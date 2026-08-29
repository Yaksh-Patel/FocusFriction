// src/screens/SettingsScreen.js

/**
 * SettingsScreen — friction types, schedule, access durations, appearance, backup.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Switch, Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../theme';
import Icon from '../components/Icon';
import settingsStore from '../core/settingsStore';
import appStorage from '../core/appStorage';
import notesStore from '../core/notesStore';
import appStore from '../core/appStore';
import sessionManager from '../core/sessionManager';

const FRICTION_OPTIONS = [
  { id: 'math', label: 'Math problem', icon: 'math', desc: 'Solve arithmetic that gets harder the more you cave' },
  { id: 'typing', label: 'Type a phrase', icon: 'typing', desc: 'Transcribe a line before continuing' },
  { id: 'breathing', label: 'One breath', icon: 'breathing', desc: 'A ten-second breathing pause' },
];

const THEME_OPTIONS = [
  { id: 'system', label: 'System', icon: 'auto' },
  { id: 'light', label: 'Light', icon: 'lightMode' },
  { id: 'dark', label: 'Dark', icon: 'darkMode' },
];

/** Parse "H:MM" / "HH:MM" into minutes since midnight, or null. */
function parseHHMM(text) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text || '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { colors, typography, spacing, shapes } = theme;

  const [enabledTypes, setEnabledTypes] = useState(['math']);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [startDraft, setStartDraft] = useState('09:00');
  const [endDraft, setEndDraft] = useState('17:00');
  const [scheduleError, setScheduleError] = useState('');
  const [solveGrant, setSolveGrant] = useState('10');
  const [bypassGrant, setBypassGrant] = useState('3');

  const applySettings = useCallback((s) => {
    setEnabledTypes(s.enabledFrictionTypes || ['math']);
    setScheduleOn(!!s.isScheduleEnabled);
    setStartDraft(settingsStore.minutesToHHMM(s.scheduleStartMinute));
    setEndDraft(settingsStore.minutesToHHMM(s.scheduleEndMinute));
    setSolveGrant(String(s.solveGrantMinutes));
    setBypassGrant(String(s.bypassGrantMinutes));
  }, []);

  useEffect(() => {
    applySettings(settingsStore.getSettings());
    return settingsStore.subscribe(applySettings);
  }, [applySettings]);

  const commitSchedule = async (enabled, startText, endText) => {
    const startMinute = parseHHMM(startText);
    const endMinute = parseHHMM(endText);
    if (enabled && (startMinute === null || endMinute === null)) {
      setScheduleError('Use 24-hour HH:MM, for example 09:00 or 22:30.');
      return;
    }
    const result = await settingsStore.setSchedule(
      enabled, startMinute ?? 540, endMinute ?? 1020
    );
    setScheduleError(result.success ? '' : result.error);
  };

  const commitGrants = async () => {
    const solve = parseInt(solveGrant, 10);
    const bypass = parseInt(bypassGrant, 10);
    if (Number.isNaN(solve) || Number.isNaN(bypass)) {
      applySettings(settingsStore.getSettings());
      return;
    }
    await settingsStore.setGrantDurations(solve, bypass);
  };

  // ─── Backup ───────────────────────────────────────────────────────────

  const handleExport = async () => {
    try {
      const keys = await appStorage.getAllKeys();
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        appName: 'FocusFriction',
        storage: {},
        notes: notesStore.getNotes({ archived: false })
          .concat(notesStore.getNotes({ archived: true })),
      };
      for (const key of keys) {
        const val = await appStorage.getItem(key);
        if (val !== null) payload.storage[key] = val;
      }

      const file = new File(Paths.document, 'focusfriction-backup.json');
      file.create({ overwrite: true });
      file.write(JSON.stringify(payload, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: 'Export FocusFriction backup',
        });
      } else {
        Alert.alert('Saved', `Backup written to ${file.uri}`);
      }
    } catch (error) {
      console.warn('[Settings] Export failed:', error);
      Alert.alert('Export failed', 'Could not write the backup file.');
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
      if (result.canceled || !result.assets?.length) return;

      const raw = await new File(result.assets[0].uri).text();
      const payload = JSON.parse(raw);

      if (!payload || typeof payload.storage !== 'object') {
        Alert.alert('Import failed', 'That file is not a FocusFriction backup.');
        return;
      }

      for (const [key, value] of Object.entries(payload.storage)) {
        if (typeof value === 'string') await appStorage.setItem(key, value);
      }

      if (Array.isArray(payload.notes)) {
        for (const note of payload.notes) {
          if (note?.id) await notesStore.restoreNote(note);
        }
      }

      await Promise.all([
        appStore.init(),
        settingsStore.init(),
        sessionManager.init(),
        notesStore.init(),
      ]);
      await settingsStore.syncNative();

      Alert.alert('Restored', 'Your backup has been imported.');
    } catch (error) {
      console.warn('[Settings] Import failed:', error);
      Alert.alert('Import failed', 'Could not read that backup file.');
    }
  };

  // ─── Building blocks ──────────────────────────────────────────────────

  const Section = ({ title, helper, children }) => (
    <View style={{ marginBottom: spacing.xxxl }}>
      <Text style={[typography.titleLarge, { color: colors.onSurface, marginBottom: spacing.xs }]}>
        {title}
      </Text>
      {!!helper && (
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant, marginBottom: spacing.md }]}>
          {helper}
        </Text>
      )}
      {children}
    </View>
  );

  const numberField = (label, value, setValue, onCommit) => (
    <View style={{ flex: 1 }}>
      <Text style={[typography.labelMedium, { color: colors.onSurfaceVariant, marginBottom: spacing.xs }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        onBlur={onCommit}
        onSubmitEditing={onCommit}
        returnKeyType="done"
        keyboardType="number-pad"
        style={[typography.titleMedium, {
          color: colors.onSurface,
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: shapes.medium,
          paddingVertical: spacing.md,
          textAlign: 'center',
        }]}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed title — only the settings themselves scroll. */}
      <View style={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
        paddingBottom: spacing.lg,
        backgroundColor: colors.background,
      }}>
        <Text style={[typography.displaySmall, { color: colors.onSurface }]}>
          Settings
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <Section
        title="Appearance"
        helper={theme.hasDynamic
          ? 'Colours can follow your wallpaper.'
          : 'Wallpaper colours need Android 12 or newer.'}
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          {THEME_OPTIONS.map((opt) => {
            const active = theme.preference === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => theme.setThemePreference(opt.id)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: spacing.xs,
                  paddingVertical: spacing.md,
                  borderRadius: shapes.large,
                  backgroundColor: active ? colors.secondaryContainer : colors.surfaceContainerHigh,
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${opt.label} theme`}
              >
                <Icon
                  name={opt.icon}
                  size={21}
                  color={active ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                />
                <Text style={[typography.labelMedium, {
                  color: active ? colors.onSecondaryContainer : colors.onSurfaceVariant,
                }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {theme.hasDynamic && (
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: colors.surfaceContainerHigh,
            borderRadius: shapes.large,
            padding: spacing.lg,
          }}>
            <Text style={[typography.bodyLarge, { flex: 1, color: colors.onSurface }]}>
              Use wallpaper colours
            </Text>
            <Switch
              value={theme.useDynamic}
              onValueChange={theme.setUseDynamicColor}
              trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
              thumbColor={colors.surfaceContainerLowest}
            />
          </View>
        )}
      </Section>

      <Section
        title="How you're paused"
        helper="Pick one or more. A random choice from your selection appears each time."
      >
        {FRICTION_OPTIONS.map((opt) => {
          const checked = enabledTypes.includes(opt.id);
          return (
            <Pressable
              key={opt.id}
              onPress={() => settingsStore.toggleFrictionType(opt.id)}
              android_ripple={{ color: colors.onSurface + '14' }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.lg,
                padding: spacing.lg,
                borderRadius: shapes.large,
                backgroundColor: checked ? colors.secondaryContainer : colors.surfaceContainerHigh,
                marginBottom: spacing.sm,
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <Icon
                name={opt.icon}
                size={23}
                color={checked ? colors.onSecondaryContainer : colors.onSurfaceVariant}
              />
              <View style={{ flex: 1 }}>
                <Text style={[typography.titleMedium, {
                  color: checked ? colors.onSecondaryContainer : colors.onSurface,
                }]}>
                  {opt.label}
                </Text>
                <Text style={[typography.bodySmall, {
                  color: checked ? colors.onSecondaryContainer : colors.onSurfaceVariant,
                }]}>
                  {opt.desc}
                </Text>
              </View>
              {checked && <Icon name="check" size={20} color={colors.onSecondaryContainer} />}
            </Pressable>
          );
        })}
      </Section>

      <Section title="Access duration" helper="How long an app stays open after you get through.">
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {numberField('After solving (min)', solveGrant, setSolveGrant, commitGrants)}
          {numberField('After skipping (min)', bypassGrant, setBypassGrant, commitGrants)}
        </View>
      </Section>

      <Section title="Schedule" helper="Only pause apps during these hours.">
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: shapes.large,
          padding: spacing.lg,
          marginBottom: spacing.md,
        }}>
          <Icon name="schedule" size={21} color={colors.onSurfaceVariant} />
          <Text style={[typography.bodyLarge, { flex: 1, color: colors.onSurface, marginLeft: spacing.md }]}>
            Limit to a time window
          </Text>
          <Switch
            value={scheduleOn}
            onValueChange={(v) => commitSchedule(v, startDraft, endDraft)}
            trackColor={{ false: colors.surfaceContainerHighest, true: colors.primary }}
            thumbColor={colors.surfaceContainerLowest}
            accessibilityLabel="Limit pausing to a time window"
          />
        </View>

        {scheduleOn && (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
              {numberField('Start', startDraft, setStartDraft,
                () => commitSchedule(scheduleOn, startDraft, endDraft))}
              {numberField('End', endDraft, setEndDraft,
                () => commitSchedule(scheduleOn, startDraft, endDraft))}
            </View>
            {!!scheduleError && (
              <Text
                style={[typography.bodySmall, { color: colors.error, marginTop: spacing.sm }]}
                accessibilityLiveRegion="polite"
              >
                {scheduleError}
              </Text>
            )}
          </>
        )}
      </Section>

      <Section title="Backup" helper="Your notes and settings, as a file you keep.">
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {[
            { label: 'Export', icon: 'export', onPress: handleExport },
            { label: 'Import', icon: 'import', onPress: handleImport },
          ].map((btn) => (
            <Pressable
              key={btn.label}
              onPress={btn.onPress}
              android_ripple={{ color: colors.onSurface + '14' }}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.lg,
                borderRadius: shapes.full,
                backgroundColor: colors.surfaceContainerHigh,
              }}
              accessibilityRole="button"
            >
              <Icon name={btn.icon} size={19} color={colors.onSurface} />
              <Text style={[typography.labelLarge, { color: colors.onSurface }]}>
                {btn.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>
      </ScrollView>
    </View>
  );
}
