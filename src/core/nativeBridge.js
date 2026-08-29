// src/core/nativeBridge.js

/**
 * Thin, safe wrappers around the native modules.
 *
 * Every call degrades to a harmless default when the module is missing, so the
 * JS app still runs in Expo Go / on web where the native side doesn't exist.
 */

import { NativeModules, Platform } from 'react-native';

const { FocusBridge, InstalledAppsModule } = NativeModules;

const isAndroid = Platform.OS === 'android';

async function safe(fn, fallback) {
  if (!isAndroid) return fallback;
  try {
    return await fn();
  } catch (e) {
    console.warn('[nativeBridge]', e?.message || e);
    return fallback;
  }
}

export default {
  available: isAndroid && !!FocusBridge,

  /** Mirror note headings so the pause overlay can render them without SQLite. */
  setNoteHeadings: (headings) =>
    safe(() => FocusBridge.setNoteHeadings(headings), false),

  /** Events recorded natively while JS wasn't running. Read-and-clear. */
  drainPendingEvents: () =>
    safe(() => FocusBridge.drainPendingEvents(), []),

  /**
   * Did the overlay ask us to show notes? Read-and-clear.
   * null = nothing pending, '' = notes tab, otherwise the note id to open.
   */
  consumePendingOpen: () =>
    safe(() => FocusBridge.consumePendingOpen(), null),

  /** True only when the accessibility service is bound — not merely permitted. */
  isServiceRunning: () =>
    safe(() => FocusBridge.isServiceRunning(), false),

  getActiveUnlocks: () =>
    safe(() => FocusBridge.getActiveUnlocks(), []),

  endUnlock: (packageId) =>
    safe(() => FocusBridge.endUnlock(packageId), false),

  /** Material You palette on Android 12+, else null. */
  getDynamicColors: () =>
    safe(() => FocusBridge.getDynamicColors(), null),

  // ── app list / permissions ──
  getInstalledApps: () =>
    safe(() => InstalledAppsModule.getInstalledApps(), []),

  getAppIcon: (packageId) =>
    safe(() => InstalledAppsModule.getAppIcon(packageId), null),

  isAccessibilityServiceEnabled: () =>
    safe(() => InstalledAppsModule.isAccessibilityServiceEnabled(), false),

  openAccessibilitySettings: () =>
    safe(() => InstalledAppsModule.openAccessibilitySettings(), false),

  updatePolicy: (policy) =>
    safe(() => InstalledAppsModule.updatePolicy(policy), false),
};
