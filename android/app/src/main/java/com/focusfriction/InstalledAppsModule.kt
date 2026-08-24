package com.focusfriction

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream

class InstalledAppsModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "InstalledAppsModule"
    }

    private fun drawableToBase64(drawable: Drawable): String {
        val bitmap = if (drawable is BitmapDrawable) {
            drawable.bitmap
        } else {
            val bmp = Bitmap.createBitmap(drawable.intrinsicWidth.coerceAtLeast(1), drawable.intrinsicHeight.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            drawable.setBounds(0, 0, canvas.width, canvas.height)
            drawable.draw(canvas)
            bmp
        }
        val stream = ByteArrayOutputStream()
        val scaled = Bitmap.createScaledBitmap(bitmap, 72, 72, true)
        scaled.compress(Bitmap.CompressFormat.PNG, 100, stream)
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val intent = Intent(Intent.ACTION_MAIN, null)
            intent.addCategory(Intent.CATEGORY_LAUNCHER)
            val resolveInfos = pm.queryIntentActivities(intent, PackageManager.GET_META_DATA)
            val array = WritableNativeArray()
            
            val seenPackages = mutableSetOf<String>()

            for (resolveInfo in resolveInfos) {
                val appInfo = resolveInfo.activityInfo.applicationInfo
                if (seenPackages.contains(appInfo.packageName)) continue
                seenPackages.add(appInfo.packageName)

                val isSystemApp = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                val appName = resolveInfo.loadLabel(pm).toString()

                val map = WritableNativeMap()
                map.putString("appName", appName)
                map.putString("packageName", appInfo.packageName)
                map.putBoolean("isSystemApp", isSystemApp)
                
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("FETCH_ERROR", e)
        }
    }

    @ReactMethod
    fun getAppIcon(packageId: String, promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val icon = pm.getApplicationIcon(packageId)
            val base64 = drawableToBase64(icon)
            promise.resolve(base64)
        } catch (e: Exception) {
            promise.reject("ICON_FETCH_ERROR", e)
        }
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            val enabledServices = Settings.Secure.getString(
                reactContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            )
            val result = enabledServices?.contains("com.focusfriction/.FocusAccessibilityService") == true
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ACCESSIBILITY_CHECK_ERROR", e)
        }
    }

    @ReactMethod
    fun openAccessibilitySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ACCESSIBILITY_OPEN_ERROR", e)
        }
    }

    @ReactMethod
    fun setProtectionEnabled(enabled: Boolean, promise: Promise) {
        try {
            FocusPolicyRepository.getInstance(reactContext).setProtectionEnabled(enabled)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_PROTECTION_ERROR", e)
        }
    }

    @ReactMethod
    fun updatePolicy(params: ReadableMap, promise: Promise) {
        try {
            val packagesArray = params.getArray("monitoredPackages")
            val monitoredPackages = mutableSetOf<String>()
            if (packagesArray != null) {
                for (i in 0 until packagesArray.size()) {
                    val pkg = packagesArray.getString(i)
                    if (pkg != null) monitoredPackages.add(pkg)
                }
            }

            val isProtectionEnabled = if (params.hasKey("isProtectionEnabled")) params.getBoolean("isProtectionEnabled") else false
            val scheduleEnabled = if (params.hasKey("scheduleEnabled")) params.getBoolean("scheduleEnabled") else false
            val scheduleStartMinute = if (params.hasKey("scheduleStartMinute")) params.getInt("scheduleStartMinute") else 540
            val scheduleEndMinute = if (params.hasKey("scheduleEndMinute")) params.getInt("scheduleEndMinute") else 1020
            val solveGrantMinutes = if (params.hasKey("solveGrantMinutes")) params.getInt("solveGrantMinutes") else 10
            val bypassGrantMinutes = if (params.hasKey("bypassGrantMinutes")) params.getInt("bypassGrantMinutes") else 3

            FocusPolicyRepository.getInstance(reactContext).updatePolicy(
                monitoredPackages = monitoredPackages,
                isProtectionEnabled = isProtectionEnabled,
                scheduleEnabled = scheduleEnabled,
                scheduleStartMinute = scheduleStartMinute,
                scheduleEndMinute = scheduleEndMinute,
                solveGrantMinutes = solveGrantMinutes,
                bypassGrantMinutes = bypassGrantMinutes
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UPDATE_POLICY_ERROR", e)
        }
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(reactContext))
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(reactContext)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + reactContext.packageName)
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
        }
    }
}
