// src/screens/NotesScreen.js

/**
 * NotesScreen — the app's home surface.
 *
 * A Keep-style masonry grid. Notes are the point of the app; pausing distracting
 * apps is a feature it offers, not its identity, so this is what you land on and
 * it works fully with protection switched off.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, useWindowDimensions, Modal,
} from 'react-native';
import { useTheme } from '../theme';
import Icon from '../components/Icon';
import notesStore from '../core/notesStore';
import NoteEditor from './NoteEditor';

// ─── Height estimation for masonry packing ────────────────────────────────

/**
 * Greedy shortest-column packing needs a height before layout, so estimate one.
 * Only relative accuracy matters — the goal is balanced columns, not exact math.
 */
function estimateHeight(note, columnWidth) {
  const charsPerLine = Math.max(12, Math.floor(columnWidth / 8));
  let h = 24; // padding

  if (note.title) {
    h += 22 * Math.ceil(note.title.length / charsPerLine);
  }
  if (note.items.length > 0) {
    h += Math.min(note.items.length, 8) * 26;
    if (note.items.length > 8) h += 20;
  } else if (note.body) {
    const lines = Math.min(10, Math.ceil(note.body.length / charsPerLine));
    h += 20 * lines;
  }
  if (note.labels.length > 0) h += 26;
  return h;
}

function packColumns(notes, columnCount, columnWidth) {
  const columns = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);

  notes.forEach((note) => {
    let target = 0;
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    columns[target].push(note);
    heights[target] += estimateHeight(note, columnWidth);
  });

  return columns;
}

// ─── Note card ────────────────────────────────────────────────────────────

