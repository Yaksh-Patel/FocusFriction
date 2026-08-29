// src/theme/index.js

/**
 * ThemeProvider — resolves the active palette from the system colour scheme,
 * the user's override, and (Android 12+) the wallpaper-derived dynamic palette.
 *
 * Components read this with useTheme() and build their styles inside a useMemo,
 * so a theme change re-renders rather than requiring an app restart.
 */

import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import nativeBridge from '../core/nativeBridge';
import appStorage from '../core/appStorage';
import {
  typography, shapes, spacing, elevation,
  lightColors, darkColors, noteTints, applyDynamicColors,
} from './tokens';

const THEME_PREF_KEY = '@focusfriction/theme_pref';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState('system');   // 'system' | 'light' | 'dark'
  const [dynamic, setDynamic] = useState(null);
  const [useDynamic, setUseDynamic] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await appStorage.getItem(THEME_PREF_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.preference) setPreference(parsed.preference);
          if (typeof parsed.useDynamic === 'boolean') setUseDynamic(parsed.useDynamic);
        } catch (e) {
          // Older builds stored the bare string.
          setPreference(stored);
        }
      }
      setDynamic(await nativeBridge.getDynamicColors());
    })();
  }, []);

  const persist = useCallback(async (next) => {
    await appStorage.setItem(THEME_PREF_KEY, JSON.stringify(next));
  }, []);

  const setThemePreference = useCallback((value) => {
    setPreference(value);
    persist({ preference: value, useDynamic });
  }, [persist, useDynamic]);

  const setUseDynamicColor = useCallback((value) => {
    setUseDynamic(value);
    persist({ preference, useDynamic: value });
  }, [persist, preference]);

  const isDark = preference === 'system'
    ? systemScheme !== 'light'      // default to dark when the system is undecided
    : preference === 'dark';

  const theme = useMemo(() => {
    const base = isDark ? darkColors : lightColors;
    const colors = useDynamic ? applyDynamicColors(base, dynamic, isDark) : base;
    return {
      isDark,
      colors,
      typography,
      shapes,
      spacing,
      elevation,
      tints: isDark ? noteTints.dark : noteTints.light,
      preference,
      hasDynamic: !!dynamic,
      useDynamic,
      setThemePreference,
      setUseDynamicColor,
    };
  }, [isDark, dynamic, useDynamic, preference, setThemePreference, setUseDynamicColor]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx;
}

/**
 * Build a StyleSheet from the theme, memoised per theme identity.
 * Usage: const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles(factory) {
  const theme = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}

export { noteTints };
