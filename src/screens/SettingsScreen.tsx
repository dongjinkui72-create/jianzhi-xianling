import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Busy, Chip, Collapsible, Field, GlassButton, IconButton, KeyValue, Notice, Sheet, SwitchRow } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber } from '../lib/format';
import { palette, type ThemeName } from '../theme/tokens';
import { useThemeName } from '../theme/ThemeProvider';
import { useScale } from '../theme/useScale';
import { canAutoImport } from '../services/launcher';
import { CLIENT_LABEL_HINTS, isWhitelistCapableShell } from '../services/detectApps';
import { appListAvailable, listInstalledApps, type InstalledApp } from '../native/installedApps';
import { canOverlay, requestOverlay } from '../native/overlay';
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
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const theme = useThemeName();

  /** 只保留可导入的适配器 */
  // 只显示「本机实际识别到」的聊天软件；Chatbox / LobeChat 等固定条目不再常驻
  const installedClients = app.clients.filter(
    (c) => c.detected === 'installed' && c.importKind !== 'launch_only' && !c.browserBased,
  );
  const importable = installedClients.filter((c) => canAutoImport(c));
  const overlayApps = installedClients.filter((c) => !canAutoImport(c));
  const preferred = installedClients.find((c) => c.id === app.settings.preferredClientId) ?? null;

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
    if (!key) return [] as InstalledApp[];
    return installed.filter(
      (a) => a.label.toLowerCase().includes(key) || a.packageName.toLowerCase().includes(key),
    );
  }, [q, installed]);

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
    // 1) 有官方一键导入协议：直接添加
    if (matched && canAutoImport(matched)) {
      await app.addCustomClient({
        name: a.label,
        scheme: matched.scheme ?? '',
        importKind: matched.importKind,
        importTemplate: matched.importTemplate,
        settingsTemplate: matched.settingsTemplate,
        settingsBase: matched.settingsBase,
        launchTemplate: matched.launchTemplate,
        browserBased: matched.browserBased,
        androidPackage: a.packageName,
      });
      setInstalledOpen(false);
      setNote(`已添加「${a.label}」，导入方式由 App 自动识别为：${matched.importKind === 'deeplink_import' ? 'deep link 直写' : 'URL 参数写入'}。`);
      await app.rescanClients();
      return;
    }
    // 2) 已登记但没有自动导入协议（如 TauriTavern / 酒馆）：回填包名，启动时先拉起 App，再用悬浮窗送达
    if (matched && matched.importKind === 'unconfirmed') {
      const cur = app.clients.find((c) => c.id === matched.id);
      if (cur) {
        await app.updateClient({ ...cur, androidPackage: a.packageName, detected: 'installed', detectReason: '从本机已安装应用列表添加' });
      } else {
        await app.addCustomClient({
          name: a.label,
          scheme: matched.scheme ?? '',
          importKind: 'unconfirmed',
          androidPackage: a.packageName,
        });
      }
      setInstalledOpen(false);
      setNote(`已添加「${a.label}」：启动时先打开它，再用悬浮窗把地址和密钥送达。`);
      await app.rescanClients();
      return;
    }
    // 3) 未登记，但名称像开源 AI 聊天 / 酒馆 / 角色聊天软件：自动建档为悬浮窗送达
    const hay = `${a.label} ${a.packageName}`.toLowerCase();
    if (CLIENT_LABEL_HINTS.some((h) => hay.includes(h))) {
      await app.addCustomClient({
        name: a.label,
        scheme: '',
        importKind: 'unconfirmed',
        androidPackage: a.packageName,
      });
      setInstalledOpen(false);
      setNote(`已识别「${a.label}」为可导入的 AI 聊天软件：启动时先打开它，再用悬浮窗送达地址与密钥。`);
      await app.rescanClients();
      return;
    }
    // 4) 大厂官方 App 等确实不接受第三方密钥的软件，如实说明
    setInstalledOpen(false);
    setNote(
      matched && matched.importKind === 'launch_only'
        ? `「${a.label}」不接受第三方 API 密钥，导入密钥在它身上不存在，因此不加入导入列表。`
        : `没有在「${a.label}」里识别到可导入 API 的入口，已按红线如实说明，不加入列表。`,
    );
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
            {c.source === 'feed' ? <Chip label="远程清单" tone="accent" /> : null}
          </View>

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
          </View>

          <KeyValue k="当前默认" v={preferred ? preferred.name : '未配置（启动按钮保持灰色）'} />

          <View style={{ marginTop: sc.s(6) }}>
            {importable.map((c) => (
              <ClientRow key={c.id} c={c} />
            ))}
            {overlayApps.length ? (
              <View style={{ marginTop: sc.s(10) }}>
                <Text style={{ fontSize: sc.fs(12.5), fontWeight: '800', color: palette.inkSoft, marginBottom: sc.s(4) }}>已识别 · 悬浮窗送达</Text>
                {overlayApps.map((c) => (
                  <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(8), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                    <View style={{ width: sc.s(30), height: sc.s(30), borderRadius: sc.s(9), backgroundColor: palette.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name="layers-outline" size={sc.s(15)} color={palette.warn} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontSize: sc.fs(13), fontWeight: '700', color: palette.ink }}>{c.name}</Text>
                      <Text numberOfLines={1} style={{ fontSize: sc.fs(10), color: palette.inkFaint }}>{c.androidPackage}</Text>
                    </View>
                    <Chip label="悬浮窗送达" tone="warn" />
                    <GlassButton
                      label={app.settings.preferredClientId === c.id ? '取消' : '设为默认'}
                      size="sm"
                      tone={app.settings.preferredClientId === c.id ? 'muted' : 'accent'}
                      onPress={async () => {
                        if (app.settings.preferredClientId === c.id) {
                          await app.patchSettings({ preferredClientId: null });
                          return;
                        }
                        await app.patchSettings({ preferredClientId: c.id });
                        if (!(await canOverlay())) {
                          setNote('已设为默认。该软件不能自动导入，请授权「显示在其他应用上层」，启动时会用悬浮窗送达密钥。');
                          await requestOverlay();
                        } else {
                          setNote(`已把「${c.name}」设为默认启动软件。`);
                        }
                      }}
                    />
                    {c.source === 'auto' ? <IconButton icon="trash-outline" size={15} tone="danger" onPress={() => app.removeCustomClient(c.id)} /> : null}
                  </View>
                ))}
              </View>
            ) : null}
            {installedClients.length === 0 ? (
              <Text style={{ fontSize: sc.fs(12), color: palette.inkFaint, paddingVertical: sc.s(10) }}>本机还没有识别到可导入的 AI 聊天软件，点「从已安装应用添加」搜索。</Text>
            ) : null}
          </View>
        </Glass>

        {/* 外观：仅两个主题，iOS 同款玻璃质感 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(10) }}>
            <Ionicons name="color-palette-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>外观</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: sc.s(10) }}>
            {(['crystal', 'dark'] as ThemeName[]).map((t) => {
              const active = theme === t;
              const dark = t === 'dark';
              return (
                <Pressable
                  key={t}
                  onPress={() => app.patchSettings({ theme: t })}
                  style={{
                    flex: 1,
                    borderRadius: sc.s(18),
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? palette.accent : palette.hairline,
                    overflow: 'hidden',
                    backgroundColor: dark ? '#0B1220' : '#F4F8FE',
                  }}
                >
                  <View style={{ height: sc.s(66), alignItems: 'center', justifyContent: 'center', gap: sc.s(6), backgroundColor: dark ? '#0B1220' : '#EDF3FB' }}>
                    <View style={{ width: sc.s(52), height: sc.s(20), borderRadius: sc.s(8), backgroundColor: dark ? 'rgba(77,154,255,0.22)' : 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(122,144,178,0.28)' }} />
                    <View style={{ width: sc.s(52), height: sc.s(20), borderRadius: sc.s(8), backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.66)', borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(122,144,178,0.22)' }} />
                  </View>
                  <View style={{ padding: sc.s(10), flexDirection: 'row', alignItems: 'center', gap: sc.s(6) }}>
                    <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={sc.s(15)} color={active ? palette.accent : palette.inkFaint} />
                    <Text style={{ fontSize: sc.fs(13), fontWeight: '800', color: dark ? '#EAF2FF' : palette.ink }}>
                      {dark ? '黑夜玻璃' : '水晶白玻璃'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
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
        <Field label="搜索要添加的软件" value={q} onChangeText={setQ} autoFocus placeholder="输入名称或包名，如 chatbox / tavern" autoCapitalize="none" />
        {q.trim() && installedBusy ? <Busy label="正在读取应用列表…" /> : null}
        {q.trim() && !installedBusy && !appListAvailable() ? (
          <Notice tone="warn" title="当前环境读不到已安装应用">读取应用列表需要原生模块；登记表搜索仍可用。</Notice>
        ) : null}
        {matches.map((a) => {
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
        {q.trim() && !installedBusy && matches.length === 0 ? (
          <Notice tone="warn">没搜到匹配的软件。换个名称或包名关键词再试一次。</Notice>
        ) : null}      </Sheet>


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