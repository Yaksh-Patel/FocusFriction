// src/theme.js

/**
 * Material Expressive (Material You) Design Tokens for FocusFriction.
 *
 * Dark theme palette inspired by Android 14/15 system UI with
 * pastel accent tones and generous rounded shapes.
 */

const Theme = {
  // ─── Colors ───────────────────────────────────────────────────────────

  colors: {
    // Surfaces
    background: '#111318',
    surface: '#111318',
    surfaceContainer: '#1D2024',
    surfaceContainerLow: '#191C20',
    surfaceContainerHigh: '#282C31',
    surfaceContainerHighest: '#33373D',
    surfaceBright: '#393C41',

    // Primary
    primary: '#A8C7FA',
    onPrimary: '#0B3D91',
    primaryContainer: '#1B4F9E',
    onPrimaryContainer: '#D3E3FD',

    // Secondary
    secondary: '#D0BCFF',
    onSecondary: '#381E72',
    secondaryContainer: '#4F378B',
    onSecondaryContainer: '#EADDFF',

    // Tertiary
    tertiary: '#7FCFCF',
    onTertiary: '#003737',
    tertiaryContainer: '#1A4E4E',
    onTertiaryContainer: '#A6F2F2',

    // Error
    error: '#F2B8B5',
    onError: '#601410',
    errorContainer: '#8C1D18',
    onErrorContainer: '#F9DEDC',

    // Success (custom)
    success: '#A8DAB5',
    successContainer: '#1A3A24',
    onSuccessContainer: '#C8F5D2',

    // Text / On-surface
    onSurface: '#E3E2E6',
    onSurfaceVariant: '#C4C6CF',
    outline: '#8E9099',
    outlineVariant: '#44474E',

    // Inverse
    inverseSurface: '#E3E2E6',
    inverseOnSurface: '#303033',
    inversePrimary: '#415F91',
  },

  // ─── Typography ───────────────────────────────────────────────────────

  typography: {
    displayLarge: { fontSize: 36, fontWeight: '700', lineHeight: 44, letterSpacing: -0.5 },
    displayMedium: { fontSize: 28, fontWeight: '700', lineHeight: 36, letterSpacing: -0.3 },
    headlineLarge: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
    headlineMedium: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
    titleLarge: { fontSize: 18, fontWeight: '600', lineHeight: 26 },
    titleMedium: { fontSize: 16, fontWeight: '600', lineHeight: 24, letterSpacing: 0.15 },
    titleSmall: { fontSize: 14, fontWeight: '600', lineHeight: 20, letterSpacing: 0.1 },
    bodyLarge: { fontSize: 16, fontWeight: '400', lineHeight: 24, letterSpacing: 0.15 },
    bodyMedium: { fontSize: 14, fontWeight: '400', lineHeight: 20, letterSpacing: 0.25 },
    bodySmall: { fontSize: 12, fontWeight: '400', lineHeight: 16, letterSpacing: 0.4 },
    labelLarge: { fontSize: 14, fontWeight: '600', lineHeight: 20, letterSpacing: 0.1 },
    labelMedium: { fontSize: 12, fontWeight: '600', lineHeight: 16, letterSpacing: 0.5 },
    labelSmall: { fontSize: 11, fontWeight: '600', lineHeight: 16, letterSpacing: 0.5 },
  },

  // ─── Shapes ───────────────────────────────────────────────────────────

  shapes: {
    none: 0,
    extraSmall: 4,
    small: 8,
    medium: 12,
    large: 16,
    extraLarge: 24,
    full: 28,
  },

  // ─── Spacing ──────────────────────────────────────────────────────────

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },
};

export default Theme;
