// src/core/notesStore.js

/**
 * NotesStore — the app's primary data store, backed by SQLite.
 *
 * Replaces the old taskStore, which rewrote a whole JSON blob to AsyncStorage on
 * every keystroke-save. Notes are edited continuously, so writes must be
 * incremental and indexed.
 *
 * Every mutation also mirrors a compact heading projection to the native side, so
 * the pause overlay can render your note titles without touching this database —
 * it runs in a different process context with no JS alive.
 */

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import * as SQLite from 'expo-sqlite';
import nativeBridge from './nativeBridge';
import appStorage from './appStorage';

const DB_NAME = 'focusfriction.db';
const LEGACY_TASKS_KEY = '@focusfriction/tasks';
const MIGRATION_FLAG = '@focusfriction/notes_migrated_v1';

/** Keep-style note tints. Stored by key, resolved by the theme. */
export const NOTE_COLORS = [
  'default', 'coral', 'peach', 'sand', 'mint',
  'sage', 'mist', 'sky', 'lilac', 'blush',
];

function now() {
  return Date.now();
}

class NotesStore {
  constructor() {
    this.db = null;
    this.notes = [];          // in-memory mirror for synchronous reads
    this.listeners = new Set();
    this.hydrated = false;
    this.schemaReady = false;
    this.initError = null;
    // One shared open promise. expo-sqlite throws NullPointerException from
    // prepareAsync when the same database is opened more than once, and two
    // call sites racing on `db == null` was enough to trigger it.
    this._dbPromise = null;
  }

