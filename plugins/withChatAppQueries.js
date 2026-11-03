/**
 * Expo 配置插件：把「AI 聊天软件」的包名 / URL Scheme 写进原生壳的可见性白名单。
 *
 * 为什么需要它：
 *  - Android 11+ 有「包可见性」限制，未在 <queries> 里声明的包，
 *    PackageManager / canOpenURL 一律查不到，会被误判成「未安装」。
 *  - iOS 同理，未在 LSApplicationQueriesSchemes 里声明的 scheme，
 *    canOpenURL 一律返回 false。
 *
 * 红线要求：原生壳无法扩展白名单时（例如 Expo Go），
 * 扫描结果必须标「无法确认」，绝不能谎报「未安装」。
 * 因此 src/services/detectApps.ts 会先判断运行环境是否具备本插件注入的白名单。
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

/** 已知 AI 聊天软件：Android 包名 */
const ANDROID_PACKAGES = [
  'ai.chatbox',
  'ai.chatbox.desktop',
  'com.lobehub.app',
  'com.github.yidadaa.chatgptnextweb',
  'com.nextchat.app',
  'com.openai.chatgpt',
  'com.deepseek.chat',
  'com.larus.nova',
  'com.kimi.chat',
  'com.moonshot.kimichat',
  'com.aliyun.tongyi',
  'com.tencent.hunyuan.app.chat',
  'ai.x.grok',
  'com.anthropic.claude',
  'com.google.android.apps.bard',
  'com.poe.android',
  'com.quora.poe',
  'com.boltai.android',
  'com.chatwise.android',
  'com.chatany.app',
  'com.openclaw.app',
  'com.papercut.ai',
  'com.cherryai.studio',
];

/** 已知 AI 聊天软件：URL Scheme（含本 App 自身） */
const URL_SCHEMES = [
  'jianzhi',
  'chatbox',
  'lobehub',
  'lobechat',
  'nextchat',
  'chatgpt',
  'deepseek',
  'kimi',
  'tongyi',
  'yuanbao',
  'grok',
  'claude',
  'gemini',
  'bard',
  'poe',
  'opencat',
  'boltai',
  'chatwise',
  'cherrystudio',
  'deepchat',
  'tauritavern',
  'sillytavern',
  'risu',
  'chatterui',
  'janitor',
];

function ensureArray(node, key) {
  if (!node[key]) node[key] = [];
  if (!Array.isArray(node[key])) node[key] = [node[key]];
  return node[key];
}

const withAndroidQueries = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest) return cfg;

    let queries = manifest.queries;
    if (!queries) {
      queries = {};
      manifest.queries = queries;
    }
    if (Array.isArray(queries)) queries = queries[0] || {};

    const packages = ensureArray(queries, 'package');
    for (const name of ANDROID_PACKAGES) {
      if (!packages.some((p) => p?.$?.['android:name'] === name)) {
        packages.push({ $: { 'android:name': name } });
      }
    }

    const intents = ensureArray(queries, 'intent');
    for (const scheme of URL_SCHEMES) {
      const exists = intents.some((it) =>
        JSON.stringify(it || {}).includes(`"android:scheme":"${scheme}"`) ||
        JSON.stringify(it || {}).includes(`"${scheme}"`)
      );
      if (!exists) {
        intents.push({
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          data: [{ $: { 'android:scheme': scheme } }],
        });
      }
    }

    manifest.queries = Array.isArray(manifest.queries) ? manifest.queries : [queries];
    return cfg;
  });

const withIosQueries = (config) =>
  withInfoPlist(config, (cfg) => {
    const list = cfg.modResults.LSApplicationQueriesSchemes || [];
    const merged = Array.from(new Set([...list, ...URL_SCHEMES]));
    cfg.modResults.LSApplicationQueriesSchemes = merged;
    return cfg;
  });

module.exports = function withChatAppQueries(config) {
  config = withAndroidQueries(config);
  config = withIosQueries(config);
  return config;
};

module.exports.ANDROID_PACKAGES = ANDROID_PACKAGES;
module.exports.URL_SCHEMES = URL_SCHEMES;