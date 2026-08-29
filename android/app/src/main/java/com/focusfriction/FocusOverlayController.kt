package com.focusfriction

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * FocusOverlayController — owns the pause window.
 *
 * The window is TYPE_ACCESSIBILITY_OVERLAY: no SYSTEM_ALERT_WINDOW permission, it
 * sits above application windows, and an app cannot suppress it with
 * setHideOverlayWindows().
 *
 * Two decisions here came out of the overlay misbehaving on a real device:
 *
 *  1. Showing the overlay also sends the user HOME. Keeping a modal window in
 *     front of a live app was a losing battle — BACK leaked through to it, and
 *     the app's own dialogs (a location prompt, say) tore the overlay down. With
 *     the app backgrounded there is nothing behind the overlay to leak into. On
 *     Continue or Skip the app is launched explicitly.
 *
 *  2. Nothing here uses the system keyboard. Math has a keypad; the typing
 *     challenge is tap-the-words-in-order. An EditText in this window type showed
 *     no cursor, could not be dismissed, and hid the card behind the IME.
 */
class FocusOverlayController(private val service: AccessibilityService) {

    companion object {
        /** Belt and braces: never leave a pause window up indefinitely. */
        private const val MAX_VISIBLE_MS = 3 * 60 * 1000L
    }

    private val policy = FocusPolicyRepository.getInstance(service)
    private val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val main = Handler(Looper.getMainLooper())

    private var overlayView: OverlayRootView? = null
    private var challenge: FrictionEngine.Challenge? = null
    private var attempts = 0
    private var breathingDone = false

    private var typedAnswer = StringBuilder()             // math keypad buffer
    private var remainingWords = mutableListOf<String>()  // typing: words still to place
    private var placedWords = mutableListOf<String>()

    private var pausedPackage: String? = null
    private var pausedLabel: String = ""

    private val autoDismiss = Runnable { if (isShowing) onDismissed() }

    val isShowing: Boolean get() = overlayView != null

    // ─── Show / hide ─────────────────────────────────────────────────────────

    fun show(packageId: String, appLabel: String) {
        if (isShowing) return

        val dailyOpens = policy.incrementOpenCount(packageId)
        challenge = FrictionEngine.generate(policy.getFrictionTypes(), dailyOpens)
        attempts = 0
        breathingDone = false
        typedAnswer = StringBuilder()
        placedWords = mutableListOf()
        remainingWords = mutableListOf()
        pausedPackage = packageId
        pausedLabel = appLabel

        policy.appendEvent(packageId, appLabel, challenge!!.mode, "intercepted", 0)

        val view = LayoutInflater.from(service)
            .inflate(R.layout.overlay_pause, null) as OverlayRootView
        bind(view, appLabel, dailyOpens)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.CENTER }

        try {
            windowManager.addView(view, params)
            overlayView = view
        } catch (e: Exception) {
            pausedPackage = null
            return
        }

        view.isFocusableInTouchMode = true
        view.requestFocus()
        view.onBackPressed = { onDismissed() }

