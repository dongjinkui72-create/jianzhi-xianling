/* eslint-disable */
/**
 * 核心逻辑验证脚本（Node 环境，不需要手机）。
 * 覆盖产品红线：噪声词排除、边界归一化、中转站分区 ≥5 条、
 * Chatbox deep link 可被标准 URL 解析且能还原出密钥与调用地址。
 */
const path = require('path');
const assert = require('assert');

const base = path.join(__dirname, '..', '.tmptest');
const N = require(path.join(base, 'lib', 'normalize.js'));
const F = require(path.join(base, 'lib', 'format.js'));
const B = require(path.join(base, 'lib', 'base64.js'));
const S = require(path.join(base, 'data', 'seed.js'));
const R = require(path.join(base, 'services', 'relayApi.js'));
const I = require(path.join(base, 'lib', 'importUrls.js'));
const REG = require(path.join(base, 'data', 'chatAppRegistry.js'));

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✅ ' + name);
  } catch (e) {
    fail++;
    console.log('  ❌ ' + name + '\n     ' + (e && e.message));
  }
}

console.log('\n[1] 噪声词排除 —— 绝不能把上下文窗口当成赠送额度');
t('「262,144 tokens 上下文窗口」被拒绝', () => {
  const q = N.parseQuota('262,144 tokens 上下文窗口');
  assert.strictEqual(q.rejected, true, '应该被拒绝，实际=' + JSON.stringify(q));
});
t('「支持 128K context window」被拒绝', () => {
  assert.strictEqual(N.parseQuota('支持 128K context window').rejected, true);
});
t('「最大输出 8192 tokens」被拒绝', () => {
  assert.strictEqual(N.parseQuota('最大输出 8192 tokens').rejected, true);
});
t('「速率限制 60 RPM」被拒绝', () => {
  assert.strictEqual(N.parseQuota('速率限制 60 RPM').rejected, true);
});
t('「context length 1M tokens」被拒绝', () => {
  assert.strictEqual(N.parseQuota('context length 1M tokens').rejected, true);
});

console.log('\n[2] 边界归一化 —— 真实额度必须被正确解析');
t('新用户赠送 $5 免费额度 -> usd 5', () => {
  const q = N.parseQuota('新用户赠送 $5 免费额度');
  assert.strictEqual(q.rejected, false);
  assert.strictEqual(q.kind, 'usd');
  assert.strictEqual(q.usd, 5);
});
t('注册赠送 ¥14 免费额度 -> cny 14', () => {
  const q = N.parseQuota('注册赠送 ¥14 免费额度');
  assert.strictEqual(q.rejected, false);
  assert.strictEqual(q.kind, 'cny');
  assert.strictEqual(q.value, 14);
});
t('赠送 1000000 tokens 免费额度 -> 1e6', () => {
  const q = N.parseQuota('赠送 1000000 tokens 免费额度');
  assert.strictEqual(q.tokens, 1000000);
});
t('赠送 100万 tokens -> 1e6（中文数量级）', () => {
  const q = N.parseQuota('赠送 100万 tokens 免费额度');
  assert.strictEqual(q.tokens, 1000000);
});
t('赠送 1.5M tokens -> 1.5e6（英文数量级）', () => {
  const q = N.parseQuota('新用户赠送 1.5M tokens');
  assert.strictEqual(q.tokens, 1500000);
});
t('全角数字与逗号归一化', () => {
  assert.strictEqual(N.normalizeNumber('1,000,000'), 1000000);
  assert.strictEqual(N.normalizeNumber('１２３'), 123);
  assert.strictEqual(N.normalizeNumber('2', '万'), 20000);
});
t('URL 边界归一化', () => {
  assert.strictEqual(N.normalizeUrl('example.com/'), 'https://example.com');
  assert.strictEqual(N.normalizeUrl(' https://a.com/// '), 'https://a.com');
  assert.strictEqual(N.siteKeyOf('https://WWW.Example.com/x/y'), 'example.com');
});

