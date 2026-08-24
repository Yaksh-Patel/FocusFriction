// src/components/HomeScreen.js

/**
 * HomeScreen — Tab 1: Value Alignment Goals & Daily Stats.
 *
 * A clean, focused layout for managing personal priorities with
 * Material Expressive styling. Connects to taskStore and sessionManager.
 * Uses DraggableFlatList for reordering goals.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { TouchableOpacity as RNGHTouchableOpacity } from 'react-native-gesture-handler';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import Theme from '../theme';
import taskStore from '../core/taskStore';
import sessionManager from '../core/sessionManager';

// ─── Helpers ──────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Component ────────────────────────────────────────────────────────────

const HomeScreen = () => {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [stats, setStats] = useState({ 
    puzzlesSolved: 0, interceptions: 0, estimatedDeferredMinutes: 0, puzzlesBypassed: 0 
  });

  useEffect(() => {
    setTasks(taskStore.getTasks());
    setStats(sessionManager.getDailyStats());
    
    const unsubTasks = taskStore.subscribe((updated) => setTasks(updated));
    const unsubSession = sessionManager.subscribe((updated) => setStats(updated));

    return () => { unsubTasks(); unsubSession(); };
  }, []);

  const handleAddTask = useCallback(async () => {
    if (newTask.trim() === '') return;
    await taskStore.addTask(newTask);
    setNewTask('');
  }, [newTask]);

  const handleToggleTask = useCallback(async (id) => {
    await taskStore.toggleTask(id);
  }, []);

  const handleEditStart = useCallback((id, currentTitle) => {
    setEditingTaskId(id);
    setEditingText(currentTitle);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (editingTaskId && editingText.trim() !== '') {
      await taskStore.updateTaskTitle(editingTaskId, editingText);
    }
    setEditingTaskId(null);
    setEditingText('');
  }, [editingTaskId, editingText]);

  const handleDeleteTask = useCallback((id, title) => {
    Alert.alert(
      'Remove Goal',
      `Delete "${title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => taskStore.deleteTask(id) },
      ],
      { cancelable: true }
    );
  }, []);

  const handleDragEnd = async ({ data }) => {
    setTasks(data); // Optimistic UI update
    await taskStore.reorderTasks(data);
  };

  const activeCount = tasks.filter((t) => !t.completed).length;
  const completedCount = tasks.filter((t) => t.completed).length;

  const renderItem = ({ item, drag, isActive }) => {
    return (
      <ScaleDecorator>
        <View
          style={[
            styles.goalCard, 
            item.completed && styles.goalCardCompleted,
            isActive && styles.goalCardActive
          ]}
        >
          {/* Dedicated Drag Handle using RNGH TouchableOpacity */}
          <RNGHTouchableOpacity
            onLongPress={drag}
            delayLongPress={150}
            style={styles.dragHandle}
            accessibilityRole="button"
            accessibilityLabel={`Drag handle for goal: ${item.title}`}
            accessibilityHint="Long press and drag to reorder this goal"
          >
            <Text style={styles.dragHandleIcon}>☰</Text>
          </RNGHTouchableOpacity>

          <TouchableOpacity
            style={[styles.goalCheckbox, item.completed && styles.goalCheckboxChecked]}
            onPress={() => handleToggleTask(item.id)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.completed }}
            accessibilityLabel={`Mark "${item.title}" as ${item.completed ? 'incomplete' : 'complete'}`}
          >
            {item.completed && <Text style={styles.goalCheckmark}>✓</Text>}
          </TouchableOpacity>
          
          {editingTaskId === item.id ? (
            <TextInput
              style={styles.goalEditInput}
              value={editingText}
              onChangeText={setEditingText}
              autoFocus
              onBlur={handleEditSave}
              onSubmitEditing={handleEditSave}
              returnKeyType="done"
              accessibilityLabel="Edit goal title"
            />
          ) : (
            <Text
              style={[styles.goalText, item.completed && styles.goalTextCompleted]}
              numberOfLines={2}
              onPress={() => handleEditStart(item.id, item.title)}
              accessibilityHint="Tap to edit title"
            >
              {item.title}
            </Text>
          )}

          <TouchableOpacity
            style={styles.goalDeleteBtn}
            onPress={() => handleDeleteTask(item.id, item.title)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Delete goal ${item.title}`}
          >
            <Text style={styles.goalDeleteIcon}>✕</Text>
          </TouchableOpacity>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={styles.container}>
        {/* ── Fixed Header Area ──────────────────────────────────────────── */}
        <View style={styles.fixedHeaderArea}>
          <View style={styles.headerSection}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.greeting}>{getGreeting()}</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {activeCount > 0
                ? `${activeCount} goal${activeCount !== 1 ? 's' : ''} to focus on`
                : completedCount > 0
                  ? 'All goals completed! 🎉'
                  : 'Set your intentions for today'}
            </Text>
          </View>

          {/* ── Analytics Summary Card ─────────────────────────────────────── */}
          <View style={styles.analyticsCard}>
            <View style={styles.analyticsHeader}>
              <Text style={styles.analyticsTitle}>Daily Summary</Text>
              <Text style={styles.analyticsSubtitle}>You're doing great!</Text>
            </View>
            
            <View style={styles.analyticsStatsRow}>
              <View style={styles.analyticsStatBox}>
                <Text style={styles.analyticsStatValue}>{stats.estimatedDeferredMinutes || 0}</Text>
                <Text style={styles.analyticsStatLabel}>Est. Deferred ℹ️</Text>
              </View>
              <View style={styles.analyticsStatDivider} />
              <View style={styles.analyticsStatBox}>
                <Text style={styles.analyticsStatValue}>{stats.interventionsCompleted || stats.puzzlesSolved || 0}</Text>
                <Text style={styles.analyticsStatLabel}>Completed</Text>
              </View>
              <View style={styles.analyticsStatDivider} />
              <View style={styles.analyticsStatBox}>
                <Text style={styles.analyticsStatValue}>{stats.puzzlesBypassed || 0}</Text>
                <Text style={styles.analyticsStatLabel}>Bypassed</Text>
              </View>
            </View>
            
            <View style={styles.analyticsFooter}>
              <Text style={styles.analyticsFooterIcon}>📉</Text>
              <Text style={styles.analyticsFooterText}>
                {stats.estimatedDeferredMinutes > 0 
                  ? `You've deferred ${stats.estimatedDeferredMinutes} minutes of distraction today.`
                  : `Stay focused. The day is just beginning!`}
              </Text>
            </View>
            <Text style={{...typography.bodySmall, color: colors.onSurfaceVariant, marginTop: spacing.xs, textAlign: 'center'}}>~15 min per goals session</Text>
          </View>

          {/* ── Section Label ────────────────────────────────────────────── */}
          <Text style={styles.sectionLabel}>YOUR GOALS</Text>
        </View>

        {tasks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyTitle}>No goals yet</Text>
            <Text style={styles.emptyBody}>
              Add what you should be doing instead of scrolling
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <DraggableFlatList
              data={tasks}
              onDragEnd={handleDragEnd}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            />
          </View>
        )}

        {/* ── Inline Pill Input ────────────────────────────────────────── */}
        <View style={styles.inputBar}>
          <View style={styles.inputPill}>
            <TextInput
              style={styles.inputField}
              placeholder="Add a new goal..."
              placeholderTextColor={Theme.colors.outline}
              value={newTask}
              onChangeText={setNewTask}
              onSubmitEditing={handleAddTask}
              returnKeyType="done"
              accessibilityLabel="New goal title"
            />
            <TouchableOpacity
              style={[styles.addPillBtn, newTask.trim() === '' && styles.addPillBtnDisabled]}
              onPress={handleAddTask}
              disabled={newTask.trim() === ''}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Add goal"
              accessibilityState={{ disabled: newTask.trim() === '' }}
            >
              <Text style={styles.addPillBtnText}>Add Goal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Styles ─────────────────────────────────────────────────────────────

