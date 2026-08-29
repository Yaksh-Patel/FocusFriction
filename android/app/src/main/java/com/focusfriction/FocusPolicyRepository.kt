package com.focusfriction

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * FocusPolicyRepository — native singleton policy + state store.
 *
 * Single source of truth for every interception decision, and for everything the
 * pause overlay needs to render. This matters because JavaScript is NOT running
 * when a monitored app is opened: the accessibility service must answer
 * synchronously, draw a UI, and record the outcome without any bridge round-trip.
 *
 * JS mirrors *into* here (policy, note headings) and drains *out of* here
 * (intervention events) the next time the app is foregrounded.
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
        private const val KEY_SOLVE_GRANT_MINUTES = "solve_grant_minutes"
        private const val KEY_BYPASS_GRANT_MINUTES = "bypass_grant_minutes"
        private const val KEY_FRICTION_TYPES = "friction_types"

        private const val KEY_NOTE_HEADINGS = "note_headings"
        private const val KEY_DAILY_OPENS = "daily_opens"
        private const val KEY_DAILY_OPENS_DATE = "daily_opens_date"
        private const val KEY_PENDING_EVENTS = "pending_events"
        private const val KEY_PENDING_NOTE_ID = "pending_note_id"

        private const val CURRENT_SCHEMA_VERSION = 2
        private const val MAX_PENDING_EVENTS = 500

        /** Packages that must never be intercepted, or a bad policy locks you out of the phone. */
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
            "com.android.dialer",
            "com.google.android.dialer",
            "com.android.emergency",
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

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    // ─── Policy reads ────────────────────────────────────────────────────────

    fun isProtectionEnabled(): Boolean = prefs.getBoolean(KEY_PROTECTION_ENABLED, false)

    fun getMonitoredPackages(): Set<String> =
        // Defensive copy: the set returned by getStringSet must never be mutated,
        // and callers here iterate it freely.
        HashSet(prefs.getStringSet(KEY_MONITORED_PACKAGES, emptySet()) ?: emptySet())

    fun isScheduleEnabled(): Boolean = prefs.getBoolean(KEY_SCHEDULE_ENABLED, false)

    fun getScheduleStartMinute(): Int = prefs.getInt(KEY_SCHEDULE_START_MINUTE, 540)

    fun getScheduleEndMinute(): Int = prefs.getInt(KEY_SCHEDULE_END_MINUTE, 1020)

    fun getSolveGrantMinutes(): Int = prefs.getInt(KEY_SOLVE_GRANT_MINUTES, 10)

    fun getBypassGrantMinutes(): Int = prefs.getInt(KEY_BYPASS_GRANT_MINUTES, 3)

    /** Friction types the user has enabled. Never empty — falls back to math. */
    fun getFrictionTypes(): List<String> {
        val raw = prefs.getString(KEY_FRICTION_TYPES, null) ?: return listOf("math", "typing", "breathing")
        return try {
            val arr = JSONArray(raw)
            val out = ArrayList<String>(arr.length())
            for (i in 0 until arr.length()) arr.optString(i, "").takeIf { it.isNotBlank() }?.let(out::add)
            if (out.isEmpty()) listOf("math") else out
        } catch (e: Exception) {
            listOf("math")
        }
    }

    // ─── Access windows ──────────────────────────────────────────────────────

    fun isPackageUnlocked(packageId: String): Boolean {
        return try {
            val obj = JSONObject(prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}")
            System.currentTimeMillis() < obj.optLong(packageId, 0L)
        } catch (e: Exception) {
            false
        }
    }

    fun getUnlockExpiry(packageId: String): Long {
        return try {
            JSONObject(prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}").optLong(packageId, 0L)
        } catch (e: Exception) {
            0L
        }
    }

    /**
     * THE single native decision point.
     * Must stay cheap — it runs on every window-state change on the device.
     */
    fun shouldIntercept(packageId: String): Boolean {
        if (packageId.isBlank()) return false
        if (!isProtectionEnabled()) return false
        if (EXCLUDED_PACKAGES.contains(packageId)) return false
        if (packageId == context.packageName) return false
        if (!getMonitoredPackages().contains(packageId)) return false
        if (isPackageUnlocked(packageId)) return false
        if (!isWithinSchedule()) return false
        return true
    }

    fun isWithinSchedule(): Boolean {
        if (!isScheduleEnabled()) return true
        val now = Calendar.getInstance()
        val currentMinute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val start = getScheduleStartMinute()
        val end = getScheduleEndMinute()
        return if (start <= end) currentMinute in start until end
        else currentMinute >= start || currentMinute < end   // overnight window
    }

    fun recordUnlock(packageId: String, grantMinutes: Int) {
        val expiries = try {
            JSONObject(prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }
        expiries.put(packageId, System.currentTimeMillis() + grantMinutes * 60_000L)
        prefs.edit().putString(KEY_UNLOCK_EXPIRIES, expiries.toString()).apply()
    }

    fun clearUnlock(packageId: String) {
        try {
            val expiries = JSONObject(prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}")
            expiries.remove(packageId)
            prefs.edit().putString(KEY_UNLOCK_EXPIRIES, expiries.toString()).apply()
        } catch (e: Exception) {
            // nothing to clear
        }
    }

    fun pruneExpiredUnlocks() {
        val expiries = try {
            JSONObject(prefs.getString(KEY_UNLOCK_EXPIRIES, "{}") ?: "{}")
        } catch (e: Exception) {
            return
        }
        val now = System.currentTimeMillis()
        val toRemove = ArrayList<String>()
        val keys = expiries.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            // optLong, not getLong — one malformed entry must not abandon the prune.
            if (expiries.optLong(key, 0L) <= now) toRemove.add(key)
        }
        if (toRemove.isNotEmpty()) {
            toRemove.forEach { expiries.remove(it) }
            prefs.edit().putString(KEY_UNLOCK_EXPIRIES, expiries.toString()).apply()
        }
    }

    // ─── Daily open counts (drives difficulty) ───────────────────────────────

    private fun todayKey(): String {
        val c = Calendar.getInstance()
        return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    }

    private fun readDailyOpens(): JSONObject {
        // Counts reset at local midnight by comparing the stored date stamp.
        if (prefs.getString(KEY_DAILY_OPENS_DATE, null) != todayKey()) return JSONObject()
        return try {
            JSONObject(prefs.getString(KEY_DAILY_OPENS, "{}") ?: "{}")
        } catch (e: Exception) {
            JSONObject()
        }
    }

    fun getOpenCountToday(packageId: String): Int = readDailyOpens().optInt(packageId, 0)

    /** Increments and returns the new count for today. */
    fun incrementOpenCount(packageId: String): Int {
        val opens = readDailyOpens()
        val next = opens.optInt(packageId, 0) + 1
        opens.put(packageId, next)
        prefs.edit()
            .putString(KEY_DAILY_OPENS, opens.toString())
            .putString(KEY_DAILY_OPENS_DATE, todayKey())
            .apply()
        return next
    }

    // ─── Note headings, mirrored from JS ─────────────────────────────────────

    /**
     * A compact projection of the user's notes: [{id, title, color, pinned}].
     * The overlay renders these; it never touches the SQLite database, which is
     * owned by the JS side and may not be open when the overlay is shown.
     */
    fun getNoteHeadings(): JSONArray {
        return try {
            JSONArray(prefs.getString(KEY_NOTE_HEADINGS, "[]") ?: "[]")
        } catch (e: Exception) {
            JSONArray()
        }
    }

    fun setNoteHeadings(json: String) {
        prefs.edit().putString(KEY_NOTE_HEADINGS, json).apply()
    }

    // ─── Event log, drained by JS ────────────────────────────────────────────

    /**
     * Append an intervention outcome. JS drains these on next foreground and merges
     * them into its own history, because nothing JS-side is alive to observe them live.
     */
    fun appendEvent(
        packageId: String,
        packageLabel: String,
        mode: String,
        outcome: String,
        grantMinutes: Int
    ) {
        val events = try {
            JSONArray(prefs.getString(KEY_PENDING_EVENTS, "[]") ?: "[]")
        } catch (e: Exception) {
            JSONArray()
        }

        events.put(JSONObject().apply {
            put("timestamp", System.currentTimeMillis())
            put("packageId", packageId)
            put("packageLabel", packageLabel)
            put("mode", mode)
            put("outcome", outcome)
            put("accessMinutesGranted", grantMinutes)
        })

        // Bound the buffer — if JS never runs, this must not grow without limit.
        val trimmed = if (events.length() > MAX_PENDING_EVENTS) {
            JSONArray().also { out ->
                for (i in events.length() - MAX_PENDING_EVENTS until events.length()) out.put(events.get(i))
            }
        } else events

        prefs.edit().putString(KEY_PENDING_EVENTS, trimmed.toString()).apply()
    }

    fun getPendingEvents(): JSONArray {
        return try {
            JSONArray(prefs.getString(KEY_PENDING_EVENTS, "[]") ?: "[]")
        } catch (e: Exception) {
            JSONArray()
        }
    }

    /**
     * One-shot handoff for "open my notes instead" on a specific heading.
     * Written by the overlay, consumed by JS on next foreground.
     */
    /**
     * Ask the app to show the notes tab. An empty string means "notes tab, no
     * particular note" — distinct from absent, which means "don't navigate".
     */
    fun setPendingOpen(noteId: String) {
        prefs.edit().putString(KEY_PENDING_NOTE_ID, noteId).apply()
    }

    /** Returns null when nothing is pending, "" for the tab, or a note id. */
    fun consumePendingOpen(): String? {
        val id = prefs.getString(KEY_PENDING_NOTE_ID, null)
        if (id != null) prefs.edit().remove(KEY_PENDING_NOTE_ID).apply()
        return id
    }

    fun clearPendingEvents() {
        prefs.edit().putString(KEY_PENDING_EVENTS, "[]").apply()
    }

    // ─── Policy writes ───────────────────────────────────────────────────────

    fun updatePolicy(
        monitoredPackages: Set<String>,
        isProtectionEnabled: Boolean,
        scheduleEnabled: Boolean,
        scheduleStartMinute: Int,
        scheduleEndMinute: Int,
        solveGrantMinutes: Int,
        bypassGrantMinutes: Int,
        frictionTypes: List<String>
    ) {
        prefs.edit()
            .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
            .putBoolean(KEY_PROTECTION_ENABLED, isProtectionEnabled)
            .putStringSet(KEY_MONITORED_PACKAGES, HashSet(monitoredPackages))
            .putBoolean(KEY_SCHEDULE_ENABLED, scheduleEnabled)
            .putInt(KEY_SCHEDULE_START_MINUTE, scheduleStartMinute)
            .putInt(KEY_SCHEDULE_END_MINUTE, scheduleEndMinute)
            .putInt(KEY_SOLVE_GRANT_MINUTES, solveGrantMinutes)
            .putInt(KEY_BYPASS_GRANT_MINUTES, bypassGrantMinutes)
            .putString(KEY_FRICTION_TYPES, JSONArray(frictionTypes).toString())
            .apply()
    }

    fun setProtectionEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_PROTECTION_ENABLED, enabled).apply()
    }
}
