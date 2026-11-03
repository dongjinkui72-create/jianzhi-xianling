/**
 * 注入「悬浮窗凭证层」原生模块。
 * 用途：对没有自动导入协议的软件，启动后以系统悬浮窗形式把调用地址与密钥
 *      盖在目标 App 之上；默认收起，点一下展开（可复制），再点收起，长按关闭。
 * 需要 SYSTEM_ALERT_WINDOW 权限（用户一次性授权）。
 */
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = [
  'package com.jianzhi.xianling',
  '',
  'import android.content.ClipData',
  'import android.content.ClipboardManager',
  'import android.content.Context',
  'import android.graphics.Color',
  'import android.graphics.PixelFormat',
  'import android.graphics.drawable.GradientDrawable',
  'import android.net.Uri',
  'import android.os.Build',
  'import android.provider.Settings',
  'import android.view.Gravity',
  'import android.view.View',
  'import android.view.WindowManager',
  'import android.widget.LinearLayout',
  'import android.widget.TextView',
  'import android.widget.Toast',
  'import com.facebook.react.bridge.Promise',
  'import com.facebook.react.bridge.ReactApplicationContext',
  'import com.facebook.react.bridge.ReactContextBaseJavaModule',
  'import com.facebook.react.bridge.ReactMethod',
  '',
  'class JZOverlayModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {',
  '    override fun getName(): String = "JZOverlay"',
  '',
  '    private var wm: WindowManager? = null',
  '    private var bubble: View? = null',
  '    private var panel: View? = null',
  '    private var expanded = false',
  '    private var baseText = ""',
  '    private var keyText = ""',
  '',
  '    private fun dp(v: Int): Int = (v * ctx.resources.displayMetrics.density).toInt()',
  '',
  '    @ReactMethod',
  '    fun canOverlay(p: Promise) { p.resolve(Settings.canDrawOverlays(ctx.applicationContext)) }',
  '',
  '    @ReactMethod',
  '    fun requestOverlay(p: Promise) {',
  '        val i = android.content.Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName))',
  '        i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)',
  '        try { ctx.startActivity(i); p.resolve(true) } catch (e: Exception) { p.resolve(false) }',
  '    }',
  '',
  '    @ReactMethod',
  '    fun show(title: String, base: String, key: String, p: Promise) {',
  '        baseText = base; keyText = key',
  '        ctx.runOnUiQueueThread {',
  '            try { buildUi(title) ; p.resolve(true) } catch (e: Exception) { p.resolve(false) }',
  '        }',
  '    }',
  '',
  '    @ReactMethod',
  '    fun hide(p: Promise) { ctx.runOnUiQueueThread { removeAll(); p.resolve(true) } }',
  '',
  '    private fun removeAll() {',
  '        val w = wm ?: return',
  '        bubble?.let { runCatching { w.removeView(it) } }',
  '        panel?.let { runCatching { w.removeView(it) } }',
  '        bubble = null; panel = null; expanded = false',
  '    }',
  '',
  '    private fun params(w: Int, h: Int, gravity: Int): WindowManager.LayoutParams {',
  '        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE',
  '        val lp = WindowManager.LayoutParams(w, h, type, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT)',
  '        lp.gravity = gravity',
  '        return lp',
  '    }',
  '',
  '    private fun toast(msg: String) { Toast.makeText(ctx.applicationContext, msg, Toast.LENGTH_SHORT).show() }',
  '',
  '    private fun copy(label: String, value: String) {',
  '        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager',
  '        cm.setPrimaryClip(ClipData.newPlainText(label, value))',
  '        toast(label + " 已复制")',
  '    }',
  '',
  '    private fun buildUi(title: String) {',
  '        if (bubble != null) return',
  '        val w = ctx.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager',
  '        wm = w',
  '',
  '        val b = TextView(ctx.applicationContext)',
  '        b.text = "钥"',
  '        b.setTextColor(Color.WHITE)',
  '        b.textSize = 16f',
  '        b.gravity = Gravity.CENTER',
  '        val bg = GradientDrawable()',
  '        bg.setColor(0xCC2E7BFF.toInt())',
  '        bg.cornerRadius = dp(23).toFloat()',
  '        b.background = bg',
  '        val size = dp(46)',
  '        b.setOnClickListener { togglePanel(title) }',
  '        b.setOnLongClickListener { removeAll(); toast("悬浮窗已关闭"); true }',
  '        w.addView(b, params(size, size, Gravity.TOP or Gravity.END).also { it.x = dp(14); it.y = dp(120) })',
  '        bubble = b',
  '        toast("悬浮窗已开启：点一下查看密钥与地址，长按关闭")',
  '    }',
  '',
  '    private fun togglePanel(title: String) {',
  '        val w = wm ?: return',
  '        if (expanded) { panel?.let { runCatching { w.removeView(it) } }; panel = null; expanded = false; return }',
  '        val box = LinearLayout(ctx.applicationContext)',
  '        box.orientation = LinearLayout.VERTICAL',
  '        val card = GradientDrawable()',
  '        card.setColor(0xF2FAFCFF.toInt())',
  '        card.cornerRadius = dp(16).toFloat()',
  '        card.setStroke(dp(1), 0x337A90B2.toInt())',
  '        box.background = card',
  '        box.setPadding(dp(14), dp(12), dp(14), dp(12))',
  '',
  '        val t = TextView(ctx.applicationContext)',
  '        t.text = title',
  '        t.setTextColor(0xFF0D1B2A.toInt())',
  '        t.textSize = 13f',
  '        box.addView(t)',
  '',
  '        box.addView(row("调用地址", baseText))',
  '        box.addView(row("API 密钥", keyText))',
  '',
  '        val hint = TextView(ctx.applicationContext)',
  '        hint.text = "点悬浮圆钮收起；长按圆钮关闭"',
  '        hint.setTextColor(0xFF8698AE.toInt())',
  '        hint.textSize = 10f',
  '        box.addView(hint)',
  '',
  '        val lp = params(dp(260), WindowManager.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END)',
  '        lp.x = dp(14); lp.y = dp(176)',
  '        w.addView(box, lp)',
  '        panel = box',
  '        expanded = true',
  '    }',
  '',
  '    private fun row(label: String, value: String): LinearLayout {',
  '        val r = LinearLayout(ctx.applicationContext)',
  '        r.orientation = LinearLayout.HORIZONTAL',
  '        r.setPadding(0, dp(8), 0, 0)',
  '        val l = TextView(ctx.applicationContext)',
  '        l.text = label',
  '        l.setTextColor(0xFF4C5F77.toInt())',
  '        l.textSize = 11f',
  '        l.width = dp(64)',
  '        r.addView(l)',
  '        val v = TextView(ctx.applicationContext)',
  '        v.text = value',
  '        v.setTextColor(0xFF0D1B2A.toInt())',
  '        v.textSize = 11f',
  '        v.setMaxLines(3)',
  '        val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)',
  '        r.addView(v, lp)',
  '        val c = TextView(ctx.applicationContext)',
  '        c.text = "复制"',
  '        c.setTextColor(0xFF2E7BFF.toInt())',
  '        c.textSize = 12f',
  '        c.setPadding(dp(10), dp(4), dp(4), dp(4))',
  '        c.setOnClickListener { copy(label, value) }',
  '        r.addView(c)',
  '        return r',
  '    }',
  '}',
].join('\n');

