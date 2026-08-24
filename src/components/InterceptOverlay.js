import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Vibration, ScrollView, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import Theme from '../theme';
import puzzleEngine from '../core/puzzleEngine';
import taskStore from '../core/taskStore';
import sessionManager from '../core/sessionManager';
import settingsStore from '../core/settingsStore';

const { colors, typography, shapes, spacing } = Theme;

const TYPING_PHRASES = [
  "I am opening this app deliberately and will exit in 5 minutes",
  "I am choosing to be distracted right now",
  "My goals are more important than scrolling",
];

export default function InterceptOverlay({ targetAppName, onUnlock, onGoToGoals }) {
  const [activeMode, setActiveMode] = useState(null); // 'math', 'typing', 'breathing'
  
  // Math State
  const [puzzle, setPuzzle] = useState(null);
  
  // Typing State
  const [typingPhrase, setTypingPhrase] = useState('');
  
  // Shared State
  const [userInput, setUserInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTasks, setActiveTasks] = useState([]);
  const [attempts, setAttempts] = useState(0);

  // Breathing State
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const [isBreathingComplete, setIsBreathingComplete] = useState(false);

  // Bypass countdown
  const [bypassCountdown, setBypassCountdown] = useState(5);
  const [isBypassing, setIsBypassing] = useState(false);
  const bypassIntervalRef = useRef(null);

  useEffect(() => {
    // Check if app is already in a cooldown window
    if (sessionManager.isAppUnlocked(targetAppName)) {
      onUnlock();
      return;
    }

    // Record interception in daily analytics
    sessionManager.recordInterception(targetAppName);

    // Pull active goals
    setActiveTasks(taskStore.getActiveTasks());

    // Determine Friction Mode
    const mode = settingsStore.getRandomEnabledFriction();
    setActiveMode(mode);

    // Initialize Mode-specific State
    if (mode === 'math') {
      setPuzzle(puzzleEngine.generateMathPuzzle(targetAppName));
    } else if (mode === 'typing') {
      setTypingPhrase(TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)]);
    } else if (mode === 'breathing') {
      // 10s sequence: Inhale (4s) -> Hold (2s) -> Exhale (4s)
      Animated.sequence([
        Animated.timing(breatheAnim, {
          toValue: 2,
          duration: 4000,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.timing(breatheAnim, {
          toValue: 1,
          duration: 4000,
          useNativeDriver: true,
        })
      ]).start(() => {
        setIsBreathingComplete(true);
      });
    }
  }, [targetAppName, onUnlock, breatheAnim]);

  const handleVerify = () => {
    let isCorrect = false;

    if (activeMode === 'math' && puzzle) {
      isCorrect = puzzleEngine.verifyAnswer(userInput, puzzle);
    } else if (activeMode === 'typing') {
      isCorrect = userInput.trim() === typingPhrase;
    } else if (activeMode === 'breathing') {
      isCorrect = isBreathingComplete;
    }

    if (isCorrect) {
      setErrorMsg('');
      sessionManager.grantAccess(targetAppName, 10);
      onUnlock();
    } else {
      setAttempts((prev) => prev + 1);
      setErrorMsg(
        attempts >= 2
          ? 'Still incorrect. Maybe take a break instead? 🌿'
          : 'Incorrect. Try again or step away!'
      );
      if (activeMode === 'math') setUserInput('');
      Vibration.vibrate(100);
    }
  };

  const handleBypassPressIn = () => {
    setIsBypassing(true);
    setBypassCountdown(5);
    let count = 5;
    bypassIntervalRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(bypassIntervalRef.current);
        bypassIntervalRef.current = null;
        sessionManager.recordBypass();
        sessionManager.grantAccess(targetAppName, 10);
        onUnlock();
      } else {
        setBypassCountdown(count);
      }
    }, 1000);
  };

  const handleBypassPressOut = () => {
    if (bypassIntervalRef.current) {
      clearInterval(bypassIntervalRef.current);
      bypassIntervalRef.current = null;
    }
    setIsBypassing(false);
    setBypassCountdown(5);
  };

  const handleViewGoals = () => {
    sessionManager.recordSavedTime(15); // Add 15 mins of saved time
    onGoToGoals();
  };

  if (!activeMode) return null;

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.overlayContainer}>
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <View style={styles.warningPill}>
            <Text style={styles.warningText}>PAUSE & REFLECT</Text>
          </View>
          <Text style={styles.appTitle}>
            {targetAppName || 'Unknown App'}
          </Text>
          <Text style={styles.appSubtitle}>is trying to steal your focus</Text>

          {/* ── Value Alignment ────────────────────────────────────────────── */}
          <View style={styles.valueCard}>
            <View style={styles.valueCardHeader}>
              <Text style={styles.valueSectionLabel}>INSTEAD, YOU WANTED TO</Text>
              <TouchableOpacity style={styles.viewGoalsBtn} onPress={handleViewGoals}>
                <Text style={styles.viewGoalsText}>View Goals →</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.tasksScrollView} showsVerticalScrollIndicator={true}>
              {activeTasks.length > 0 ? (
                activeTasks.map((task) => (
                  <View key={task.id} style={styles.valueItem}>
                    <Text style={styles.valueBullet}>→</Text>
                    <Text style={styles.valueText}>{task.title}</Text>
                  </View>
                ))
              ) : (
                <View style={styles.valueItem}>
                  <Text style={styles.valueBullet}>✨</Text>
                  <Text style={styles.valueText}>No active tasks remaining today!</Text>
                </View>
              )}
            </ScrollView>
          </View>

          {/* ── Intervention Card ──────────────────────────────────────────── */}
          <View style={styles.interventionCard}>
            
            {activeMode === 'math' && puzzle && (
              <>
                <Text style={styles.interventionLabel}>SOLVE TO UNLOCK</Text>
                <Text style={styles.interventionPrompt}>{puzzle.question}</Text>
                <TextInput
                  style={[styles.inputField, errorMsg ? styles.inputFieldError : null]}
                  keyboardType="numeric"
                  placeholder="Your answer"
                  placeholderTextColor={colors.outline}
                  value={userInput}
                  onChangeText={setUserInput}
                  onSubmitEditing={handleVerify}
                  returnKeyType="done"
                  autoFocus
                />
              </>
            )}

            {activeMode === 'typing' && (
              <>
                <Text style={styles.interventionLabel}>TYPE EXACTLY TO UNLOCK</Text>
                <Text style={styles.typingPrompt}>"{typingPhrase}"</Text>
                <TextInput
                  style={[styles.inputField, errorMsg ? styles.inputFieldError : null]}
                  placeholder="Type the phrase above..."
                  placeholderTextColor={colors.outline}
                  value={userInput}
                  onChangeText={setUserInput}
                  onSubmitEditing={handleVerify}
                  returnKeyType="done"
                  autoFocus
                  multiline
                />
              </>
            )}

            {activeMode === 'breathing' && (
              <View style={styles.breathingContainer}>
                <Text style={styles.interventionLabel}>TAKE A BREATH</Text>
                <Text style={styles.interventionPrompt}>Inhale... Hold... Exhale</Text>
                <View style={styles.breathingBox}>
                  <Animated.View style={[styles.breathingCircle, { transform: [{ scale: breatheAnim }] }]} />
                </View>
              </View>
            )}

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

            {/* Submit / Unlock Button */}
            {activeMode !== 'breathing' ? (
              <TouchableOpacity
                style={[styles.submitBtn, userInput.trim() === '' && styles.submitBtnDisabled]}
                onPress={handleVerify}
                disabled={userInput.trim() === ''}
                activeOpacity={0.8}
              >
                <Text style={styles.submitBtnText}>Submit & Access</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitBtn, !isBreathingComplete && styles.submitBtnDisabled]}
                onPress={handleVerify}
                disabled={!isBreathingComplete}
                activeOpacity={0.8}
              >
                <Text style={styles.submitBtnText}>
                  {isBreathingComplete ? 'Unlock App' : 'Breathe...'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Bypass Button */}
            {(activeMode !== 'breathing' || isBreathingComplete) && (
              <TouchableOpacity
                style={styles.bypassBtn}
                onPressIn={handleBypassPressIn}
                onPressOut={handleBypassPressOut}
                activeOpacity={0.7}
              >
                <Text style={styles.bypassBtnText}>
                  {isBypassing ? `Hold to Bypass · ${bypassCountdown}s` : 'Hold to Bypass · 5s'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  overlayContainer: {
    padding: spacing.xxl,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Header
  warningPill: {
    backgroundColor: colors.errorContainer,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: shapes.full,
    marginBottom: spacing.lg,
  },
  warningText: {
    ...typography.labelMedium,
    color: colors.onErrorContainer,
    letterSpacing: 1.5,
  },
  appTitle: {
    ...typography.displayMedium,
    color: colors.onSurface,
    textAlign: 'center',
  },
  appSubtitle: {
    ...typography.bodyLarge,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xxl,
    textAlign: 'center',
  },

  // Value Alignment
  valueCard: {
    backgroundColor: colors.surfaceContainerHigh,
    width: '100%',
    padding: spacing.xl,
    borderRadius: shapes.extraLarge,
    marginBottom: spacing.xl,
  },
  valueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  valueSectionLabel: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
  },
  viewGoalsBtn: {
    backgroundColor: colors.primaryContainer,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: shapes.full,
  },
  viewGoalsText: {
    ...typography.labelSmall,
    color: colors.onPrimaryContainer,
  },
  tasksScrollView: {
    maxHeight: 160,
  },
  valueItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  valueBullet: {
    ...typography.bodyLarge,
    color: colors.primary,
    marginTop: 1,
  },
  valueText: {
    ...typography.bodyLarge,
    color: colors.onSurface,
    flex: 1,
  },

  // Interventions
  interventionCard: {
    backgroundColor: colors.surfaceContainer,
    width: '100%',
    padding: spacing.xl,
    borderRadius: shapes.extraLarge,
    alignItems: 'center',
  },
  interventionLabel: {
    ...typography.labelSmall,
    color: colors.onSurfaceVariant,
    letterSpacing: 1,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  interventionPrompt: {
    ...typography.headlineLarge,
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  typingPrompt: {
    ...typography.bodyLarge,
    color: colors.onSurface,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  inputField: {
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.onSurface,
    width: '100%',
    padding: spacing.lg,
    borderRadius: shapes.large,
    ...typography.titleLarge,
    textAlign: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  inputFieldError: {
    borderColor: colors.error,
  },
  
  // Breathing
  breathingContainer: {
    alignItems: 'center',
    width: '100%',
  },
  breathingBox: {
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  breathingCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryContainer,
  },

  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    width: '100%',
    paddingVertical: spacing.lg,
    borderRadius: shapes.full,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.3,
  },
  submitBtnText: {
    ...typography.labelLarge,
    color: '#FFFFFF',
  },
  bypassBtn: {
    backgroundColor: '#3B1C1C',
    borderWidth: 1,
    borderColor: '#5C2B2B',
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: shapes.full,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  bypassBtnText: {
    ...typography.labelMedium,
    color: '#D4A0A0',
  },
});
