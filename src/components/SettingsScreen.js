// src/components/SettingsScreen.js

/**
 * SettingsScreen — Tab 3: App preferences, friction types, schedules, and data management.
 * Material Expressive styling with multi-select checkboxes.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Theme from '../theme';
import settingsStore from '../core/settingsStore';
import appStorage from '../core/appStorage';
import taskStore from '../core/taskStore';
import appStore from '../core/appStore';
import sessionManager from '../core/sessionManager';

const { colors, typography, shapes, spacing } = Theme;

const FRICTION_OPTIONS = [
  { id: 'math', label: 'Math Puzzle', emoji: '🧮', desc: 'Solve an arithmetic problem to unlock' },
  { id: 'typing', label: 'Value Typing', emoji: '✍️', desc: 'Type a mindful phrase to proceed' },
  { id: 'breathing', label: 'Mindful Pause', emoji: '🧘', desc: '10-second breathing exercise' },
];

const SettingsScreen = () => {
  const [enabledTypes, setEnabledTypes] = useState(['math', 'typing', 'breathing']);
  const [isScheduleEnabled, setIsScheduleEnabled] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('09:00');
  const [scheduleEnd, setScheduleEnd] = useState('17:00');

  useEffect(() => {
    const settings = settingsStore.getSettings();
    setEnabledTypes(settings.enabledFrictionTypes || ['math']);
    setIsScheduleEnabled(settings.isScheduleEnabled || false);
    setScheduleStart(settings.scheduleStart || '09:00');
    setScheduleEnd(settings.scheduleEnd || '17:00');

    const unsub = settingsStore.subscribe((updated) => {
      setEnabledTypes(updated.enabledFrictionTypes || ['math']);
      setIsScheduleEnabled(updated.isScheduleEnabled || false);
      setScheduleStart(updated.scheduleStart || '09:00');
      setScheduleEnd(updated.scheduleEnd || '17:00');
    });

    return unsub;
  }, []);

  const handleToggleFriction = async (type) => {
    await settingsStore.toggleFrictionType(type);
  };

  const handleToggleSchedule = async (val) => {
    await settingsStore.updateSchedule(val, scheduleStart, scheduleEnd);
  };

  const handleChangeStart = async (val) => {
    setScheduleStart(val);
    await settingsStore.updateSchedule(isScheduleEnabled, val, scheduleEnd);
  };

  const handleChangeEnd = async (val) => {
    setScheduleEnd(val);
    await settingsStore.updateSchedule(isScheduleEnabled, scheduleStart, val);
  };

  const handleExportData = async () => {
    try {
      const keys = await appStorage.getAllKeys();
      const exportPayload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        appName: 'FocusFriction',
        data: {},
      };

      for (const key of keys) {
        const val = await appStorage.getItem(key);
        if (val !== null) {
          exportPayload.data[key] = val;
        }
      }

      const fileUri = `${FileSystem.documentDirectory}focusfriction_backup.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(exportPayload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Export Error', 'Sharing is not available on this device.');
      }
    } catch (error) {
      console.warn('[Settings] Export failed:', error);
      Alert.alert('Export Error', 'Failed to export data.');
    }
  };

  const handleImportData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const fileUri = result.assets[0].uri;
        const fileContent = await FileSystem.readAsStringAsync(fileUri);
        const importedPayload = JSON.parse(fileContent);

        if (!importedPayload || importedPayload.version !== 1 || typeof importedPayload.data !== 'object') {
          Alert.alert('Import Error', 'Invalid or incompatible backup file format.');
          return;
        }

        const entries = Object.entries(importedPayload.data);
        for (const [key, value] of entries) {
          if (typeof value === 'string') {
            await appStorage.setItem(key, value);
          }
        }

        // Re-hydrate all stores
        await Promise.all([
          taskStore.init(),
          appStore.init(),
          settingsStore.init(),
          sessionManager.init(),
        ]);

        Alert.alert('Success', 'Data restored successfully!');
      }
    } catch (error) {
      console.warn('[Settings] Import failed:', error);
      Alert.alert('Import Error', 'Failed to import backup file.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Settings</Text>
        <Text style={styles.headerSubtitle}>Customize your focus experience</Text>
      </View>

      {/* ── Intervention Types ──────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Intervention Types</Text>
        <Text style={styles.sectionHelper}>
          Select one or more. A random type from your selection will appear during each interception.
        </Text>

        {FRICTION_OPTIONS.map((opt) => {
          const isChecked = enabledTypes.includes(opt.id);
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.frictionCard, isChecked && styles.frictionCardChecked]}
              onPress={() => handleToggleFriction(opt.id)}
              activeOpacity={0.7}
            >
              <View style={styles.frictionInfo}>
                <Text style={styles.frictionEmoji}>{opt.emoji}</Text>
                <View style={styles.frictionTextGroup}>
                  <Text style={[styles.frictionLabel, isChecked && styles.frictionLabelChecked]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.frictionDesc}>{opt.desc}</Text>
                </View>
              </View>
              <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                {isChecked && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Focus Schedule ──────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.scheduleHeaderRow}>
          <View>
            <Text style={styles.sectionTitle}>Focus Schedule</Text>
            <Text style={styles.sectionHelper}>
              Overlays only trigger during these hours.
            </Text>
          </View>
          <Switch
            value={isScheduleEnabled}
            onValueChange={handleToggleSchedule}
            trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        <View style={[styles.scheduleInputRow, !isScheduleEnabled && styles.disabledSection]}>
          <View style={styles.scheduleInputBlock}>
            <Text style={styles.scheduleInputLabel}>Start</Text>
            <TextInput
              style={styles.scheduleInput}
              value={scheduleStart}
              onChangeText={handleChangeStart}
              placeholder="09:00"
              placeholderTextColor={colors.outline}
              editable={isScheduleEnabled}
            />
          </View>
          <Text style={styles.scheduleDivider}>→</Text>
          <View style={styles.scheduleInputBlock}>
            <Text style={styles.scheduleInputLabel}>End</Text>
            <TextInput
              style={styles.scheduleInput}
              value={scheduleEnd}
              onChangeText={handleChangeEnd}
              placeholder="17:00"
              placeholderTextColor={colors.outline}
              editable={isScheduleEnabled}
            />
          </View>
        </View>
      </View>

      {/* ── Data & Backup ──────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data & Backup</Text>
        <Text style={styles.sectionHelper}>
          Export your goals, stats, and settings to a local file, or restore from a backup.
        </Text>

        <View style={styles.backupRow}>
          <TouchableOpacity style={styles.backupBtn} onPress={handleExportData} activeOpacity={0.7}>
            <Text style={styles.backupBtnText}>📤  Export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backupBtn} onPress={handleImportData} activeOpacity={0.7}>
            <Text style={styles.backupBtnText}>📥  Import</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },

  // Header
  headerSection: {
    paddingTop: spacing.xxxl + 16,
    marginBottom: spacing.xxl,
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

  // Section
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    ...typography.titleLarge,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  sectionHelper: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.lg,
  },

  // Friction Cards
  frictionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainer,
    borderRadius: shapes.large,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  frictionCardChecked: {
    backgroundColor: colors.primaryContainer,
  },
  frictionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
  },
  frictionEmoji: {
    fontSize: 24,
  },
  frictionTextGroup: {
    flex: 1,
  },
  frictionLabel: {
    ...typography.titleMedium,
    color: colors.onSurface,
  },
  frictionLabelChecked: {
    color: colors.onPrimaryContainer,
  },
  frictionDesc: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: shapes.medium,
    borderWidth: 2,
    borderColor: colors.outline,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },

  // Schedule
  scheduleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  scheduleInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  disabledSection: {
    opacity: 0.35,
  },
  scheduleInputBlock: {
    flex: 1,
  },
  scheduleInputLabel: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  scheduleInput: {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    padding: spacing.lg,
    borderRadius: shapes.large,
    ...typography.titleMedium,
    textAlign: 'center',
  },
  scheduleDivider: {
    ...typography.titleLarge,
    color: colors.outline,
    marginTop: 16,
  },

  // Backup
  backupRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  backupBtn: {
    flex: 1,
    backgroundColor: colors.surfaceContainerHigh,
    paddingVertical: spacing.lg,
    borderRadius: shapes.large,
    alignItems: 'center',
  },
  backupBtnText: {
    ...typography.labelLarge,
    color: colors.onSurface,
  },
});

export default SettingsScreen;
