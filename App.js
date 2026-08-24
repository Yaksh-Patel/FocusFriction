// App.js

/**
 * FocusFriction — Root Application Component
 *
 * Material Expressive three-tab layout with custom bottom navigation bar.
 * Handles store hydration, tab routing, and the InterceptOverlay gate.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  Text,
  View,
  ActivityIndicator,
  NativeModules,
  AppState,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Theme from './src/theme';
import HomeScreen from './src/components/HomeScreen';
import SetupScreen from './src/components/SetupScreen';
import AppSelectorScreen from './src/components/AppSelectorScreen';
import SettingsScreen from './src/components/SettingsScreen';
import InterventionScreen from './src/screens/InterventionScreen';
import taskStore from './src/core/taskStore';
import appStore from './src/core/appStore';
import settingsStore from './src/core/settingsStore';
import appStorage from './src/core/appStorage';

const { colors, typography, shapes, spacing } = Theme;

// ─── Tab Definitions ──────────────────────────────────────────────────────

const TABS = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'apps', label: 'Apps', icon: '🛡' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

// ─── App Component ────────────────────────────────────────────────────────

export default function App() {
  const [isHydrated, setIsHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [interventionData, setInterventionData] = useState(null);

  // ─── Hydrate all stores ──────────────────────────────────────────────

  useEffect(() => {
    const hydrate = async () => {
      try {
        await appStorage.init();
        await Promise.all([
          taskStore.init(),
          appStore.init(),
          settingsStore.init(),
        ]);
      } catch (error) {
        console.warn('[App] Hydration error:', error);
      } finally {
        setIsHydrated(true);
      }
    };
    hydrate();
  }, []);

  // ─── Deep Link / Native Intent Listener ──────────────────────────────
  // Check for active intervention whenever app comes to foreground
  useEffect(() => {
    const checkIntervention = async () => {
      try {
        const { InterventionModule } = NativeModules;
        if (!InterventionModule) return;
        const data = await InterventionModule.getActiveIntervention();
        if (data && data.sessionId) {
          setInterventionData(data);
        }
      } catch (e) {
        console.warn('[App] Failed to check intervention:', e);
      }
    };

    checkIntervention();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkIntervention();
    });
    return () => sub.remove();
  }, [isHydrated]);

  // ─── Loading ─────────────────────────────────────────────────────────

  if (!isHydrated) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaView style={styles.loadingContainer}>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading FocusFriction...</Text>
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  // ─── Tab Content ─────────────────────────────────────────────────────

  const renderTabContent = () => {
    const isSetupComplete = settingsStore.isProtectionEnabled();
    switch (activeTab) {
      case 'home':
        return isSetupComplete ? <HomeScreen /> : <SetupScreen />;
      case 'apps':
        return <AppSelectorScreen />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return isSetupComplete ? <HomeScreen /> : <SetupScreen />;
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />

        {interventionData !== null ? (
          <InterventionScreen 
            interventionData={interventionData} 
            onComplete={() => setInterventionData(null)} 
          />
        ) : (
          <View style={{ flex: 1 }}>
            {renderTabContent()}

            {/* ── Bottom Tab Bar ────────────────────────────────────────── */}
            <View style={styles.tabBar}>
              {TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={styles.tabItem}
                    onPress={() => setActiveTab(tab.key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.tabPill, isActive && styles.tabPillActive]}>
                      <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
                        {tab.icon}
                      </Text>
                    </View>
                    <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  loadingText: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },

  // Snackbar
  snackbar: {
    position: 'absolute',
    bottom: 100,
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.inverseSurface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: shapes.medium,
    alignItems: 'center',
    elevation: 6,
  },
  snackbarText: {
    ...typography.bodyMedium,
    color: colors.inverseOnSurface,
    fontWeight: '500',
  },

  // Tab Bar — Material You pill style
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainer,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  tabPill: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: shapes.full,
  },
  tabPillActive: {
    backgroundColor: colors.secondaryContainer,
  },
  tabIcon: {
    fontSize: 20,
    opacity: 0.5,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
  },
  tabLabelActive: {
    color: colors.onSurface,
    fontWeight: '700',
  },
});
