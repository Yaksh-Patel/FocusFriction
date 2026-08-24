package com.focusfriction

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * InterventionModule — Bridge for JavaScript to report intervention outcomes.
 * JavaScript calls completeIntervention(sessionId, outcome) when done.
 */
class InterventionModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "InterventionModule"

    /**
     * Called by InterventionScreen.js when the user completes the friction.
     * @param sessionId The session ID from intent extras
     * @param outcome "solved" | "bypassed" | "goals"
     * @param packageId The package being intercepted
     */
    @ReactMethod
    fun completeIntervention(sessionId: String, outcome: String, packageId: String, promise: Promise) {
        try {
            val policy = FocusPolicyRepository.getInstance(reactContext.applicationContext)

            // Validate session is still active
            if (!policy.isSessionActive(sessionId)) {
                promise.resolve(false)
                return
            }

            val activity = InterventionActivity.current
            if (activity != null) {
                activity.runOnUiThread {
                    activity.onComplete(outcome)
                }
                promise.resolve(true)
            } else {
                // InterventionActivity not found — handle gracefully
                policy.clearActiveSession()
                if (outcome == InterventionActivity.OUTCOME_SOLVED || outcome == InterventionActivity.OUTCOME_BYPASSED) {
                    val grantMinutes = if (outcome == InterventionActivity.OUTCOME_SOLVED)
                        policy.getSolveGrantMinutes() else policy.getBypassGrantMinutes()
                    policy.recordUnlock(packageId, grantMinutes)
                }
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("INTERVENTION_ERROR", e.message, e)
        }
    }

    /**
     * Returns current intervention info if one is active.
     */
    @ReactMethod
    fun getActiveIntervention(promise: Promise) {
        try {
            val policy = FocusPolicyRepository.getInstance(reactContext.applicationContext)
            val sessionId = policy.getActiveSessionId()
            val packageId = policy.getActiveSessionPackage()

            if (sessionId != null && packageId != null) {
                val map = com.facebook.react.bridge.WritableNativeMap().apply {
                    putString("sessionId", sessionId)
                    putString("packageId", packageId)
                    // Try to get friendly label
                    val label = try {
                        val pm = reactContext.packageManager
                        pm.getApplicationLabel(pm.getApplicationInfo(packageId, 0)).toString()
                    } catch (e: Exception) { packageId }
                    putString("appLabel", label)
                }
                promise.resolve(map)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("GET_INTERVENTION_ERROR", e.message, e)
        }
    }
}