const NoteCard = ({ note, tint, theme, onPress, onLongPress, onToggleItem }) => {
  const { colors, typography, spacing, shapes } = theme;
  const visibleItems = note.items.slice(0, 8);
  const hiddenCount = note.items.length - visibleItems.length;

  return (
    <Pressable
      onPress={() => onPress(note)}
      onLongPress={() => onLongPress(note)}
      delayLongPress={300}
      android_ripple={{ color: colors.onSurface + '14' }}
      style={({ pressed }) => [{
        backgroundColor: tint.bg,
        borderColor: tint.border,
        borderWidth: 1,
        borderRadius: shapes.large,
        padding: spacing.md + 2,
        marginBottom: spacing.sm + 2,
        opacity: pressed ? 0.9 : 1,
      }]}
      accessibilityRole="button"
      accessibilityLabel={note.title || 'Untitled note'}
      accessibilityHint="Long press for pin, colour, archive and delete"
    >
      {note.pinned && (
        <View style={{ position: 'absolute', top: 8, right: 8 }}>
          <Icon name="pin" size={13} color={colors.onSurfaceVariant} />
        </View>
      )}

      {!!note.title && (
        <Text
          style={[typography.titleMedium, {
            color: colors.onSurface,
            marginBottom: note.body || note.items.length ? spacing.xs + 2 : 0,
            paddingRight: note.pinned ? 18 : 0,
          }]}
          numberOfLines={3}
        >
          {note.title}
        </Text>
      )}

      {note.items.length > 0 ? (
        <View style={{ gap: 3 }}>
          {visibleItems.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onToggleItem(note.id, item.id)}
              hitSlop={6}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}
            >
              <Icon
                name={item.checked ? 'checkboxChecked' : 'checkbox'}
                size={16}
                color={item.checked ? colors.onSurfaceVariant : colors.outline}
                style={{ marginTop: 1 }}
              />
              <Text
                style={[typography.bodyMedium, {
                  color: item.checked ? colors.onSurfaceVariant : colors.onSurface,
                  textDecorationLine: item.checked ? 'line-through' : 'none',
                  flex: 1,
                }]}
                numberOfLines={2}
              >
                {item.text}
              </Text>
            </Pressable>
          ))}
          {hiddenCount > 0 && (
            <Text style={[typography.bodySmall, { color: colors.onSurfaceVariant, marginTop: 2 }]}>
              +{hiddenCount} more
            </Text>
          )}
        </View>
      ) : !!note.body && (
        <Text style={[typography.bodyMedium, { color: colors.onSurfaceVariant }]} numberOfLines={10}>
          {note.body}
        </Text>
      )}

      {note.labels.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm }}>
          {note.labels.slice(0, 3).map((label) => (
            <View
              key={label}
              style={{
                backgroundColor: colors.onSurface + '12',
                borderRadius: shapes.full,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text style={[typography.labelSmall, { color: colors.onSurfaceVariant }]}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
};

// ─── Long-press action sheet ──────────────────────────────────────────────

/**
 * A real sheet rather than Alert.alert: Android caps alerts at three buttons and
 * silently drops the rest, which is why Delete never appeared.
 */
const NoteActionSheet = ({ note, theme, onClose, onDeleted }) => {
  const { colors, typography, spacing, shapes } = theme;

  const run = async (fn) => {
    onClose();
    try {
      await fn();
    } catch (error) {
      console.error('[NotesScreen] Action failed:', error);
    }
  };

  const actions = [
    {
      icon: 'pin',
      label: note.pinned ? 'Unpin' : 'Pin to top',
      onPress: () => run(() => notesStore.togglePin(note.id)),
    },
    {
      icon: 'undo',
      label: 'Move to top',
      onPress: () => run(() => notesStore.moveToTop(note.id)),
    },
    {
      icon: note.archived ? 'unarchive' : 'archive',
      label: note.archived ? 'Unarchive' : 'Archive',
      onPress: () => run(() => notesStore.toggleArchive(note.id)),
    },
    {
      icon: 'delete',
      label: 'Delete',
      destructive: true,
      onPress: () => run(async () => {
        const removed = await notesStore.deleteNote(note.id);
        if (removed) onDeleted(removed);
      }),
    },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' }}
        onPress={onClose}
        accessibilityLabel="Close menu"
      >
        <Pressable
          style={{
            backgroundColor: colors.surfaceContainerHigh,
            borderTopLeftRadius: shapes.extraLarge,
            borderTopRightRadius: shapes.extraLarge,
            paddingTop: spacing.lg,
            paddingBottom: spacing.xxxl,
          }}
          onPress={() => {}}
        >
          <Text
            style={[typography.titleMedium, {
              color: colors.onSurface,
              paddingHorizontal: spacing.xl,
              paddingBottom: spacing.md,
            }]}
            numberOfLines={1}
          >
            {note.title || 'Untitled note'}
          </Text>

          {actions.map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
              android_ripple={{ color: colors.onSurface + '14' }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.lg,
                paddingVertical: spacing.lg,
                paddingHorizontal: spacing.xl,
              }}
              accessibilityRole="button"
            >
              <Icon
                name={action.icon}
                size={21}
                color={action.destructive ? colors.error : colors.onSurfaceVariant}
              />
              <Text style={[typography.bodyLarge, {
                color: action.destructive ? colors.error : colors.onSurface,
              }]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

// ─── Screen ───────────────────────────────────────────────────────────────

export default function NotesScreen({ initialNoteId, onConsumeInitialNote }) {
  const theme = useTheme();
  const { colors, typography, spacing, shapes, tints, elevation } = theme;
  const { width } = useWindowDimensions();

  const [notes, setNotes] = useState(() => notesStore.getNotes());
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);      // note object, or 'new'
  const [undoNote, setUndoNote] = useState(null);
  const [menuNote, setMenuNote] = useState(null);

  useEffect(() => {
    const unsub = notesStore.subscribe(() => {
      setNotes(notesStore.getNotes({ archived: showArchived }));
    });
    setNotes(notesStore.getNotes({ archived: showArchived }));
    return unsub;
  }, [showArchived]);

  // Deep link from the pause overlay: "open my notes" on a specific heading.
  useEffect(() => {
    if (!initialNoteId) return;
    const note = notesStore.getNote(initialNoteId);
    if (note) setEditing(note);
    onConsumeInitialNote?.();
  }, [initialNoteId, onConsumeInitialNote]);

  const filtered = useMemo(
    () => notesStore.getNotes({ archived: showArchived, query }),
    [notes, query, showArchived]
  );

  const pinned = filtered.filter(n => n.pinned);
  const others = filtered.filter(n => !n.pinned);

  const columnCount = width >= 720 ? 3 : 2;
  const gutter = spacing.md;
  const horizontalPadding = spacing.lg;
  const columnWidth =
    (width - horizontalPadding * 2 - gutter * (columnCount - 1)) / columnCount;

  const handleToggleItem = useCallback((noteId, itemId) => {
    notesStore.toggleItem(noteId, itemId);
  }, []);

  const handleDelete = useCallback(async (id) => {
    try {
      const removed = await notesStore.deleteNote(id);
      if (removed) {
        setUndoNote(removed);
        setTimeout(() => setUndoNote(cur => (cur?.id === removed.id ? null : cur)), 6000);
      }
    } catch (error) {
      // A failed delete used to leave the editor open with its close path already
      // latched, so back did nothing and the app had to be killed.
      console.error('[NotesScreen] Delete failed:', error);
    } finally {
      setEditing(null);
    }
  }, []);

  const handleLongPress = useCallback((note) => setMenuNote(note), []);

  const renderGrid = (list) => {
    const columns = packColumns(list, columnCount, columnWidth);
    return (
      <View style={{ flexDirection: 'row', gap: gutter }}>
        {columns.map((column, i) => (
          <View key={i} style={{ flex: 1 }}>
            {column.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                tint={tints[note.color] || tints.default}
                theme={theme}
                onPress={setEditing}
                onLongPress={handleLongPress}
                onToggleItem={handleToggleItem}
              />
            ))}
          </View>
        ))}
      </View>
    );
  };

  const sectionLabel = (text) => (
    <Text style={[typography.labelMedium, {
      color: colors.onSurfaceVariant,
      letterSpacing: 1,
      marginBottom: spacing.sm,
      marginTop: spacing.xs,
    }]}>
      {text}
    </Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Search bar doubles as the header — Keep's pattern, and it removes a
          redundant title row from a screen that is obviously the notes screen. */}
      <View style={{ paddingHorizontal: horizontalPadding, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surfaceContainerHigh,
          borderRadius: shapes.full,
          paddingHorizontal: spacing.lg,
          height: 50,
          gap: spacing.md,
        }}>
          <Icon name="search" size={20} color={colors.onSurfaceVariant} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={showArchived ? 'Search archive' : 'Search your notes'}
            placeholderTextColor={colors.onSurfaceVariant}
            style={[typography.bodyLarge, { flex: 1, color: colors.onSurface, paddingVertical: 0 }]}
            returnKeyType="search"
            accessibilityLabel="Search notes"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Icon name="close" size={18} color={colors.onSurfaceVariant} />
            </Pressable>
          )}
          <Pressable
            onPress={() => setShowArchived(v => !v)}
            hitSlop={10}
            accessibilityLabel={showArchived ? 'Show active notes' : 'Show archived notes'}
          >
            <Icon
              name="archive"
              size={20}
              color={showArchived ? colors.primary : colors.onSurfaceVariant}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingBottom: 120,
          paddingTop: spacing.xs,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 90, gap: spacing.sm }}>
            <Icon
              name={query ? 'search' : showArchived ? 'archive' : 'notes'}
              size={44}
              color={colors.outlineVariant}
            />
            <Text style={[typography.titleMedium, { color: colors.onSurface, marginTop: spacing.sm }]}>
              {query ? 'Nothing matches' : showArchived ? 'No archived notes' : 'No notes yet'}
            </Text>
            <Text style={[typography.bodyMedium, {
              color: colors.onSurfaceVariant, textAlign: 'center', paddingHorizontal: spacing.xxxl,
            }]}>
              {query
                ? `No note contains “${query}”.`
                : showArchived
                  ? 'Notes you archive are kept here.'
                  : 'Write down what matters. These headings appear when a distracting app is paused.'}
            </Text>
          </View>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                {sectionLabel('PINNED')}
                {renderGrid(pinned)}
              </>
            )}
            {others.length > 0 && (
              <>
                {pinned.length > 0 && sectionLabel('OTHERS')}
                {renderGrid(others)}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Undo bar — deleting a note should never be a dead end */}
      {undoNote && (
        <View style={{
          position: 'absolute',
          left: spacing.lg,
          right: spacing.lg,
          bottom: 96,
          backgroundColor: colors.inverseSurface,
          borderRadius: shapes.medium,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          ...elevation.level3,
        }}>
          <Text style={[typography.bodyMedium, { color: colors.inverseOnSurface, flex: 1 }]}>
            Note deleted
          </Text>
          <Pressable
            onPress={async () => { await notesStore.restoreNote(undoNote); setUndoNote(null); }}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[typography.labelLarge, { color: colors.primary }]}>UNDO</Text>
          </Pressable>
        </View>
      )}

      {/* FAB */}
      <Pressable
        onPress={() => setEditing('new')}
        style={({ pressed }) => [{
          position: 'absolute',
          right: spacing.xl,
          bottom: spacing.xl,
          width: 60,
          height: 60,
          borderRadius: shapes.extraLarge,
          backgroundColor: colors.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed ? 0.94 : 1 }],
          ...elevation.level3,
        }]}
        accessibilityRole="button"
        accessibilityLabel="New note"
      >
        <Icon name="add" size={28} color={colors.onPrimaryContainer} />
      </Pressable>

      {menuNote && (
        <NoteActionSheet
          note={menuNote}
          theme={theme}
          onClose={() => setMenuNote(null)}
          onDeleted={(removed) => {
            setUndoNote(removed);
            setTimeout(() => setUndoNote(cur => (cur?.id === removed.id ? null : cur)), 6000);
          }}
        />
      )}

      {editing && (
        <NoteEditor
          note={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </View>
  );
}
