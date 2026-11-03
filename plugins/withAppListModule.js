/**
 * 注入「已安装应用列表」原生模块。
 * 用途：设置里「手动添加软件」时直接拉取手机上的应用列表，
 *      由 App 自动比对适配器登记表识别导入方式，不让用户自己选。
 * 需要 QUERY_ALL_PACKAGES 权限才能列全（Android 11+ 的包可见性限制）。
 */
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = `package com.jianzhi.xianling

import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class JZAppListModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "JZAppList"

    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = ctx.packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val infos = pm.queryIntentActivities(intent, 0)
            val seen = HashSet<String>()
            val rows = mutableListOf<Pair<String, String>>()
            for (ri in infos) {
                val pkg = ri.activityInfo.packageName
                if (pkg == ctx.packageName) continue
                if (!seen.add(pkg)) continue
                val label = ri.loadLabel(pm).toString()
                rows.add(Pair(label, pkg))
            }
            rows.sortBy { it.first }
            val arr = Arguments.createArray()
            for (r in rows) {
                val m = Arguments.createMap()
                m.putString("label", r.first)
                m.putString("packageName", r.second)
                arr.pushMap(m)
            }
            promise.resolve(arr)
        } catch (e: Exception) {
            promise.reject("E_APP_LIST", e.message)
        }
    }

    private fun norm(s: String): String {
        val sb = StringBuilder()
        for (ch in s.lowercase()) {
            if (ch.isLetterOrDigit()) sb.append(ch)
        }
        return sb.toString()
    }

    /** 按应用名称在本机应用列表里找到并拉起（包名未知时的兜底） */
    @ReactMethod
    fun launchAppByName(name: String, promise: Promise) {
        try {
            val pm = ctx.packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val infos = pm.queryIntentActivities(intent, 0)
            val target = norm(name)
            var best: String? = null
            for (ri in infos) {
                val pkg = ri.activityInfo.packageName
                if (pkg == ctx.packageName) continue
                val label = norm(ri.loadLabel(pm).toString())
                val npkg = norm(pkg)
                if (label == target || npkg == target || (target.length >= 3 && (label.contains(target) || target.contains(label)))) {
                    best = pkg
                    break
                }
            }
            if (best == null) {
                promise.resolve("")
                return
            }
            val li = pm.getLaunchIntentForPackage(best)
            if (li == null) {
                promise.resolve("")
                return
            }
            li.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(li)
            promise.resolve(best)
        } catch (e: Exception) {
            promise.resolve("")
        }
    }

    /** 用包名直接拉起目标 App（比 URL Scheme 更可靠） */
    @ReactMethod
    fun launchApp(packageName: String, promise: Promise) {
        try {
            val intent = ctx.packageManager.getLaunchIntentForPackage(packageName)
            if (intent == null) {
                promise.resolve(false)
                return
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
`;

const PACKAGE_KT = `package com.jianzhi.xianling

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class JZAppListPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(JZAppListModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
`;

function writeKotlin(modDir) {
  const target = path.join(modDir, 'app', 'src', 'main', 'java', 'com', 'jianzhi', 'xianling');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'JZAppListModule.kt'), MODULE_KT, 'utf8');
  fs.writeFileSync(path.join(target, 'JZAppListPackage.kt'), PACKAGE_KT, 'utf8');
}

const withAppListModule = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const perms = manifest['uses-permission'] || (manifest['uses-permission'] = []);
    const name = 'android.permission.QUERY_ALL_PACKAGES';
    if (!perms.some((p) => p?.$?.['android:name'] === name)) {
      perms.push({ $: { 'android:name': name } });
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const androidDir = cfg.modRequest.platformProjectPath || path.join(cfg.modRequest.projectRoot, 'android');
      writeKotlin(androidDir);
      return cfg;
    },
  ]);

  config = withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (!src.includes('JZAppListPackage()')) {
      cfg.modResults.contents = src.replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n            add(JZAppListPackage())',
      );
    }
    return cfg;
  });

  return config;
};

module.exports = withAppListModule;