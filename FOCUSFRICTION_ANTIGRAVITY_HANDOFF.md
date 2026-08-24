# FocusFriction — Complete Product, Functional, and Technical Remediation Brief

## Purpose of this document

This document is a detailed implementation brief for Antigravity. It is based on a source-code audit of the current FocusFriction project, including its Expo SDK 57 configuration, React Native application, Android native module, Android accessibility service, and data flows.

**Do not treat this as a request for cosmetic changes only.** The current application bundle compiles, but the principal promise of the product—intercepting selected Android apps and putting meaningful friction in front of them—cannot work reliably with the current architecture. Start by rebuilding the interception flow and its native/JavaScript contract. Preserve the good product intent (goals, deliberate pause, optional unlock, local-first data) while replacing the fragile implementation.

---

## 1. Product intent and target scope

FocusFriction is an Android-first gamified productivity and digital-wellbeing application. The product should help a person interrupt automatic opens of selected distracting apps, reflect on goals, complete a short chosen friction exercise, and then either return to their goals or deliberately access the app for a limited time.

### Recommended scope for the next stable release

- Platform: **Android native development build only**. Do not claim that the app-interception feature works in Expo Go, on iOS, or on the web.
- Primary user journey: select apps → complete permissions/onboarding → set goals and intervention policy → attempt to open monitored app → see intervention immediately → choose goals or unlock for a finite, correctly enforced time.
- Local-first: tasks, policies, activity records, and backup data should remain on-device unless a future sync feature is explicitly designed.
- Accessibility: use it only with a narrowly defined, clearly disclosed product purpose. Review current Google Play accessibility policy before any store submission; do not assume this use is automatically acceptable.
- Do not present estimates as measured facts. “Minutes saved” must either be calculated from an explicit, transparent rule and labelled as an estimate, or be removed until a defensible measurement method exists.

---

## 2. What exists today: full walkthrough

### Startup and state hydration

`App.js` starts four singleton stores after a storage wrapper is initialized:

1. `taskStore`: the user’s goals.
2. `sessionManager`: daily counters and per-app 10-minute unlock expirations.
3. `appStore`: monitored application selections.
4. `settingsStore`: enabled friction types and optional time schedule.

The app shows a loading screen until this completes, then displays a three-tab custom navigation bar.

### Home tab: goals and daily summary

The Home tab lets the user:

- Add a goal.
- Mark a goal done.
- Edit a goal by tapping it.
- Reorder goals by long pressing and dragging.
- Delete a goal after a confirmation prompt.

It also presents “Mins Saved,” “Solved,” and “Bypassed.” At present, “Solved” and “Bypassed” map to events, but “Mins Saved” increases by a fixed 15 minutes whenever the user presses “View Goals” in an interception. It does not measure time and should not be described as reclaimed time.

### Apps tab: monitored-app selection

On Android, `InstalledAppsModule` queries launcher apps, converts every icon into base64 PNG text, and returns the resulting array to JavaScript. The app list is stored in AsyncStorage and toggles are copied into native `SharedPreferences` under `monitored_packages`.

The screen currently:

- Displays a search field.
- Shows enabled apps under “Monitored” and the rest under “Available.”
- Lets every row toggle monitoring.
- Checks whether draw-over-other-apps permission is granted and shows a banner if not.

It does **not** check accessibility-service status, does not teach the user how to enable it, does not verify that monitored-app state reached native code, and does not surface whether interception is currently operational.

### Settings tab

The user can select one or more intervention types:

- Math puzzle.
- Type a deliberate phrase exactly.
- Ten-second breathing exercise.

The user can also turn on a simple start/end focus schedule and export/import data. The schedule accepts free-form text and is persisted on every keystroke.

### Intended interception flow

The Android accessibility service receives a window-state event. If the foreground package is in native `SharedPreferences`, it opens the FocusFriction activity via a `focusfriction://intercept/<package>` deep link. The JavaScript app receives the deep link and renders `InterceptOverlay`.

