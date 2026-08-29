// src/screens/FocusScreen.js

/**
 * FocusScreen — protection setup and the monitored-app picker in one place.
 *
 * Previously these were split across a setup checklist that gated the home
 * screen and a separate app tab. Notes are the home surface now, so this is
 * simply the place where you turn pausing on and choose what it applies to.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, Image,
  Switch, AppState, ActivityIndicator,
} from 'react-native';
import { useTheme } from '../theme';
import Icon from '../components/Icon';
import appStore from '../core/appStore';
import settingsStore from '../core/settingsStore';
import sessionManager from '../core/sessionManager';
import nativeBridge from '../core/nativeBridge';

// Icons are expensive to produce; cache across mounts and list recycling.
const iconCache = new Map();
const iconMisses = new Set();

// ─── App row ──────────────────────────────────────────────────────────────

const AppRow = React.memo(({ item, onToggle, theme }) => {
  const { colors, typography, spacing, shapes } = theme;
  const [icon, setIcon] = useState(() => iconCache.get(item.packageId) || null);

  useEffect(() => {
    const pkg = item.packageId;
    if (!pkg || iconCache.has(pkg) || iconMisses.has(pkg)) return undefined;

    let cancelled = false;
    nativeBridge.getAppIcon(pkg).then((data) => {
      if (!data) { iconMisses.add(pkg); return; }
      iconCache.set(pkg, data);
      if (!cancelled) setIcon(data);
    });
    return () => { cancelled = true; };
  }, [item.packageId]);

  return (
    <Pressable
      onPress={() => onToggle(item.packageId, item.label)}
      android_ripple={{ color: colors.onSurface + '14' }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderRadius: shapes.large,
        backgroundColor: item.isSelected ? colors.secondaryContainer : 'transparent',
        marginBottom: spacing.xs,
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.isSelected }}
      accessibilityLabel={item.label}
    >
      {icon ? (
        <Image
          source={{ uri: `data:image/png;base64,${icon}` }}
          style={{ width: 38, height: 38, borderRadius: shapes.small }}
        />
      ) : (
        <View style={{
          width: 38, height: 38, borderRadius: shapes.small,
          backgroundColor: colors.surfaceContainerHighest,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={[typography.titleMedium, { color: colors.onSurfaceVariant }]}>
            {(item.label || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      <Text
        style={[typography.bodyLarge, {
          flex: 1,
          color: item.isSelected ? colors.onSecondaryContainer : colors.onSurface,
        }]}
        numberOfLines={1}
      >
        {item.label}
      </Text>

      <View style={{
        width: 24, height: 24, borderRadius: shapes.full,
        borderWidth: item.isSelected ? 0 : 2,
        borderColor: colors.outline,
        backgroundColor: item.isSelected ? colors.primary : 'transparent',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {item.isSelected && <Icon name="check" size={16} color={colors.onPrimary} />}
      </View>
    </Pressable>
  );
});
AppRow.displayName = 'AppRow';

// ─── Screen ───────────────────────────────────────────────────────────────

export default function FocusScreen() {
  const theme = useTheme();
  const { colors, typography, spacing, shapes, elevation } = theme;

  const [apps, setApps] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [accessibilityOn, setAccessibilityOn] = useState(false);
  const [serviceRunning, setServiceRunning] = useState(false);
  const [protectionOn, setProtectionOn] = useState(settingsStore.isProtectionEnabled());
  const [stats, setStats] = useState(() => sessionManager.getDailyStats());

  const refreshStatus = useCallback(async () => {
    const [enabled, running] = await Promise.all([
      nativeBridge.isAccessibilityServiceEnabled(),
      nativeBridge.isServiceRunning(),
    ]);
    setAccessibilityOn(enabled);
    setServiceRunning(running);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadApps = async () => {
      const native = await nativeBridge.getInstalledApps();
      appStore.setNativeAppList((native || []).filter(a => !a.isSystemApp));
      if (mounted) setLoading(false);
    };

    loadApps();
    refreshStatus();
    setApps(appStore.getAllApps());

    const unsubApps = appStore.subscribe(() => {
      if (mounted) setApps(appStore.getAllApps());
    });
    const unsubSettings = settingsStore.subscribe((s) => {
      if (mounted) setProtectionOn(!!s.isProtectionEnabled);
    });
    const unsubStats = sessionManager.subscribe(() => {
      if (mounted) setStats(sessionManager.getDailyStats());
    });
    setStats(sessionManager.getDailyStats());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshStatus();
    });

    return () => {
      mounted = false;
      unsubApps();
      unsubSettings();
      unsubStats();
      sub.remove();
    };
  }, [refreshStatus]);

  const handleToggleApp = useCallback(async (packageId, label) => {
    await appStore.toggleApp(packageId, label);
    await settingsStore.syncNative();
  }, []);

  const handleToggleProtection = useCallback(async (value) => {
    await settingsStore.setProtectionEnabled(value);
  }, []);

  const monitoredCount = apps.filter(a => a.isSelected).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? apps.filter(a => (a.label || '').toLowerCase().includes(q))
      : apps;
    return [...list].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return (a.label || '').localeCompare(b.label || '');
    });
  }, [apps, query]);

  // Protection is only genuinely live when all three are true. Reporting
  // "on" when the service isn't bound is how the old build misled you.
  const isLive = protectionOn && accessibilityOn && serviceRunning && monitoredCount > 0;

  const statusText = !accessibilityOn
    ? 'Grant accessibility access to let FocusFriction see which app opened.'
    : !protectionOn
      ? 'Pausing is switched off.'
      : monitoredCount === 0
        ? 'Choose at least one app to pause.'
        : !serviceRunning
          ? 'The service is not running yet. Toggling accessibility access off and on usually fixes it.'
          : `Pausing ${monitoredCount} app${monitoredCount === 1 ? '' : 's'}.`;

  const header = (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.background }}>
      {/* Status card */}
      <View style={{
        backgroundColor: isLive ? colors.successContainer : colors.surfaceContainerHigh,
        borderRadius: shapes.extraLarge,
        padding: spacing.xl,
        marginBottom: spacing.lg,
        gap: spacing.md,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Icon
            name={isLive ? 'lock' : 'unlock'}
            size={22}
            color={isLive ? colors.onSuccessContainer : colors.onSurfaceVariant}
          />
          <Text style={[typography.titleLarge, {
            flex: 1,
            color: isLive ? colors.onSuccessContainer : colors.onSurface,
          }]}>
            {isLive ? 'Pausing is active' : 'Pausing is inactive'}
          </Text>
          <Switch
            value={protectionOn}
            onValueChange={handleToggleProtection}
            trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
            thumbColor={colors.surfaceContainerLowest}
            accessibilityLabel="Turn pausing on or off"
          />
        </View>

        <Text style={[typography.bodyMedium, {
          color: isLive ? colors.onSuccessContainer : colors.onSurfaceVariant,
        }]}>
          {statusText}
        </Text>

        {!accessibilityOn && (
          <Pressable
            onPress={() => nativeBridge.openAccessibilitySettings()}
            style={{
              backgroundColor: colors.primary,
              borderRadius: shapes.full,
              paddingVertical: spacing.md,
              alignItems: 'center',
              marginTop: spacing.xs,
            }}
            accessibilityRole="button"
          >
            <Text style={[typography.labelLarge, { color: colors.onPrimary }]}>
              Open accessibility settings
            </Text>
          </Pressable>
        )}
      </View>

      {/* Today — these numbers lost their home when the old Home tab went away. */}
      {stats.protectedAttempts > 0 && (
        <View style={{
          flexDirection: 'row',
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: shapes.extraLarge,
          paddingVertical: spacing.lg,
          marginBottom: spacing.lg,
        }}>
          {[
            { value: stats.protectedAttempts, label: 'Paused' },
            { value: stats.interventionsCompleted, label: 'Continued' },
            { value: stats.bypasses, label: 'Skipped' },
            { value: stats.goalsChosen, label: 'Backed out' },
          ].map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && (
                <View style={{ width: 1, backgroundColor: colors.outlineVariant, marginVertical: 2 }} />
              )}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={[typography.headlineMedium, { color: colors.onSurface }]}>
                  {stat.value}
                </Text>
                <Text style={[typography.labelSmall, { color: colors.onSurfaceVariant }]}>
                  {stat.label}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* Search */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.surfaceContainerHigh,
        borderRadius: shapes.full,
        paddingHorizontal: spacing.lg,
        height: 48,
        gap: spacing.md,
        marginBottom: spacing.sm,
      }}>
        <Icon name="search" size={19} color={colors.onSurfaceVariant} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps"
          placeholderTextColor={colors.onSurfaceVariant}
          style={[typography.bodyLarge, { flex: 1, color: colors.onSurface, paddingVertical: 0 }]}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search apps"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Icon name="close" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.packageId}
        renderItem={({ item }) => (
          <AppRow item={item} onToggle={handleToggleApp} theme={theme} />
        )}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60, gap: spacing.md }}>
            {loading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <Icon name="search" size={38} color={colors.outlineVariant} />
                <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]}>
                  {query ? `No app matches “${query}”` : 'No apps found'}
                </Text>
              </>
            )}
          </View>
        }
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        windowSize={9}
        removeClippedSubviews
      />
    </View>
  );
}
