// src/components/AppSelectorScreen.js

/**
 * AppSelectorScreen — Tab 2: App Interception Manager.
 *
 * Searchable list of apps with Material Expressive toggle cards.
 * Selections persist via appStore (AsyncStorage-backed).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  NativeModules,
  Platform,
  Image,
  AppState,
} from 'react-native';
import Theme from '../theme';
import appStore from '../core/appStore';
import settingsStore from '../core/settingsStore';

const { InstalledAppsModule } = NativeModules;
const { colors, typography, shapes, spacing } = Theme;

// ─── AppRow Component ───────────────────────────────────────────────────

const AppRow = ({ item, onToggle }) => {
  const [icon, setIcon] = useState(null);
  
  useEffect(() => {
    let cancelled = false;
    if (NativeModules.InstalledAppsModule?.getAppIcon && item.packageId) {
      NativeModules.InstalledAppsModule.getAppIcon(item.packageId)
        .then((base64Icon) => {
          if (!cancelled && base64Icon) setIcon(base64Icon);
        })
        .catch(() => {});
    } else if (item.iconData) {
      setIcon(item.iconData);
    }
    return () => { cancelled = true; };
  }, [item.packageId, item.iconData]);
  
  return (
    <TouchableOpacity
      style={[styles.appCard, item.isSelected && styles.appCardEnabled]}
      onPress={() => onToggle(item.packageId, item.label)}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.isSelected }}
      accessibilityLabel={`Toggle ${item.label}`}
    >
      <View style={styles.appInfo}>
        {icon ? (
          <Image 
            source={{ uri: `data:image/png;base64,${icon}` }} 
            style={styles.appIconImage} 
          />
        ) : (
          <View style={[styles.appIconCircle, item.isSelected && styles.appIconCircleEnabled]}>
            <Text style={styles.appInitial}>
              {item.label ? item.label.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
        )}
        <View style={styles.appTextGroup}>
          <Text style={[styles.appName, item.isSelected && styles.appNameEnabled]}>
            {item.label}
          </Text>
        </View>
      </View>

      <View style={[styles.appCheckbox, item.isSelected && styles.appCheckboxEnabled]}>
        {item.isSelected && <Text style={styles.appCheckmark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
};

// ─── Component ────────────────────────────────────────────────────────────

const AppSelectorScreen = () => {
  const [apps, setApps] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAccessibilityEnabled, setIsAccessibilityEnabled] = useState(true);

  const checkAccessibility = useCallback(async () => {
    if (Platform.OS === 'android' && InstalledAppsModule?.isAccessibilityServiceEnabled) {
      try {
        const enabled = await InstalledAppsModule.isAccessibilityServiceEnabled();
        setIsAccessibilityEnabled(!!enabled);
      } catch (e) {
        console.warn("Error checking accessibility", e);
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    checkAccessibility();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAccessibility();
    });

    const fetchNativeData = async () => {
      if (Platform.OS === 'android' && InstalledAppsModule) {
        try {
          const nativeApps = await InstalledAppsModule.getInstalledApps();
          const userApps = nativeApps.filter(app => !app.isSystemApp);
          if (typeof appStore.setNativeAppList === 'function') {
            await appStore.setNativeAppList(userApps);
          } else {
            await appStore.syncWithNativeApps(userApps); // fallback
          }
        } catch (err) {
          console.warn("[AppSelector] Native fetch error:", err);
        }
      }
    };
    fetchNativeData();

    const fetchApps = () => {
      const getAppsFn = appStore.getAllApps || appStore.getApps;
      setApps(getAppsFn.call(appStore) || []);
    };
    
    fetchApps();
    const unsub = appStore.subscribe((updated) => {
      if (isMounted) fetchApps();
    });
    
    return () => {
      isMounted = false;
      unsub();
      sub.remove();
    };
  }, [checkAccessibility]);

  const handleOpenAccessibility = () => {
    InstalledAppsModule?.openAccessibilitySettings();
  };

  const handleToggle = useCallback(async (packageId, label) => {
    await appStore.toggleApp(packageId, label);
    if (typeof settingsStore._syncNative === 'function') {
      await settingsStore._syncNative();
    }
  }, []);

  // ─── Derived Data ─────────────────────────────────────────────────────

  const filteredApps = useMemo(() => {
    let result = apps || [];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (app) => (app.label || '').toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      if (a.isSelected && !b.isSelected) return -1;
      if (!a.isSelected && b.isSelected) return 1;
      return (a.label || '').localeCompare(b.label || '');
    });
  }, [apps, searchQuery]);

  const enabledCount = (apps || []).filter((a) => a.isSelected).length;

  // ─── Render Helper ────────────────────────────────────────────────────

  const renderItem = ({ item }) => (
    <AppRow item={item} onToggle={handleToggle} />
  );

  const renderEmptyComponent = () => (
    <View style={styles.emptySearch}>
      <Text style={styles.emptySearchIcon}>🔎</Text>
      <Text style={styles.emptySearchText}>
        {searchQuery.trim() ? `No apps match "${searchQuery}"` : 'No apps available'}
      </Text>
    </View>
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* ── Fixed Header ──────────────────────────────────────────────── */}
      <View style={styles.fixedHeader}>
        {!isAccessibilityEnabled && (
          <View style={styles.permissionBanner}>
            <View style={styles.permissionTextGroup}>
              <Text style={styles.permissionTitle}>Accessibility service not enabled — protection is inactive</Text>
            </View>
            <TouchableOpacity style={styles.permissionBtn} onPress={handleOpenAccessibility}>
              <Text style={styles.permissionBtnText}>Enable</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.headerSection}>
          <Text style={styles.headerTitle}>Apps ({enabledCount} monitored)</Text>
          <Text style={styles.headerSubtitle}>
            Select apps to add cognitive friction before opening
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search apps..."
            placeholderTextColor={colors.outline}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── FlatList App List ───────────────────────────────────────── */}
      <FlatList
        data={filteredApps}
        keyExtractor={(item) => item.packageId || item.packageName}
        renderItem={renderItem}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        ListEmptyComponent={renderEmptyComponent}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
      />
    </View>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fixedHeader: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl + 16,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl + 80,
  },

  // Header
  headerSection: {
    marginBottom: spacing.xl,
  },
  headerTitle: {
    ...typography.displayMedium,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    ...typography.bodyLarge,
    color: colors.onSurfaceVariant,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: shapes.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  searchIcon: {
    fontSize: 16,
  },
  searchInput: {
    flex: 1,
    ...typography.bodyLarge,
    color: colors.onSurface,
    paddingVertical: spacing.xs,
  },
  searchClear: {
    color: colors.onSurfaceVariant,
    fontSize: 14,
    fontWeight: '700',
    padding: spacing.xs,
  },

  // Permission Banner
  permissionBanner: {
    flexDirection: 'row',
    backgroundColor: colors.errorContainer,
    borderRadius: shapes.medium,
    padding: spacing.md,
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permissionTextGroup: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  permissionTitle: {
    ...typography.labelMedium,
    color: colors.onErrorContainer,
  },
  permissionBtn: {
    backgroundColor: colors.error,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: shapes.small,
  },
  permissionBtnText: {
    ...typography.labelMedium,
    color: colors.onError,
  },

  // App Cards
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainer,
    borderRadius: shapes.large,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  appCardEnabled: {
    backgroundColor: colors.primaryContainer,
  },
  appInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  appIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appIconCircleEnabled: {
    backgroundColor: colors.primary,
  },
  appIconImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  appInitial: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  appTextGroup: {
    flex: 1,
  },
  appName: {
    ...typography.bodyLarge,
    color: colors.onSurface,
  },
  appNameEnabled: {
    color: colors.onPrimaryContainer,
    fontWeight: '600',
  },
  appCheckbox: {
    width: 24,
    height: 24,
    borderRadius: shapes.medium,
    borderWidth: 2,
    borderColor: colors.outline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appCheckboxEnabled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  appCheckmark: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Empty Search
  emptySearch: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptySearchIcon: {
    fontSize: 40,
    marginBottom: spacing.md,
  },
  emptySearchText: {
    ...typography.bodyLarge,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
});

export default AppSelectorScreen;