The overlay shows the **package identifier** rather than the friendly app name, shows active goals, randomly chooses a friction mode, and offers a five-second hold-to-bypass option. Solving or bypassing calls `sessionManager.grantAccess(package, 10)`. The parent then calls `BackHandler.exitApp()` in the hope that Android returns to the original app.

---

## 3. Audit results at a glance

### Verification completed

- The Android JavaScript bundle exports successfully with the installed Expo SDK 57 dependency set.
- Dependencies are aligned with the declared Expo SDK 57 / React Native 0.86 / React 19.2 configuration.
- The present failure is therefore architectural and runtime-behavioral, not a JavaScript syntax or Metro-bundling failure.

### Severity scale

- **P0** — makes the core promise fail, loses data, or creates a major safety/privacy/release risk.
- **P1** — a likely user-visible failure or a serious correctness issue.
- **P2** — quality, usability, performance, or maintainability issue.

---

## 4. P0: core functional failures that must be fixed first

### P0-1 — Overlay permission is requested, but no overlay exists

**Current behavior:** `InstalledAppsModule` can check and request `SYSTEM_ALERT_WINDOW`. The Apps screen tells the user this permission is needed to show the pause screen “over apps.” However, no code creates a `WindowManager` overlay or an Android `TYPE_APPLICATION_OVERLAY` window. The accessibility service simply starts the normal FocusFriction activity.

**Why this breaks the product:** The app is not actually displayed over the target application. Android switches the user into FocusFriction instead. The permission call gives a false impression that enabling it activates the core feature.

**Required change:** Choose one and only one intentional, fully implemented intervention presentation model:

1. **Recommended for a first stable version: a dedicated full-screen native InterventionActivity.** The accessibility service opens this activity with a validated package ID. The activity hosts the intervention UI, then explicitly either returns to Home or launches the target package after a native access decision. Do not label it an overlay.
2. **Alternative: a real native application overlay.** Implement it using `WindowManager` and `TYPE_APPLICATION_OVERLAY`, including lifecycle, permission, screen-lock behavior, accessibility, and failure handling. Use this only if the product and policy review require true in-place overlay behavior.

Do not retain an unused overlay permission. The UI, manifest, and onboarding must match the selected implementation.

### P0-2 — Access windows are not enforced at the native decision point

**Current behavior:** The accessibility service intercepts every monitored package immediately based only on native `monitored_packages`. The ten-minute unlock registry exists only in JavaScript/AsyncStorage. The service cannot see it.

If a user solves a puzzle, JavaScript records an unlock and exits FocusFriction. When the target app resumes, the service sees it again and starts FocusFriction again. The JavaScript handler may then notice the unlock, show a snackbar, and return without reopening the target application. This is exactly the type of loop/stuck behavior users would experience as “not working.”

**Required change:** Establish **one native policy authority** for all time-critical interception decisions. At minimum, native code must synchronously know:

- whether FocusFriction is enabled;
- which package IDs are monitored;
- whether the current local time is inside the focus schedule;
- whether that package has a currently valid access window;
- the active intervention/session ID, if one is already being shown;
- a cooldown/debounce policy that suppresses duplicate foreground events.

Store this policy in native `SharedPreferences` or a native local database. Update it atomically from the app whenever the user changes selections, schedule, or access status. JavaScript may mirror it for UI, but native code must not rely on React Native being alive to make the decision.

On a successful unlock or bypass, native code must first write the access expiry, then explicitly launch the target app’s launcher intent. The accessibility service must see the expiry and allow the target package without launching another intervention. On expiry, the next monitored foreground event should create a fresh intervention.

### P0-3 — Schedule enforcement is too late and is unreliable

**Current behavior:** schedule data is only read in `App.js`, after the accessibility service has already forced the user into FocusFriction. If outside the schedule, JavaScript displays a short snackbar but does not return the user to the app they chose.

**Required change:** put schedule validation in the same native policy decision described above. Validate time ranges when the user saves them. Define and test these semantics:

