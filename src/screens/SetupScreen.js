// src/screens/SetupScreen.js

/**
 * SetupScreen — Protection setup checklist.
 * Shows live status of each prerequisite for protection to work.
 * Re-checks status on AppState 'active'.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  AppState,
  NativeModules,
  ScrollView,
  Switch,
  Platform,
} from 'react-native';
import Theme from '../theme';
import appStore from '../core/appStore';
import settingsStore from '../core/settingsStore';

const { colors, typography, shapes, spacing } = Theme;

export default function SetupScreen({ onSetupComplete }) {
  const [isAccessibilityEnabled, setIsAccessibilityEnabled] = useState(false);
  const [isProtectionEnabled, setIsProtectionEnabled] = useState(false);
  const [monitoredCount, setMonitoredCount] = useState(0);
  const [checking, setChecking] = useState(true);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const { InstalledAppsModule } = NativeModules;
      if (InstalledAppsModule?.isAccessibilityServiceEnabled) {
        const enabled = await InstalledAppsModule.isAccessibilityServiceEnabled();
        setIsAccessibilityEnabled(!!enabled);
      }
      
      // Fallback if settingsStore methods are missing
      const isEnabled = typeof settingsStore.isProtectionEnabled === 'function' 
        ? settingsStore.isProtectionEnabled() 
        : false;
      setIsProtectionEnabled(isEnabled);
      
      const count = typeof appStore.getMonitoredCount === 'function' 
        ? appStore.getMonitoredCount() 
        : (typeof appStore.getEnabledCount === 'function' ? appStore.getEnabledCount() : 0);
      setMonitoredCount(count);

      // If all conditions met, notify parent
      const allGood = isAccessibilityEnabled && isEnabled && count > 0;
      if (allGood && onSetupComplete) onSetupComplete();
    } catch (e) {
      console.warn('[SetupScreen] Status check failed:', e);
    } finally {
      setChecking(false);
    }
  }, [isAccessibilityEnabled, onSetupComplete]);

  useEffect(() => {
    checkStatus();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkStatus();
    });
    return () => sub.remove();
  }, [checkStatus]);

  const handleToggleProtection = async (value) => {
    if (typeof settingsStore.setProtectionEnabled === 'function') {
      await settingsStore.setProtectionEnabled(value);
    }
    setIsProtectionEnabled(value);
  };

  const handleOpenAccessibility = () => {
    NativeModules.InstalledAppsModule?.openAccessibilitySettings();
  };

  const isAllComplete = isAccessibilityEnabled && isProtectionEnabled && monitoredCount > 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Protection Setup</Text>
        <Text style={styles.subtitle}>
          FocusFriction pauses selected apps so you can choose what to do next.{' '}
          Complete these steps to activate it.
        </Text>
      </View>

      {/* Step 1: Accessibility Service */}
      <SetupRow
        step="1"
        title="Enable Accessibility Service"
        description="Required to detect when you open a monitored app. FocusFriction only reads which app is in the foreground — no browsing history or keystrokes."
        status={isAccessibilityEnabled}
        actionLabel="Open Accessibility Settings"
        onAction={handleOpenAccessibility}
      />

      {/* Step 2: Turn on Protection */}
      <SetupRow
        step="2"
        title="Turn on Protection"
        description="Enable the friction system. You can turn it off any time from Settings."
        status={isProtectionEnabled}
        actionLabel={null}
        customAction={
          <Switch
            value={isProtectionEnabled}
            onValueChange={handleToggleProtection}
            trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
            thumbColor={isProtectionEnabled ? colors.onPrimary : colors.onSurfaceVariant}
            accessibilityLabel="Toggle protection on or off"
          />
        }
      />

      {/* Step 3: Select Apps */}
      <SetupRow
        step="3"
        title={`Select apps to pause ${monitoredCount > 0 ? `(${monitoredCount} selected)` : ''}`}
        description="Choose which apps to add friction to. At least one is required."
        status={monitoredCount > 0}
        actionLabel="Go to Apps tab"
        onAction={null} // Parent handles tab switching
      />

      {/* Status Summary */}
      {isAllComplete && (
        <View style={styles.completeCard}>
          <Text style={styles.completeEmoji}>✓</Text>
          <Text style={styles.completeTitle}>Protection is active</Text>
          <Text style={styles.completeSubtitle}>
            Opening a monitored app will show your mindful pause.
          </Text>
        </View>
      )}

      <TouchableOpacity 
        style={styles.recheckBtn} 
        onPress={checkStatus}
        accessibilityRole="button"
        accessibilityLabel="Re-check protection status"
      >
        <Text style={styles.recheckText}>Re-check status</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SetupRow({ step, title, description, status, actionLabel, onAction, customAction }) {
  return (
    <View style={[styles.row, status && styles.rowComplete]}>
      <View style={[styles.stepBadge, status && styles.stepBadgeComplete]}>
        <Text style={styles.stepText}>{status ? '✓' : step}</Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={[styles.rowTitle, status && styles.rowTitleComplete]}>{title}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
        {customAction ? (
          <View style={{ marginTop: spacing.sm }}>{customAction}</View>
        ) : actionLabel && onAction ? (
          <TouchableOpacity 
            style={styles.actionBtn} 
            onPress={onAction} 
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={styles.actionBtnText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl || 48 },
  header: { marginBottom: spacing.xl },
  title: {
    ...typography.headlineMedium,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainer,
    borderRadius: shapes.large || 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.outline || colors.surfaceContainerHighest,
  },
  rowComplete: {
    borderColor: colors.primary,
    borderWidth: 1,
  },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  stepBadgeComplete: {
    backgroundColor: colors.primary,
  },
  stepText: {
    ...typography.labelMedium,
    color: colors.onSurface,
    fontWeight: '700',
  },
  rowContent: { flex: 1 },
  rowTitle: {
    ...typography.titleSmall,
    color: colors.onSurface,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  rowTitleComplete: { color: colors.primary },
  rowDesc: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    lineHeight: 18,
  },
  actionBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primaryContainer || colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: shapes.medium || 12,
    alignSelf: 'flex-start',
  },
  actionBtnText: {
    ...typography.labelMedium,
    color: colors.onPrimary || '#fff',
    fontWeight: '600',
  },
  completeCard: {
    backgroundColor: colors.primaryContainer || '#2D1B69',
    borderRadius: shapes.large || 16,
    padding: spacing.xl,
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  completeEmoji: { fontSize: 40, marginBottom: spacing.sm },
  completeTitle: {
    ...typography.titleMedium,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  completeSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  recheckBtn: { marginTop: spacing.lg, alignItems: 'center', padding: spacing.md },
  recheckText: { ...typography.labelMedium, color: colors.onSurfaceVariant },
});