console.log('\n[3] 网页提炼 —— 只留福利句');
t('块级标签正确断句，只抽出赠送句', () => {
  const html = [
    '<html><body>',
    '<p>Gemini 2.5 Pro 支持 262,144 tokens 上下文窗口</p>',
    '<p>速率限制：60 RPM，max_tokens 8192</p>',
    '<ul><li>新用户注册赠送 $5 免费额度，90 天有效</li>',
    '<li>免费层每日提供 100 次免费请求</li></ul>',
    '</body></html>',
  ].join('\n');
  const lines = N.extractBenefitLines(html, 'api');
  const joined = lines.join(' | ');
  assert.ok(!/上下文窗口/.test(joined), '不应包含上下文窗口句: ' + joined);
  assert.ok(!/速率限制/.test(joined), '不应包含速率限制句: ' + joined);
  assert.ok(/赠送/.test(joined) || /\$5/.test(joined), '应包含赠送句: ' + joined);
  assert.ok(/100 次/.test(joined), '应包含每日免费请求句: ' + joined);
  assert.strictEqual(lines.length, 2, '应恰好抽出 2 条，实际 ' + lines.length + ': ' + joined);
});
t('噪声与福利混在同一句时，取的是 $5 而不是 262,144 tokens', () => {
  const q = N.parseQuota('Gemini 支持 262,144 tokens 上下文窗口，新用户注册赠送 $5 免费额度');
  assert.strictEqual(q.rejected, false, '不应整句拒绝');
  assert.strictEqual(q.kind, 'usd', '应识别为美元额度，实际 ' + q.kind);
  assert.strictEqual(q.usd, 5, '应为 $5，实际 ' + q.usd);
  assert.strictEqual(q.tokens, null, '绝不能把 262,144 当成赠送 token 数');
});
t('纯上下文窗口整句一律拒绝', () => {
  for (const s of ['262,144 tokens 上下文窗口', '上下文长度 128K', 'max_tokens 8192', '支持 200 万 tokens 上下文']) {
    assert.strictEqual(N.parseQuota(s).rejected, true, '应被拒绝: ' + s);
  }
});
console.log('\n[4] 种子情报库 —— 验收标准');
t('中转站分区 ≥ 5 条', () => {
  const relay = S.allSeedBenefits().filter((b) => b.section === 'relay');
  assert.ok(relay.length >= 5, '实际只有 ' + relay.length + ' 条');
  console.log('     中转站 ' + relay.length + ' 条 / 官方 ' + S.allSeedBenefits().filter((b) => b.section === 'official').length + ' 条');
});
t('每条情报都有「怎么领」步骤和链接', () => {
  for (const b of S.allSeedBenefits()) {
    assert.ok(Array.isArray(b.steps) && b.steps.length >= 3, b.id + ' 步骤不足');
    assert.ok(/^https?:\/\//.test(b.url), b.id + ' 链接非法');
    assert.ok(b.title && b.provider, b.id + ' 缺标题');
  }
});
t('中转站抓取关键词为 api + 中转站', () => {
  const F = require(path.join(base, 'services', 'radarFeed.js'));
  assert.deepStrictEqual(F.RELAY_KEYWORDS, ['api', '中转站', '公益站', '路由站']);
});
t('中转站情报都命中关键词 api', () => {
  for (const b of S.allSeedBenefits().filter((x) => x.section === 'relay')) {
    const hay = (b.title + b.summary + b.keywords.join(' ')).toLowerCase();
    assert.ok(hay.includes('api'), b.id + ' 未命中关键词 api');
  }
});
t('内置站点目录 ≥ 5 个', () => {
  assert.ok(S.SEED_RELAYS.length >= 5, '实际 ' + S.SEED_RELAYS.length);
});

console.log('\n[5] 格式化工具');
t('掩码只留头尾', () => {
  assert.strictEqual(F.maskKey('sk-abcdefgh1234567890'), 'sk-abc****7890');
  assert.ok(!F.maskKey('sk-abcdefgh1234567890').includes('defgh123456'));
});
t('New API quota 折算美元：500000 -> $1', () => {
  assert.strictEqual(F.quotaToUsd(500000), 1);
  assert.strictEqual(F.quotaToUsd(250000), 0.5);
});
t('token 数紧凑显示', () => {
  assert.strictEqual(F.compactNumber(1500000), '1.5M');
  assert.strictEqual(F.compactNumber(20000), '2万');
});

console.log('\n[6] 调用地址拼接');
t('joinApiBase 自动补 /v1', () => {
  assert.strictEqual(R.joinApiBase('https://anyrouter.top'), 'https://anyrouter.top/v1');
  assert.strictEqual(R.joinApiBase('https://anyrouter.top/'), 'https://anyrouter.top/v1');
  assert.strictEqual(R.joinApiBase('https://x.com/v1'), 'https://x.com/v1');
  assert.strictEqual(R.joinApiBase('https://x.com/v1/'), 'https://x.com/v1');
});
t('New API 响应解包兼容两种形态', () => {
  assert.deepStrictEqual(R.envelope({ ok: true, status: 200, data: { success: true, message: '', data: { id: 7 } } }), { success: true, message: '', data: { id: 7 } });
  assert.strictEqual(R.envelope({ ok: true, status: 200, data: [1, 2] }).data.length, 2);
});

console.log('\n[7] 全自动导入 URL 构造（Chatbox / LobeChat）');
const KEY = { id: 'k1', relayId: null, label: '云雾·主号', maskedKey: 'sk-abc****7890', secretRef: 'r', baseUrl: 'https://anyrouter.top', provider: '云雾', protocol: 'openai_compatible', status: 'ok', remainingTokens: null, remainingUsd: null, statusNote: null, checkedAt: null, source: 'auto', createdAt: 0 };
const SECRET = 'sk-测试密钥ABC123';

t('Chatbox deep link 可解析且能还原密钥与调用地址', () => {
  const client = REG.CHAT_APP_REGISTRY.find((x) => x.id === 'chatbox');
  const url = I.buildImportUrl(client, KEY, SECRET);
  assert.ok(url, '应能构造出 URL');
  const u = new URL(url);
  assert.strictEqual(u.protocol, 'chatbox:');
  assert.strictEqual(u.searchParams.get('type'), 'openai_compatible');
  const back = JSON.parse(Buffer.from(u.searchParams.get('data'), 'base64').toString('utf8'));
  assert.strictEqual(back.apiKey, SECRET);
  assert.strictEqual(back.apiHost, 'https://anyrouter.top/v1');
});

t('LobeChat URL 参数写入 keyVaults.openai', () => {
  const client = REG.CHAT_APP_REGISTRY.find((x) => x.id === 'lobechat');
  const url = I.buildImportUrl(client, KEY, SECRET);
  assert.ok(url.startsWith('https://chat.lobehub.com/?settings='), '应以 base + ?settings= 开头: ' + url);
  const settings = JSON.parse(decodeURIComponent(url.split('?settings=')[1]));
  assert.strictEqual(settings.keyVaults.openai.apiKey, SECRET);
  assert.strictEqual(settings.keyVaults.openai.baseURL, 'https://anyrouter.top/v1');
});

t('协议映射齐全（claude/gemini 走对应 keyVaults 与 type）', () => {
  assert.strictEqual(I.lobeProviderFor('claude'), 'anthropic');
  assert.strictEqual(I.lobeProviderFor('gemini'), 'google');
  assert.strictEqual(I.chatboxTypeFor('gemini'), 'gemini');
  assert.strictEqual(I.chatboxTypeFor('openai_compatible'), 'openai_compatible');
});

console.log('\n[8] 适配器登记表 —— 诚实性不变量');
t('标「可全自动导入」的适配器必须有模板', () => {
  for (const c of REG.CHAT_APP_REGISTRY) {
    if (c.importKind === 'deeplink_import') assert.ok(c.importTemplate, c.id + ' 缺 importTemplate');
    if (c.importKind === 'url_settings_import') assert.ok(c.settingsTemplate, c.id + ' 缺 settingsTemplate');
  }
});
t('标「无法确认」的适配器绝不允许带导入模板（防止贸然发送）', () => {
  for (const c of REG.CHAT_APP_REGISTRY) {
    if (c.importKind === 'unconfirmed') {
      assert.ok(!c.importTemplate && !c.settingsTemplate, c.id + ' 不应带导入模板');
      assert.ok(I.canAutoImport(c) === false, c.id + ' 不应被判为可自动导入');
    }
  }
});
t('每条适配器都有诚实说明', () => {
  for (const c of REG.CHAT_APP_REGISTRY) assert.ok(c.note && c.note.length > 4, c.id + ' 缺 note');
});
t('内置适配器覆盖开源项目（GitHub）', () => {
  const ids = REG.CHAT_APP_REGISTRY.map((c) => c.id);
  for (const need of ['deepchat', 'cherrystudio', 'lobechat']) assert.ok(ids.includes(need), '缺少 ' + need);
});
t('仓库自带 adapters/clients.json 合法且与内置一致', () => {
  const fs = require('fs');
  const file = path.join(__dirname, '..', 'adapters', 'clients.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(json.adapters) && json.adapters.length >= 3);
  for (const a of json.adapters) {
    assert.ok(['deeplink_import', 'url_settings_import', 'launch_only', 'unconfirmed'].includes(a.importKind), a.id + ' importKind 非法');
    if (a.importKind === 'deeplink_import') assert.ok(a.importTemplate, a.id);
    if (a.importKind === 'url_settings_import') assert.ok(a.settingsTemplate, a.id);
    if (a.importKind === 'unconfirmed') assert.ok(!a.importTemplate && !a.settingsTemplate, a.id);
  }
});
console.log('\n[9] 可用池三分组与可导入过滤');
const G = require(path.join(base, 'lib', 'poolGroups.js'));
const mk = (status) => ({ id: 'k-' + status, relayId: null, label: status, maskedKey: 'sk-x', secretRef: 'r', baseUrl: 'https://x/v1', provider: 'p', protocol: 'openai_compatible', status, remainingTokens: 1000, remainingUsd: 1, statusNote: null, checkedAt: 1, source: 'auto', createdAt: 1 });
t('绿/黄/红三分组归位正确', () => {
  const g = G.groupKeys([mk('ok'), mk('unknown'), mk('low'), mk('dead')]);
  assert.strictEqual(g.green.length, 2);
  assert.strictEqual(g.yellow.length, 1);
  assert.strictEqual(g.red.length, 1);
  assert.strictEqual(g.yellow[0].status, 'low');
  assert.strictEqual(g.red[0].status, 'dead');
});
t('只有绿色分组可选中启动', () => {
  assert.strictEqual(G.isSelectable(mk('ok')), true);
  assert.strictEqual(G.isSelectable(mk('unknown')), true);
  assert.strictEqual(G.isSelectable(mk('low')), false);
  assert.strictEqual(G.isSelectable(mk('dead')), false);
});
t('设置页/启动流程只保留可导入软件（大厂官方 App 被排除）', () => {
  const importable = REG.CHAT_APP_REGISTRY.filter((c) => I.canAutoImport(c));
  const ids = importable.map((c) => c.id);
  assert.ok(ids.includes('chatbox') && ids.includes('lobechat'), '应包含 chatbox 与 lobechat');
  for (const banned of ['chatgpt', 'claude', 'gemini', 'deepseek', 'doubao', 'grok', 'poe']) {
    assert.ok(!ids.includes(banned), banned + ' 不应出现在可导入列表');
  }
});
console.log('\n[10] API 根嗅探（公益站/路由站 404 场景回归）');
t('探针记录的带前缀 API 地址能被还原成候选根', () => {
  const cands = R.deriveApiCandidates(['https://ly.7625.xyz/apiroot/api/user/self'], 'https://ly.7625.xyz');
  assert.strictEqual(cands[0], 'https://ly.7625.xyz/apiroot');
  assert.ok(cands.includes('https://ly.7625.xyz'), '应包含页面所在域');
  assert.ok(cands.includes('https://7625.xyz'), '应包含根域候选');
  assert.ok(cands.includes('https://api.7625.xyz'), '应包含 api 子域候选');
});
t('无探针记录时至少回退到页面域及其变体', () => {
  const cands = R.deriveApiCandidates([], 'https://console.example.com');
  assert.deepStrictEqual(cands.slice(0, 3), ['https://console.example.com', 'https://example.com', 'https://api.example.com']);
});
t('后台签到模块可加载且导出齐全', () => {
  const H = require(path.join(base, 'services', 'headlessCheckin.js'));
  assert.strictEqual(typeof H.headlessCheckin, 'function');
  assert.strictEqual(typeof H.headlessProbeSite, 'function');
  assert.strictEqual(typeof H.registerHeadlessNavigator, 'function');
  assert.strictEqual(H.headlessReady(), false);
});
t('带 /apiroot 前缀的公益站根地址能被正确还原', () => {
  const cands = R.deriveApiCandidates(['https://ly.7625.xyz/apiroot/api/user/self'], 'https://ly.7625.xyz/docs');
  assert.strictEqual(cands[0], 'https://ly.7625.xyz/apiroot');
});
console.log('\n────────────────────────────');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) process.exit(1);