- Schedule disabled: monitor all day.
- Same-day range: e.g. 09:00–17:00, inclusive start and exclusive end.
- Overnight range: e.g. 22:00–07:00.
- Start equals end: explicitly decide whether that means all day or zero duration; recommend treating it as invalid and asking the user to choose a valid range.
- Device timezone changes: evaluate against device local time and refresh policy after timezone/time changes.

Outside the window, the service must simply allow the target app to remain foreground; it must not launch FocusFriction and then attempt to dismiss itself.

### P0-4 — There is no complete permission/onboarding path

**Current behavior:** only draw-over-other-apps is surfaced. Accessibility-service status is neither checked nor requested. The manifest declares usage-stats permission but code does not use it. The native service may never be enabled, in which case selections appear to work but nothing happens.

**Required change:** build a first-run “Protection setup” screen and a persistent status card. It must list the exact prerequisites for the chosen presentation model:

- Accessibility service enabled (mandatory for the current detection approach).
- Notification/overlay/other special access only if it is genuinely implemented and mandatory.
- At least one monitored app selected.
- A valid schedule, if schedule mode is enabled.

Each row needs a live status, why it is needed, a button that opens the appropriate Android Settings page, and a re-check when the app returns to foreground. Add native methods for `isAccessibilityServiceEnabled`, `openAccessibilitySettings`, and any required permission states. Do not promise an automatic grant: Android requires the user to enable special access themselves.

### P0-5 — Critical deep-link race during startup

**Current behavior:** the deep-link listener is registered independently of hydration. An accessibility event can arrive while the app’s stores are still using defaults. That can result in an interception decision against stale/empty settings, and there is no pending-intent queue once hydration finishes.

**Required change:** make incoming interception requests durable and ordered. Either let the dedicated native activity own the interaction, or queue the package/session request until the JavaScript/native policy has hydrated. Do not render a user-facing intervention until a consistent policy snapshot is available. Duplicate events for the same package/session must coalesce.

### P0-6 — Current “return to app” behavior is not deterministic

**Current behavior:** `BackHandler.exitApp()` does not guarantee that Android returns to the exact target app. It can return to the launcher, another activity, or an inaccessible back-stack state. It also executes without awaiting persistence of the access decision.

**Required change:** never use process exit as navigation logic. Native code must explicitly retrieve and start the target package’s launch intent after persisting the access window. If the target is no longer installed or launchable, handle that gracefully and return to FocusFriction Home with an actionable message.

---

## 5. P1: correctness, security, and data failures

### P1-1 — Native list visibility and package selection need a real Android strategy

`InstalledAppsModule` queries launcher activities, but the manifest only declares a browser HTTPS query. Android package visibility restrictions can cause incomplete app results on newer Android versions. The list may be empty or partial depending on the device.

Required implementation:

- Declare only the narrow `MAIN` + `LAUNCHER` query required for the picker, if that meets the product need.
- Do not use broad package visibility unless it is essential and policy-approved.
- Show a clear empty/error state when no apps can be queried.
- Exclude FocusFriction itself, system settings, the launcher, installer, and other essential system components from monitoring by default. Enforce this in native code too—not only in UI.
- Keep stable package ID, label, and icon metadata. Reconcile app installs/uninstalls without silently discarding existing monitored policy.

### P1-2 — The product displays package IDs to users

The accessibility service sends `com.instagram.android`, and `InterceptOverlay` renders this value as the app title. That is technical and confusing.

Required change:

- The native request should include both package ID (stable policy key) and a safe friendly label (display only).
- Resolve the label only from trusted PackageManager data.
- If resolution fails, display “This app” rather than an unknown technical identifier.

### P1-3 — Access and bypass persistence are not awaited or transaction-safe

`grantAccess` is asynchronous but is called without `await` before the app exits. A process/activity change can race the storage write. The current bypass callback also calls `recordBypass`, `grantAccess`, and `onUnlock` independently.

Required change:

- Centralize completion into one idempotent native operation: `completeIntervention(sessionId, outcome)`.
- Outcomes should include `SOLVED`, `BYPASSED`, and `CHOOSE_GOALS`.
- Write access expiry and event record as one logical transaction before target launch.
- Ignore repeat completion events for a closed session.
- Make a failed write visible and do not falsely claim an unlock happened.