const PACKAGE_KT = [
  'package com.jianzhi.xianling',
  '',
  'import com.facebook.react.ReactPackage',
  'import com.facebook.react.bridge.NativeModule',
  'import com.facebook.react.bridge.ReactApplicationContext',
  'import com.facebook.react.uimanager.ViewManager',
  '',
  'class JZOverlayPackage : ReactPackage {',
  '    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =',
  '        listOf(JZOverlayModule(reactContext))',
  '',
  '    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =',
  '        emptyList()',
  '}',
].join('\n');

function writeKotlin(androidDir) {
  const target = path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'jianzhi', 'xianling');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'JZOverlayModule.kt'), MODULE_KT, 'utf8');
  fs.writeFileSync(path.join(target, 'JZOverlayPackage.kt'), PACKAGE_KT, 'utf8');
}

const withOverlayModule = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const perms = manifest['uses-permission'] || (manifest['uses-permission'] = []);
    const name = 'android.permission.SYSTEM_ALERT_WINDOW';
    if (!perms.some((p) => p?.$?.['android:name'] === name)) perms.push({ $: { 'android:name': name } });
    return cfg;
  });
  config = withDangerousMod(config, ['android', (cfg) => {
    const androidDir = cfg.modRequest.platformProjectPath || path.join(cfg.modRequest.projectRoot, 'android');
    writeKotlin(androidDir);
    return cfg;
  }]);
  config = withMainApplication(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (!src.includes('JZOverlayPackage()')) {
      cfg.modResults.contents = src.replace('// add(MyReactNativePackage())', '// add(MyReactNativePackage())\n            add(JZOverlayPackage())');
    }
    return cfg;
  });
  return config;
};

module.exports = withOverlayModule;