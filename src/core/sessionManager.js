// src/core/sessionManager.js

/**
 * SessionManager — Intervention event log and daily metrics.
 *
 * Stores an append-only log of intervention events.
 * Daily metrics are DERIVED from events — no separate mutable counters.
 *
 * Note: Access decisions are made natively by FocusPolicyRepository.
 * This module handles the JavaScript-side display and event recording only.
 */

import appStorage from './appStorage';
import nativeBridge from './nativeBridge';

const EVENTS_KEY = '@focusfriction/intervention_events_v1';

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Timestamp of local midnight today.
 * NOTE: do NOT use `new Date('2026-08-29').getTime()` — a bare date string is parsed
 * as UTC midnight, so "today" would start at the wrong hour anywhere but UTC.
 */
function getTodayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

class SessionManager {
  constructor() {
    /** @type {Array<InterventionEvent>} */
    this.events = [];
    this.listeners = new Set();
    this.hydrated = false;
  }

  async init() {
    try {
      const raw = await appStorage.getItem(EVENTS_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        // Only keep last 30 days of events
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        this.events = Array.isArray(parsed)
          ? parsed.filter(e => e && e.timestamp > thirtyDaysAgo)
          : [];
      } else {
        this.events = [];
      }
    } catch (error) {
      console.warn('[SessionManager] Hydration failed:', error);
      this.events = [];
    }
    this.hydrated = true;
    this._notify();
  }

  // ─── Event Recording ───────────────────────────────────────────────────────

  /**
   * Append an intervention event to the log.
   * @param {{ sessionId, packageId, packageLabel, mode, outcome, accessMinutesGranted }} event
   */
  async appendEvent(event) {
    const fullEvent = {
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      sessionId: event.sessionId || '',
      timestamp: Date.now(),
      packageId: event.packageId || '',
      packageLabel: event.packageLabel || event.packageId || 'Unknown App',
      mode: event.mode || 'math',
      outcome: event.outcome || 'dismissed',
      accessMinutesGranted: event.accessMinutesGranted || 0,
    };

    this.events = [...this.events, fullEvent];
    await this._persist();
    this._notify();
    return fullEvent;
  }

  /**
   * Pull in events the pause overlay recorded while JS was not running, and merge
   * them into the persistent log. Called on boot and on every foreground.
   *
   * Deduplicated by (timestamp, packageId, outcome): drain clears the native
   * buffer, but a crash between drain and persist could otherwise double-count.
   */
  async syncFromNative() {
    const pending = await nativeBridge.drainPendingEvents();
    if (!pending || pending.length === 0) return 0;

    const seen = new Set(
      this.events.map(e => `${e.timestamp}|${e.packageId}|${e.outcome}`)
    );

    const merged = [];
    for (const e of pending) {
      const key = `${e.timestamp}|${e.packageId}|${e.outcome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        id: `${e.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId: '',
        timestamp: e.timestamp,
        packageId: e.packageId || '',
        packageLabel: e.packageLabel || e.packageId || 'Unknown app',
        mode: e.mode || 'none',
        outcome: e.outcome || 'dismissed',
        accessMinutesGranted: e.accessMinutesGranted || 0,
      });
    }

    if (merged.length === 0) return 0;

    this.events = [...this.events, ...merged].sort((a, b) => a.timestamp - b.timestamp);
    await this._persist();
    this._notify();
    return merged.length;
  }

  // NOTE: there are no JS-side recorders any more. Every intervention outcome is
  // written natively by the pause overlay, because no JavaScript is running at
  // that moment. syncFromNative() above is the only way events enter this log.

  // ─── Analytics ─────────────────────────────────────────────────────────────

  /**
   * How many times a specific app has been intercepted today.
   * This is what drives puzzle difficulty — the whole "cost scales with your own
   * behaviour" premise depends on it being real.
   * @param {string} packageId
   * @returns {number}
   */
  getOpenCountToday(packageId) {
    if (!packageId) return 0;
    const todayStart = getTodayStart();
    return this.events.filter(
      e => e.timestamp >= todayStart &&
           e.packageId === packageId &&
           e.outcome === 'intercepted'
    ).length;
  }

  /**
   * Get daily metrics derived from events.
   */
  getDailyStats() {
    const todayStart = getTodayStart();
    const todayEvents = this.events.filter(e => e.timestamp >= todayStart);

    const interventionsCompleted = todayEvents.filter(e => e.outcome === 'solved').length;
    const bypasses = todayEvents.filter(e => e.outcome === 'bypassed').length;
    const goalsChosen = todayEvents.filter(e => e.outcome === 'goals').length;
    // Count interceptions only — every pause now logs one 'intercepted' event plus
    // one outcome event, so counting all events would double-count.
    const protectedAttempts = todayEvents.filter(e => e.outcome === 'intercepted').length;

    // Estimate: each 'goals' outcome = 15 min deferred (labeled as an estimate in the UI)
    const estimatedDeferredMinutes = goalsChosen * 15;

    return {
      date: getTodayKey(),
      interventionsCompleted,
      bypasses,
      goalsChosen,
      protectedAttempts,
      estimatedDeferredMinutes,
    };
  }

  getTodayEvents() {
    const todayStart = getTodayStart();
    return this.events.filter(e => e.timestamp >= todayStart);
  }

  getAllEvents() {
    return [...this.events];
  }

  // ─── Event System ──────────────────────────────────────────────────────────

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  async _persist() {
    try {
      await appStorage.setItem(EVENTS_KEY, JSON.stringify(this.events));
    } catch (error) {
      console.warn('[SessionManager] Persist failed:', error);
    }
  }

  _notify() {
    this.listeners.forEach(fn => {
      try { fn(this.getDailyStats()); } catch (e) { console.warn('[SessionManager] Listener error:', e); }
    });
  }
}

export default new SessionManager();
