// src/screens/NoteEditor.js

/**
 * NoteEditor — full-screen note editing.
 *
 * Saves on close rather than behind a Save button: a notes app that can lose
 * what you typed because you hit back is a notes app you stop trusting.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Modal,
  KeyboardAvoidingView, Platform, Alert, BackHandler,
} from 'react-native';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import Icon from '../components/Icon';
import notesStore, { NOTE_COLORS } from '../core/notesStore';

export default function NoteEditor({ note, onClose, onDelete }) {
  const theme = useTheme();
  const { colors, typography, spacing, shapes, tints } = theme;
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState(note?.title || '');
  const [body, setBody] = useState(note?.body || '');
  const [items, setItems] = useState(note?.items || []);
  const [color, setColor] = useState(note?.color || 'default');
  const [pinned, setPinned] = useState(!!note?.pinned);
  const [labelsText, setLabelsText] = useState((note?.labels || []).join(', '));
  const [showPalette, setShowPalette] = useState(false);
  const [isChecklist, setIsChecklist] = useState((note?.items || []).length > 0);

  // Ref mirror so any save path reads the latest values, even when triggered
  // from a callback captured on an earlier render.
  const latest = useRef({});
  // Modal.onRequestClose and the BackHandler can both fire for one back press.
  const closing = useRef(false);
  // Tracks the row this editor owns. Starts null for a new note and is filled in
  // the moment autosave creates it, so later saves update instead of duplicating.
  const noteIdRef = useRef(note?.id || null);
  const saveTimer = useRef(null);

  latest.current = { title, body, items, color, pinned, labelsText, isChecklist };

  const tint = tints[color] || tints.default;

  /** Write current state through to the store. Safe to call repeatedly. */
  const persist = useCallback(async () => {
    const s = latest.current;
    const labels = s.labelsText.split(',').map(l => l.trim()).filter(Boolean);
    const cleanItems = s.isChecklist
      ? s.items.filter(i => (i.text || '').trim() !== '')
      : [];

    const isEmpty =
      s.title.trim() === '' &&
      (s.isChecklist ? cleanItems.length === 0 : s.body.trim() === '');

    const fields = {
      title: s.title.trim(),
      body: s.isChecklist ? '' : s.body,
      items: cleanItems,
      color: s.color,
      pinned: s.pinned,
      labels,
    };

    try {
      if (!noteIdRef.current) {
        // Don't create a row just because the editor was opened.
        if (isEmpty) return;
        const created = await notesStore.createNote(fields);
        noteIdRef.current = created?.id || null;
        return;
      }

      if (isEmpty) {
        // An existing note emptied out is a delete, matching Keep.
        await notesStore.deleteNote(noteIdRef.current);
        noteIdRef.current = null;
        return;
      }

      await notesStore.updateNote(noteIdRef.current, fields);
    } catch (error) {
      console.error('[NoteEditor] Save failed:', error);
      // Show the real reason. "Something went wrong" told the user nothing and
      // told me nothing either when this came back from the device.
      Alert.alert('Could not save this note', String(error?.message || error));
    }
  }, []);

  // Autosave. The close path also saves, but relying on it alone means one
  // missed callback loses whatever was typed.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { persist(); }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, body, items, color, pinned, labelsText, isChecklist, persist]);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await persist();
    } finally {
      onClose();
    }
  }, [persist, onClose]);

  // Hardware back must save too, not discard.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // If a close is already latched (a delete that failed, say), let back out
      // regardless. Swallowing it here is what made the editor unescapable.
      if (closing.current) {
        onClose();
        return true;
      }
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, onClose]);

  // ─── Checklist helpers ──────────────────────────────────────────────────

  const addItem = () => {
    setItems(prev => [...prev, { id: uuidv4(), text: '', checked: false, position: prev.length }]);
  };

  const updateItem = (id, text) =>
    setItems(prev => prev.map(i => (i.id === id ? { ...i, text } : i)));

  const toggleItemChecked = (id) =>
    setItems(prev => prev.map(i => (i.id === id ? { ...i, checked: !i.checked } : i)));

  const removeItem = (id) =>
    setItems(prev => prev.filter(i => i.id !== id));

  const convertToChecklist = () => {
    // Carry the body across as one item per line rather than discarding it.
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    setItems(lines.map((text, i) => ({ id: uuidv4(), text, checked: false, position: i })));
    setBody('');
    setIsChecklist(true);
  };

  const convertToText = () => {
    const text = items.map(i => i.text).filter(Boolean).join('\n');
    setBody(prev => (prev ? `${prev}\n${text}` : text));
    setItems([]);
    setIsChecklist(false);
  };

  const confirmDelete = () => {
    const id = noteIdRef.current;
    if (!id) { closing.current = true; onClose(); return; }
    Alert.alert('Delete note', 'This note will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          closing.current = true;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          onDelete(id);
        },
      },
    ]);
  };

  const iconBtn = (name, label, onPress, active = false) => (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{
        width: 42, height: 42, borderRadius: shapes.full,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colors.onSurface + '18' : 'transparent',
        opacity: pressed ? 0.6 : 1,
      }]}
    >
      <Icon name={name} size={21} color={colors.onSurface} />
    </Pressable>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent={false}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: tint.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Top bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.sm + insets.top,
          paddingBottom: spacing.xs,
        }}>
          {iconBtn('back', 'Save and close', close)}
          <View style={{ flex: 1 }} />
          {iconBtn('pin', pinned ? 'Unpin note' : 'Pin note', () => setPinned(p => !p), pinned)}
          {iconBtn(
            note?.archived ? 'unarchive' : 'archive',
            note?.archived ? 'Unarchive note' : 'Archive note',
            async () => {
              if (closing.current) return;
              closing.current = true;
              if (saveTimer.current) clearTimeout(saveTimer.current);
              await persist();
              if (noteIdRef.current) await notesStore.toggleArchive(noteIdRef.current);
              onClose();
            }
          )}
          {iconBtn('palette', 'Change colour', () => setShowPalette(v => !v), showPalette)}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            placeholderTextColor={colors.onSurfaceVariant}
            style={[typography.headlineMedium, {
              color: colors.onSurface, padding: 0, marginBottom: spacing.md,
            }]}
            multiline
            accessibilityLabel="Note title"
          />

          {isChecklist ? (
            <View style={{ gap: spacing.xs }}>
              {items.map((item) => (
                <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Pressable onPress={() => toggleItemChecked(item.id)} hitSlop={8}>
                    <Icon
                      name={item.checked ? 'checkboxChecked' : 'checkbox'}
                      size={21}
                      color={item.checked ? colors.onSurfaceVariant : colors.outline}
                    />
                  </Pressable>
                  <TextInput
                    value={item.text}
                    onChangeText={(t) => updateItem(item.id, t)}
                    placeholder="List item"
                    placeholderTextColor={colors.onSurfaceVariant}
                    style={[typography.bodyLarge, {
                      flex: 1, color: colors.onSurface, paddingVertical: 6,
                      textDecorationLine: item.checked ? 'line-through' : 'none',
                    }]}
                    onSubmitEditing={addItem}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                  <Pressable onPress={() => removeItem(item.id)} hitSlop={8} accessibilityLabel="Remove item">
                    <Icon name="close" size={17} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                onPress={addItem}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}
                accessibilityRole="button"
              >
                <Icon name="add" size={20} color={colors.onSurfaceVariant} />
                <Text style={[typography.bodyLarge, { color: colors.onSurfaceVariant }]}>
                  List item
                </Text>
              </Pressable>
            </View>
          ) : (
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Start writing…"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[typography.bodyLarge, {
                color: colors.onSurface, padding: 0, minHeight: 200, textAlignVertical: 'top',
              }]}
              multiline
              accessibilityLabel="Note body"
            />
          )}

          <View style={{ marginTop: spacing.xxl }}>
            <Text style={[typography.labelSmall, { color: colors.onSurfaceVariant, letterSpacing: 1 }]}>
              LABELS
            </Text>
            <TextInput
              value={labelsText}
              onChangeText={setLabelsText}
              placeholder="work, ideas"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[typography.bodyMedium, {
                color: colors.onSurface,
                borderBottomWidth: 1,
                borderBottomColor: tint.border,
                paddingVertical: spacing.sm,
              }]}
              autoCapitalize="none"
              accessibilityLabel="Labels, comma separated"
            />
          </View>
        </ScrollView>

        {/* Colour palette */}
        {showPalette && (
          <View style={{
            flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md,
            paddingHorizontal: spacing.xl, paddingVertical: spacing.lg,
            backgroundColor: colors.surfaceContainer,
            borderTopWidth: 1, borderTopColor: colors.outlineVariant,
          }}>
            {NOTE_COLORS.map((key) => {
              const t = tints[key] || tints.default;
              const selected = color === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setColor(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${key}`}
                  accessibilityState={{ selected }}
                  style={{
                    width: 42, height: 42, borderRadius: shapes.full,
                    backgroundColor: t.bg,
                    borderWidth: selected ? 3 : 1,
                    borderColor: selected ? colors.primary : t.border,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {selected && <Icon name="check" size={18} color={colors.onSurface} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Bottom bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: spacing.sm,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm + insets.bottom,
          borderTopWidth: 1,
          borderTopColor: tint.border,
          backgroundColor: tint.bg,
        }}>
          {iconBtn(
            isChecklist ? 'list' : 'checkbox',
            isChecklist ? 'Convert to plain text' : 'Convert to checklist',
            isChecklist ? convertToText : convertToChecklist
          )}
          <View style={{ flex: 1 }} />
          {note && iconBtn('delete', 'Delete note', confirmDelete)}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
