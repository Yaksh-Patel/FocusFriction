// src/components/Icon.js

/**
 * Icon — the single icon vocabulary for the app.
 *
 * Replaces the emoji that were doing the work of icons (🏠 🛡 ⚙ 🔍 ☰ ✕ ✓ 📤).
 * Emoji render differently per device, can't take a colour, and are the main
 * reason the app read as unfinished.
 *
 * Names are semantic, not glyph names, so the underlying set can change without
 * touching call sites.
 */

import React from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const GLYPHS = {
  notes: 'sticky-note-2',
  notesOutline: 'sticky-note-2',
  shield: 'shield',
  settings: 'settings',
  search: 'search',
  close: 'close',
  check: 'check',
  add: 'add',
  pin: 'push-pin',
  archive: 'archive',
  unarchive: 'unarchive',
  palette: 'palette',
  delete: 'delete-outline',
  back: 'arrow-back',
  more: 'more-vert',
  checkbox: 'check-box-outline-blank',
  checkboxChecked: 'check-box',
  label: 'label-outline',
  export: 'file-upload',
  import: 'file-download',
  schedule: 'schedule',
  timer: 'timer',
  lock: 'lock-outline',
  unlock: 'lock-open',
  warning: 'warning-amber',
  info: 'info-outline',
  chevronRight: 'chevron-right',
  lightMode: 'light-mode',
  darkMode: 'dark-mode',
  auto: 'brightness-auto',
  drag: 'drag-indicator',
  math: 'calculate',
  typing: 'keyboard',
  breathing: 'self-improvement',
  grid: 'grid-view',
  list: 'view-agenda',
  undo: 'undo',
};

export default function Icon({ name, size = 22, color, style }) {
  const glyph = GLYPHS[name] || 'help-outline';
  return <MaterialIcons name={glyph} size={size} color={color} style={style} />;
}

export { GLYPHS };
