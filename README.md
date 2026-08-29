# FocusFriction

An Android notes app that also puts a **deliberate speed bump** between you and your
distracting apps. Open YouTube while pausing is on and you don't get YouTube — you get
your own notes, and a small cognitive cost that grows the more times you've caved today.

> ### 🤖 About this project
>
> **I did not hand-write this code — AI tools did, and I directed them.**
>
> This is a pet project I use to learn how far current AI coding tools can actually go.
> My contribution was the idea, the product decisions, the architecture calls, and the
> review loop: deciding what to build, spotting where the AI got it wrong, and pushing
> back until the result was something I'd actually keep installed. The typing was the
> model's; the judgement was mine.

---

## Two halves, each standing alone

**A notes app.** Titles, bodies, checklists, ten colours, pinning, labels, archive and
search — a Google Keep-shaped app you'd keep on your phone on a day you never open a
monitored app once. Notes are the home surface; nothing gates them behind setup.

**A pause.** Friction that scales with your own behaviour: 1–3 opens today gets an easy
challenge, 4–5 medium, 6+ hard. Always passable, never free.

**What joins them:** the pause screen shows *your note headings*. Not a generic "are you
sure" — the things you actually wrote down. One tap opens that note instead of the feed.

## How interception works

The decision, the UI and the outcome logging are all **native**, because no JavaScript is
running at the moment you open YouTube.

```
Monitored app opened
        │
        ▼
FocusAccessibilityService          TYPE_WINDOW_STATE_CHANGED, debounced per package
        │
        ▼
FocusPolicyRepository.shouldIntercept(packageId)
        ├── is pausing enabled?
        ├── is this package monitored?
        ├── inside the schedule window?
        └── already unlocked?
        │
        ▼  (yes)
FocusOverlayController → TYPE_ACCESSIBILITY_OVERLAY window
        │
        ├── note headings, read from a projection in SharedPreferences
        └── challenge from FrictionEngine, difficulty from today's open count
        │
        ▼
Continue → solve grant   ·   Skip → shorter grant   ·   Open notes → no grant
```

### Why `TYPE_ACCESSIBILITY_OVERLAY`

Most blockers use `SYSTEM_ALERT_WINDOW` with a foreground service, or launch a full-screen
Activity. This uses the window type an AccessibilityService can add directly, which is
better on three counts:

- **No `SYSTEM_ALERT_WINDOW` permission.** One less thing to grant.
- **Apps can't hide it.** Android 12's `setHideOverlayWindows()` suppresses ordinary app
  overlays. Accessibility overlays are exempt.
- **No activity launch, no React Native cold start.** It's a window add — it appears
  before you've read a single post.

The earlier version launched an Activity that launched the whole RN app and polled for
state. It lost that race routinely, which is why pausing appeared not to work at all.

### Data flow across the seam

JS owns the notes database; native owns the policy and the overlay. They meet twice:

- **JS → native:** every note write mirrors a compact `{id, title, color, pinned}`
  projection into SharedPreferences, so the overlay never touches SQLite.
- **native → JS:** the overlay appends intervention events to a native buffer, which the
  app drains and merges into its history on next foreground.

Math challenges use a **built-in keypad**, not the system IME — an `EditText` in an
accessibility overlay depends on the IME focusing a non-activity window, which varies by
OEM, and failing there would strand you on the pause screen.

## Structure

```
src/
├── core/
│   ├── notesStore.js       SQLite notes + native heading mirror
│   ├── appStore.js         monitored app selection
│   ├── settingsStore.js    preferences, pushes policy to native
│   ├── sessionManager.js   event log, drains native buffer
│   ├── nativeBridge.js     safe wrappers over the native modules
│   └── appStorage.js       AsyncStorage wrapper
├── screens/                Notes, NoteEditor, Focus, Settings
├── components/Icon.js      single icon vocabulary
└── theme/                  M3 tokens + provider (light/dark/dynamic)

android/app/src/main/java/com/focusfriction/
├── FocusAccessibilityService.kt   detector + overlay host
├── FocusOverlayController.kt      the pause window
├── FocusPolicyRepository.kt       policy, counts, events, note projection
├── FrictionEngine.kt              native challenge generation
├── FocusBridgeModule.kt           ┐
├── InstalledAppsModule.kt         ├─ RN bridge
├── FocusFrictionPackage.kt        ┘
├── MainActivity.kt
└── MainApplication.kt
```

Design notes worth keeping:

- **Daily metrics are derived, never stored.** An append-only event log, counted on read.
- **Difficulty counts *attempts*, not completions.** Opening and backing out five times
  still means you caved five times.
- **Deleting a note is undoable**, and emptying one deletes it — matching Keep.

## Run it

Needs a real Android device; accessibility services don't do anything meaningful on an
emulator.

```bash
npm install
npx expo run:android
```

Then: **Settings → Accessibility → FocusFriction**, pick apps on the Focus tab, and flip
pausing on. That's the only permission required.

- **Expo** SDK 57 · **React Native** 0.86 · **React** 19 · Kotlin native modules
- Friction types: `math`, `typing`, `breathing`
- Light / dark / system themes, with Material You dynamic colour on Android 12+

## Status

Android-only by design; the interception model has no iOS equivalent.

## License

Personal project, no license granted. Read it, learn from it, ask before reusing.