        // Background the app this pause is about. Done after the window is up so
        // the launcher never flashes into view.
        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)

        main.postDelayed(autoDismiss, MAX_VISIBLE_MS)
    }

    fun hide() {
        main.removeCallbacks(autoDismiss)
        val view = overlayView ?: return
        try {
            windowManager.removeViewImmediate(view)
        } catch (e: Exception) {
            // Already detached.
        }
        overlayView = null
        challenge = null
        pausedPackage = null
    }

    // ─── Binding ─────────────────────────────────────────────────────────────

    private fun bind(view: View, appLabel: String, dailyOpens: Int) {
        val c = challenge ?: return

        view.findViewById<TextView>(R.id.ff_app_name).text = appLabel
        view.findViewById<TextView>(R.id.ff_subtitle).text = subtitleFor(dailyOpens)
        bindNotes(view)

        val label = view.findViewById<TextView>(R.id.ff_challenge_label)
        val prompt = view.findViewById<TextView>(R.id.ff_challenge_prompt)
        val primary = view.findViewById<TextView>(R.id.ff_btn_primary)

        when (c.mode) {
            "typing" -> {
                label.text = "TAP THE WORDS IN ORDER"
                prompt.text = "“${c.prompt}”"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                view.findViewById<TextView>(R.id.ff_typed).visibility = View.VISIBLE
                view.findViewById<LinearLayout>(R.id.ff_wordbank).visibility = View.VISIBLE
                remainingWords = c.prompt.split(" ").filter { it.isNotBlank() }.toMutableList()
                buildWordBank(view)
                renderTyped(view)
            }
            "breathing" -> {
                label.text = "TAKE ONE BREATH"
                prompt.text = "In… hold… out"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                view.findViewById<FrameLayout>(R.id.ff_breath_box).visibility = View.VISIBLE
                primary.text = "Breathe…"
                primary.alpha = 0.4f
                startBreathing(view)
            }
            else -> {
                label.text = when {
                    c.difficulty >= 3 -> "SOLVE TO CONTINUE · HARD"
                    c.difficulty == 2 -> "SOLVE TO CONTINUE · MEDIUM"
                    else -> "SOLVE TO CONTINUE"
                }
                prompt.text = c.prompt
                view.findViewById<TextView>(R.id.ff_answer).visibility = View.VISIBLE
                buildKeypad(view)
            }
        }

        view.findViewById<TextView>(R.id.ff_btn_skip).text =
            "Skip this time (${policy.getBypassGrantMinutes()} min)"
        if (c.mode != "breathing") {
            primary.text = "Continue (${policy.getSolveGrantMinutes()} min)"
        }

        primary.setOnClickListener { onPrimary(view) }
        view.findViewById<TextView>(R.id.ff_btn_notes).setOnClickListener { onOpenNotes(null) }
        view.findViewById<TextView>(R.id.ff_btn_skip).setOnClickListener { onSkip() }
    }

    private fun subtitleFor(dailyOpens: Int): String = when {
        dailyOpens <= 1 -> "You can still go in. It just costs a moment."
        dailyOpens <= 3 -> "That's $dailyOpens times today."
        dailyOpens <= 5 -> "$dailyOpens times today. This one's harder."
        else -> "$dailyOpens times today. Worth asking why."
    }

    /** Note headings, read from the mirrored projection — never from SQLite. */
    private fun bindNotes(view: View) {
        val container = view.findViewById<LinearLayout>(R.id.ff_notes_container)
        val label = view.findViewById<TextView>(R.id.ff_notes_label)
        container.removeAllViews()

        val headings = policy.getNoteHeadings()
        for (i in 0 until minOf(headings.length(), 4)) {
            val obj = headings.optJSONObject(i) ?: continue
            val title = obj.optString("title", "").trim()
            if (title.isEmpty()) continue
            val noteId = obj.optString("id", "")
            container.addView(fullWidthChip(title) { onOpenNotes(noteId.ifBlank { null }) })
        }

        if (container.childCount == 0) {
            label.visibility = View.GONE
            container.visibility = View.GONE
        }
    }

    // ─── Typing challenge: tap the words in order ────────────────────────────

    private fun buildWordBank(view: View) {
        val bank = view.findViewById<LinearLayout>(R.id.ff_wordbank)
        bank.removeAllViews()

        // Shuffled, so the order has to come from reading the phrase.
        val shuffled = remainingWords.shuffled()

        // Greedy row packing by character count. A plain LinearLayout has no
        // flow layout, and estimating is plenty for short phrases.
        var row = newRow()
        var rowChars = 0
        shuffled.forEach { word ->
            if (rowChars + word.length > 22 && row.childCount > 0) {
                bank.addView(row)
                row = newRow()
                rowChars = 0
            }
            row.addView(wordChip(word, view))
            rowChars += word.length + 3
        }
        if (row.childCount > 0) bank.addView(row)
    }

    private fun newRow() = LinearLayout(service).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(8) }
    }

    private fun wordChip(word: String, root: View): TextView =
        TextView(service).apply {
            text = word
            gravity = Gravity.CENTER
            setTextColor(service.getColor(R.color.ff_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setBackgroundResource(R.drawable.ff_note_chip)
            setPadding(dp(13), dp(10), dp(13), dp(10))
            isClickable = true
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(8) }
            setOnClickListener {
                if (remainingWords.firstOrNull() == word) {
                    placedWords.add(word)
                    remainingWords.removeAt(0)
                    visibility = View.INVISIBLE
                    isClickable = false
                    hideError(root)
                    renderTyped(root)
                } else {
                    showError(root, "Not that word — follow the phrase in order.")
                }
            }
        }

    private fun renderTyped(view: View) {
        val field = view.findViewById<TextView>(R.id.ff_typed)
        if (placedWords.isEmpty()) {
            field.text = "Tap the words below"
            field.setTextColor(service.getColor(R.color.ff_text_dim))
        } else {
            field.text = placedWords.joinToString(" ")
            field.setTextColor(service.getColor(R.color.ff_text))
        }
        // Tap what you have built to take the last word back.
        field.isClickable = true
        field.setOnClickListener {
            if (placedWords.isNotEmpty()) {
                val last = placedWords.removeAt(placedWords.size - 1)
                remainingWords.add(0, last)
                buildWordBank(view)
                renderTyped(view)
            }
        }
    }

    // ─── Math challenge: keypad ──────────────────────────────────────────────

    private fun buildKeypad(view: View) {
        val keypad = view.findViewById<LinearLayout>(R.id.ff_keypad)
        keypad.removeAllViews()
        keypad.visibility = View.VISIBLE

        listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("C", "0", "⌫")
        ).forEach { rowKeys ->
            val row = newRow()
            rowKeys.forEach { key ->
                row.addView(TextView(service).apply {
                    text = key
                    gravity = Gravity.CENTER
                    setTextColor(service.getColor(R.color.ff_text))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                    setBackgroundResource(R.drawable.ff_btn_ghost)
                    isClickable = true
                    layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f).apply {
                        marginStart = if (key == rowKeys.first()) 0 else dp(8)
                    }
                    setOnClickListener { onKey(view, key) }
                })
            }
            keypad.addView(row)
        }
        renderAnswer(view)
    }

    private fun onKey(view: View, key: String) {
        when (key) {
            "C" -> typedAnswer.clear()
            "⌫" -> if (typedAnswer.isNotEmpty()) typedAnswer.deleteCharAt(typedAnswer.length - 1)
            else -> if (typedAnswer.length < 6) typedAnswer.append(key)
        }
        hideError(view)
        renderAnswer(view)
    }

    private fun renderAnswer(view: View) {
        val field = view.findViewById<TextView>(R.id.ff_answer)
        if (typedAnswer.isEmpty()) {
            field.text = "Tap the numbers"
            field.setTextColor(service.getColor(R.color.ff_text_dim))
        } else {
            field.text = typedAnswer.toString()
            field.setTextColor(service.getColor(R.color.ff_text))
        }
        field.setBackgroundResource(R.drawable.ff_input_bg)
    }

    // ─── Breathing ───────────────────────────────────────────────────────────

    private fun startBreathing(view: View) {
        val circle = view.findViewById<View>(R.id.ff_breath_circle)
        val prompt = view.findViewById<TextView>(R.id.ff_challenge_prompt)
        val primary = view.findViewById<TextView>(R.id.ff_btn_primary)

        prompt.text = "Breathe in…"
        circle.animate().scaleX(2.1f).scaleY(2.1f)
            .setDuration(4000)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction {
                if (!isShowing) return@withEndAction
                prompt.text = "Hold…"
                main.postDelayed({
                    if (!isShowing) return@postDelayed
                    prompt.text = "Breathe out…"
                    circle.animate().scaleX(1f).scaleY(1f)
                        .setDuration(4000)
                        .setInterpolator(AccelerateDecelerateInterpolator())
                        .withEndAction {
                            if (!isShowing) return@withEndAction
                            breathingDone = true
                            prompt.text = "Done"
                            primary.text = "Continue (${policy.getSolveGrantMinutes()} min)"
                            primary.alpha = 1f
                        }.start()
                }, 2000)
            }.start()
    }

    // ─── Outcomes ────────────────────────────────────────────────────────────

    private fun onPrimary(view: View) {
        val c = challenge ?: return

        val passed = when (c.mode) {
            "breathing" -> breathingDone
            "typing" -> remainingWords.isEmpty() &&
                FrictionEngine.verify(c, placedWords.joinToString(" "))
            else -> FrictionEngine.verify(c, typedAnswer.toString())
        }

        if (!passed) {
            when (c.mode) {
                "breathing" -> return          // still counting down; not a failure
                "typing" -> showError(view, "Place every word first.")
                else -> {
                    attempts++
                    showError(
                        view,
                        if (attempts >= 3) "Still not right. Maybe that's the answer."
                        else "Not quite. Try again."
                    )
                    typedAnswer.clear()
                    renderAnswer(view)
                    view.findViewById<TextView>(R.id.ff_answer)
                        .setBackgroundResource(R.drawable.ff_input_error)
                }
            }
            return
        }

        grantAndOpen(policy.getSolveGrantMinutes(), "solved")
    }

    private fun onSkip() = grantAndOpen(policy.getBypassGrantMinutes(), "bypassed")

    /** Record the grant, take the overlay down, then open the app. */
    private fun grantAndOpen(minutes: Int, outcome: String) {
        val pkg = pausedPackage ?: return
        val label = pausedLabel
        val mode = challenge?.mode ?: "none"

        policy.recordUnlock(pkg, minutes)
        policy.appendEvent(pkg, label, mode, outcome, minutes)
        hide()

        // The app was backgrounded when the pause appeared, so it has to be
        // launched rather than simply revealed.
        try {
            service.packageManager.getLaunchIntentForPackage(pkg)?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                service.startActivity(it)
            }
        } catch (e: Exception) {
            // The unlock stands; the user can open it themselves.
        }
    }

    private fun onOpenNotes(noteId: String?) {
        val pkg = pausedPackage ?: return
        policy.appendEvent(pkg, pausedLabel, challenge?.mode ?: "none", "goals", 0)
        // No unlock recorded: the user chose not to go in.
        policy.setPendingOpen(noteId ?: "")
        hide()

        try {
            service.startActivity(Intent(service, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            })
        } catch (e: Exception) {
            // The pending flag survives; the app acts on it when next opened.
        }
    }

    /** BACK, or the safety timeout. No grant, and the user is already home. */
    fun onDismissed() {
        pausedPackage?.let {
            policy.appendEvent(it, pausedLabel, challenge?.mode ?: "none", "dismissed", 0)
        }
        hide()
    }

    // ─── Small helpers ───────────────────────────────────────────────────────

    private fun showError(view: View, message: String) {
        view.findViewById<TextView>(R.id.ff_error).apply {
            text = message
            visibility = View.VISIBLE
        }
    }

    private fun hideError(view: View) {
        view.findViewById<TextView>(R.id.ff_error).visibility = View.GONE
    }

    private fun fullWidthChip(text: String, onClick: () -> Unit): TextView =
        TextView(service).apply {
            this.text = text
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(service.getColor(R.color.ff_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setBackgroundResource(R.drawable.ff_note_chip)
            setPadding(dp(13), dp(11), dp(13), dp(11))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }
            isClickable = true
            setOnClickListener { onClick() }
        }

    private fun dp(value: Int): Int =
        (value * service.resources.displayMetrics.density).toInt()
}
