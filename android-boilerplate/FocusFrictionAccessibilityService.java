/*
 * FocusFrictionAccessibilityService.java
 * =======================================
 *
 * An Android Accessibility Service that detects when the user switches to a
 * new foreground app. It listens for TYPE_WINDOW_STATE_CHANGED events and
 * extracts the package name of the newly focused app.
 *
 * The detected package name is broadcast via LocalBroadcastManager so that
 * the React Native bridge module (FocusFrictionModule) can pick it up and
 * emit a JavaScript event to the React Native layer.
 *
 * SETUP:
 *   1. Copy this file to:
 *      android/app/src/main/java/com/focusfriction/FocusFrictionAccessibilityService.java
 *
 *   2. Copy accessibility_service_config.xml to:
 *      android/app/src/main/res/xml/accessibility_service_config.xml
 *
 *   3. Declare the service in AndroidManifest.xml (inside <application>):
 *      <service
 *          android:name=".FocusFrictionAccessibilityService"
 *          android:exported="false"
 *          android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
 *          <intent-filter>
 *              <action android:name="android.accessibilityservice.AccessibilityService" />
 *          </intent-filter>
 *          <meta-data
 *              android:name="android.accessibilityservice"
 *              android:resource="@xml/accessibility_service_config" />
 *      </service>
 *
 *   4. Add the description string to res/values/strings.xml:
 *      <string name="accessibility_service_description">
 *          FocusFriction monitors which app is in the foreground to help you
 *          manage screen time by introducing a brief pause before opening
 *          distracting apps.
 *      </string>
 *
 * IMPORTANT:
 *   - The user must manually enable this service in:
 *     Settings → Accessibility → Downloaded services → FocusFriction
 *   - This service cannot be enabled programmatically.
 *   - Google Play requires a clear disclosure of why accessibility access is
 *     needed. Only use it for the stated purpose (foreground app detection).
 *
 * @see <a href="https://developer.android.com/guide/topics/ui/accessibility/service">
 *      Android Accessibility Service Documentation</a>
 */

package com.focusfriction;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

/**
 * Accessibility service that monitors foreground app transitions.
 *
 * <p>When the user navigates to a new app, Android fires a
 * {@link AccessibilityEvent#TYPE_WINDOW_STATE_CHANGED} event. This service
 * intercepts that event, extracts the package name of the new foreground app,
 * and broadcasts it locally so the React Native bridge can forward it to the
 * JavaScript layer.</p>
 *
 * <h3>Data flow:</h3>
 * <pre>
 *   AccessibilityService
 *       ↓ (LocalBroadcast)
 *   FocusFrictionModule (React Native Native Module)
 *       ↓ (RCTDeviceEventEmitter)
 *   JavaScript (NativeEventEmitter listener)
 * </pre>
 */
public class FocusFrictionAccessibilityService extends AccessibilityService {

    /**
     * Tag used for all log messages from this service.
     * Filter in logcat with: adb logcat -s FocusFrictionA11y:D
     */
    private static final String TAG = "FocusFrictionA11y";

    /**
     * Intent action used for the LocalBroadcast.
     * The React Native bridge module (FocusFrictionModule) registers a
     * BroadcastReceiver for this action.
     */
    public static final String ACTION_FOREGROUND_APP_CHANGED =
            "com.focusfriction.FOREGROUND_APP_CHANGED";

    /**
     * Intent extra key for the detected package name.
     */
    public static final String EXTRA_PACKAGE_NAME = "package_name";

    /**
     * Tracks the last detected foreground package to avoid emitting duplicate
     * events when the system fires multiple TYPE_WINDOW_STATE_CHANGED events
     * for the same app (e.g., when an Activity within the same app changes).
     */
    private String lastForegroundPackage = "";

    // =========================================================================
    // Lifecycle Callbacks
    // =========================================================================

    /**
     * Called when the system successfully connects to this accessibility service.
     *
     * <p>This is the recommended place to configure the service dynamically
     * (as an alternative or supplement to the XML configuration). Here we
     * confirm the configuration and log that the service is active.</p>
     *
     * <p>You can also override the XML config here programmatically:</p>
     * <pre>
     *   AccessibilityServiceInfo info = new AccessibilityServiceInfo();
     *   info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
     *   info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
     *   info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
     *   info.notificationTimeout = 300;
     *   setServiceInfo(info);
     * </pre>
     */
    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.i(TAG, "Accessibility service connected and active.");

