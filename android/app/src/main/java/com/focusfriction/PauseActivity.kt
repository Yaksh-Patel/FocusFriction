package com.focusfriction

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * PauseActivity — the friction screen.
 *
 * This was previously a TYPE_ACCESSIBILITY_OVERLAY window, which was a mistake.
 * That window type is layered above the status bar, the navigation bar and the
 * keyguard, so while it was up the notification shade would not open, the nav
 * buttons did nothing, and unlocking the phone landed back on it. The user was
 * genuinely stuck with only the three buttons on the card.
 *
 * A plain Activity is a normal window: the shade pulls down, the nav bar works,
 * recents works, and the lock screen behaves. It is also self-contained native
 * code — the original design's failure was chaining into the React Native app and
 * racing its cold start, not the use of an Activity.
 *
 * Nothing here uses the system keyboard: math has a keypad and the typing
 * challenge is tap-the-words-in-order.
 */
class PauseActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE_ID = "extra_package_id"
        const val EXTRA_APP_LABEL = "extra_app_label"

        /** Lets the accessibility service avoid stacking a second pause. */
        @Volatile
        var isShowing: Boolean = false
            private set
    }

    private lateinit var policy: FocusPolicyRepository
    private var challenge: FrictionEngine.Challenge? = null

    private var packageId: String = ""
    private var appLabel: String = ""
    private var attempts = 0
    private var breathingDone = false
    private var decided = false

    private var typedAnswer = StringBuilder()
    private var remainingWords = mutableListOf<String>()
    private var placedWords = mutableListOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        packageId = intent.getStringExtra(EXTRA_PACKAGE_ID).orEmpty()
        appLabel = intent.getStringExtra(EXTRA_APP_LABEL) ?: packageId
        policy = FocusPolicyRepository.getInstance(applicationContext)

        if (packageId.isBlank()) { finish(); return }

        setContentView(R.layout.overlay_pause)

        val dailyOpens = policy.incrementOpenCount(packageId)
        challenge = FrictionEngine.generate(policy.getFrictionTypes(), dailyOpens)
        policy.appendEvent(packageId, appLabel, challenge!!.mode, "intercepted", 0)

        bind(findViewById(R.id.ff_root), dailyOpens)
    }

    override fun onStart() {
        super.onStart()
        isShowing = true
    }

    override fun onStop() {
        super.onStop()
        isShowing = false
        // Left without choosing — switched apps, locked the phone, whatever. No
        // grant was recorded, so re-opening the app pauses again.
        if (!decided) {
            policy.appendEvent(packageId, appLabel, challenge?.mode ?: "none", "dismissed", 0)
            decided = true
            finish()
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (!decided) {
            policy.appendEvent(packageId, appLabel, challenge?.mode ?: "none", "dismissed", 0)
            decided = true
        }
        goHome()
    }

    // ─── Binding ─────────────────────────────────────────────────────────────

    private fun bind(root: View, dailyOpens: Int) {
        val c = challenge ?: return

        findViewById<TextView>(R.id.ff_app_name).text = appLabel
        findViewById<TextView>(R.id.ff_subtitle).text = subtitleFor(dailyOpens)
        bindNotes()

        val label = findViewById<TextView>(R.id.ff_challenge_label)
        val prompt = findViewById<TextView>(R.id.ff_challenge_prompt)
        val primary = findViewById<TextView>(R.id.ff_btn_primary)

        when (c.mode) {
            "typing" -> {
                label.text = "TAP THE WORDS IN ORDER"
                prompt.text = "“${c.prompt}”"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                findViewById<TextView>(R.id.ff_typed).visibility = View.VISIBLE
                findViewById<LinearLayout>(R.id.ff_wordbank).visibility = View.VISIBLE
                remainingWords = c.prompt.split(" ").filter { it.isNotBlank() }.toMutableList()
                buildWordBank()
                renderTyped()
            }
            "breathing" -> {
                label.text = "TAKE ONE BREATH"
                prompt.text = "In… hold… out"
                prompt.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                findViewById<FrameLayout>(R.id.ff_breath_box).visibility = View.VISIBLE
                primary.text = "Breathe…"
                primary.alpha = 0.4f
                startBreathing()
            }
            else -> {
                label.text = when {
                    c.difficulty >= 3 -> "SOLVE TO CONTINUE · HARD"
                    c.difficulty == 2 -> "SOLVE TO CONTINUE · MEDIUM"
                    else -> "SOLVE TO CONTINUE"
                }
                prompt.text = c.prompt
                findViewById<TextView>(R.id.ff_answer).visibility = View.VISIBLE
                buildKeypad()
            }
        }

        findViewById<TextView>(R.id.ff_btn_skip).text =
            "Skip this time (${policy.getBypassGrantMinutes()} min)"
        if (c.mode != "breathing") {
            primary.text = "Continue (${policy.getSolveGrantMinutes()} min)"
        }

        primary.setOnClickListener { onPrimary() }
        findViewById<TextView>(R.id.ff_btn_notes).setOnClickListener { onOpenNotes(null) }
        findViewById<TextView>(R.id.ff_btn_skip).setOnClickListener {
            grantAndOpen(policy.getBypassGrantMinutes(), "bypassed")
        }
    }

    private fun subtitleFor(dailyOpens: Int): String = when {
        dailyOpens <= 1 -> "You can still go in. It just costs a moment."
        dailyOpens <= 3 -> "That's $dailyOpens times today."
        dailyOpens <= 5 -> "$dailyOpens times today. This one's harder."
        else -> "$dailyOpens times today. Worth asking why."
    }

    /** Headings from the mirrored projection — never from the notes database. */
    private fun bindNotes() {
        val container = findViewById<LinearLayout>(R.id.ff_notes_container)
        val label = findViewById<TextView>(R.id.ff_notes_label)
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

    // ─── Typing challenge ────────────────────────────────────────────────────

    private fun buildWordBank() {
        val bank = findViewById<LinearLayout>(R.id.ff_wordbank)
        bank.removeAllViews()

        var row = newRow()
        var rowChars = 0
        remainingWords.shuffled().forEach { word ->
            if (rowChars + word.length > 22 && row.childCount > 0) {
                bank.addView(row); row = newRow(); rowChars = 0
            }
            row.addView(wordChip(word))
            rowChars += word.length + 3
        }
        if (row.childCount > 0) bank.addView(row)
    }

    private fun newRow() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(8) }
    }

    private fun wordChip(word: String): TextView = TextView(this).apply {
        text = word
        gravity = Gravity.CENTER
        setTextColor(getColor(R.color.ff_text))
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
                hideError()
                renderTyped()
            } else {
                showError("Not that word — follow the phrase in order.")
            }
        }
    }

    private fun renderTyped() {
        val field = findViewById<TextView>(R.id.ff_typed)
        if (placedWords.isEmpty()) {
            field.text = "Tap the words below"
            field.setTextColor(getColor(R.color.ff_text_dim))
        } else {
            field.text = placedWords.joinToString(" ")
            field.setTextColor(getColor(R.color.ff_text))
        }
        field.isClickable = true
        field.setOnClickListener {
            if (placedWords.isNotEmpty()) {
                remainingWords.add(0, placedWords.removeAt(placedWords.size - 1))
                buildWordBank()
                renderTyped()
            }
        }
    }

    // ─── Math challenge ──────────────────────────────────────────────────────

    private fun buildKeypad() {
        val keypad = findViewById<LinearLayout>(R.id.ff_keypad)
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
                row.addView(TextView(this).apply {
                    text = key
                    gravity = Gravity.CENTER
                    setTextColor(getColor(R.color.ff_text))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                    setBackgroundResource(R.drawable.ff_btn_ghost)
                    isClickable = true
                    layoutParams = LinearLayout.LayoutParams(0, dp(52), 1f).apply {
                        marginStart = if (key == rowKeys.first()) 0 else dp(8)
                    }
                    setOnClickListener { onKey(key) }
                })
            }
            keypad.addView(row)
        }
        renderAnswer()
    }

    private fun onKey(key: String) {
        when (key) {
            "C" -> typedAnswer.clear()
            "⌫" -> if (typedAnswer.isNotEmpty()) typedAnswer.deleteCharAt(typedAnswer.length - 1)
            else -> if (typedAnswer.length < 6) typedAnswer.append(key)
        }
        hideError()
        renderAnswer()
    }

    private fun renderAnswer() {
        val field = findViewById<TextView>(R.id.ff_answer)
        if (typedAnswer.isEmpty()) {
            field.text = "Tap the numbers"
            field.setTextColor(getColor(R.color.ff_text_dim))
        } else {
            field.text = typedAnswer.toString()
            field.setTextColor(getColor(R.color.ff_text))
        }
        field.setBackgroundResource(R.drawable.ff_input_bg)
    }

    // ─── Breathing ───────────────────────────────────────────────────────────

    private fun startBreathing() {
        val circle = findViewById<View>(R.id.ff_breath_circle)
        val prompt = findViewById<TextView>(R.id.ff_challenge_prompt)
        val primary = findViewById<TextView>(R.id.ff_btn_primary)

        prompt.text = "Breathe in…"
        circle.animate().scaleX(2.1f).scaleY(2.1f)
            .setDuration(4000)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .withEndAction {
                if (isFinishing) return@withEndAction
                prompt.text = "Hold…"
                circle.postDelayed({
                    if (isFinishing) return@postDelayed
                    prompt.text = "Breathe out…"
                    circle.animate().scaleX(1f).scaleY(1f)
                        .setDuration(4000)
                        .setInterpolator(AccelerateDecelerateInterpolator())
                        .withEndAction {
                            if (isFinishing) return@withEndAction
                            breathingDone = true
                            prompt.text = "Done"
                            primary.text = "Continue (${policy.getSolveGrantMinutes()} min)"
                            primary.alpha = 1f
                        }.start()
                }, 2000)
            }.start()
    }

    // ─── Outcomes ────────────────────────────────────────────────────────────

    private fun onPrimary() {
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
                "typing" -> showError("Place every word first.")
                else -> {
                    attempts++
                    showError(
                        if (attempts >= 3) "Still not right. Maybe that's the answer."
                        else "Not quite. Try again."
                    )
                    typedAnswer.clear()
                    renderAnswer()
                    findViewById<TextView>(R.id.ff_answer)
                        .setBackgroundResource(R.drawable.ff_input_error)
                }
            }
            return
        }

        grantAndOpen(policy.getSolveGrantMinutes(), "solved")
    }

    private fun grantAndOpen(minutes: Int, outcome: String) {
        decided = true
        policy.recordUnlock(packageId, minutes)
        policy.appendEvent(packageId, appLabel, challenge?.mode ?: "none", outcome, minutes)

        try {
            packageManager.getLaunchIntentForPackage(packageId)?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(it)
            }
        } catch (e: Exception) {
            // The unlock stands; the user can open it themselves.
        }
        finish()
    }

    private fun onOpenNotes(noteId: String?) {
        decided = true
        policy.appendEvent(packageId, appLabel, challenge?.mode ?: "none", "goals", 0)
        // No unlock recorded: the user chose not to go in.
        policy.setPendingOpen(noteId ?: "")

        try {
            startActivity(Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            })
        } catch (e: Exception) {
            // The pending flag survives until the app is next opened.
        }
        finish()
    }

    private fun goHome() {
        try {
            startActivity(Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        } catch (e: Exception) {
            // Falling through to finish() is good enough.
        }
        finish()
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private fun showError(message: String) {
        findViewById<TextView>(R.id.ff_error).apply {
            text = message
            visibility = View.VISIBLE
        }
    }

    private fun hideError() {
        findViewById<TextView>(R.id.ff_error).visibility = View.GONE
    }

    private fun fullWidthChip(text: String, onClick: () -> Unit): TextView = TextView(this).apply {
        this.text = text
        maxLines = 2
        ellipsize = android.text.TextUtils.TruncateAt.END
        setTextColor(getColor(R.color.ff_text))
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

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