### P1-4 — Bypass is functionally the same as solve

Both solve and bypass grant ten minutes of access. That may be a deliberate compassionate design, but it should be a user policy—not an accidental hard-code. It also means nothing prevents repeated bypasses.

Required change:

- Add a configurable post-solve access duration and bypass policy.
- Suggested defaults: successful intervention = 10 minutes; bypass = 2–5 minutes, or require a reason, or allow it but record it clearly.
- Provide an emergency/essential-access option that is visible, deliberate, and not hidden behind a press-and-hold timer.
- Never frame friction as punishment; it should be a mindful interruption with user control.

### P1-5 — Statistics are misleading and inconsistent

Issues:

- `timeSaved` adds a fixed 15 minutes when “View Goals” is tapped; it is not observed usage reduction.
- “Daily opens” counts interceptions, not actual opens, and may inflate from repeated accessibility events.
- `PuzzleEngine.unlockHistory` and `COOLOFF_WINDOW_MS` are unused; its comments do not match behavior.
- The “Solved” counter can increase even if native launch policy failed.

Required change:

- Introduce an append-only `intervention_events` model with event ID, timestamp, package ID, presentation type, outcome, duration granted, and optional reason.
- Derive daily metrics from events; never maintain competing mutable counters as the only source of truth.
- Rename metrics honestly: “Interventions completed,” “Bypasses,” “Time intentionally deferred (estimate)” if using a rule, and “Protected attempts.”
- Deduplicate one foreground attempt into one event/session.
- Provide a privacy explanation and a “clear all local data” action.

### P1-6 — Backup/export uses the wrong monitored-app key and omits native state

The export code includes `@focusfriction/app_enabled_states`, but `appStore` writes `@focusfriction/monitored_apps`. The backup therefore omits the actual JavaScript monitored-app selection. It also does not export native `SharedPreferences`, which is what the accessibility service actually consults.

Required change:

- Replace ad hoc raw-key backup with a versioned `FocusFrictionBackup` schema.
- Include tasks, settings, monitored package IDs, native policy, active unlock expiries (if intentionally portable), and event history.
- Validate every field, schema version, type, and allowed package ID before import.
- Import transactionally: validate fully first, write all data second, then refresh JavaScript and native policy in memory.
- Do not write arbitrary keys from an imported JSON object into storage.
- Explain that imports replace or merge data, and give the user a deliberate choice.

### P1-7 — “SecureStore” is not secure storage

`src/core/secureStore.js` is a wrapper around AsyncStorage. That is appropriate for non-sensitive local preferences, but its name and comments imply stronger protection.

Required change:

- Rename it to `localStorage`/`appStorage`, or actually use platform secure storage only for secrets that require it.
- Do not put large app lists, images, analytics history, or backup data in SecureStore.
- Document the local-data model accurately.

### P1-8 — Schedule input accepts invalid and partially typed values

The settings screen persists `"0"`, `"09:"`, or any other intermediate text on every keystroke. `isWithinActiveWindow()` then splits and converts invalid values to `NaN`, producing an unreliable comparison.

Required change:

- Use a native Android time picker or a strictly masked/validated time control.
- Keep draft input separate from saved policy.
- Show validation inline and enable Save only for valid `HH:mm` values.
- Canonicalize to zero-padded 24-hour format.

### P1-9 — Accessibility event handling is too broad and too weakly debounced

The service reacts to every `TYPE_WINDOW_STATE_CHANGED` event and only avoids same-package repetitions within two seconds. App transitions can emit several events; a user can also open another monitored app while the first intervention is active.

Required change:

- Introduce a native session state machine (see section 7).
- Deduplicate by `packageId + foreground transition + active session`, not merely a two-second global timestamp.
- Ignore known self/system package transitions and never intercept device-critical flows.
- Persist enough state to recover safely after service or process restart.

### P1-10 — External apps can invoke the exported deep link

