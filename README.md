# FocusFriction

An Android notes app that also puts a **deliberate speed bump** between you and the
apps you keep opening without meaning to. Open YouTube while pausing is on and you
don't get YouTube — you get your own notes and a small cognitive cost, and that cost
grows the more times you've caved today.

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

FocusFriction adds *friction* instead of a wall. You can always get through. But
getting through costs a few seconds of actual effort, which is usually enough to
notice you didn't mean to open the app at all. And the cost **scales with your own
behaviour**: 1–3 opens today gets you an easy challenge, 4–5 a medium one, 6+ a hard
one.

The other half matters just as much. The pause screen shows **your own note
headings** — not a generic "are you sure", but the four things you actually wrote
down that you meant to be doing. One tap opens that note instead of the feed.

That only works if the notes are worth having on their own, so notes are the app's
home surface and pausing is a mode it offers. Everything works with protection off.

## How interception works

```
Monitored app opened
        │
        ▼
FocusAccessibilityService            TYPE_WINDOW_STATE_CHANGED
        │
        ▼
FocusPolicyRepository.shouldIntercept(packageId)
        ├── is pausing enabled?
        ├── is this package monitored?
        ├── are we inside the active schedule window?
        └── does this package already have an unlock?
        │
        ▼  (yes)
PauseActivity — native, no React Native
        │
        ├── Continue  → solve grant, launch the app
        ├── Skip      → shorter grant, launch the app
        ├── Open note → no grant, opens FocusFriction
        └── Back      → no grant, home
```

Three things about this are load-bearing:

**No JavaScript is alive at interception time.** The accessibility service needs a
synchronous answer the instant a window changes, so the policy store, the challenge
generation, the difficulty scaling and the outcome log are all native. JS mirrors
note headings *into* `FocusPolicyRepository` and drains intervention events *out* of
it the next time the app is foregrounded. An earlier design chained into the React
Native app and polled for state; it lost that race routinely and pausing simply
didn't happen.

**The pause is a normal Activity, not an overlay.** It was briefly a
`TYPE_ACCESSIBILITY_OVERLAY` window, which needs no permissions and can't be
suppressed by the app underneath — but that window type also sits above the status
bar, the navigation bar and the keyguard. The notification shade wouldn't open, the
nav buttons did nothing, and unlocking the phone came back to it. A plain Activity is
an ordinary window and behaves.

**The pause screen never uses the keyboard.** Getting the IME to focus reliably was a
losing battle across OEMs. Math has its own keypad; the typing challenge is
tap-the-words-in-order from a shuffled bank.

A hardcoded `EXCLUDED_PACKAGES` set means the launcher, system UI, Settings, the
dialer, the Play Store, the package installer and FocusFriction itself can never be
intercepted — otherwise a bad policy could lock you out of your own phone.

## Structure

```
src/
├── core/
│   ├── notesStore.js       SQLite-backed notes; mirrors headings to native
│   ├── appStore.js         installed-app list + monitored selection
│   ├── settingsStore.js    pausing toggle, schedule, grant durations
│   ├── sessionManager.js   event log, merged from the native buffer
│   ├── nativeBridge.js     safe wrappers over the native modules
│   └── appStorage.js       AsyncStorage wrapper
├── screens/                NotesScreen, NoteEditor, FocusScreen, SettingsScreen
├── components/Icon.js      one semantic icon vocabulary
└── theme/                  M3 tokens + provider (light/dark/dynamic colour)

android/app/src/main/java/com/focusfriction/
├── FocusAccessibilityService.kt   window-change listener
├── FocusPolicyRepository.kt       native policy store (source of truth)
├── PauseActivity.kt               the friction screen
├── FrictionEngine.kt              challenge generation + difficulty
├── FocusBridgeModule.kt           ┐
├── InstalledAppsModule.kt         ├─ RN bridge modules
├── FocusFrictionPackage.kt        ┘
├── MainActivity.kt
└── MainApplication.kt
```

Notes on the data model:

- **Notes are SQLite, not a JSON blob.** The predecessor rewrote its entire store to
  AsyncStorage on every save. Fine for five to-do items, wrong for notes you edit
  continuously. The editor autosaves rather than relying on a close callback firing.
- **Daily metrics are derived, never stored.** An append-only event log with a 30-day
  window; counts are computed from it. An earlier version kept mutable counters and
  they drifted out of sync within a day.
- **Headings are mirrored, not queried.** The pause screen reads a compact
  `{id, title, color, pinned}` projection from SharedPreferences. It never touches
  the notes database, which belongs to a JS runtime that isn't running.

## Run it

Requires a real Android device — accessibility services and app interception don't
work meaningfully on an emulator.

```bash
git clone git@github.com:Yaksh-Patel/FocusFriction.git
cd FocusFriction
npm install
npx expo run:android
```

Then, on first launch:

1. Open the **Focus** tab
2. Grant **Accessibility** access (it's the only permission the app needs)
3. Pick the apps to pause, then turn pausing on

- **Expo** SDK 57 · **React Native** 0.86 · **React** 19 · Kotlin native modules
- Friction types: `math`, `typing`, `breathing`
- Schedule window optional, off by default

### Release builds

`android/app/build.gradle` reads signing credentials from
`android/keystore.properties`, which is **not** in the repo. Without it, release
builds fall back to the debug key so a fresh clone still compiles — that APK is fine
for your own device and must not be distributed.

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

The ABI flag matters: all four architectures produce a 78 MB APK, arm64 alone about
31 MB.

The `android/` native sources are tracked, but `android/app/build/`, `node_modules/`,
keystores and APKs are not.

## Status

Working on-device. Android-only by design; the interception model has no iOS
equivalent.

[docs/REBUILD_PLAN.html](docs/REBUILD_PLAN.html) is the code review and plan behind
the current rewrite, kept for the record.

## License

Personal project, no license granted. Read it, learn from it, ask before reusing.
