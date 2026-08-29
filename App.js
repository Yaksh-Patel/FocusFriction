// App.js

/**
 * FocusFriction — root component.
 *
 * Notes are the home surface. Pausing distracting apps is a mode the app offers,
 * not a gate in front of it: the app is fully useful before any permission is
 * granted, which is the point of it being a notes app first.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StatusBar, StyleSheet, Pressable, Text, View,
  ActivityIndicator, AppState,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from './src/theme';
import Icon from './src/components/Icon';
import NotesScreen from './src/screens/NotesScreen';
import FocusScreen from './src/screens/FocusScreen';
import SettingsScreen from './src/screens/SettingsScreen';

import appStorage from './src/core/appStorage';
import notesStore from './src/core/notesStore';
import appStore from './src/core/appStore';
import settingsStore from './src/core/settingsStore';
import sessionManager from './src/core/sessionManager';
import nativeBridge from './src/core/nativeBridge';

const TABS = [
  { key: 'notes', label: 'Notes', icon: 'notes' },
  { key: 'focus', label: 'Focus', icon: 'shield' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

// ─── Shell ────────────────────────────────────────────────────────────────

function AppShell() {
  const { colors, typography, spacing, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState('notes');
  const [initialNoteId, setInitialNoteId] = useState(null);

  // ── Hydrate ──
  useEffect(() => {
    (async () => {
      try {
        await appStorage.init();
        await Promise.all([
          appStore.init(),
          settingsStore.init(),
          sessionManager.init(),
          notesStore.init(),
        ]);
        // Only now is the monitored list real. Syncing earlier could push an
        // empty set to native and silently disable pausing.
        await settingsStore.syncNative();
      } catch (error) {
        console.warn('[App] Hydration failed:', error);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // ── Sync with whatever the overlay did while JS was not running ──
  // It records outcomes and, if you tapped a heading, which note to open.
  useEffect(() => {
    if (!hydrated) return undefined;

    const sync = async () => {
      await sessionManager.syncFromNative();
      // '' means "just show notes"; a non-empty value means open that note.
      // null means the overlay didn't ask for anything, so don't navigate.
      const pending = await nativeBridge.consumePendingOpen();
      if (pending !== null && pending !== undefined) {
        setActiveTab('notes');
        if (pending) setInitialNoteId(pending);
      }
    };

    sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    return () => sub.remove();
  }, [hydrated]);

  const consumeInitialNote = useCallback(() => setInitialNoteId(null), []);

  if (!hydrated) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          translucent
          backgroundColor="transparent"
        />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'focus':
        return <FocusScreen />;
      case 'settings':
        return <SettingsScreen />;
      case 'notes':
      default:
        return (
          <NotesScreen
            initialNoteId={initialNoteId}
            onConsumeInitialNote={consumeInitialNote}
          />
        );
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        translucent
        backgroundColor="transparent"
      />

      <View style={{ flex: 1 }}>{renderTab()}</View>

      {/* Bottom navigation. paddingBottom clears the gesture bar or the
          three-button nav, whichever this device uses. */}
      <View style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceContainer,
        paddingTop: spacing.sm,
        paddingBottom: spacing.sm + insets.bottom,
      }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={{ flex: 1, alignItems: 'center', gap: 3 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={tab.label}
            >
              <View style={{
                width: 64,
                height: 32,
                borderRadius: 16,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? colors.secondaryContainer : 'transparent',
              }}>
                <Icon
                  name={tab.icon}
                  size={22}
                  color={active ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                />
              </View>
              <Text style={[typography.labelSmall, {
                color: active ? colors.onSurface : colors.onSurfaceVariant,
              }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