The activity is exported to handle `focusfriction://` links. Any app can request an interception route with an arbitrary package string. The current JavaScript code trusts it.

Required change:

- Do not use a public deep link as the internal service protocol.
- Prefer an explicit intent directed to a non-exported internal activity, carrying a validated package extra.
- If a deep link remains for legitimate external use, keep it separate from the interception route, validate all arguments, and reject package IDs that are not currently monitored.

---

## 6. P2: UX, performance, maintainability, and release improvements

### Intervention experience

- Replace “is trying to steal your focus” with neutral, user-respecting language such as “You chose to pause before opening [App].” The user—not the app—is in control.
- Show the actual selected app name and icon.
- Do not expose the bypass button only after breathing completes unless that is an explicit policy. Explain the chosen policy.
- Add an explicit “Return to goals” outcome which closes the intervention, shows the Home screen, and records a truthful event.
- Add an accessibility-friendly text alternative for the breathing animation; animation alone should not convey completion.
- Normalize typing-answer comparison only if the instruction says so. If exact matching is intended, make case, punctuation, and whitespace expectations clear. Consider accepting normalized whitespace to prevent unnecessary frustration.
- Limit displayed active goals to a useful small number (for example top three) and provide “See all goals” instead of nested scroll views inside a scrollable intervention.

### App selector performance and usability

- Do not serialise every installed icon to base64 and store it in AsyncStorage. This is memory-heavy, slow, and may exceed practical storage limits on devices with many apps.
- Return only package ID and label for the initial list; load/cache icons lazily at native size, or use a purpose-built native image bridge.
- Use `FlatList`/`FlashList`, not `ScrollView`, for installed apps.
- Do not make system app filtering the sole filtering rule; some distracting apps may be preinstalled and some non-system entries should remain excluded.
- Add selected-app count, select/deselect all within a filtered set only if it remains comprehensible, and a visible explanation of what monitoring means.
- Refresh permission/service status whenever the Apps tab regains focus.

### Navigation and layout

- Replace manual emoji navigation icons with accessible vector icons and labels. Emoji appearance varies by device and screen reader output is inconsistent.
- Use safe-area insets correctly on Android. Current fixed paddings and absolute input/tab areas can overlap gesture navigation, keyboard, or smaller screens.
- Consider Expo Router or React Navigation if navigation becomes more than three simple tabs. A dedicated InterventionActivity still remains native-owned.
- Ensure all controls have accessibility labels, minimum touch targets, visible focus, scalable text support, and adequate colour contrast.

### State and code structure

- Replace mutable singleton stores with a typed domain layer (TypeScript recommended), a single source of truth, and explicit async action states.
- Add runtime schema validation for persisted data and migrations for storage/backup versions.
- Remove dead/incorrect concepts, such as `unlockHistory` and `COOLOFF_WINDOW_MS`, unless they are implemented as a deliberate escalating-difficulty policy.
- Persist only canonical models; derive UI grouping/search/status from them.
- Add error reporting/logging appropriate for development builds, without collecting sensitive app-usage data remotely by default.

### Native project hygiene

- Treat the Android folder as a first-class native project. The existing `ANDROID_SETUP.md` is stale: it describes an earlier project state, says the Android folder does not exist, lists old toolchain assumptions, and suggests manual code that does not match current implementation.
- Update the setup documentation after architecture is settled.
- Put durable native manifest/package changes into an Expo config plugin if continuing to use Expo prebuild/Continuous Native Generation. Otherwise document that the Android folder is intentionally maintained manually and do not casually rerun prebuild over custom native files.
- Confirm exact Expo SDK 57-compatible APIs and package versions before changing code. Follow the project instruction to use versioned Expo 57 documentation, not generic/latest Expo examples.
- Remove declared permissions that are not required by the final implementation, especially usage stats and overlay access if they are unused.
- Verify release signing: the present Gradle configuration signs release with the debug keystore. This must be replaced with a secure release signing workflow before distribution.

---

## 7. Required target architecture

### 7.1 Design principle

The accessibility service is the time-critical event source. React Native is an excellent place for settings and rich UI, but it must not be the sole decision maker for an event that happens while another app is foregrounded or while the app process is cold.

