package com.focusfriction

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.LruCache
import android.view.accessibility.AccessibilityManager
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

    companion object {
        private const val ICON_PX = 72
        // Decoding + rescaling + base64-encoding an icon costs real time, and list
        // recycling asks for the same icon repeatedly as the user scrolls. ~200 icons
        // at 72x72 PNG base64 is a few MB at most.
        private val iconCache = object : LruCache<String, String>(256) {}
    }

    override fun getName(): String {
        return "InstalledAppsModule"
    }

    private fun drawableToBase64(drawable: Drawable): String {
        // Render straight into a target-sized bitmap. The old path built a
        // full-resolution bitmap and then rescaled it, doing twice the allocation.
        val bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        drawable.setBounds(0, 0, ICON_PX, ICON_PX)
        drawable.draw(canvas)

        val stream = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, stream)
        bmp.recycle()
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
            iconCache.get(packageId)?.let {
                promise.resolve(it)
                return
            }
            val pm = reactContext.packageManager
            val icon = pm.getApplicationIcon(packageId)
            val base64 = drawableToBase64(icon)
            iconCache.put(packageId, base64)
            promise.resolve(base64)
        } catch (e: Exception) {
            promise.reject("ICON_FETCH_ERROR", e)
        }
    }

    @ReactMethod
    fun isAccessibilityServiceEnabled(promise: Promise) {
        try {
            val expected = ComponentName(reactContext.packageName, FocusAccessibilityService::class.java.name)
            val manager = reactContext.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE)
                as? AccessibilityManager

            val viaManager = manager
                ?.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                ?.any { it.resolveInfo?.serviceInfo?.let { si -> si.packageName == expected.packageName && si.name == expected.className } == true }
                ?: false

            if (viaManager) {
                promise.resolve(true)
                return
            }

            // Fallback: parse the raw setting, accepting both the short and fully
            // qualified component spellings that different OEMs write.
            val raw = Settings.Secure.getString(
                reactContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            val matched = raw.split(':').any { entry ->
                ComponentName.unflattenFromString(entry)?.let {
                    it.packageName == expected.packageName && it.className == expected.className
                } == true
            }
            promise.resolve(matched)
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

            val frictionTypes = ArrayList<String>()
            params.getArray("frictionTypes")?.let { arr ->
                for (i in 0 until arr.size()) arr.getString(i)?.let(frictionTypes::add)
            }
            if (frictionTypes.isEmpty()) frictionTypes.add("math")

            FocusPolicyRepository.getInstance(reactContext).updatePolicy(
                monitoredPackages = monitoredPackages,
                isProtectionEnabled = isProtectionEnabled,
                scheduleEnabled = scheduleEnabled,
                scheduleStartMinute = scheduleStartMinute,
                scheduleEndMinute = scheduleEndMinute,
                solveGrantMinutes = solveGrantMinutes,
                bypassGrantMinutes = bypassGrantMinutes,
                frictionTypes = frictionTypes
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
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(reactContext)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + reactContext.packageName)
                )
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OVERLAY_PERMISSION_ERROR", e)
        }
    }
}
