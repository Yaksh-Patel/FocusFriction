// src/core/taskStore.js

/**
 * TaskStore — Persistent local task/goal manager backed by secureStore.
 *
 * Uses an in-memory cache for synchronous reads and auto-persists every
 * mutation to secureStore. Components can subscribe to changes via the
 * lightweight event emitter pattern.
 */

import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import appStorage from './appStorage';

const STORAGE_KEY = '@focusfriction/tasks';

const DEFAULT_TASKS = [];

class TaskStore {
  constructor() {
    this.tasks = [];
    this.listeners = new Set();
    this.hydrated = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Hydrate tasks from secureStore on app boot.
   * If no persisted data exists, seeds with default tasks.
   * Must be called once before any other method.
   */
  async init() {
    try {
      const stored = await appStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        this.tasks = JSON.parse(stored);
      } else {
        this.tasks = [...DEFAULT_TASKS];
        await this._persist();
      }
    } catch (error) {
      console.warn('[TaskStore] Failed to hydrate, using defaults:', error);
      this.tasks = [...DEFAULT_TASKS];
    }
    this.hydrated = true;
    this._notify();
  }

  // ─── Reads (synchronous from cache) ─────────────────────────────────

  /**
   * Returns all tasks.
   * @returns {Array<{ id: string, title: string, completed: boolean }>}
   */
  getTasks() {
    return [...this.tasks];
  }

  /**
   * Returns only uncompleted tasks.
   * @returns {Array<{ id: string, title: string, completed: boolean }>}
   */
  getActiveTasks() {
    return this.tasks.filter((task) => !task.completed);
  }

  // ─── Mutations (auto-persist) ───────────────────────────────────────

  /**
   * Appends a new task and persists.
   * @param {string} title - The task title
   * @returns {{ id: string, title: string, completed: boolean } | null}
   */
  async addTask(title) {
    if (!title || String(title).trim() === '') return null;

    const newTask = {
      id: uuidv4(),
      title: String(title).trim(),
      completed: false,
      sortOrder: this.tasks.length,
    };

    this.tasks = [...this.tasks, newTask];
    await this._persist();
    this._notify();
    return newTask;
  }

  /**
   * Toggles the completion status of a task by ID.
   * @param {string} id - Task ID
   */
  async toggleTask(id) {
    if (!id) return;

    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return;

    this.tasks = this.tasks.map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task
    );
    await this._persist();
    this._notify();
  }

  /**
   * Updates the title of a task by ID.
   * @param {string} id - Task ID
   * @param {string} newTitle - New title
   */
  async updateTaskTitle(id, newTitle) {
    if (!id || !newTitle || String(newTitle).trim() === '') return;

    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return;

    this.tasks = this.tasks.map((task) =>
      task.id === id ? { ...task, title: String(newTitle).trim() } : task
    );
    await this._persist();
    this._notify();
  }

  /**
   * Permanently removes a task by ID.
   * @param {string} id - Task ID
   */
  async deleteTask(id) {
    if (!id) return;

    const before = this.tasks.length;
    this.tasks = this.tasks.filter((task) => task.id !== id);

    if (this.tasks.length !== before) {
      await this._persist();
      this._notify();
    }
  }

  /**
   * Replaces the current tasks list with a new ordered list.
   * @param {Array<{ id: string, title: string, completed: boolean }>} newOrderedList - Array of task objects
   */
  async reorderTasks(newOrderedList) {
    if (!Array.isArray(newOrderedList) || newOrderedList.length === 0) return;

    this.tasks = newOrderedList.map((task, index) => ({
      ...task,
      sortOrder: index,
    }));
    await this._persist();
    this._notify();
  }

  /**
   * Moves a task up or down by one position.
   * @param {string} id - Task ID
   * @param {'up' | 'down'} direction - Direction to move the task
   */
  async moveTask(id, direction) {
    if (!id || (direction !== 'up' && direction !== 'down')) return;

    const index = this.tasks.findIndex((t) => t.id === id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === this.tasks.length - 1) return;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const newTasks = [...this.tasks];
    
    // Swap
    const temp = newTasks[index];
    newTasks[index] = newTasks[newIndex];
    newTasks[newIndex] = temp;

    this.tasks = newTasks;
    await this._persist();
    this._notify();
  }

  // ─── Event System ───────────────────────────────────────────────────

  /**
   * Subscribe to task changes.
   * @param {Function} listener - Callback invoked on any mutation
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ─── Internal ───────────────────────────────────────────────────────

  /** Persist current tasks array to AsyncStorage. */
  async _persist() {
    try {
      await appStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
    } catch (error) {
      console.warn('[TaskStore] Persist failed:', error);
    }
  }

  /** Notify all subscribed listeners. */
  _notify() {
    this.listeners.forEach((fn) => {
      try {
        fn(this.getTasks());
      } catch (error) {
        console.warn('[TaskStore] Listener error:', error);
      }
    });
  }
}

export default new TaskStore();
