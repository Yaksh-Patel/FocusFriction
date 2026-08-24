// src/core/appStore.js

/**
 * AppStore — Monitored app selection manager.
 *
 * Stores minimal data: only the package IDs and labels of SELECTED apps.
 * The full app list comes from the native module on each sync.
 * Icons are loaded lazily per-row, not stored here.
 */

import { NativeModules, Platform } from 'react-native';
import appStorage from './appStorage';

const STORAGE_KEY = '@focusfriction/monitored_apps_v2';

// Packages that should never appear in the picker
const EXCLUDED_PACKAGES = new Set([
  'com.focusfriction',
  'com.android.systemui',
  'com.android.launcher',
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  'com.android.settings',
  'com.android.vending',
  'com.android.packageinstaller',
  'com.google.android.packageinstaller',
  'com.android.shell',
  'android',
]);

class AppStore {
  constructor() {
    // Map of packageId -> { packageId, label, selectedAt }
    this.selectedApps = new Map();
    // Full list from native module: [{ packageId, label, isSystemApp }]
    this.allApps = [];
    this.listeners = new Set();
    this.hydrated = false;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async init() {
    try {
      const raw = await appStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.selectedApps = new Map(
            parsed.map(app => [app.packageId, app])
          );
        }
      }
    } catch (error) {
      console.warn('[AppStore] Hydration failed:', error);
      this.selectedApps = new Map();
    }
    this.hydrated = true;
    this._notify();
  }

  // ─── Native Sync ───────────────────────────────────────────────────────────

  /**
   * Merge native app list with persisted selections.
   * Called after InstalledAppsModule.getInstalledApps() resolves.
   * @param {Array<{packageId: string, label: string, isSystemApp: boolean}>} nativeApps
   */
  setNativeAppList(nativeApps) {
    this.allApps = nativeApps
      .filter(app => !EXCLUDED_PACKAGES.has(app.packageName))
      .map(app => ({
        packageId: app.packageName,
        label: app.appName || app.packageName,
        isSystemApp: !!app.isSystemApp,
        isSelected: this.selectedApps.has(app.packageName),
      }));
    this._notify();
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  /** Returns the full list (from native sync) with selection state. */
  getAllApps() {
    return this.allApps;
  }

  /** Returns only selected/monitored apps. */
  getMonitoredApps() {
    return Array.from(this.selectedApps.values());
  }

  /** Returns the count of monitored apps. */
  getMonitoredCount() {
    return this.selectedApps.size;
  }

  /** Returns true if a package is currently monitored. */
  isMonitored(packageId) {
    return this.selectedApps.has(packageId);
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Toggle monitoring for a package.
   * @param {string} packageId
   * @param {string} label - Friendly display name
   */
  async toggleApp(packageId, label) {
    if (!packageId) return;
    if (EXCLUDED_PACKAGES.has(packageId)) return;

    if (this.selectedApps.has(packageId)) {
      this.selectedApps.delete(packageId);
    } else {
      this.selectedApps.set(packageId, {
        packageId,
        label: label || packageId,
        selectedAt: Date.now(),
      });
    }

    // Update allApps selection state
    this.allApps = this.allApps.map(app =>
      app.packageId === packageId
        ? { ...app, isSelected: this.selectedApps.has(packageId) }
        : app
    );

    await this._persist();
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
      const data = Array.from(this.selectedApps.values());
      await appStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('[AppStore] Persist failed:', error);
    }
  }

  _notify() {
    this.listeners.forEach(fn => {
      try { fn(); } catch (e) { console.warn('[AppStore] Listener error:', e); }
    });
  }
}

export default new AppStore();
