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

    /**
     * Windows that routinely appear *over* a paused app without the user having
     * left it: permission prompts, system dialogs, the keyboard, the shade.
     * Treating these as "user navigated away" is what let a location-permission
     * dialog dismiss the pause and hand over the app.
     */
    private fun isTransientSystemWindow(packageId: String): Boolean {
        if (packageId == "android") return true
        if (packageId == "com.android.systemui") return true
        if (packageId.endsWith(".permissioncontroller")) return true
        if (packageId.endsWith(".packageinstaller")) return true
        if (packageId.contains("inputmethod")) return true
        if (packageId == currentImePackage()) return true
        return false
    }

    private fun currentImePackage(): String? = try {
        android.provider.Settings.Secure.getString(
            contentResolver, android.provider.Settings.Secure.DEFAULT_INPUT_METHOD
        )?.substringBefore('/')
    } catch (e: Exception) {
        null
    }

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

        if (controller.isShowing) {
            // Stay up for the paused app itself and for anything transient layered
            // over it. Only a move to a genuinely different app counts as leaving.
            if (packageId == controller.pausedPackage) return
            if (isTransientSystemWindow(packageId)) return

            controller.hide()
            // Allow an immediate re-pause if they come straight back: without this
            // the per-package debounce would swallow the returning event.
            controller.lastPausedPackage?.let { lastEventByPackage.remove(it) }
            return
        }

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
