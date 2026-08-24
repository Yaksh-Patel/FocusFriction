// src/core/appStorage.js

/**
 * AppStorage — Local storage abstraction using AsyncStorage.
 * This is standard AsyncStorage — data is NOT encrypted.
 * Do not store sensitive secrets here.
 *
 * Schema version is tracked to support future migrations.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = '@focusfriction/schema_version';

class AppStorage {
  constructor() {
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const storedVersion = await AsyncStorage.getItem(SCHEMA_VERSION_KEY);
      if (storedVersion === null) {
        // First install — write current schema version
        await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(SCHEMA_VERSION));
      } else {
        const version = parseInt(storedVersion, 10);
        if (version < SCHEMA_VERSION) {
          await this._migrate(version, SCHEMA_VERSION);
        }
      }
    } catch (e) {
      console.warn('[AppStorage] Init failed:', e);
    }
    this.initialized = true;
  }

  async _migrate(fromVersion, toVersion) {
    // Future migrations go here
    console.log(`[AppStorage] Migrating from v${fromVersion} to v${toVersion}`);
    await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(toVersion));
  }

  async getItem(key) {
    try {
      return await AsyncStorage.getItem(key);
    } catch (e) {
      console.warn(`[AppStorage] Failed to read '${key}':`, e);
      return null;
    }
  }

  async setItem(key, value) {
    try {
      await AsyncStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn(`[AppStorage] Failed to write '${key}':`, e);
      return false;
    }
  }

  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn(`[AppStorage] Failed to delete '${key}':`, e);
      return false;
    }
  }

  async getAllKeys() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      return (keys || []).filter(k => k.startsWith('@focusfriction/'));
    } catch (e) {
      console.warn('[AppStorage] Failed to get keys:', e);
      return [];
    }
  }

  /**
   * Clear all FocusFriction data. Used by the "Clear all data" action.
   */
  async clearAll() {
    try {
      const keys = await this.getAllKeys();
      if (keys.length > 0) {
        await AsyncStorage.multiRemove(keys);
      }
      return true;
    } catch (e) {
      console.warn('[AppStorage] Failed to clear all:', e);
      return false;
    }
  }
}

export default new AppStorage();
