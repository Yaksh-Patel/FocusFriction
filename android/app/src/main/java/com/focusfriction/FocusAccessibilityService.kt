package com.focusfriction

import android.accessibilityservice.AccessibilityService
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

    private var overlay: FocusOverlayController? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        isConnected = true
        overlay = FocusOverlayController(this)
        lastEventByPackage.clear()
        FocusPolicyRepository.getInstance(applicationContext).pruneExpiredUnlocks()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val packageId = event.packageName?.toString()?.trim().orEmpty()
        if (packageId.isBlank()) return

        val controller = overlay ?: return

        // Our own windows must never drive the state machine.
        if (packageId == packageName) return

        // While the pause is up, ignore the world. The app it concerns has been
        // sent to the background, so every window event now describes the
        // launcher or a system surface — none of which mean the user decided
        // anything. The overlay comes down only through an explicit choice, BACK,
        // or its own safety timeout.
        if (controller.isShowing) return

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

        controller.show(packageId, label)
    }

    override fun onInterrupt() {
        overlay?.hide()
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        isConnected = false
        overlay?.hide()
        overlay = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        isConnected = false
        overlay?.hide()
        overlay = null
        super.onDestroy()
    }
}