### 7.2 Native policy repository

Create a native `FocusPolicyRepository` with an atomic, versioned `FocusPolicy` model. Suggested fields:

```text
schemaVersion
isProtectionEnabled
monitoredPackageIds: Set<String>
schedule: { enabled, startMinute, endMinute }
unlockExpiriesByPackage: Map<String, epochMillis>
interventionDefaults: { solveGrantMinutes, bypassGrantMinutes, modePolicy }
lastUpdatedAt
```

Rules:

- Prune expired access windows while reading.
- Never store friendly labels as policy identity; package ID is the identity.
- Update selections, schedule, and grants atomically.
- Expose a snapshot to JavaScript for display only.
- Validate incoming policy and use safe defaults after corrupt data.

### 7.3 Native interception state machine

Implement a native coordinator/service with explicit states:

```text
IDLE
  -> FOREGROUND_MONITORED(package)
  -> ALLOWED_UNTIL_EXPIRY(package)         // no intervention
  -> OUTSIDE_SCHEDULE(package)             // no intervention
  -> INTERVENTION_ACTIVE(sessionId, package)
  -> COMPLETED(sessionId, outcome)
  -> launch target or FocusFriction Home
  -> IDLE
```

Required behavior:

1. Receive a foreground event.
2. Discard event if it is FocusFriction, a protected system package, non-monitored, a duplicate, outside schedule, or currently allowed.
3. Create one opaque session ID for a new monitored attempt.
4. Show exactly one intervention presentation for that session.
5. When the user chooses an outcome, atomically record it. For solve/bypass, update native expiry before launching the target. For goals, close intervention and open FocusFriction Home.
6. If the intervention is dismissed unexpectedly, return to a safe state. Do not silently leave an app blocked forever.
7. On service restart, discard stale active sessions and preserve only valid policy/unlock data.

### 7.4 UI boundary

For reliability, make the intervention a native-owned Android surface. There are two acceptable implementation approaches:

- **Native InterventionActivity with native Compose/View UI**: simplest lifecycle, clear launch/return behavior, works without a React bridge being warm. This is recommended.
- **Native Activity that hosts a dedicated React Native screen**: acceptable only if startup latency, cold-start handling, native policy methods, lifecycle recovery, and test coverage are robust. The native activity still owns the policy decision and target-app launch.

Do not use the app’s root deep-link listener as the core protocol. Do not use process exit to return to the target app.

### 7.5 JavaScript domain model

Use a single versioned local model, for example:

```text
Task { id, title, status, createdAt, completedAt, sortOrder }
MonitoredApp { packageId, label, selectedAt }
FocusSchedule { enabled, startMinute, endMinute }
InterventionEvent {
  id, sessionId, timestamp, packageId, mode,
  outcome: solved | bypassed | goals | dismissed | error,
  accessMinutesGranted
}
```

The JS UI should subscribe to canonical data and render it; it should not make background access-control decisions.

---

## 8. Detailed implementation sequence for Antigravity

### Phase 0 — Preserve and establish a baseline

1. Do not delete user data or blindly regenerate the native Android folder.
2. Create a dedicated branch/worktree.
3. Document the existing package name and Android build identity.
4. Run the current Android build on at least one physical device and capture reproducible evidence for: service disabled, service enabled, monitored app selection, unlock, bypass, schedule outside window, and cold start.
5. Add a short architecture decision record selecting either an InterventionActivity or a true overlay. This brief recommends InterventionActivity.

### Phase 1 — Fix policy and permissions before polishing UI

1. Build the native policy repository and migration from the current `monitored_packages` SharedPreferences state.
2. Implement service-enabled detection and settings navigation.
3. Replace the deep-link interception protocol with an explicit internal intent/session handoff.
4. Make the service decide monitored/schedule/unlocked status natively.
5. Build the native intervention presenter and deterministic target-app launch.
6. Remove overlay UI/permission if choosing an activity. If choosing a true overlay, implement it completely before exposing the permission.
7. Add native failure states for unavailable target package, service unavailable, missing permission, corrupt policy, and duplicate session.

