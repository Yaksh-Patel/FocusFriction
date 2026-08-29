package com.focusfriction

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * FocusAccessibilityService — foreground-app detector and overlay host.
 *
 * The previous design launched an Activity, which launched the whole React Native
 * app, and hoped JS booted before the activity was destroyed. It lost that race
 * routinely. This version answers the decision synchronously and adds a window
 * directly — no activity, no bridge, no cold start.
 */
class FocusAccessibilityService : AccessibilityService() {

    companion object {
        /** Set while the service is connected, so the JS bridge can ask if it's live. */
        @Volatile
        var isConnected: Boolean = false
            private set
    }

    // Debounced per package. A single shared timestamp meant any window change —
    // including our own overlay — suppressed a genuine app open moments later.
    private val lastEventByPackage = HashMap<String, Long>()
    private val debounceMs = 700L
    private val maxTrackedPackages = 64

    override fun onServiceConnected() {
        super.onServiceConnected()
        isConnected = true
        lastEventByPackage.clear()
        FocusPolicyRepository.getInstance(applicationContext).pruneExpiredUnlocks()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageId = event.packageName?.toString()?.trim().orEmpty()
        if (packageId.isBlank()) return

        // Our own windows must never drive the state machine.
        if (packageId == packageName) return

        // A pause is already on screen; don't stack another.
        if (PauseActivity.isShowing) return

        val now = System.currentTimeMillis()
        val last = lastEventByPackage[packageId] ?: 0L
        if (now - last < debounceMs) return
        if (lastEventByPackage.size > maxTrackedPackages) {
            lastEventByPackage.entries.removeAll { now - it.value > debounceMs * 20 }
        }
        lastEventByPackage[packageId] = now

        val policy = FocusPolicyRepository.getInstance(applicationContext)
        policy.pruneExpiredUnlocks()
        if (!policy.shouldIntercept(packageId)) return

        val label = try {
            val pm = applicationContext.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(packageId, 0)).toString()
        } catch (e: Exception) {
            packageId
        }

        // Accessibility services are exempt from background-activity-launch limits.
        try {
            startActivity(Intent(this, PauseActivity::class.java).apply {
                putExtra(PauseActivity.EXTRA_PACKAGE_ID, packageId)
                putExtra(PauseActivity.EXTRA_APP_LABEL, label)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            })
        } catch (e: Exception) {
            // Nothing to fall back to; the next window change will try again.
        }
    }

    override fun onInterrupt() {
        // Nothing to tear down: the pause screen is an Activity with its own
        // lifecycle, not a window this service holds.
    }

    override fun onUnbind(intent: Intent?): Boolean {
        isConnected = false
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        isConnected = false
        super.onDestroy()
    }
}
