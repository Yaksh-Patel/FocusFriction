package com.focusfriction

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import org.json.JSONArray

/**
 * FocusPolicyRepository — Native singleton policy store.
 * Single source of truth for all interception decisions.
 * Stores state in SharedPreferences for synchronous access from AccessibilityService.
 */
class FocusPolicyRepository private constructor(private val context: Context) {

    companion object {
        private const val PREFS_NAME = "FocusFrictionPolicy"
        private const val KEY_SCHEMA_VERSION = "schema_version"
        private const val KEY_PROTECTION_ENABLED = "protection_enabled"
        private const val KEY_MONITORED_PACKAGES = "monitored_packages"
        private const val KEY_SCHEDULE_ENABLED = "schedule_enabled"
        private const val KEY_SCHEDULE_START_MINUTE = "schedule_start_minute"
        private const val KEY_SCHEDULE_END_MINUTE = "schedule_end_minute"
        private const val KEY_UNLOCK_EXPIRIES = "unlock_expiries"
        private const val KEY_ACTIVE_SESSION_PKG = "active_session_package"
        private const val KEY_ACTIVE_SESSION_ID = "active_session_id"
        private const val KEY_SOLVE_GRANT_MINUTES = "solve_grant_minutes"
        private const val KEY_BYPASS_GRANT_MINUTES = "bypass_grant_minutes"
        private const val CURRENT_SCHEMA_VERSION = 1

        // Packages that must never be intercepted
        val EXCLUDED_PACKAGES = setOf(
            "com.focusfriction",
            "com.android.systemui",
            "com.android.launcher",
            "com.android.launcher3",
            "com.google.android.apps.nexuslauncher",
            "com.android.settings",
            "com.android.vending",
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
            "com.android.shell",
            "android"
        )

        @Volatile
        private var INSTANCE: FocusPolicyRepository? = null

        fun getInstance(context: Context): FocusPolicyRepository {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: FocusPolicyRepository(context.applicationContext).also { INSTANCE = it }
            }
        }
    }

    private val prefs: SharedPreferences
        get() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ─── Policy Reads ────────────────────────────────────────────────────────

    fun isProtectionEnabled(): Boolean = prefs.getBoolean(KEY_PROTECTION_ENABLED, false)

    fun getMonitoredPackages(): Set<String> =
        prefs.getStringSet(KEY_MONITORED_PACKAGES, emptySet()) ?: emptySet()

    fun isScheduleEnabled(): Boolean = prefs.getBoolean(KEY_SCHEDULE_ENABLED, false)

    fun getScheduleStartMinute(): Int = prefs.getInt(KEY_SCHEDULE_START_MINUTE, 540) // 9:00 AM

    fun getScheduleEndMinute(): Int = prefs.getInt(KEY_SCHEDULE_END_MINUTE, 1020) // 5:00 PM

    fun getSolveGrantMinutes(): Int = prefs.getInt(KEY_SOLVE_GRANT_MINUTES, 10)

    fun getBypassGrantMinutes(): Int = prefs.getInt(KEY_BYPASS_GRANT_MINUTES, 3)

    // ─── Access Window Checks ────────────────────────────────────────────────

    /**
     * Check if a package currently has an active unlock window (user solved puzzle).
     */
    fun isPackageUnlocked(packageId: String): Boolean {
        val expiriesJson = prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}"
        return try {
            val obj = JSONObject(expiriesJson)
            val expiry = if (obj.has(packageId)) obj.getLong(packageId) else 0L
            System.currentTimeMillis() < expiry
        } catch (e: Exception) {
            false
        }
    }

    /**
     * THE single native decision point. Call this before showing any intervention.
     * Returns true if the package should be intercepted right now.
     */
    fun shouldIntercept(packageId: String): Boolean {
        if (!isProtectionEnabled()) return false
        if (packageId.isBlank()) return false
        if (EXCLUDED_PACKAGES.contains(packageId)) return false
        if (!getMonitoredPackages().contains(packageId)) return false
        if (isPackageUnlocked(packageId)) return false
        if (!isWithinSchedule()) return false
        return true
    }

    /**
     * Check if current time is within the focus schedule.
     */
    fun isWithinSchedule(): Boolean {
        if (!isScheduleEnabled()) return true
        val now = java.util.Calendar.getInstance()
        val currentMinute = now.get(java.util.Calendar.HOUR_OF_DAY) * 60 + now.get(java.util.Calendar.MINUTE)
        val start = getScheduleStartMinute()
        val end = getScheduleEndMinute()
        return if (start <= end) {
            currentMinute in start until end
        } else {
            // Overnight schedule
            currentMinute >= start || currentMinute < end
        }
    }

    // ─── Session Management ──────────────────────────────────────────────────

    fun getActiveSessionPackage(): String? = prefs.getString(KEY_ACTIVE_SESSION_PKG, null)

    fun getActiveSessionId(): String? = prefs.getString(KEY_ACTIVE_SESSION_ID, null)

    fun setActiveSession(packageId: String, sessionId: String) {
        prefs.edit()
            .putString(KEY_ACTIVE_SESSION_PKG, packageId)
            .putString(KEY_ACTIVE_SESSION_ID, sessionId)
            .apply()
    }

    fun clearActiveSession() {
        prefs.edit()
            .remove(KEY_ACTIVE_SESSION_PKG)
            .remove(KEY_ACTIVE_SESSION_ID)
            .apply()
    }

    fun isSessionActive(sessionId: String): Boolean {
        return prefs.getString(KEY_ACTIVE_SESSION_ID, null) == sessionId
    }

    // ─── Policy Writes ───────────────────────────────────────────────────────

    /**
     * Record an unlock after a successful intervention.
     * MUST be called before launching target app.
     */
    fun recordUnlock(packageId: String, grantMinutes: Int) {
        val expiriesJson = prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}"
        val expiries = try { JSONObject(expiriesJson) } catch (e: Exception) { JSONObject() }
        val expiryMs = System.currentTimeMillis() + (grantMinutes * 60 * 1000L)
        expiries.put(packageId, expiryMs)
        prefs.edit().putString(KEY_UNLOCK_EXPIRIES, expiries.toString()).apply()
    }

    /**
     * Atomically update the full policy. Called from JS bridge when user changes settings.
     */
    fun updatePolicy(
        monitoredPackages: Set<String>,
        isProtectionEnabled: Boolean,
        scheduleEnabled: Boolean,
        scheduleStartMinute: Int,
        scheduleEndMinute: Int,
        solveGrantMinutes: Int,
        bypassGrantMinutes: Int
    ) {
        prefs.edit()
            .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
            .putBoolean(KEY_PROTECTION_ENABLED, isProtectionEnabled)
            .putStringSet(KEY_MONITORED_PACKAGES, monitoredPackages)
            .putBoolean(KEY_SCHEDULE_ENABLED, scheduleEnabled)
            .putInt(KEY_SCHEDULE_START_MINUTE, scheduleStartMinute)
            .putInt(KEY_SCHEDULE_END_MINUTE, scheduleEndMinute)
            .putInt(KEY_SOLVE_GRANT_MINUTES, solveGrantMinutes)
            .putInt(KEY_BYPASS_GRANT_MINUTES, bypassGrantMinutes)
            .apply()
    }

    fun setProtectionEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_PROTECTION_ENABLED, enabled).apply()
    }

    /**
     * Prune expired unlock windows. Call on init.
     */
    fun pruneExpiredUnlocks() {
        val expiriesJson = prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}"
        val expiries = try { JSONObject(expiriesJson) } catch (e: Exception) { return }
        val now = System.currentTimeMillis()
        val toRemove = mutableListOf<String>()
        val keys = expiries.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            if (expiries.getLong(key) <= now) toRemove.add(key)
        }
        if (toRemove.isNotEmpty()) {
            toRemove.forEach { expiries.remove(it) }
            prefs.edit().putString(KEY_UNLOCK_EXPIRIES, expiries.toString()).apply()
        }
    }

    /**
     * Update only the monitored packages set. Called from JS when user toggles an app.
     */
    fun updateMonitoredPackages(packages: Set<String>) {
        prefs.edit().putStringSet(KEY_MONITORED_PACKAGES, packages).apply()
    }
}
