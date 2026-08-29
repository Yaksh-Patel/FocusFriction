package com.focusfriction

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * FocusOverlayController — owns the pause window.
 *
 * The window is TYPE_ACCESSIBILITY_OVERLAY, which is why this class needs the
 * AccessibilityService itself as its context. That window type:
 *   - requires no SYSTEM_ALERT_WINDOW permission,
 *   - sits above application windows,
 *   - and cannot be suppressed by an app calling setHideOverlayWindows().
 *
 * Everything here runs with no JavaScript alive, so the challenge, the difficulty
 * and the outcome logging are all native.
 */
class FocusOverlayController(private val service: AccessibilityService) {

    private val policy = FocusPolicyRepository.getInstance(service)
    private val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val main = Handler(Looper.getMainLooper())

    private var overlayView: View? = null
    private var challenge: FrictionEngine.Challenge? = null
    private var attempts = 0
    private var breathingDone = false
    private var typedAnswer = StringBuilder()

    /** Package currently paused, or null when no overlay is up. */
    var pausedPackage: String? = null
        private set

    private var pausedLabel: String = ""

    val isShowing: Boolean get() = overlayView != null

    // ─── Show / hide ─────────────────────────────────────────────────────────

    fun show(packageId: String, appLabel: String) {
        if (isShowing) return

        val dailyOpens = policy.incrementOpenCount(packageId)
        challenge = FrictionEngine.generate(policy.getFrictionTypes(), dailyOpens)
        attempts = 0
        breathingDone = false
        typedAnswer = StringBuilder()
        pausedPackage = packageId
        pausedLabel = appLabel

        policy.appendEvent(packageId, appLabel, challenge!!.mode, "intercepted", 0)

        val view = LayoutInflater.from(service).inflate(R.layout.overlay_pause, null) as OverlayRootView
        bind(view, appLabel, dailyOpens)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            // Deliberately NOT FLAG_NOT_FOCUSABLE — the answer field needs the keyboard.
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }

        try {
            windowManager.addView(view, params)
            overlayView = view
        } catch (e: Exception) {
            // If the window can't be added there is nothing to fall back to;
            // leaving state clean matters more than the intervention.
            pausedPackage = null
            return
        }

