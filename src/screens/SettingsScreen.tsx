import React, { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Busy, Chip, Collapsible, Field, GlassButton, IconButton, KeyValue, Notice, Sheet, SwitchRow } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber } from '../lib/format';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { canAutoImport } from '../services/launcher';
import { isWhitelistCapableShell } from '../services/detectApps';
import { appListAvailable, listInstalledApps, type InstalledApp } from '../native/installedApps';
import { CHAT_APP_REGISTRY } from '../data/chatAppRegistry';
import { useApp } from '../store/AppStore';
import type { ChatClient } from '../lib/types';

/**
 * 设置（入口固定在主界面右上角）。
 * 迭代要求：
 *  - AI 聊天软件列表只保留「可导入 API」的软件，猫箱/ChatGPT/Claude/Gemini 等不可导入的一律不出现；
 *  - 手动添加 = 直接拉取手机应用列表，由 App 自动比对登记表识别导入方式，不让用户自己选。
 */

const TOKEN_PRESETS = [50000, 200000, 1000000, 5000000];
const USD_PRESETS = [0.1, 0.5, 2, 10];

export function SettingsScreen({ navigation }: any) {
  const sc = useScale();
  const app = useApp();
  const [installedOpen, setInstalledOpen] = useState(false);
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [installedBusy, setInstalledBusy] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [adapterSheetOpen, setAdapterSheetOpen] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [baseEdit, setBaseEdit] = useState<{ id: string; value: string } | null>(null);
  const [q, setQ] = useState('');

  /** 只保留可导入的适配器 */
  const importable = app.clients.filter((c) => canAutoImport(c));
  const preferred = importable.find((c) => c.id === app.settings.preferredClientId) ?? null;

  const rescan = async () => {
    setScanning(true);
    try {
      await app.rescanClients();
      setNote('已重新扫描本机 AI 聊天软件');
    } finally {
      setScanning(false);
    }
  };

  const matches = useMemo(() => {
    const key = q.trim().toLowerCase();
    if (!key) return { apps: [] as InstalledApp[], seeds: [] as typeof CHAT_APP_REGISTRY };
    const apps = installed.filter((a) => a.label.toLowerCase().includes(key) || a.packageName.toLowerCase().includes(key));
    const seeds = CHAT_APP_REGISTRY.filter(
      (s) =>
        (s.name.toLowerCase().includes(key) || (s.androidPackage ?? '').toLowerCase().includes(key)) &&
        !app.clients.some((c) => c.id === s.id),
    );
    return { apps, seeds };
  }, [q, installed, app.clients]);

  const addSeed = async (s: (typeof CHAT_APP_REGISTRY)[number]) => {
    await app.addCustomClient({
      name: s.name,
      scheme: s.scheme ?? '',
      importKind: s.importKind,
      importTemplate: s.importTemplate,
      settingsTemplate: s.settingsTemplate,
      settingsBase: s.settingsBase,
      launchTemplate: s.launchTemplate,
      browserBased: s.browserBased,
    });
    setInstalledOpen(false);
    setQ('');
    setNote(canAutoImport(s) ? '已添加，导入方式由 App 自动识别。' : '已添加；它没有对外导入协议，启动时会用悬浮窗凭证层兜底。');
  };

  const openInstalled = async () => {
    setInstalledOpen(true);
    if (!appListAvailable()) {
      setInstalled([]);
      return;
    }
    setInstalledBusy(true);
    try {
      const list = await listInstalledApps();
      setInstalled(list);
    } finally {
      setInstalledBusy(false);
    }
  };

  /** 自动识别：拿包名去登记表 / 远程清单里比对，用户不做任何选择 */
  const identify = (pkg: string) => {
    return (
      app.clients.find((c) => c.androidPackage === pkg || c.iosBundleId === pkg) ??
      CHAT_APP_REGISTRY.find((s) => s.androidPackage === pkg || s.iosBundleId === pkg) ??
      null
    );
  };

  const addInstalled = async (a: InstalledApp) => {
    const matched = identify(a.packageName);
    const kind = matched?.importKind ?? 'unconfirmed';
    if (!matched || !canAutoImport(matched)) {
      setInstalledOpen(false);
      setNote(
        matched
          ? `已识别「${a.label}」，但它的导入能力是「${matched.importKind === 'launch_only' ? '仅能打开' : '无法确认'}」，不属于可导入软件，因此不会出现在列表里。`
          : `已识别「${a.label}」，但适配器登记表里还没有它的导入协议，标为「无法确认」。等远程清单补上后会自动生效。`,
      );
      return;
    }
    await app.addCustomClient({
      name: a.label,
      scheme: matched.scheme ?? '',
      importKind: matched.importKind,
      importTemplate: matched.importTemplate,
      settingsTemplate: matched.settingsTemplate,
      settingsBase: matched.settingsBase,
      launchTemplate: matched.launchTemplate,
      browserBased: matched.browserBased,
    });
    setInstalledOpen(false);
    setNote(`已添加「${a.label}」，导入方式由 App 自动识别为：${matched.importKind === 'deeplink_import' ? 'deep link 直写' : 'URL 参数写入'}。`);
    await app.rescanClients();
  };

  const submitAdapterFeed = async () => {
    const u = feedUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      setNote('清单地址必须是 http(s)');
      return;
    }
    const next = Array.from(new Set([...app.settings.adapterFeedUrls, u]));
    await app.patchSettings({ adapterFeedUrls: next });
    setFeedUrl('');
    setAdapterSheetOpen(false);
    setNote('已添加适配器清单，正在拉取…');
    await app.refreshAdapters(true);
  };

  const submitFeed = async () => {
    const u = feedUrl.trim();
    if (!/^https?:\/\//i.test(u)) {
      setNote('情报源必须是 http(s) 地址');
      return;
    }
    const next = Array.from(new Set([...app.settings.feedUrls, u]));
    await app.patchSettings({ feedUrls: next });
    setFeedUrl('');
    setFeedOpen(false);
    setNote('已添加情报源，下次抓取会带上它');
  };

  const ClientRow = ({ c }: { c: ChatClient }) => {
    const isPref = app.settings.preferredClientId === c.id;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(9), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
        <View style={{ width: sc.s(34), height: sc.s(34), borderRadius: sc.s(11), backgroundColor: palette.okSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={c.importKind === 'deeplink_import' ? 'flash' : 'link'} size={sc.s(17)} color={palette.ok} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{c.name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(4) }}>
            <Chip label={c.importKind === 'deeplink_import' ? 'deep link 直写' : 'URL 参数写入'} tone="ok" />
            <Chip label={c.detected === 'installed' ? '已识别安装' : c.browserBased ? '网页版/PWA' : '无法确认安装'} tone={c.detected === 'installed' ? 'accent' : 'muted'} />
            {isPref ? <Chip label="默认启动" tone="ok" icon="star" /> : null}
            {c.source === 'feed' ? <Chip label="远程清单" tone="accent" /> : null}
          </View>
          {c.note ? <Text style={{ marginTop: sc.s(3), fontSize: sc.fs(10), color: palette.inkFaint, lineHeight: sc.fs(14) }}>{c.note}</Text> : null}
          {c.importKind === 'url_settings_import' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(6), marginTop: sc.s(5) }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(10.5), color: palette.inkSoft }}>{c.settingsBase}</Text>
              <GlassButton label="改地址" size="sm" tone="muted" onPress={() => setBaseEdit({ id: c.id, value: c.settingsBase || '' })} />
            </View>
          ) : null}
        </View>
        <View style={{ gap: sc.s(5) }}>
          <GlassButton label={isPref ? '取消' : '设为默认'} size="sm" tone={isPref ? 'muted' : 'accent'} onPress={() => app.patchSettings({ preferredClientId: isPref ? null : c.id })} />
          {!c.builtin ? <GlassButton label="删除" size="sm" tone="danger" onPress={() => app.removeCustomClient(c.id)} /> : null}
        </View>
      </View>
    );
  };

  return (
    <ScreenShell>
      <Header title="设置" right={<IconButton icon="close" onPress={() => navigation.goBack()} tone="muted" />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(40) }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {note ? (
          <View style={{ marginBottom: sc.s(12) }}>
            <Notice tone="ok">{note}</Notice>
          </View>
        ) : null}

        {/* AI 聊天软件（只列可导入的） */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(4) }}>
            <Ionicons name="apps-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ flex: 1, marginLeft: sc.s(8), fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>AI 聊天软件（可导入）</Text>
            <GlassButton label={scanning ? '扫描中' : '重新扫描'} icon="refresh-outline" size="sm" tone="muted" loading={scanning} onPress={rescan} />
          </View>

          {app.scanNote ? (
            <View style={{ marginBottom: sc.s(10) }}>
              <Notice tone="warn" title="扫描能力受限（如实标注）">{app.scanNote}</Notice>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: sc.s(8), marginBottom: sc.s(6), flexWrap: 'wrap' }}>
            <GlassButton label="从已安装应用添加" icon="phone-portrait-outline" size="sm" onPress={openInstalled} />
            <GlassButton label="安装 Chatbox" icon="download-outline" size="sm" tone="ok" onPress={() => Linking.openURL('https://chatboxai.app/').catch(() => {})} />
          </View>

          <SwitchRow
            title="每次都让我选用哪个软件"
            desc="关掉后，若已设置「默认启动」，点启动按钮会直接拉起它"
            value={app.settings.alwaysAskClient}
            onValueChange={(v) => app.patchSettings({ alwaysAskClient: v })}
          />
          <KeyValue k="当前默认" v={preferred ? preferred.name : '未设置（每次自选）'} />

          <View style={{ marginTop: sc.s(6) }}>
            {importable.map((c) => (
              <ClientRow key={c.id} c={c} />
            ))}
            {importable.length === 0 ? (
              <Text style={{ fontSize: sc.fs(12), color: palette.inkFaint, paddingVertical: sc.s(10) }}>还没有可导入的软件。点「从已安装应用添加」，或先安装 Chatbox。</Text>
            ) : null}
          </View>
        </Glass>

        {/* 适配器清单 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(6) }}>
            <Ionicons name="git-branch-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>导入适配器清单</Text>
            <GlassButton label="立即拉取" icon="cloud-download-outline" size="sm" tone="muted" onPress={() => app.refreshAdapters(true)} />
          </View>
          <GlassButton label="添加清单地址" icon="add-outline" size="sm" onPress={() => setAdapterSheetOpen(true)} />
          {app.settings.adapterFeedUrls.length ? (
            <View style={{ marginTop: sc.s(9) }}>
              {app.settings.adapterFeedUrls.map((u) => (
                <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), paddingVertical: sc.s(7), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(11.5), color: palette.inkSoft }}>{u}</Text>
                  <IconButton icon="trash-outline" size={15} tone="danger" onPress={() => app.patchSettings({ adapterFeedUrls: app.settings.adapterFeedUrls.filter((x) => x !== u) })} />
                </View>
              ))}
            </View>
          ) : null}
          {app.adapterNotes.length ? (
            <View style={{ marginTop: sc.s(8) }}>
              {app.adapterNotes.map((t, i) => (
                <Text key={i} style={{ fontSize: sc.fs(10.5), color: palette.inkFaint, lineHeight: sc.fs(15) }}>· {t}</Text>
              ))}
            </View>
          ) : null}
        </Glass>

        {/* 预警阈值 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(6) }}>
            <Ionicons name="alert-circle-outline" size={sc.s(18)} color={palette.danger} />
            <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>可用池预警阈值</Text>
          </View>
          <Text style={{ fontSize: sc.fs(12.5), fontWeight: '700', color: palette.inkSoft, marginBottom: sc.s(7) }}>剩余 token 阈值</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(7), marginBottom: sc.s(10) }}>
            {TOKEN_PRESETS.map((t) => (
              <PressableChip key={t} label={compactNumber(t)} active={app.settings.lowTokenThreshold === t} onPress={() => app.patchSettings({ lowTokenThreshold: t })} />
            ))}
          </View>
          <Text style={{ fontSize: sc.fs(12.5), fontWeight: '700', color: palette.inkSoft, marginBottom: sc.s(7) }}>剩余金额阈值（美元）</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(7) }}>
            {USD_PRESETS.map((u) => (
              <PressableChip key={u} label={`$${u}`} active={app.settings.lowUsdThreshold === u} onPress={() => app.patchSettings({ lowUsdThreshold: u })} />
            ))}
          </View>
          <View style={{ marginTop: sc.s(12) }}>
            <SwitchRow title="打开 App 时自动体检" desc="每次进入只跑一遍轻量检查，10 分钟内不重复" value={app.settings.autoHealthCheck} onValueChange={(v) => app.patchSettings({ autoHealthCheck: v })} />
          </View>
        </Glass>

        {/* 情报源 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(6) }}>
            <Ionicons name="radio-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>雷达站情报源</Text>
            <GlassButton label="立即抓取" icon="download-outline" size="sm" tone="muted" loading={app.radarBusy} onPress={() => app.refreshRadar(true)} />
          </View>
          <GlassButton label="添加情报源" icon="add-outline" size="sm" onPress={() => setFeedOpen(true)} />
          {app.settings.feedUrls.length ? (
            <View style={{ marginTop: sc.s(9) }}>
              {app.settings.feedUrls.map((u) => (
                <View key={u} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), paddingVertical: sc.s(7), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(11.5), color: palette.inkSoft }}>{u}</Text>
                  <IconButton icon="trash-outline" size={15} tone="danger" onPress={() => app.patchSettings({ feedUrls: app.settings.feedUrls.filter((x) => x !== u) })} />
                </View>
              ))}
            </View>
          ) : null}
        </Glass>

        {/* 数据与隐私 */}
        <Collapsible title="数据与隐私" right={<Ionicons name="lock-closed-outline" size={sc.s(17)} color={palette.ok} />}>
          <View style={{ paddingTop: sc.s(10) }}>
            <KeyValue k="账号体系" v="无。免注册免登录，打开即用" />
            <KeyValue k="云端（公开）" v="providers / benefits / relays / clients 情报与适配器清单，匿名可读" />
            <KeyValue k="本机 SQLite" v="中转站档案、API 掩码、签到日志、适配器、设置" />
            <KeyValue k="本机加密区" v="真实 API Key、系统访问令牌（SecureStore）" />
            <KeyValue k="上传行为" v="无。App 不向任何服务器发送你的密钥或签到记录" />
            <KeyValue k="应用列表权限" v="仅用于「从已安装应用添加」，结果只在本机比对适配器登记表" />
          </View>
        </Collapsible>

        <Collapsible title="能力边界（如实标注）" right={<Ionicons name="information-circle-outline" size={sc.s(17)} color={palette.warn} />}>
          <View style={{ paddingTop: sc.s(10) }}>
            <Notice tone="warn" title="自动签到">只对开启了签到接口、且未强制人机验证的站点有效；其余标「只能手动」，日志记 manual_only，绝不伪造成功。</Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="自动建档">只适配 New API / One API 架构面板；其它架构标「不支持」并给手动入口。</Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="全自动导入">只有具备官方导入协议的软件才会出现在可导入列表（当前：Chatbox、LobeChat，以及远程清单补充的）。不接受第三方密钥的官方 App 物理上无法导入，App 不会假装能做到。</Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="安装检测">{isWhitelistCapableShell() ? '当前运行环境可以扩展原生壳白名单，检测结果可信。' : '当前运行环境无法扩展原生壳白名单，检测结果一律标「无法确认」，不会谎报未安装。'}</Notice>
          </View>
        </Collapsible>

        <Glass style={{ marginTop: sc.s(4) }} pad={sc.s(14)}>
          <Text style={{ fontSize: sc.fs(14), fontWeight: '800', color: palette.ink }}>关于「剪纸仙灵」</Text>
          <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(11.5), color: palette.inkSoft, lineHeight: sc.fs(18) }}>
            版本 {Application.nativeApplicationVersion ?? '1.0.0'}（build {Application.nativeBuildVersion ?? '1'}）· 免费开源 · 仅手机客户端{'\n'}
            配色固定为水晶白，不提供换肤。界面按屏幕宽度等比缩放，大屏小屏都能正常用。
          </Text>
        </Glass>
      </ScrollView>

      {/* 从已安装应用添加 */}
      <Sheet visible={installedOpen} onClose={() => setInstalledOpen(false)} title="从已安装应用添加">
        <Field label="搜索要添加的软件" value={q} onChangeText={setQ} placeholder="输入名称或包名，如 chatbox / tavern" autoCapitalize="none" />
        {q.trim() && installedBusy ? <Busy label="正在读取应用列表…" /> : null}
        {q.trim() && !installedBusy && !appListAvailable() ? (
          <Notice tone="warn" title="当前环境读不到已安装应用">读取应用列表需要原生模块；登记表搜索仍可用。</Notice>
        ) : null}
        {matches.seeds.map((s) => (
          <Glass key={s.id} onPress={() => addSeed(s)} style={{ marginBottom: sc.s(8) }} pad={sc.s(11)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
              <View style={{ width: sc.s(32), height: sc.s(32), borderRadius: sc.s(10), backgroundColor: canAutoImport(s) ? palette.okSoft : 'rgba(122,144,178,0.13)', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={canAutoImport(s) ? 'flash' : 'layers-outline'} size={sc.s(16)} color={canAutoImport(s) ? palette.ok : palette.inkFaint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{s.name}</Text>
                <Text numberOfLines={1} style={{ fontSize: sc.fs(10), color: palette.inkFaint }}>登记表 · 自动识别导入方式</Text>
              </View>
              <Chip label={canAutoImport(s) ? '可全自动导入' : '悬浮窗兜底'} tone={canAutoImport(s) ? 'ok' : 'muted'} />
            </View>
          </Glass>
        ))}
        {matches.apps.map((a) => {
          const matched = identify(a.packageName);
          const ok = !!matched && canAutoImport(matched);
          return (
            <Glass key={a.packageName} onPress={() => addInstalled(a)} style={{ marginBottom: sc.s(8) }} pad={sc.s(11)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
                <View style={{ width: sc.s(32), height: sc.s(32), borderRadius: sc.s(10), backgroundColor: ok ? palette.okSoft : 'rgba(122,144,178,0.13)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={ok ? 'flash' : 'help-circle-outline'} size={sc.s(16)} color={ok ? palette.ok : palette.inkFaint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{a.label}</Text>
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(10), color: palette.inkFaint }}>{a.packageName}</Text>
                </View>
                <Chip label={ok ? '可全自动导入' : '悬浮窗兜底'} tone={ok ? 'ok' : 'muted'} />
              </View>
            </Glass>
          );
        })}
        {q.trim() && !installedBusy && matches.apps.length === 0 && matches.seeds.length === 0 ? (
          <Notice tone="warn">没搜到匹配的软件。换个关键词，或在「导入适配器清单」里补它的协议。</Notice>
        ) : null}      </Sheet>

      {/* 适配器清单地址 */}
      <Sheet visible={adapterSheetOpen} onClose={() => setAdapterSheetOpen(false)} title="添加适配器清单" footer={<GlassButton label="添加并拉取" icon="cloud-download-outline" size="lg" onPress={submitAdapterFeed} />}>
        <Field label="清单 JSON 地址" value={feedUrl} onChangeText={setFeedUrl} placeholder="https://raw.githubusercontent.com/你的仓库/main/adapters/clients.json" keyboardType="url" autoCapitalize="none" hint="清单格式见 README「适配器清单」。" />
      </Sheet>

      {/* 情报源地址 */}
      <Sheet visible={feedOpen} onClose={() => setFeedOpen(false)} title="添加情报源" footer={<GlassButton label="添加" icon="add" size="lg" onPress={submitFeed} />}>
        <Field label="情报 JSON 地址" value={feedUrl} onChangeText={setFeedUrl} placeholder="https://example.com/benefits.json" keyboardType="url" autoCapitalize="none" />
      </Sheet>

      {/* base 地址编辑 */}
      <Sheet
        visible={!!baseEdit}
        onClose={() => setBaseEdit(null)}
        title="修改 base 地址"
        footer={
          <GlassButton
            label="保存"
            icon="save-outline"
            size="lg"
            onPress={async () => {
              if (!baseEdit) return;
              const target = app.clients.find((x) => x.id === baseEdit.id);
              if (target) await app.updateClient({ ...target, settingsBase: baseEdit.value.trim() || target.settingsBase });
              setBaseEdit(null);
            }}
          />
        }
      >
        <Field label="base 地址" value={baseEdit?.value || ''} onChangeText={(t) => setBaseEdit((b) => (b ? { ...b, value: t } : b))} placeholder="https://your-lobechat.example.com" keyboardType="url" autoCapitalize="none" />
      </Sheet>
    </ScreenShell>
  );
}

function PressableChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const sc = useScale();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: sc.s(13),
        paddingVertical: sc.s(8),
        borderRadius: 999,
        backgroundColor: active ? palette.accentSoft : 'rgba(255,255,255,0.7)',
        borderWidth: 1,
        borderColor: active ? palette.accent : palette.hairline,
      }}
    >
      <Text style={{ fontSize: sc.fs(12.5), fontWeight: '800', color: active ? palette.accent : palette.inkSoft }}>{label}</Text>
    </Pressable>
  );
}