### Phase 2 — Make settings and selection trustworthy

1. Create the setup/status screen.
2. Make app-picker queries Android-version-safe and list rendering efficient.
3. Validate schedule input and save only valid canonical values.
4. Sync every policy change to native storage; show a success/error state rather than assuming a fire-and-forget bridge call succeeded.
5. Separate product toggles: global protection enabled, monitored apps, schedule enabled, intervention types, solve duration, bypass duration.

### Phase 3 — Rebuild analytics and backup

1. Replace mutable counters with intervention event records plus derived daily summaries.
2. Rename or remove unsupported “minutes saved.”
3. Implement versioned export/import with full validation and an explicit refresh afterward—no restart required.
4. Add data-clear and data-retention controls.

### Phase 4 — UX and accessibility refinements

1. Improve intervention copy, labels, icons, empty states, and recovery paths.
2. Implement TalkBack labels, text scaling, keyboard/focus handling, and contrast checks.
3. Test small devices, large fonts, gesture navigation, rotation policy, keyboard interaction, and dark mode.
4. Update setup/readme documentation to match the final behavior exactly.

---

## 9. Acceptance criteria: the implementation is not done until these pass

### Core behavior on a physical Android device

- [ ] A new user immediately sees a truthful setup checklist.
- [ ] The product clearly distinguishes a disabled accessibility service from an enabled service.
- [ ] Selecting a valid launchable app and turning on protection syncs the package ID to native policy.
- [ ] Opening a monitored app while protection is active and the schedule permits it creates exactly one intervention.
- [ ] The intervention identifies the app by friendly label and icon, not package ID.
- [ ] An intervention works after a cold start of FocusFriction and when the React Native app is not already open.
- [ ] Completing a friction exercise writes the access decision before navigating away.
- [ ] The target app opens deliberately after success, and reopening/resuming it during the grant window does not create another intervention.
- [ ] Once the access window expires, a new target-app open produces one new intervention.
- [ ] A bypass follows the configured policy and is recorded truthfully.
- [ ] “Return to goals” returns to FocusFriction Home and does not falsely grant target-app access.
- [ ] Outside the schedule, monitored apps remain usable and FocusFriction does not steal foreground focus.
- [ ] Overnight schedules work correctly.
- [ ] An invalid schedule cannot be saved.
- [ ] Disabling global protection immediately prevents future interceptions.
- [ ] Removing an app from monitoring immediately prevents future interceptions.

### Data and recovery

- [ ] Tasks, policy, and valid access windows survive app restart.
- [ ] Corrupt or outdated stored data fails safely and is migrated or reset with a clear user message.
- [ ] Export contains the actual monitored package policy, not an unused key.
- [ ] Import validates schema/version, cannot write arbitrary storage keys, and refreshes the current UI/native policy without asking for a restart.
- [ ] Metrics are derived from real event records and labels do not overclaim what was measured.

### Security, privacy, and release

- [ ] No public interception deep link can create an arbitrary unvalidated intervention.
- [ ] Minimal Android permissions are declared and every requested special permission is implemented and explained.
- [ ] Accessibility use is documented with a clear disclosure and reviewed against the current distribution policy.
- [ ] Release builds use a non-debug signing configuration and are tested from the actual release artifact.
- [ ] The Android picker does not require unjustified broad app visibility.

### Automated tests

- [ ] Unit tests cover schedule boundaries, overnight ranges, expiry pruning, duplicate suppression, and policy migration.
- [ ] Unit tests cover event-to-metric derivation and backup schema validation.
- [ ] Native tests cover policy repository read/write and `isAccessibilityServiceEnabled` detection.
- [ ] Device/instrumented tests cover monitored → intervention → solve → target launch → allowed window.
- [ ] Manual QA covers service disable/re-enable, app uninstall, reboot, time change, timezone change, and device lock/unlock.

---

## 10. Specific current files and what to do with them

