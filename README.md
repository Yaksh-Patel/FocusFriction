# FocusFriction

An Android app that puts a **deliberate speed bump** between you and your distracting apps.
Open YouTube while protection is on and you don't get YouTube — you get a puzzle, and the
puzzle gets harder the more times you've caved today.

> ### 🤖 About this project
>
> **I did not hand-write this code — AI tools did, and I directed them.**
>
> This is a pet project I use to learn how far current AI coding tools can actually go.
> My contribution was the idea, the product decisions, the architecture calls, and the
> review loop: deciding what to build, spotting where the AI got it wrong, and pushing
> back until the result was something I'd actually keep installed. The typing was the
> model's; the judgement was mine.
>
> I keep these projects public because the interesting artifact isn't the app — it's
> what the process reveals about where AI-assisted development genuinely works and
> where it still needs a human holding the wheel.

---

## The idea

App blockers fail because blocking is binary — you either can't open the app, or you
disable the blocker and open it freely. Neither teaches you anything.

FocusFriction adds *friction* instead of a wall. You can always get through. But getting
through costs a few seconds of actual cognitive effort, which is usually enough to notice
that you didn't mean to open the app at all. And the cost **scales with your own
behaviour**: 1–3 opens today gets you an easy puzzle, 4–5 a medium one, 6+ a hard one.

Solve it and you get 10 minutes. Bypass it and you get 3. Both are configurable.

## How interception works

The interesting part is that the decision is made **natively**, not in JavaScript:

```
Target app opened (e.g. YouTube)
        │
        ▼
FocusAccessibilityService          TYPE_WINDOW_STATE_CHANGED
        │
        ▼
FocusPolicyRepository.shouldIntercept(packageId)
        ├── is protection enabled?
        ├── is this package monitored?
        ├── are we inside the active schedule window?
        └── is this package already unlocked?
        │
        ▼  (yes)
InterventionActivity  →  React Native intervention screen  →  puzzle
        │
        ▼
Solve → 10 min grant   ·   Bypass → 3 min grant
```

`FocusPolicyRepository` is a native singleton backed by `SharedPreferences`, which matters:
the accessibility service needs a **synchronous** answer the instant a window changes.
Routing that through the RN bridge would have been too slow and too fragile, so the policy
store is the single source of truth on the native side and JS mirrors it, not the reverse.

A hardcoded `EXCLUDED_PACKAGES` set means the launcher, system UI, Settings, the Play Store,
the package installer, and FocusFriction itself can never be intercepted — otherwise a bad
policy could lock you out of your own phone.

## Structure

```
src/
├── core/
│   ├── appStore.js          installed-app list + monitored selection
│   ├── settingsStore.js     protection toggle, schedule, grant durations
│   ├── taskStore.js         local task/goal list (uuid + secure storage)
│   ├── sessionManager.js    append-only intervention event log
│   ├── puzzleEngine.js      difficulty scaling + puzzle generation
│   ├── appStorage.js        AsyncStorage wrapper
│   └── secureStore.js       expo-secure-store wrapper
├── screens/                 InterventionScreen, SetupScreen
├── components/              Home, AppSelector, Settings, InterceptOverlay
└── theme.js

android/app/src/main/java/com/focusfriction/
├── FocusAccessibilityService.kt   window-change listener
├── FocusPolicyRepository.kt       native policy store (source of truth)
├── InterventionActivity.kt        full-screen intervention host
├── InterventionModule.kt          ┐
├── InstalledAppsModule.kt         ├─ RN bridge modules
├── FocusFrictionPackage.kt        ┘
├── MainActivity.kt
└── MainApplication.kt
```

Two design notes that took iteration to get right:

- **Daily metrics are derived, never stored.** `sessionManager` keeps an append-only event
  log (30-day window) and computes counts from it. The first version kept mutable counters
  and they drifted out of sync with reality within a day.
- **`puzzleEngine` evaluates arithmetic without `eval`/`Function`.** A tiny thing, but it
  came out of review rather than out of the model.

## Run it

Requires a real Android device — accessibility services and app interception don't work
meaningfully on an emulator.

```bash
git clone git@github.com:Yaksh-Patel/FocusFriction.git
cd FocusFriction
npm install
npx expo run:android
```

Then, on first launch:

1. Grant **Accessibility** access (Settings → Accessibility → FocusFriction)
2. Grant **Usage Access** and **Display over other apps**
3. Pick the apps to monitor, then flip protection on

See [ANDROID_SETUP.md](ANDROID_SETUP.md) for the full native architecture walkthrough.

- **Expo** SDK 57 · **React Native** 0.86 · **React** 19 · Kotlin native modules
- Friction types wired: `math`, `typing`, `breathing`
- Default schedule window: 09:00–17:00 (off by default)

The `android/` native sources are tracked, but `android/app/build/`, `node_modules/`, and
the debug keystore are not — a fresh clone generates its own.

## Status

Working on-device. Android-only by design; the interception model has no iOS equivalent.

## License

Personal project, no license granted. Read it, learn from it, ask before reusing.
