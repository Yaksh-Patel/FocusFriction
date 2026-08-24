# Android Native Updates

Because `npx` / Node.js was not accessible in the sandboxed environment, I could not automatically generate the `android/` directory using `expo prebuild`. 

Please follow these instructions to integrate the native Kotlin modules into your app:

## Step 1: Generate the Android Project
Run the following in your terminal:
```bash
npx expo prebuild -p android --clean
```

## Step 2: Copy the Native Module Files
Copy the generated Kotlin files from this folder into the native Android source directory:
```bash
cp android-updates/InstalledAppsModule.kt android/app/src/main/java/com/focusfriction/InstalledAppsModule.kt
cp android-updates/FocusFrictionPackage.kt android/app/src/main/java/com/focusfriction/FocusFrictionPackage.kt
```

## Step 3: Register the Package in `MainApplication.kt`
Open `android/app/src/main/java/com/focusfriction/MainApplication.kt` (or `.java`).
Inside the `getPackages()` method, add `FocusFrictionPackage()` to the returned list. For example, in Kotlin:
```kotlin
override fun getPackages(): List<ReactPackage> {
    val packages = PackageList(this).packages
    packages.add(FocusFrictionPackage())
    return packages
}
```

## Step 4: Update `AndroidManifest.xml`
Open `android/app/src/main/AndroidManifest.xml`.
1. Add `xmlns:tools="http://schemas.android.com/tools"` to the root `<manifest>` tag.
2. Insert these permissions before the `<application>` tag:
```xml
    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />
    <uses-permission android:name="android.permission.BIND_ACCESSIBILITY_SERVICE" />
```

## Step 5: Build the App
You will now need to build the app natively to test these features (they will not work in the standard Expo Go app):
```bash
npx expo run:android
```
