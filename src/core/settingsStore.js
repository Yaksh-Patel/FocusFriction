// src/core/settingsStore.js

/**
 * SettingsStore — User preferences with native policy sync.
 *
 * Validates inputs before saving. Syncs protection policy to native
 * FocusPolicyRepository on every relevant change.
 */

import { NativeModules, Platform } from 'react-native';
import appStorage from './appStorage';

const STORAGE_KEY = '@focusfriction/settings_v2';

const DEFAULTS = {
  schemaVersion: 1,
  isProtectionEnabled: false,
  enabledFrictionTypes: ['math', 'typing', 'breathing'],
  isScheduleEnabled: false,
  scheduleStartMinute: 540,   // 9:00 AM in minutes
  scheduleEndMinute: 1020,    // 5:00 PM in minutes
  solveGrantMinutes: 10,
  bypassGrantMinutes: 3,
};

class SettingsStore {
  constructor() {
    this.settings = { ...DEFAULTS };
    this.listeners = new Set();
    this.hydrated = false;
  }

  async init() {
    try {
      const raw = await appStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULTS, ...parsed };
        // Legacy migration: if scheduleStart is a string like "09:00", convert
        if (typeof this.settings.scheduleStartMinute !== 'number') {
          const startStr = parsed.scheduleStart || '09:00';
          const endStr = parsed.scheduleEnd || '17:00';
          this.settings.scheduleStartMinute = this._hhmToMinutes(startStr);
          this.settings.scheduleEndMinute = this._hhmToMinutes(endStr);
        }
      } else {
        this.settings = { ...DEFAULTS };
        await this._persist();
      }
    } catch (error) {
      console.warn('[SettingsStore] Hydration error:', error);
      this.settings = { ...DEFAULTS };
    }
    this.hydrated = true;
    this._notify();
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  getSettings() {
    return {
      ...this.settings,
      enabledFrictionTypes: [...this.settings.enabledFrictionTypes],
    };
  }

  isProtectionEnabled() {
    return this.settings.isProtectionEnabled;
  }

  /**
   * Validates that a schedule time range is valid.
   * @param {number} startMinute - 0 to 1439
   * @param {number} endMinute - 0 to 1439
   * @returns {{ valid: boolean, error: string | null }}
   */
  validateSchedule(startMinute, endMinute) {
    if (typeof startMinute !== 'number' || typeof endMinute !== 'number') {
      return { valid: false, error: 'Invalid time values' };
    }
    if (startMinute < 0 || startMinute > 1439 || endMinute < 0 || endMinute > 1439) {
      return { valid: false, error: 'Times must be between 00:00 and 23:59' };
    }
    if (startMinute === endMinute) {
      return { valid: false, error: 'Start and end times must be different' };
    }
    return { valid: true, error: null };
  }

  isWithinActiveWindow() {
    if (!this.settings.isScheduleEnabled) return true;
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const start = this.settings.scheduleStartMinute;
    const end = this.settings.scheduleEndMinute;
    if (start <= end) {
      return currentMinute >= start && currentMinute < end;
    } else {
      return currentMinute >= start || currentMinute < end;
    }
  }

  getRandomEnabledFriction() {
    const types = this.settings.enabledFrictionTypes;
    if (!types || types.length === 0) return 'math';
    return types[Math.floor(Math.random() * types.length)];
  }

  minutesToHHMM(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  _hhmToMinutes(str) {
    if (!str || typeof str !== 'string') return 0;
    const parts = str.split(':').map(Number);
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
    return parts[0] * 60 + parts[1];
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  async setProtectionEnabled(enabled) {
    this.settings.isProtectionEnabled = !!enabled;
    await this._persist();
    await this._syncNative();
    this._notify();
  }

  async toggleFrictionType(type) {
    if (!['math', 'typing', 'breathing'].includes(type)) return;
    const current = [...this.settings.enabledFrictionTypes];
    const index = current.indexOf(type);
    if (index > -1) {
      if (current.length <= 1) return; // Must keep at least one
      current.splice(index, 1);
    } else {
      current.push(type);
    }
    this.settings.enabledFrictionTypes = current;
    await this._persist();
    this._notify();
  }

  /**
   * Set schedule. Validates before saving.
   * @returns {{ success: boolean, error: string | null }}
   */
  async setSchedule(enabled, startMinute, endMinute) {
    if (enabled) {
      const validation = this.validateSchedule(startMinute, endMinute);
      if (!validation.valid) return { success: false, error: validation.error };
    }
    this.settings.isScheduleEnabled = !!enabled;
    this.settings.scheduleStartMinute = startMinute;
    this.settings.scheduleEndMinute = endMinute;
    await this._persist();
    await this._syncNative();
    this._notify();
    return { success: true, error: null };
  }

  async setGrantDurations(solveMinutes, bypassMinutes) {
    this.settings.solveGrantMinutes = Math.max(1, solveMinutes);
    this.settings.bypassGrantMinutes = Math.max(1, bypassMinutes);
    await this._persist();
    await this._syncNative();
    this._notify();
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
      await appStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.warn('[SettingsStore] Persist failed:', error);
    }
  }

  /**
   * Sync current policy to native FocusPolicyRepository.
   * Also requires current monitored packages from appStore.
   */
  async _syncNative() {
    if (Platform.OS !== 'android') return;
    try {
      const { InstalledAppsModule } = NativeModules;
      if (!InstalledAppsModule?.updatePolicy) return;

      // Import lazily to avoid circular dependency
      const appStore = require('./appStore').default;
      const monitoredPackages = appStore.getMonitoredApps().map(a => a.packageId);

      await InstalledAppsModule.updatePolicy({
        monitoredPackages,
        isProtectionEnabled: this.settings.isProtectionEnabled,
        scheduleEnabled: this.settings.isScheduleEnabled,
        scheduleStartMinute: this.settings.scheduleStartMinute,
        scheduleEndMinute: this.settings.scheduleEndMinute,
        solveGrantMinutes: this.settings.solveGrantMinutes,
        bypassGrantMinutes: this.settings.bypassGrantMinutes,
      });
    } catch (error) {
      console.warn('[SettingsStore] Native sync failed:', error);
    }
  }

  _notify() {
    const data = this.getSettings();
    this.listeners.forEach(fn => {
      try { fn(data); } catch (e) { console.warn('[SettingsStore] Listener error:', e); }
    });
  }
}

export default new SettingsStore();
