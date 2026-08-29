// src/theme/tokens.js

/**
 * Material 3 design tokens.
 *
 * Two complete palettes — never one palette with inverted values, which is how
 * dark themes end up with unreadable mid-tones. Dynamic colour from the user's
 * wallpaper overrides the accent roles when Android 12+ provides it.
 */

// ─── Type scale ───────────────────────────────────────────────────────────

export const typography = {
  displayLarge:   { fontSize: 40, fontWeight: '700', lineHeight: 48, letterSpacing: -0.6 },
  displayMedium:  { fontSize: 32, fontWeight: '700', lineHeight: 40, letterSpacing: -0.4 },
  displaySmall:   { fontSize: 26, fontWeight: '700', lineHeight: 34, letterSpacing: -0.2 },
  headlineLarge:  { fontSize: 24, fontWeight: '700', lineHeight: 32, letterSpacing: -0.15 },
  headlineMedium: { fontSize: 21, fontWeight: '600', lineHeight: 28 },
  headlineSmall:  { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  titleLarge:     { fontSize: 17, fontWeight: '600', lineHeight: 25 },
  titleMedium:    { fontSize: 15, fontWeight: '600', lineHeight: 22, letterSpacing: 0.1 },
  titleSmall:     { fontSize: 13, fontWeight: '600', lineHeight: 19, letterSpacing: 0.1 },
  bodyLarge:      { fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0.15 },
  bodyMedium:     { fontSize: 14, fontWeight: '400', lineHeight: 20, letterSpacing: 0.2 },
  bodySmall:      { fontSize: 12, fontWeight: '400', lineHeight: 17, letterSpacing: 0.3 },
  labelLarge:     { fontSize: 14, fontWeight: '600', lineHeight: 20, letterSpacing: 0.1 },
  labelMedium:    { fontSize: 12, fontWeight: '600', lineHeight: 16, letterSpacing: 0.4 },
  labelSmall:     { fontSize: 11, fontWeight: '600', lineHeight: 15, letterSpacing: 0.5 },
};

export const shapes = {
  none: 0, extraSmall: 4, small: 8, medium: 12,
  large: 16, extraLarge: 24, full: 999,
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32,
};

export const elevation = {
  level0: { elevation: 0 },
  level1: { elevation: 1, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  level2: { elevation: 3, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  level3: { elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
};

// ─── Base palettes ────────────────────────────────────────────────────────

export const lightColors = {
  background: '#FBF9FD',
  surface: '#FBF9FD',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F5F3F7',
  surfaceContainer: '#EFEDF1',
  surfaceContainerHigh: '#E9E7EC',
  surfaceContainerHighest: '#E3E1E6',

  primary: '#4A5C92',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DBE1FF',
  onPrimaryContainer: '#00174B',

  secondary: '#585E71',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#DDE1F9',
  onSecondaryContainer: '#151B2C',

  tertiary: '#74546E',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD7F5',
  onTertiaryContainer: '#2B1229',

  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',

  success: '#3F6C46',
  successContainer: '#C1F0C5',
  onSuccessContainer: '#00210C',

  onSurface: '#1A1B21',
  onSurfaceVariant: '#45464F',
  outline: '#767680',
  outlineVariant: '#C6C6D0',

  inverseSurface: '#2F3036',
  inverseOnSurface: '#F2F0F4',
  scrim: 'rgba(0,0,0,0.4)',
};

export const darkColors = {
  background: '#121317',
  surface: '#121317',
  surfaceContainerLowest: '#0D0E12',
  surfaceContainerLow: '#1A1B21',
  surfaceContainer: '#1E1F25',
  surfaceContainerHigh: '#282A30',
  surfaceContainerHighest: '#33353B',

  primary: '#B3C5FF',
  onPrimary: '#1B2E60',
  primaryContainer: '#324478',
  onPrimaryContainer: '#DBE1FF',

  secondary: '#C1C5DD',
  onSecondary: '#2A3042',
  secondaryContainer: '#404659',
  onSecondaryContainer: '#DDE1F9',

  tertiary: '#E2BBD9',
  onTertiary: '#42273F',
  tertiaryContainer: '#5A3D56',
  onTertiaryContainer: '#FFD7F5',

  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  success: '#A5D3AA',
  successContainer: '#26512F',
  onSuccessContainer: '#C1F0C5',

  onSurface: '#E4E1E7',
  onSurfaceVariant: '#C6C6D0',
  outline: '#90909A',
  outlineVariant: '#45464F',

  inverseSurface: '#E4E1E7',
  inverseOnSurface: '#2F3036',
  scrim: 'rgba(0,0,0,0.6)',
};

// ─── Note tints ───────────────────────────────────────────────────────────

/**
 * Keep-style note colours. Each is a surface tint plus a matching border, tuned
 * separately per theme so a note reads as the "same" colour in both.
 */
export const noteTints = {
  light: {
    default: { bg: '#FFFFFF', border: '#DCDCE4' },
    coral:   { bg: '#FFE9E5', border: '#F6C9C1' },
    peach:   { bg: '#FFEEDC', border: '#F4D3AF' },
    sand:    { bg: '#FBF3D2', border: '#E8DCA4' },
    mint:    { bg: '#DFF5E4', border: '#B4DEBE' },
    sage:    { bg: '#E2F0E6', border: '#B8D6C2' },
    mist:    { bg: '#DCF2F3', border: '#AFD8DA' },
    sky:     { bg: '#DFEAFC', border: '#B6CDF0' },
    lilac:   { bg: '#E9E3FA', border: '#C7BCEC' },
    blush:   { bg: '#FBE2F0', border: '#EDBBD9' },
  },
  dark: {
    default: { bg: '#1E1F25', border: '#34353C' },
    coral:   { bg: '#3B2624', border: '#5A3B37' },
    peach:   { bg: '#3A2C1D', border: '#584330' },
    sand:    { bg: '#35311C', border: '#524B2E' },
    mint:    { bg: '#1D3325', border: '#2F4E3A' },
    sage:    { bg: '#22322A', border: '#374C3F' },
    mist:    { bg: '#1B3133', border: '#2C4B4E' },
    sky:     { bg: '#1F2B3D', border: '#33425C' },
    lilac:   { bg: '#292440', border: '#403A5D' },
    blush:   { bg: '#372431', border: '#553C4C' },
  },
};

/**
 * Map Android's wallpaper-derived palette onto the M3 accent roles.
 * Returns null when the device didn't supply one (below Android 12).
 */
export function applyDynamicColors(base, dynamic, isDark) {
  if (!dynamic) return base;
  try {
    return {
      ...base,
      primary:             isDark ? dynamic.accent1_200 : dynamic.accent1_600,
      onPrimary:           isDark ? dynamic.accent1_700 : '#FFFFFF',
      primaryContainer:    isDark ? dynamic.accent1_700 : dynamic.accent1_100,
      onPrimaryContainer:  isDark ? dynamic.accent1_100 : dynamic.accent1_700,
      secondary:           isDark ? dynamic.accent2_100 : dynamic.accent2_500,
      secondaryContainer:  isDark ? dynamic.neutral2_700 : dynamic.accent2_100,
      tertiary:            isDark ? dynamic.accent3_100 : dynamic.accent3_500,
      tertiaryContainer:   isDark ? dynamic.accent3_500 : dynamic.accent3_100,
    };
  } catch (e) {
    return base;
  }
}
