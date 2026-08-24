import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Vibration, KeyboardAvoidingView, Platform, Animated } from 'react-native';
import { NativeModules } from 'react-native';
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

export default function InterventionScreen({ interventionData, onComplete }) {
  const [activeMode, setActiveMode] = useState(null);
  const [puzzle, setPuzzle] = useState(null);
  const [typingPhrase, setTypingPhrase] = useState('');
  const [userInput, setUserInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTasks, setActiveTasks] = useState([]);
  const [attempts, setAttempts] = useState(0);

  const breatheAnim = useRef(new Animated.Value(1)).current;
  const [isBreathingComplete, setIsBreathingComplete] = useState(false);
  const [breathingStage, setBreathingStage] = useState('Breathe in...');

  const packageId = interventionData?.packageId;
  const targetAppName = interventionData?.appLabel || 'Unknown App';
  const sessionId = interventionData?.sessionId;

  const settings = settingsStore.getSettings() || {};
  const solveGrantMinutes = settings.solveGrantMinutes || 5;
  const bypassGrantMinutes = settings.bypassGrantMinutes || 5;

  useEffect(() => {
    setActiveTasks(taskStore.getActiveTasks ? taskStore.getActiveTasks().slice(0, 3) : taskStore.getTasks().filter(t => !t.completed).slice(0, 3));

    const mode = typeof settingsStore.getRandomEnabledFriction === 'function' ? settingsStore.getRandomEnabledFriction() : 'math';
    setActiveMode(mode);

    if (mode === 'math') {
      const dailyOpens = 1;
      setPuzzle(puzzleEngine.generateMathPuzzle(dailyOpens));
    } else if (mode === 'typing') {
      setTypingPhrase(TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)]);
    } else if (mode === 'breathing') {
      setBreathingStage('Breathe in...');
      Animated.sequence([
        Animated.timing(breatheAnim, { toValue: 2, duration: 4000, useNativeDriver: true }),
        Animated.timing(breatheAnim, { toValue: 2, duration: 2000, useNativeDriver: true }), // Hold
        Animated.timing(breatheAnim, { toValue: 1, duration: 4000, useNativeDriver: true })
      ]).start(() => {
        setIsBreathingComplete(true);
        setBreathingStage('Done');
      });

      // Update text label to match animation
      setTimeout(() => setBreathingStage('Hold...'), 4000);
      setTimeout(() => setBreathingStage('Breathe out...'), 6000);
    }
  }, [breatheAnim]);

  const handleSolve = () => {
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
      if (NativeModules.InterventionModule?.completeIntervention) {
        NativeModules.InterventionModule.completeIntervention(sessionId, 'solved', packageId);
      }
      if (sessionManager.recordSolve) {
        sessionManager.recordSolve(solveGrantMinutes);
      } else if (sessionManager.grantAccess) {
        sessionManager.grantAccess(packageId, solveGrantMinutes);
      }
      if (onComplete) onComplete();
    } else {
      setAttempts((prev) => prev + 1);
      setErrorMsg(attempts >= 2 ? 'Still incorrect. Maybe take a break instead? 🌿' : 'Incorrect. Try again or step away!');
      if (activeMode === 'math') setUserInput('');
      Vibration.vibrate(100);
    }
  };

  const handleGoals = () => {
    if (NativeModules.InterventionModule?.completeIntervention) {
      NativeModules.InterventionModule.completeIntervention(sessionId, 'goals', packageId);
    }
    if (sessionManager.recordGoals) {
      sessionManager.recordGoals(15);
    } else if (sessionManager.recordSavedTime) {
      sessionManager.recordSavedTime(15);
    }
    if (onComplete) onComplete();
  };

  const handleBypass = () => {
    if (NativeModules.InterventionModule?.completeIntervention) {
      NativeModules.InterventionModule.completeIntervention(sessionId, 'bypassed', packageId);
    }
    if (sessionManager.recordBypass) {
      sessionManager.recordBypass(bypassGrantMinutes);
    }
    if (onComplete) onComplete();
  };

  if (!activeMode) return null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.overlayContainer}>
        {/* Header */}
        <View style={styles.warningPill}>
          <Text style={styles.warningText}>MINDFUL PAUSE</Text>
        </View>
        <Text style={styles.appTitle}>Pause before opening{'\n'}{targetAppName}</Text>
        <Text style={styles.appSubtitle}>You set this moment aside for what matters. Choose deliberately.</Text>

        {/* Value Alignment */}
        <View style={styles.valueCard}>
          <View style={styles.valueCardHeader}>
            <Text style={styles.valueSectionLabel}>INSTEAD, YOU WANTED TO</Text>
          </View>
          <View style={styles.tasksContainer}>
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
          </View>
        </View>

        {/* Intervention Card */}
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
                onSubmitEditing={handleSolve}
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
                onSubmitEditing={handleSolve}
                returnKeyType="done"
                autoFocus
                multiline
              />
            </>
          )}

          {activeMode === 'breathing' && (
            <View 
              style={styles.breathingContainer}
              accessible={true}
              accessibilityLabel="Breathing exercise in progress. Follow the breathing prompt."
              accessibilityHint="Takes 10 seconds to complete"
            >
              <Text style={styles.interventionLabel}>TAKE A BREATH</Text>
              <Text style={styles.interventionPrompt}>Inhale... Hold... Exhale</Text>
              <View style={styles.breathingBox}>
                <Animated.View style={[styles.breathingCircle, { transform: [{ scale: breatheAnim }] }]} />
              </View>
              <Text style={styles.breathingStageLabel} accessibilityLiveRegion="polite">{breathingStage}</Text>
            </View>
          )}

          {errorMsg ? <Text style={styles.errorText} accessibilityLiveRegion="assertive">{errorMsg}</Text> : null}

          {/* Buttons */}
          <TouchableOpacity
            style={[styles.submitBtn, (activeMode !== 'breathing' ? userInput.trim() === '' : !isBreathingComplete) && styles.submitBtnDisabled]}
            onPress={handleSolve}
            disabled={activeMode !== 'breathing' ? userInput.trim() === '' : !isBreathingComplete}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Complete and open ${targetAppName}`}
            accessibilityState={{ disabled: activeMode !== 'breathing' ? userInput.trim() === '' : !isBreathingComplete }}
          >
            <Text style={styles.submitBtnText}>
              {activeMode !== 'breathing' || isBreathingComplete ? `Complete & Open (${solveGrantMinutes} min)` : 'Breathe...'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryBtn} 
            onPress={handleGoals} 
            accessibilityRole="button"
            accessibilityLabel="Return to goals"
          >
            <Text style={styles.secondaryBtnText}>Return to goals</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.tertiaryBtn} 
            onPress={handleBypass} 
            accessibilityRole="button"
            accessibilityLabel={`Bypass and access ${targetAppName} now`}
          >
            <Text style={styles.tertiaryBtnText}>Need access now ({bypassGrantMinutes} min)</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  overlayContainer: { flex: 1, padding: spacing.xxl, justifyContent: 'center', alignItems: 'center' },
  warningPill: { backgroundColor: colors.errorContainer, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: shapes.full, marginBottom: spacing.lg },
  warningText: { ...typography.labelMedium, color: colors.onErrorContainer, letterSpacing: 1.5 },
  appTitle: { ...typography.displayMedium, color: colors.onSurface, textAlign: 'center' },
  appSubtitle: { ...typography.bodyLarge, color: colors.onSurfaceVariant, marginBottom: spacing.xxl, textAlign: 'center' },
  valueCard: { backgroundColor: colors.surfaceContainerHigh, width: '100%', padding: spacing.xl, borderRadius: shapes.extraLarge, marginBottom: spacing.xl },
  valueCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  valueSectionLabel: { ...typography.labelSmall, color: colors.onSurfaceVariant, letterSpacing: 1 },
  tasksContainer: { maxHeight: 160 },
  valueItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginVertical: spacing.xs },
  valueBullet: { ...typography.bodyLarge, color: colors.primary, marginTop: 1 },
  valueText: { ...typography.bodyLarge, color: colors.onSurface, flex: 1 },
  interventionCard: { backgroundColor: colors.surfaceContainer, width: '100%', padding: spacing.xl, borderRadius: shapes.extraLarge, alignItems: 'center' },
  interventionLabel: { ...typography.labelSmall, color: colors.onSurfaceVariant, letterSpacing: 1, marginBottom: spacing.md, textAlign: 'center' },
  interventionPrompt: { ...typography.headlineLarge, color: colors.primary, textAlign: 'center', marginBottom: spacing.xl },
  typingPrompt: { ...typography.bodyLarge, color: colors.onSurface, textAlign: 'center', fontStyle: 'italic', marginBottom: spacing.xl, paddingHorizontal: spacing.md },
  inputField: { backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface, width: '100%', padding: spacing.lg, borderRadius: shapes.large, ...typography.titleLarge, textAlign: 'center', marginBottom: spacing.md, borderWidth: 1, borderColor: colors.outlineVariant },
  inputFieldError: { borderColor: colors.error },
  breathingContainer: { alignItems: 'center', width: '100%' },
  breathingBox: { height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md },
  breathingCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primaryContainer },
  breathingStageLabel: { ...typography.bodyMedium, color: colors.onSurface, marginBottom: spacing.xl },
  errorText: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  submitBtn: { backgroundColor: colors.primary, width: '100%', paddingVertical: spacing.lg, borderRadius: shapes.full, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.3 },
  submitBtnText: { ...typography.labelLarge, color: '#FFFFFF' },
  secondaryBtn: { backgroundColor: colors.surfaceContainerHighest, width: '100%', paddingVertical: spacing.md, borderRadius: shapes.full, alignItems: 'center', marginTop: spacing.md },
  secondaryBtnText: { ...typography.labelLarge, color: colors.onSurface },
  tertiaryBtn: { marginTop: spacing.lg },
  tertiaryBtnText: { ...typography.labelMedium, color: colors.outline, textDecorationLine: 'underline' }
});
