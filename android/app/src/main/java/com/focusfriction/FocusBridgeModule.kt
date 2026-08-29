package com.focusfriction

import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import org.json.JSONArray
import org.json.JSONObject

/**
 * FocusBridgeModule — the JS ↔ native seam for everything the overlay depends on.
 *
 * Two directions:
 *   JS → native   note headings (so the overlay can render them without SQLite)
 *   native → JS   intervention events (recorded while JS was not running)
 */
class FocusBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "FocusBridge"

    private val policy get() = FocusPolicyRepository.getInstance(reactContext.applicationContext)

    // ─── Note projection ─────────────────────────────────────────────────────

    /**
     * Mirror a compact projection of the user's notes for the overlay to render.
     * Expects [{ id, title, color, pinned }]. Called on every note mutation.
     */
    @ReactMethod
    fun setNoteHeadings(headings: ReadableArray, promise: Promise) {
        try {
            val out = JSONArray()
            for (i in 0 until headings.size()) {
                val map = headings.getMap(i) ?: continue
                val title = if (map.hasKey("title")) map.getString("title") else null
                if (title.isNullOrBlank()) continue
                out.put(JSONObject().apply {
                    put("id", if (map.hasKey("id")) map.getString("id") else "")
                    put("title", title)
                    put("color", if (map.hasKey("color")) map.getString("color") else "")
                    put("pinned", map.hasKey("pinned") && map.getBoolean("pinned"))
                })
            }
            policy.setNoteHeadings(out.toString())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_HEADINGS_ERROR", e)
        }
    }

    // ─── Event drain ─────────────────────────────────────────────────────────

    /**
     * Return and clear events the overlay recorded while JS was dead.
     * Read-and-clear is atomic enough here: only the JS side ever drains, and it
     * merges into its own persistent log before the next drain can happen.
     */
    @ReactMethod
    fun drainPendingEvents(promise: Promise) {
        try {
            val events = policy.getPendingEvents()
            val out = WritableNativeArray()
            for (i in 0 until events.length()) {
                val e = events.optJSONObject(i) ?: continue
                out.pushMap(WritableNativeMap().apply {
                    putDouble("timestamp", e.optLong("timestamp", 0L).toDouble())
                    putString("packageId", e.optString("packageId", ""))
                    putString("packageLabel", e.optString("packageLabel", ""))
                    putString("mode", e.optString("mode", "none"))
                    putString("outcome", e.optString("outcome", "dismissed"))
                    putInt("accessMinutesGranted", e.optInt("accessMinutesGranted", 0))
                })
            }
            policy.clearPendingEvents()
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("DRAIN_ERROR", e)
        }
    }

    /**
     * Whether the overlay asked the app to show notes. Read-and-clear.
     * null = nothing pending, "" = notes tab, otherwise the note id to open.
     */
    @ReactMethod
    fun consumePendingOpen(promise: Promise) {
        try {
            promise.resolve(policy.consumePendingOpen())
        } catch (e: Exception) {
            promise.reject("PENDING_OPEN_ERROR", e)
        }
    }

    // ─── Live status ─────────────────────────────────────────────────────────

    /** True only when the accessibility service is actually bound and running. */
    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        promise.resolve(FocusAccessibilityService.isConnected)
    }

    /** Remaining unlock time per monitored package, for the app to display. */
    @ReactMethod
    fun getActiveUnlocks(promise: Promise) {
        try {
            val out = WritableNativeArray()
            val now = System.currentTimeMillis()
            for (pkg in policy.getMonitoredPackages()) {
                val expiry = policy.getUnlockExpiry(pkg)
                if (expiry > now) {
                    out.pushMap(WritableNativeMap().apply {
                        putString("packageId", pkg)
                        putDouble("expiresAt", expiry.toDouble())
                    })
                }
            }
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("UNLOCKS_ERROR", e)
        }
    }

    /** End an unlock early — "I'm done with this app". */
    @ReactMethod
    fun endUnlock(packageId: String, promise: Promise) {
        try {
            policy.clearUnlock(packageId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("END_UNLOCK_ERROR", e)
        }
    }

    // ─── Material You dynamic colour ─────────────────────────────────────────

    /**
     * Wallpaper-derived system colours, Android 12+. Returned as hex so the JS
     * theme can consume them directly. Resolves null below API 31 so the caller
     * falls back to the bundled palette.
     */
    @ReactMethod
    fun getDynamicColors(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            promise.resolve(null)
            return
        }
        try {
            val ctx = reactContext.applicationContext
            fun hex(resId: Int): String = String.format("#%06X", 0xFFFFFF and ContextCompat.getColor(ctx, resId))

            promise.resolve(WritableNativeMap().apply {
                putString("accent1_100", hex(android.R.color.system_accent1_100))
                putString("accent1_200", hex(android.R.color.system_accent1_200))
                putString("accent1_300", hex(android.R.color.system_accent1_300))
                putString("accent1_500", hex(android.R.color.system_accent1_500))
                putString("accent1_600", hex(android.R.color.system_accent1_600))
                putString("accent1_700", hex(android.R.color.system_accent1_700))
                putString("accent2_100", hex(android.R.color.system_accent2_100))
                putString("accent2_500", hex(android.R.color.system_accent2_500))
                putString("accent3_100", hex(android.R.color.system_accent3_100))
                putString("accent3_500", hex(android.R.color.system_accent3_500))
                putString("neutral1_50", hex(android.R.color.system_neutral1_50))
                putString("neutral1_100", hex(android.R.color.system_neutral1_100))
                putString("neutral1_800", hex(android.R.color.system_neutral1_800))
                putString("neutral1_900", hex(android.R.color.system_neutral1_900))
                putString("neutral2_100", hex(android.R.color.system_neutral2_100))
                putString("neutral2_700", hex(android.R.color.system_neutral2_700))
            })
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }
}