        // Optional: programmatically configure the service instead of (or in
        // addition to) the XML config. Uncomment the block below to override.
        /*
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
            info.notificationTimeout = 300;
            setServiceInfo(info);
            Log.d(TAG, "Service info configured programmatically.");
        }
        */
    }

    /**
     * Called when the system interrupts the feedback this service provides.
     *
     * <p>This can happen when the user navigates away from the accessibility
     * settings, or when a higher-priority service takes over. Use this to
     * clean up any ongoing feedback (audio, haptic, etc.).</p>
     *
     * <p>For FocusFriction, we don't provide continuous feedback, so this
     * is a no-op — but we log it for debugging purposes.</p>
     */
    @Override
    public void onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted.");
    }

    /**
     * Called when the service is being shut down (e.g., user disables it).
     * Clean up any resources here.
     */
    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.i(TAG, "Accessibility service destroyed.");
    }

    // =========================================================================
    // Event Handling
    // =========================================================================

    /**
     * Called when an accessibility event matching our configured criteria is
     * fired by the system.
     *
     * <p>We filter for {@link AccessibilityEvent#TYPE_WINDOW_STATE_CHANGED},
     * which is fired when a new window (typically a new Activity) comes to the
     * foreground. We extract the package name and broadcast it.</p>
     *
     * <p><b>Important considerations:</b></p>
     * <ul>
     *   <li>Some system UI elements (e.g., notification shade, dialogs) also
     *       trigger this event. The package name will be
     *       {@code "com.android.systemui"} or similar — you may want to filter
     *       these out in the React Native layer.</li>
     *   <li>On some OEM ROMs (MIUI, EMUI, ColorOS), additional events may be
     *       fired or certain events may be suppressed.</li>
     *   <li>The {@code notificationTimeout} in the XML config (300ms) provides
     *       a debounce to avoid excessive event processing.</li>
     * </ul>
     *
     * @param event The accessibility event dispatched by the system.
     */
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Guard: only process window-state-changed events
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }

        // Extract the package name of the newly focused app
        CharSequence packageNameCS = event.getPackageName();
        if (packageNameCS == null) {
            return;
        }

        String packageName = packageNameCS.toString();

        // Deduplicate: skip if the foreground app hasn't actually changed.
        // This avoids emitting events when Activities within the same app
        // transition (e.g., navigating between screens in YouTube).
        if (packageName.equals(lastForegroundPackage)) {
            return;
        }

        // Update the tracked foreground package
        lastForegroundPackage = packageName;

        Log.d(TAG, "Foreground app changed: " + packageName);

        // Broadcast the detected package name via LocalBroadcastManager.
        // The FocusFrictionModule (React Native bridge) listens for this
        // broadcast and emits it as a JavaScript event.
        broadcastForegroundApp(packageName);
    }

    // =========================================================================
    // Broadcasting
    // =========================================================================

    /**
     * Sends a local broadcast with the detected foreground app's package name.
     *
     * <p>We use {@link LocalBroadcastManager} because:</p>
     * <ul>
     *   <li>It's more efficient than system-wide broadcasts.</li>
     *   <li>It's more secure — other apps cannot intercept local broadcasts.</li>
     *   <li>It doesn't require any additional permissions.</li>
     * </ul>
     *
     * <p><b>Gradle dependency required:</b></p>
     * <pre>
     *   // In android/app/build.gradle → dependencies:
     *   implementation 'androidx.localbroadcastmanager:localbroadcastmanager:1.1.0'
     * </pre>
     *
     * <p><b>Alternative approach (static reference):</b> If you prefer to avoid
     * LocalBroadcastManager (which is deprecated in favor of other patterns),
     * you can use a static reference or an application-scoped event bus:</p>
     * <pre>
     *   // In this service:
     *   public static volatile String currentForegroundApp = "";
     *
     *   // In FocusFrictionModule, poll or observe this field.
     * </pre>
     *
     * @param packageName The package name of the detected foreground app.
     */
    private void broadcastForegroundApp(String packageName) {
        Intent intent = new Intent(ACTION_FOREGROUND_APP_CHANGED);
        intent.putExtra(EXTRA_PACKAGE_NAME, packageName);

        LocalBroadcastManager.getInstance(this).sendBroadcast(intent);

        Log.d(TAG, "Broadcast sent for package: " + packageName);
    }
}