const { colors, typography, shapes, spacing } = Theme;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fixedHeaderArea: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl + 16,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 100, // padding for input bar
  },

  // Header
  headerSection: {
    marginBottom: spacing.xxl,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  greeting: {
    ...typography.displayMedium,
    color: colors.onSurface,
  },
  headerSubtitle: {
    ...typography.bodyLarge,
    color: colors.onSurfaceVariant,
  },

  // Analytics Card
  analyticsCard: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: shapes.extraLarge,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
  },
  analyticsHeader: {
    marginBottom: spacing.lg,
  },
  analyticsTitle: {
    ...typography.titleLarge,
    color: colors.onSurface,
  },
  analyticsSubtitle: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
  },
  analyticsStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: shapes.large,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  analyticsStatBox: {
    flex: 1,
    alignItems: 'center',
  },
  analyticsStatValue: {
    ...typography.displaySmall,
    color: colors.primary,
    fontWeight: '700',
  },
  analyticsStatLabel: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xs,
  },
  analyticsStatDivider: {
    width: 1,
    height: '70%',
    backgroundColor: colors.outlineVariant,
  },
  analyticsFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  analyticsFooterIcon: {
    fontSize: 16,
  },
  analyticsFooterText: {
    ...typography.bodySmall,
    color: colors.onSurfaceVariant,
    flex: 1,
  },

  // Section
  sectionLabel: {
    ...typography.labelMedium,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.md,
    letterSpacing: 1,
  },

  // Goal Card
  dragHandle: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragHandleIcon: {
    fontSize: 18,
    color: colors.onSurfaceVariant,
    opacity: 0.5,
  },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: shapes.large,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  goalCardCompleted: {
    backgroundColor: colors.successContainer,
  },
  goalCardActive: {
    backgroundColor: colors.surfaceContainerHighest,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  goalCheckbox: {
    width: 24,
    height: 24,
    borderRadius: shapes.medium,
    borderWidth: 2,
    borderColor: colors.outline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalCheckboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  goalCheckmark: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  goalText: {
    ...typography.bodyLarge,
    color: colors.onSurface,
    flex: 1,
  },
  goalEditInput: {
    ...typography.bodyLarge,
    color: colors.onSurface,
    flex: 1,
    backgroundColor: colors.surfaceContainerHighest,
    paddingVertical: 0,
    paddingHorizontal: spacing.sm,
    borderRadius: shapes.small,
  },
  goalTextCompleted: {
    textDecorationLine: 'line-through',
    color: colors.onSurfaceVariant,
    opacity: 0.7,
  },

  goalDeleteBtn: {
    width: 32,
    height: 32,
    borderRadius: shapes.large,
    backgroundColor: colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goalDeleteIcon: {
    color: colors.onSurfaceVariant,
    fontSize: 12,
    fontWeight: '700',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl + 16,
    backgroundColor: colors.surfaceContainer,
    borderRadius: shapes.extraLarge,
    marginHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.titleLarge,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptyBody: {
    ...typography.bodyMedium,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },

  // Input Bar
  inputBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: shapes.full,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  inputField: {
    flex: 1,
    ...typography.bodyLarge,
    color: colors.onSurface,
    paddingVertical: spacing.sm,
  },
  addPillBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: shapes.full,
  },
  addPillBtnDisabled: {
    opacity: 0.3,
  },
  addPillBtnText: {
    ...typography.labelLarge,
    color: colors.onPrimary,
  },
});

export default HomeScreen;
