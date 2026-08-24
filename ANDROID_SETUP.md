# FocusFriction — Android Native Architecture & Setup Guide

This document outlines the Android native architecture for **FocusFriction** (Expo SDK 57, React Native 0.76+), explaining how native app interception, accessibility service detection, policy management, and the React Native bridge work together.

---

## 1. Architecture Overview

FocusFriction is an Android-first productivity app that pauses selected distracting applications when opened, prompting the user with a deliberate cognitive intervention.

```
Target App Opened (e.g., YouTube)
       │
       ▼
FocusAccessibilityService (AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
       │
       ▼
FocusPolicyRepository.shouldIntercept(packageId)
 ├── isProtectionEnabled()
 ├── monitoredPackages.contains(packageId)
 ├── isWithinSchedule()
 └── !isPackageUnlocked(packageId)
       │
       ▼ (shouldIntercept = true)
FocusPolicyRepository.setActiveSession(packageId, sessionId)
       │
       ▼
startActivity(InterventionActivity, extras={packageId, appLabel, sessionId})
       │
       ▼
InterventionActivity -> Launches MainActivity -> Renders <InterventionScreen />
       │
 User Solves / Bypasses / Selects Goals
       │
       ▼
NativeModules.InterventionModule.completeIntervention(sessionId, outcome, packageId)
       │
       ▼
InterventionActivity.onComplete(outcome)
 ├── FocusPolicyRepository.recordUnlock(packageId, grantMinutes)  ← Written FIRST natively
 └── launchTargetApp() / finish()
```

### Key Components

1. **`FocusPolicyRepository.kt`** (Native Policy Authority)
   - Singleton stored in Android `SharedPreferences`.
   - Single authority for `shouldIntercept(packageId)`, `isPackageUnlocked(packageId)`, `isWithinSchedule()`, and active session tracking.
   - Allows synchronous access from the `AccessibilityService` without JS thread dependency.

2. **`FocusAccessibilityService.kt`** (Foreground App Detector)
   - Binds to `android.accessibilityservice.AccessibilityService`.
   - Listens for `TYPE_WINDOW_STATE_CHANGED` events.
   - Debounces rapid duplicate events (1000ms window).
   - Launches `InterventionActivity` natively via explicit internal intents (no public deep-link protocol).

3. **`InterventionActivity.kt`** (Lifecycle Owner)
   - Non-exported Activity (`android:exported="false"`).
   - Holds the session lifecycle state.
   - When JS completes the intervention (`completeIntervention`), it writes the native unlock window **before** launching the target app via `PackageManager.getLaunchIntentForPackage()`.

4. **`InterventionModule.kt`** (React Native Bridge)
   - Exposes `completeIntervention(sessionId, outcome, packageId)` and `getActiveIntervention()` to JavaScript.

5. **`InstalledAppsModule.kt`** (Native Utilities)
   - Exposes `getInstalledApps()`, `getAppIcon(packageId)` (lazy base64 loading), `isAccessibilityServiceEnabled()`, `openAccessibilitySettings()`, and `updatePolicy(params)`.

---

## 2. Android Manifest Configuration

Path: `android/app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE"/>
  <uses-permission android:name="android.permission.VIBRATE"/>

  <queries>
    <intent>
      <action android:name="android.intent.action.VIEW"/>
      <category android:name="android.intent.category.BROWSABLE"/>
      <data android:scheme="https"/>
    </intent>
    <intent>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent>
  </queries>

  <application ...>
    <!-- Main App Activity -->
    <activity android:name=".MainActivity" ... android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>

    <!-- Accessibility Service -->
    <service android:name=".FocusAccessibilityService"
             android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
             android:exported="true">
      <intent-filter>
        <action android:name="android.accessibilityservice.AccessibilityService"/>
      </intent-filter>
      <meta-data android:name="android.accessibilityservice"
                 android:resource="@xml/accessibility_service_config"/>
    </service>

    <!-- Non-exported Intervention Lifecycle Activity -->
    <activity 
      android:name=".InterventionActivity" 
      android:exported="false"
      android:theme="@style/Theme.App.SplashScreen"
      android:launchMode="singleTop"
      android:screenOrientation="portrait"/>
  </application>
</manifest>
```

---

## 3. Building & Testing

### 3.1 Debug Build

```bash
# Build and launch on connected Android device / emulator
npx expo run:android
```

### 3.2 Release APK Build

```bash
# Build release APK using Gradle
cd android
./gradlew assembleRelease
```

The APK will be generated at:
`android/app/build/outputs/apk/release/app-release.apk`

---

## 4. Enabling Accessibility Service on Device

To test app interception:

1. Open **FocusFriction** on your device.
2. Complete the **Protection Setup** checklist:
   - Tap **"Open Accessibility Settings"**.
   - Select **FocusFriction** under Installed Services / Accessibility.
   - Toggle the switch **ON** and confirm permissions.
3. Turn **Protection ON** in Setup or Settings.
4. Open the **Apps tab** and select at least one app to monitor (e.g., YouTube).
5. Exit FocusFriction and open YouTube → The Mindful Pause screen will trigger.