| Current area | Current role | Required direction |
| --- | --- | --- |
| `App.js` | hydrates stores, receives public deep links, controls a simulated overlay, exits app | remove it as interception authority; retain shell/navigation only; render truthful setup/status and Home UI |
| `src/core/sessionManager.js` | JS-only unlocks and mutable daily counters | replace with display-side reads from canonical event/policy data; native layer owns live access decisions |
| `src/core/appStore.js` | list and monitored toggle persistence | retain UI model only; synchronise validated package IDs atomically with native policy |
| `src/core/settingsStore.js` | friction options/schedule | validate canonical schedule; synchronise native decision data; add global protection and duration policies |
| `src/core/secureStore.js` | AsyncStorage under misleading name | rename/rework; add schema/migrations; do not imply encryption |
| `src/core/puzzleEngine.js` | simple math generation | retain only with clear difficulty policy; remove dead history fields; add deterministic tests |
| `src/components/InterceptOverlay.js` | JS overlay/friction UI | move into a dedicated native-owned intervention surface or make it a resilient activity screen with native contract |
| `src/components/AppSelectorScreen.js` | picker and overlay permission prompt | add setup/status, efficient virtualised list, service checks, correct permission language |
| `src/components/SettingsScreen.js` | settings and fragile raw backup | use validated controls; rebuild export/import using versioned schema |
| `android/.../FocusAccessibilityService.kt` | foreground-event detector that starts public deep link | turn into policy-aware state-machine entry point; create one validated intervention session; no public URL protocol |
| `android/.../InstalledAppsModule.kt` | app enumeration, policy copy, overlay setting | split into typed policy/service-status/app-picker modules; reduce base64 icon transfer; return operation results/errors |
| `android/app/src/main/AndroidManifest.xml` | permissions, exported activity/service | minimise permissions; use explicit internal route; revisit exported settings after final architecture |
| `ANDROID_SETUP.md` | historical setup guide | replace with accurate, current installation/build/testing instructions |

---

## 11. Non-negotiable constraints for the implementation

1. **No fake overlay permission flow.** If a permission is requested, the feature must actually use it; otherwise remove it.
2. **No JavaScript-only access decisions for a native foreground event.** Native policy decides whether the target is allowed before showing anything.
3. **No process exit as return navigation.** Explicitly launch the target app after persisting an allowed window.
4. **No raw unvalidated storage import.** Use a typed versioned backup schema.
5. **No misleading analytics.** Label estimates as estimates or remove them.
6. **No claim of iOS/web interception support.** Scope the current product clearly to Android.
7. **No broad, unjustified Android permissions.** Implement minimal access and review store policy before release.
8. **No manual native changes that can be silently erased.** Either use a maintained config plugin/CNG strategy or deliberately own and document the native Android project.
9. **Use Expo SDK 57 documentation and SDK-57-compatible APIs** for every Expo dependency/configuration change.
10. **Test on a physical Android device.** Accessibility/service behavior cannot be signed off from a bundle export or emulator-only test.

---

## 12. Suggested final product copy and behavior

### Setup card

> FocusFriction pauses selected apps so you can choose what to do next. To activate it, enable FocusFriction in Android Accessibility settings, then choose at least one app to pause. You can turn protection off any time.

### Intervention headline

> Pause before opening Instagram

### Intervention supporting copy

> You set this moment aside for what matters. Choose a short pause, then decide deliberately.

### Outcomes

- **Complete pause & open for 10 min** (or configured duration)
- **Return to my goals**
- **Need access now** (uses the transparent configured bypass policy)

### Analytics language

- “Interventions completed”
- “Deliberate access sessions”
- “Bypasses”
- Optional: “Estimated time deferred” with an explicit info tooltip that states its calculation

---

## Closing direction

FocusFriction has a promising, coherent user concept and a visually established starting point. The priority is not to add more mini-games or visual polish; it is to make the interception contract real, deterministic, respectful, and observable. Once the native service, policy state, session lifecycle, permission setup, and return-to-app behavior are reliable, the existing goals and friction interactions can become a credible digital-wellbeing product rather than a UI simulation.