        // BACK is consumed by the root view itself. A setOnKeyListener only fires
        // while that view holds focus, so BACK used to leak to the paused app the
        // moment focus moved to a keypad key.
        view.isFocusableInTouchMode = true
        view.requestFocus()
        view.onBackPressed = { onDismissed() }
    }

    /** Package the overlay was showing for, so the service can reset its debounce. */
    var lastPausedPackage: String? = null
        private set

    fun hide() {
        lastPausedPackage = pausedPackage
        val view = overlayView ?: return
        try {
            hideKeyboard(view)
            windowManager.removeViewImmediate(view)
        } catch (e: Exception) {
            // Already detached — nothing to do.
        }
        overlayView = null
        pausedPackage = null
        challenge = null
    }

    // ─── Binding ─────────────────────────────────────────────────────────────

    private fun bind(view: View, appLabel: String, dailyOpens: Int) {
        val c = challenge ?: return

        view.findViewById<TextView>(R.id.ff_app_name).text = appLabel
        view.findViewById<TextView>(R.id.ff_subtitle).text = subtitleFor(dailyOpens)

        bindNotes(view)

        val label = view.findViewById<TextView>(R.id.ff_challenge_label)
        val prompt = view.findViewById<TextView>(R.id.ff_challenge_prompt)
        val input = view.findViewById<EditText>(R.id.ff_input)
        val breathBox = view.findViewById<FrameLayout>(R.id.ff_breath_box)
        val primary = view.findViewById<TextView>(R.id.ff_btn_primary)

        when (c.mode) {
            "typing" -> {
                label.text = "TYPE THIS TO CONTINUE"
                prompt.text = "“${c.prompt}”"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
                input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                input.hint = "Type the phrase above"
            }
            "breathing" -> {
                label.text = "TAKE ONE BREATH"
                prompt.text = "In… hold… out"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                input.visibility = View.GONE
                breathBox.visibility = View.VISIBLE
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
                // Built-in keypad rather than the system IME. An EditText in a
                // TYPE_ACCESSIBILITY_OVERLAY relies on the IME focusing a
                // non-activity window, which is inconsistent across OEMs — and
                // failing there would strand the user on the pause screen.
                input.visibility = View.GONE
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
        view.findViewById<TextView>(R.id.ff_btn_notes).setOnClickListener { onOpenNotes() }
        view.findViewById<TextView>(R.id.ff_btn_skip).setOnClickListener { onSkip() }
    }

    private fun buildKeypad(view: View) {
        val keypad = view.findViewById<LinearLayout>(R.id.ff_keypad)
        keypad.removeAllViews()
        keypad.visibility = View.VISIBLE

        val rows = listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf("C", "0", "⌫")
        )

        rows.forEach { row ->
            val rowView = LinearLayout(service).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(8) }
            }

            row.forEach { key ->
                rowView.addView(TextView(service).apply {
                    text = key
                    gravity = android.view.Gravity.CENTER
                    setTextColor(service.getColor(R.color.ff_text))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                    setBackgroundResource(R.drawable.ff_btn_ghost)
                    minHeight = dp(52)
                    isClickable = true
                    layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f).apply {
                        marginStart = if (key == row.first()) 0 else dp(8)
                    }
                    setOnClickListener { onKey(view, key) }
                })
            }
            keypad.addView(rowView)
        }
        renderAnswer(view)
    }

    private fun onKey(view: View, key: String) {
        when (key) {
            "C" -> typedAnswer.clear()
            "⌫" -> if (typedAnswer.isNotEmpty()) typedAnswer.deleteCharAt(typedAnswer.length - 1)
            else -> if (typedAnswer.length < 6) typedAnswer.append(key)
        }
        view.findViewById<TextView>(R.id.ff_error).visibility = View.GONE
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
    }

    private fun subtitleFor(dailyOpens: Int): String = when {
        dailyOpens <= 1 -> "You can still go in. It just costs a moment."
        dailyOpens <= 3 -> "That's $dailyOpens times today."
        dailyOpens <= 5 -> "$dailyOpens times today. This one's harder."
        else -> "$dailyOpens times today. Worth asking why."
    }

    /**
     * Renders mirrored note headings. Reads the projection in SharedPreferences,
     * never the SQLite database — that belongs to the JS side and may not be open.
     */
    private fun bindNotes(view: View) {
        val container = view.findViewById<LinearLayout>(R.id.ff_notes_container)
        val label = view.findViewById<TextView>(R.id.ff_notes_label)
        container.removeAllViews()

        val headings = policy.getNoteHeadings()
        if (headings.length() == 0) {
            label.visibility = View.GONE
            container.visibility = View.GONE
            return
        }

        val max = minOf(headings.length(), 4)
        for (i in 0 until max) {
            val obj = headings.optJSONObject(i) ?: continue
            val title = obj.optString("title", "").trim()
            if (title.isEmpty()) continue
            container.addView(noteChip(title, obj))
        }

        if (container.childCount == 0) {
            label.visibility = View.GONE
            container.visibility = View.GONE
        }
    }

    private fun noteChip(title: String, obj: JSONObject): TextView {
        return TextView(service).apply {
            text = title
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setTextColor(service.getColor(R.color.ff_text))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setBackgroundResource(R.drawable.ff_note_chip)
            val pad = dp(13)
            setPadding(pad, dp(11), pad, dp(11))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }

            val noteId = obj.optString("id", "")
            if (noteId.isNotEmpty()) {
                isClickable = true
                setOnClickListener { onOpenNotes(noteId) }
            }
        }
    }

    private fun dp(value: Int): Int =
        (value * service.resources.displayMetrics.density).toInt()

    // ─── Breathing ───────────────────────────────────────────────────────────

    private fun startBreathing(view: View) {
        val circle = view.findViewById<View>(R.id.ff_breath_circle)
        val prompt = view.findViewById<TextView>(R.id.ff_challenge_prompt)
        val primary = view.findViewById<TextView>(R.id.ff_btn_primary)

        prompt.text = "Breathe in…"
        circle.animate()
            .scaleX(2.1f).scaleY(2.1f)
            .setDuration(4000)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction {
                if (!isShowing) return@withEndAction
                prompt.text = "Hold…"
                main.postDelayed({
                    if (!isShowing) return@postDelayed
                    prompt.text = "Breathe out…"
                    circle.animate()
                        .scaleX(1f).scaleY(1f)
                        .setDuration(4000)
                        .setInterpolator(AccelerateDecelerateInterpolator())
                        .withEndAction {
                            if (!isShowing) return@withEndAction
                            breathingDone = true
                            prompt.text = "Done"
                            primary.text = "Continue (${policy.getSolveGrantMinutes()} min)"
                            primary.alpha = 1f
                        }
                        .start()
                }, 2000)
            }
            .start()
    }

    // ─── Outcomes ────────────────────────────────────────────────────────────

    private fun onPrimary(view: View) {
        val c = challenge ?: return
        val pkg = pausedPackage ?: return

        val passed = when (c.mode) {
            "breathing" -> breathingDone
            "math" -> FrictionEngine.verify(c, typedAnswer.toString())
            else -> FrictionEngine.verify(c, view.findViewById<EditText>(R.id.ff_input).text.toString())
        }

        if (!passed) {
            if (c.mode == "breathing") return   // still counting down; not a failure
            attempts++
            val error = view.findViewById<TextView>(R.id.ff_error)
            error.text = if (attempts >= 3) "Still not right. Maybe that's the answer."
                         else "Not quite. Try again."
            error.visibility = View.VISIBLE
            if (c.mode == "math") {
                typedAnswer.clear()
                renderAnswer(view)
                view.findViewById<TextView>(R.id.ff_answer)
                    .setBackgroundResource(R.drawable.ff_input_error)
            } else {
                view.findViewById<EditText>(R.id.ff_input)
                    .setBackgroundResource(R.drawable.ff_input_error)
            }
            return
        }

        val minutes = policy.getSolveGrantMinutes()
        policy.recordUnlock(pkg, minutes)
        policy.appendEvent(pkg, pausedLabel, c.mode, "solved", minutes)
        hide()
    }

    private fun onSkip() {
        val pkg = pausedPackage ?: return
        val minutes = policy.getBypassGrantMinutes()
        policy.recordUnlock(pkg, minutes)
        policy.appendEvent(pkg, pausedLabel, challenge?.mode ?: "none", "bypassed", minutes)
        hide()
    }

    private fun onOpenNotes(noteId: String? = null) {
        val pkg = pausedPackage ?: return
        policy.appendEvent(pkg, pausedLabel, challenge?.mode ?: "none", "goals", 0)
        // No unlock recorded — the user chose not to go in.
        hide()

        // Handed off through the policy store rather than an intent extra: the RN
        // activity usually already exists, in which case extras on a CLEAR_TOP
        // launch are easy to miss and the app just resumes wherever it was left.
        // An empty string still means "show the notes tab".
        policy.setPendingOpen(noteId ?: "")

        val intent = Intent(service, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        try {
            service.startActivity(intent)
        } catch (e: Exception) {
            service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
        }
    }

    /** BACK pressed, or the user navigated away: no grant, send them home. */
    fun onDismissed() {
        val pkg = pausedPackage
        if (pkg != null) {
            policy.appendEvent(pkg, pausedLabel, challenge?.mode ?: "none", "dismissed", 0)
        }
        hide()
        // No unlock was granted, so the app must not be left in front — otherwise
        // backing out of the pause is a free pass straight into it.
        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
    }

    private fun hideKeyboard(view: View) {
        try {
            val imm = service.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.hideSoftInputFromWindow(view.windowToken, 0)
        } catch (e: Exception) {
            // best effort
        }
    }
}
