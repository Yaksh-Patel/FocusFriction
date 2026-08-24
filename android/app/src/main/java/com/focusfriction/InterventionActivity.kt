package com.focusfriction

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * InterventionActivity — Non-exported Activity that owns the intervention lifecycle.
 *
 * Receives: packageId, appLabel, sessionId
 * On complete: writes access decision natively, then explicitly launches target app.
 *
 * NOT exported — only the AccessibilityService can start this via explicit intent.
 */
class InterventionActivity : Activity() {

    companion object {
        const val EXTRA_PACKAGE_ID = "extra_package_id"
        const val EXTRA_APP_LABEL = "extra_app_label"
        const val EXTRA_SESSION_ID = "extra_session_id"
        const val OUTCOME_SOLVED = "solved"
        const val OUTCOME_BYPASSED = "bypassed"
        const val OUTCOME_GOALS = "goals"

        // Singleton reference so JS bridge can call completeIntervention
        @Volatile
        var current: InterventionActivity? = null
    }

    private var packageId: String = ""
    private var appLabel: String = ""
    private var sessionId: String = ""
    private lateinit var policy: FocusPolicyRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this

        packageId = intent.getStringExtra(EXTRA_PACKAGE_ID) ?: ""
        appLabel = intent.getStringExtra(EXTRA_APP_LABEL) ?: "This app"
        sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: ""
        policy = FocusPolicyRepository.getInstance(applicationContext)

        // Validate session — ignore if stale
        if (packageId.isEmpty() || sessionId.isEmpty() || !policy.isSessionActive(sessionId)) {
            finish()
            return
        }

        // Launch the main FocusFriction app with intervention data embedded in intent
        // The main app reads these extras and renders InterventionScreen
        val mainIntent = Intent(this, MainActivity::class.java).apply {
            putExtra(EXTRA_PACKAGE_ID, packageId)
            putExtra(EXTRA_APP_LABEL, appLabel)
            putExtra(EXTRA_SESSION_ID, sessionId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            action = "com.focusfriction.INTERVENTION"
        }
        startActivity(mainIntent)
        // Don't finish — stay in back stack so onComplete can be called
    }

    /**
     * Called by the native bridge (InterventionModule) when JS reports completion.
     * @param outcome: "solved" | "bypassed" | "goals"
     */
    fun onComplete(outcome: String) {
        if (!policy.isSessionActive(sessionId)) {
            finish()
            return
        }

        policy.clearActiveSession()
        current = null

        when (outcome) {
            OUTCOME_SOLVED -> {
                val grantMinutes = policy.getSolveGrantMinutes()
                policy.recordUnlock(packageId, grantMinutes)
                launchTargetApp()
            }
            OUTCOME_BYPASSED -> {
                val grantMinutes = policy.getBypassGrantMinutes()
                policy.recordUnlock(packageId, grantMinutes)
                launchTargetApp()
            }
            OUTCOME_GOALS -> {
                // Don't grant access — just return to FocusFriction main UI
                // MainActivity is already in the stack from onCreate
                val intent = Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    action = "com.focusfriction.HOME"
                }
                startActivity(intent)
            }
            else -> finish()
        }
        finish()
    }

    private fun launchTargetApp() {
        try {
            val pm = packageManager
            val launchIntent = pm.getLaunchIntentForPackage(packageId)
            if (launchIntent != null) {
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(launchIntent)
            } else {
                // Target not launchable — go to FocusFriction home
                val homeIntent = Intent(this, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    action = "com.focusfriction.HOME"
                    putExtra("error_message", "Could not open $appLabel. It may no longer be installed.")
                }
                startActivity(homeIntent)
            }
        } catch (e: Exception) {
            finish()
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(homeIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (current == this) {
            policy.clearActiveSession()
            current = null
        }
    }
}
