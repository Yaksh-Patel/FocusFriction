package com.focusfriction

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import java.util.UUID

/**
 * FocusAccessibilityService — Foreground app detector with proper state machine.
 *
 * States:
 *   IDLE → INTERVENTION_ACTIVE(sessionId, packageId) → IDLE
 *   IDLE → ALLOWED_UNTIL_EXPIRY (no action)
 *   IDLE → OUTSIDE_SCHEDULE (no action)
 */
class FocusAccessibilityService : AccessibilityService() {

    private var lastEventTimestamp: Long = 0L
    private val DEBOUNCE_MS = 1000L

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageId = event.packageName?.toString()?.trim() ?: return
        if (packageId.isBlank()) return

        // Debounce rapid duplicate events
        val now = System.currentTimeMillis()
        if (now - lastEventTimestamp < DEBOUNCE_MS) return
        lastEventTimestamp = now

        val policy = FocusPolicyRepository.getInstance(applicationContext)
        policy.pruneExpiredUnlocks()

        // If an intervention is already active, ignore
        val currentSessionPkg = policy.getActiveSessionPackage()
        val currentSessionId = policy.getActiveSessionId()
        if (currentSessionPkg != null && currentSessionId != null) {
            return
        }

        // Core decision
        if (!policy.shouldIntercept(packageId)) return

        // Create a new intervention session
        val sessionId = UUID.randomUUID().toString()
        policy.setActiveSession(packageId, sessionId)

        // Get app label for display
        val appLabel = try {
            val pm = applicationContext.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(packageId, 0)).toString()
        } catch (e: Exception) {
            packageId
        }

        // Launch InterventionActivity via explicit internal intent
        val intent = Intent(applicationContext, InterventionActivity::class.java).apply {
            putExtra(InterventionActivity.EXTRA_PACKAGE_ID, packageId)
            putExtra(InterventionActivity.EXTRA_APP_LABEL, appLabel)
            putExtra(InterventionActivity.EXTRA_SESSION_ID, sessionId)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        applicationContext.startActivity(intent)
    }

    override fun onInterrupt() {
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        // Reset any stale session
        FocusPolicyRepository.getInstance(applicationContext).clearActiveSession()
    }

    /**
     * Called by InterventionActivity when intervention is complete.
     */
    fun onInterventionComplete() {
        FocusPolicyRepository.getInstance(applicationContext).clearActiveSession()
    }
}