  _openDb() {
    if (!this._dbPromise) this._dbPromise = SQLite.openDatabaseAsync(DB_NAME);
    return this._dbPromise;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async init() {
    try {
      this.db = await this._openDb();
      await this._ensureSchema();
      await this._migrateLegacyTasks();
      await this._reload();
      this.initError = null;
    } catch (error) {
      console.error('[NotesStore] Init failed:', error);
      this.initError = error;
      this.notes = [];
    }
    this.hydrated = true;
    this._notify();
  }

  /**
   * Create the schema. Kept separate from opening the database and from the
   * PRAGMA, because a failure in any one of them previously left `db` assigned
   * with no table behind it — every later write then failed with "no such
   * table: notes", which surfaced to the user as an unexplained save error.
   */
  async _ensureSchema() {
    if (!this.db) throw new Error('Database is not open');

    // Best-effort: WAL is a performance choice, not a correctness one, and this
    // statement returns a row, which some drivers refuse inside a batch.
    try {
      await this.db.execAsync('PRAGMA journal_mode = WAL;');
    } catch (e) {
      console.warn('[NotesStore] WAL unavailable, continuing on the default journal:', e);
    }

    await this.db.execAsync(`
      CREATE TABLE IF NOT EXISTS notes (
        id          TEXT PRIMARY KEY NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        items       TEXT NOT NULL DEFAULT '[]',
        color       TEXT NOT NULL DEFAULT 'default',
        labels      TEXT NOT NULL DEFAULT '',
        pinned      INTEGER NOT NULL DEFAULT 0,
        archived    INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `);

    // Manual ordering, added after the first release. ALTER TABLE ADD COLUMN
    // throws if it already exists, and there is no IF NOT EXISTS for it.
    const columns = await this.db.getAllAsync(`PRAGMA table_info(notes)`);
    if (!columns.some(c => c.name === 'sort_order')) {
      await this.db.execAsync(`ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`);
    }

    await this.db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_notes_order ON notes(archived, pinned, sort_order DESC, updated_at DESC);`
    );

    this.schemaReady = true;
  }

  /**
   * Guard every write. If init failed (bad upgrade, storage hiccup) this gives
   * the app a chance to recover instead of failing for the rest of the session.
   */
  async _requireDb() {
    if (this.db && this.schemaReady) return;
    this.db = await this._openDb();
    await this._ensureSchema();
    if (this.notes.length === 0) await this._reload();
  }

  /**
   * Every write goes through here. If the native handle has gone bad — which
   * surfaces as "NativeDatabase.prepareAsync has been rejected / NullPointer" —
   * drop the connection and retry once against a fresh one, rather than failing
   * the user's note.
   */
  async _run(sql, params) {
    await this._requireDb();
    try {
      return await this.db.runAsync(sql, params);
    } catch (error) {
      console.warn('[NotesStore] Write failed, reopening database:', error);
      this._dbPromise = null;
      this.db = null;
      this.schemaReady = false;
      await this._requireDb();
      return this.db.runAsync(sql, params);
    }
  }

  /**
   * One-time import of the old flat task list so nothing the user wrote is lost.
   * Guarded by a flag rather than by "is the table empty", so deleting every note
   * doesn't resurrect old tasks on next launch.
   */
  async _migrateLegacyTasks() {
    const done = await appStorage.getItem(MIGRATION_FLAG);
    if (done === 'true') return;

    try {
      const raw = await appStorage.getItem(LEGACY_TASKS_KEY);
      const tasks = raw ? JSON.parse(raw) : [];
      if (Array.isArray(tasks) && tasks.length > 0) {
        const stamp = now();
        // The old model was one line of text per task. That maps to a single
        // checklist note far better than to N separate notes.
        const items = tasks.map((t, i) => ({
          id: uuidv4(),
          text: String(t.title || '').trim(),
          checked: !!t.completed,
          position: i,
        })).filter(i => i.text !== '');

        if (items.length > 0) {
          await this.db.runAsync(
            `INSERT INTO notes (id, title, body, items, color, labels, pinned, archived, created_at, updated_at)
             VALUES (?, ?, '', ?, 'sage', '', 1, 0, ?, ?)`,
            [uuidv4(), 'My goals', JSON.stringify(items), stamp, stamp]
          );
        }
      }
    } catch (error) {
      console.warn('[NotesStore] Legacy migration failed:', error);
    }
    await appStorage.setItem(MIGRATION_FLAG, 'true');
  }

  async _reload() {
    const rows = await this.db.getAllAsync(
      `SELECT * FROM notes ORDER BY pinned DESC, sort_order DESC, updated_at DESC`
    );
    this.notes = rows.map(this._hydrateRow);
    await this._mirrorToNative();
  }

  _hydrateRow = (row) => ({
    id: row.id,
    title: row.title || '',
    body: row.body || '',
    items: (() => {
      try { return JSON.parse(row.items || '[]'); } catch (e) { return []; }
    })(),
    color: row.color || 'default',
    labels: row.labels ? row.labels.split(',').filter(Boolean) : [],
    pinned: !!row.pinned,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order || 0,
  });

  // ─── Reads (synchronous, from the in-memory mirror) ─────────────────────

  getNotes({ archived = false, label = null, query = '' } = {}) {
    let out = this.notes.filter(n => n.archived === archived);

    if (label) out = out.filter(n => n.labels.includes(label));

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.items.some(i => (i.text || '').toLowerCase().includes(q))
      );
    }
    return out;
  }

  getNote(id) {
    return this.notes.find(n => n.id === id) || null;
  }

  getAllLabels() {
    const set = new Set();
    this.notes.forEach(n => n.labels.forEach(l => set.add(l)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  getCounts() {
    const active = this.notes.filter(n => !n.archived);
    const openItems = active.reduce(
      (sum, n) => sum + n.items.filter(i => !i.checked).length, 0
    );
    return {
      total: active.length,
      pinned: active.filter(n => n.pinned).length,
      archived: this.notes.length - active.length,
      openItems,
    };
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  async createNote(fields = {}) {
    await this._requireDb();
    const stamp = now();
    const note = {
      id: uuidv4(),
      title: fields.title || '',
      body: fields.body || '',
      items: fields.items || [],
      color: fields.color || 'default',
      labels: fields.labels || [],
      pinned: !!fields.pinned,
      archived: false,
      createdAt: stamp,
      updatedAt: stamp,
    };

    note.sortOrder = this._nextSortOrder();

    await this._run(
      `INSERT INTO notes (id, title, body, items, color, labels, pinned, archived, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [note.id, note.title, note.body, JSON.stringify(note.items),
       note.color, note.labels.join(','), note.pinned ? 1 : 0, stamp, stamp, note.sortOrder]
    );

    this.notes = [note, ...this.notes];
    await this._afterWrite();
    return note;
  }

  async updateNote(id, patch) {
    await this._requireDb();
    const existing = this.getNote(id);
    if (!existing) return null;

    const next = { ...existing, ...patch, updatedAt: now() };

    await this._run(
      `UPDATE notes SET title = ?, body = ?, items = ?, color = ?, labels = ?,
         pinned = ?, archived = ?, updated_at = ?, sort_order = ? WHERE id = ?`,
      [next.title, next.body, JSON.stringify(next.items), next.color,
       next.labels.join(','), next.pinned ? 1 : 0, next.archived ? 1 : 0,
       next.updatedAt, next.sortOrder || 0, id]
    );

    this.notes = this._resort(this.notes.map(n => (n.id === id ? next : n)));
    await this._afterWrite();
    return next;
  }

  async deleteNote(id) {
    await this._requireDb();
    const note = this.getNote(id);
    if (!note) return null;
    await this._run(`DELETE FROM notes WHERE id = ?`, [id]);
    this.notes = this.notes.filter(n => n.id !== id);
    await this._afterWrite();
    return note;   // returned so the caller can offer an undo
  }

  /** Re-insert a deleted note verbatim, preserving its id and timestamps. */
  async restoreNote(note) {
    if (!note || !note.id) return;
    await this._requireDb();
    await this._run(
      `INSERT OR REPLACE INTO notes (id, title, body, items, color, labels, pinned, archived, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [note.id, note.title, note.body, JSON.stringify(note.items), note.color,
       note.labels.join(','), note.pinned ? 1 : 0, note.archived ? 1 : 0,
       note.createdAt, note.updatedAt, note.sortOrder || 0]
    );
    this.notes = this._resort([note, ...this.notes]);
    await this._afterWrite();
  }

  togglePin(id) {
    const n = this.getNote(id);
    return n ? this.updateNote(id, { pinned: !n.pinned }) : null;
  }

  toggleArchive(id) {
    const n = this.getNote(id);
    return n ? this.updateNote(id, { archived: !n.archived }) : null;
  }

  setColor(id, color) {
    return this.updateNote(id, { color });
  }

  /** Manual reordering: lift a note above everything else in its group. */
  moveToTop(id) {
    return this.updateNote(id, { sortOrder: this._nextSortOrder() });
  }

  /** Swap a note with its neighbour in the current display order. */
  async moveBy(id, delta) {
    const list = this.getNotes({ archived: this.getNote(id)?.archived || false });
    const index = list.findIndex(n => n.id === id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= list.length) return null;

    const a = list[index];
    const b = list[target];
    // Pinned and unpinned are separate groups; refuse to swap across them.
    if (a.pinned !== b.pinned) return null;

    const aOrder = a.sortOrder || 0;
    const bOrder = b.sortOrder || 0;
    if (aOrder === bOrder) {
      // Never ordered manually before — assign distinct values first.
      await this.updateNote(b.id, { sortOrder: this._nextSortOrder() });
      return this.updateNote(a.id, { sortOrder: this._nextSortOrder() + 1 });
    }
    await this.updateNote(b.id, { sortOrder: aOrder });
    return this.updateNote(a.id, { sortOrder: bOrder });
  }

  async toggleItem(noteId, itemId) {
    const note = this.getNote(noteId);
    if (!note) return null;
    const items = note.items.map(i =>
      i.id === itemId ? { ...i, checked: !i.checked } : i
    );
    return this.updateNote(noteId, { items });
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  _resort(list) {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const orderDiff = (b.sortOrder || 0) - (a.sortOrder || 0);
      if (orderDiff !== 0) return orderDiff;
      return b.updatedAt - a.updatedAt;
    });
  }

  _nextSortOrder() {
    return this.notes.reduce((max, n) => Math.max(max, n.sortOrder || 0), 0) + 1;
  }

  async _afterWrite() {
    await this._mirrorToNative();
    this._notify();
  }

  /**
   * Push note headings to the native policy store. Pinned first, then most
   * recently touched — the overlay shows the top few.
   */
  async _mirrorToNative() {
    try {
      const headings = this.notes
        .filter(n => !n.archived && (n.title.trim() || n.items.some(i => !i.checked)))
        .slice(0, 8)
        .map(n => ({
          id: n.id,
          // A note with no title still has something worth showing: its first
          // unchecked item, then its first line of body.
          title: n.title.trim()
            || (n.items.find(i => !i.checked)?.text || '').trim()
            || n.body.split('\n')[0].trim(),
          color: n.color,
          pinned: n.pinned,
        }))
        .filter(h => h.title);

      await nativeBridge.setNoteHeadings(headings);
    } catch (error) {
      console.warn('[NotesStore] Mirror failed:', error);
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    this.listeners.forEach(fn => {
      try {
        fn(this.notes);
      } catch (e) {
        // Loud on purpose. A listener that throws here used to fail silently and
        // left the UI showing stale data after a successful write.
        console.error('[NotesStore] Listener threw — UI may be stale:', e);
      }
    });
  }
}

export default new NotesStore();
