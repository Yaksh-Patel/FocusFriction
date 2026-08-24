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

const EVENTS_KEY = '@focusfriction/intervention_events_v1';

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

  // ─── Legacy compat helpers (called from InterventionScreen) ────────────────

  async recordInterception(packageId) {
    // Interception recording now happens via appendEvent on completion
    // This is a no-op kept for backward compat
  }

  async recordBypass(packageId, mode) {
    await this.appendEvent({
      packageId,
      mode: mode || 'bypass',
      outcome: 'bypassed',
      accessMinutesGranted: 3,
    });
  }

  async recordSolve(packageId, mode, grantMinutes) {
    await this.appendEvent({
      packageId,
      mode: mode || 'math',
      outcome: 'solved',
      accessMinutesGranted: grantMinutes || 10,
    });
  }

  async recordGoals(packageId) {
    await this.appendEvent({
      packageId,
      mode: 'goals',
      outcome: 'goals',
      accessMinutesGranted: 0,
    });
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  /**
   * Get daily metrics derived from events.
   * @returns {{ date, interventionsCompleted, bypasses, goalsChosen, estimatedDeferredMinutes }}
   */
  getDailyStats() {
    const today = getTodayKey();
    const todayStart = new Date(today).getTime();
    const todayEvents = this.events.filter(e => e.timestamp >= todayStart);

    const interventionsCompleted = todayEvents.filter(e => e.outcome === 'solved').length;
    const bypasses = todayEvents.filter(e => e.outcome === 'bypassed').length;
    const goalsChosen = todayEvents.filter(e => e.outcome === 'goals').length;
    const protectedAttempts = todayEvents.length;

    // Estimate: each 'goals' outcome = 15 min deferred (labeled as estimate)
    const estimatedDeferredMinutes = goalsChosen * 15;

    return {
      date: today,
      interventionsCompleted,
      bypasses,
      goalsChosen,
      protectedAttempts,
      estimatedDeferredMinutes,
      // Legacy compat
      puzzlesSolved: interventionsCompleted,
      interceptions: protectedAttempts,
      timeSaved: estimatedDeferredMinutes,
      puzzlesBypassed: bypasses,
    };
  }

  getTodayEvents() {
    const today = getTodayKey();
    const todayStart = new Date(today).getTime();
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
