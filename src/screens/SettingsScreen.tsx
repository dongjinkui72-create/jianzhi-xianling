import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import { Chip, Collapsible, Field, GlassButton, IconButton, KeyValue, Notice, Sheet, SwitchRow } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber } from '../lib/format';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { canAutoImport } from '../services/launcher';
import { isWhitelistCapableShell } from '../services/detectApps';
import { useApp } from '../store/AppStore';
import type { ChatClient } from '../lib/types';

/**
 * 设置（入口固定在主界面右上角）。
 * 可以在这里主动导入 AI 聊天软件、调预警阈值、管理情报源、查看隐私说明。
 */

const TOKEN_PRESETS = [50000, 200000, 1000000, 5000000];
const USD_PRESETS = [0.1, 0.5, 2, 10];

export function SettingsScreen({ navigation }: any) {
  const sc = useScale();
  const app = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cScheme, setCScheme] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cKind, setCKind] = useState<ChatClient['importKind']>('unconfirmed');
  const [cTemplate, setCTemplate] = useState('');
  const [cBase, setCBase] = useState('');
  const [cBrowser, setCBrowser] = useState(false);
  const [adapterSheetOpen, setAdapterSheetOpen] = useState(false);
  const [adapterUrl, setAdapterUrl] = useState('');
  const [baseEdit, setBaseEdit] = useState<{ id: string; value: string } | null>(null);

  const installed = app.clients.filter((c) => c.detected === 'installed');
  const unknown = app.clients.filter((c) => c.detected === 'unknown' && (c.platform === 'all' || c.platform === Platform.OS));
  const preferred = app.clients.find((c) => c.id === app.settings.preferredClientId) ?? null;

  const rescan = async () => {
    setScanning(true);
    try {
      await app.rescanClients();
      setNote('已重新扫描本机 AI 聊天软件');
    } finally {
      setScanning(false);
    }
  };

  const submitClient = async () => {
    if (!cName.trim()) {
      setNote('请填写软件名称');
      return;
    }
    await app.addCustomClient({
      name: cName,
      scheme: cScheme,
      importKind: cKind,
      importTemplate: cKind === 'deeplink_import' ? cTemplate || 'chatbox://app/import-config?type={type}&data={data}' : undefined,
      settingsTemplate: cKind === 'url_settings_import' ? cTemplate || '{base}/?settings={json}' : undefined,
      settingsBase: cKind === 'url_settings_import' ? cBase || 'https://chat.lobehub.com' : undefined,
      launchTemplate: cKind === 'launch_only' && cTemplate ? cTemplate : undefined,
      browserBased: cBrowser,
    });
    setAddOpen(false);
    setCName('');
    setCScheme('');
    setCKind('unconfirmed');
    setCTemplate('');
    setCBase('');
    setCBrowser(false);
    setNote('已添加。自定义条目默认标「安装状态无法确认」，这是如实标注。');
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
    setFeedOpen(false);
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
    const auto = canAutoImport(c);
    const isPref = app.settings.preferredClientId === c.id;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(9), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
        <View style={{ width: sc.s(34), height: sc.s(34), borderRadius: sc.s(11), backgroundColor: auto ? palette.okSoft : 'rgba(122,144,178,0.13)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={auto ? 'flash' : 'chatbubble-ellipses-outline'} size={sc.s(17)} color={auto ? palette.ok : palette.inkSoft} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{c.name}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(4) }}>
            <Chip
              label={
                c.importKind === 'deeplink_import'
                  ? '可全自动导入（deep link）'
                  : c.importKind === 'url_settings_import'
                    ? '可全自动导入（URL 参数）'
                    : c.importKind === 'launch_only'
                      ? '仅能打开'
                      : '导入无法确认'
              }
              tone={auto ? 'ok' : c.importKind === 'launch_only' ? 'warn' : 'muted'}
            />
            {c.source === 'feed' ? <Chip label='远程清单' tone='accent' /> : c.source === 'custom' ? <Chip label='自建' tone='muted' /> : null}
            <Chip
              label={c.detected === 'installed' ? '已识别' : c.detected === 'unknown' ? '无法确认' : '未安装'}
              tone={c.detected === 'installed' ? 'accent' : 'muted'}
            />
            {isPref ? <Chip label="默认启动" tone="ok" icon="star" /> : null}
          </View>
          {c.detectReason ? <Text style={{ marginTop: sc.s(3), fontSize: sc.fs(10), color: palette.inkFaint, lineHeight: sc.fs(14) }}>{c.detectReason}</Text> : null}
          {c.note ? <Text style={{ marginTop: sc.s(3), fontSize: sc.fs(10), color: palette.warn, lineHeight: sc.fs(14) }}>{c.note}</Text> : null}
          {c.importKind === 'url_settings_import' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(6), marginTop: sc.s(5) }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(10.5), color: palette.inkSoft }}>{c.settingsBase || '未设置 base 地址'}</Text>
              <GlassButton label='改地址' size='sm' tone='muted' onPress={() => setBaseEdit({ id: c.id, value: c.settingsBase || '' })} />
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
      <Header
        title="设置"
        subtitle="所有配置都只存在这台手机上"
        right={<IconButton icon="close" onPress={() => navigation.goBack()} tone="muted" />}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(40) }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {note ? (
          <View style={{ marginBottom: sc.s(12) }}>
            <Notice tone="ok">{note}</Notice>
          </View>
        ) : null}

        {/* AI 聊天软件 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(4) }}>
            <Ionicons name="apps-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ flex: 1, marginLeft: sc.s(8), fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>AI 聊天软件</Text>
            <GlassButton label={scanning ? '扫描中' : '重新扫描'} icon="refresh-outline" size="sm" tone="muted" loading={scanning} onPress={rescan} />
          </View>
          <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint, lineHeight: sc.fs(17), marginBottom: sc.s(9) }}>
            App 打开时会自动扫描本机已安装的 AI 聊天软件，并把它们的打开方式接到启动按钮上。已识别 {installed.length} 个，无法确认 {unknown.length} 个。
          </Text>

          {app.scanNote ? (
            <View style={{ marginBottom: sc.s(10) }}>
              <Notice tone="warn" title="扫描能力受限（如实标注）">
                {app.scanNote}
              </Notice>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: sc.s(8), marginBottom: sc.s(6), flexWrap: 'wrap' }}>
            <GlassButton label="手动添加软件" icon="add-circle-outline" size="sm" onPress={() => setAddOpen(true)} />
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
            {app.clients.map((c) => (
              <ClientRow key={c.id} c={c} />
            ))}
          </View>
        </Glass>

        {/* 适配器清单 */}
        <Glass style={{ marginBottom: sc.s(13) }} pad={sc.s(14)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(6) }}>
            <Ionicons name="git-branch-outline" size={sc.s(18)} color={palette.accent} />
            <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>导入适配器清单</Text>
            <GlassButton label="立即拉取" icon="cloud-download-outline" size="sm" tone="muted" onPress={() => app.refreshAdapters(true)} />
          </View>
          <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint, lineHeight: sc.fs(17), marginBottom: sc.s(9) }}>
            「能不能自动导入」被做成了数据而不是写死的代码。加一个清单地址，GitHub 上新出的开源聊天软件就能在不更新 App 的情况下被支持。清单是公开 JSON，不含任何私有数据。
          </Text>
          <View style={{ flexDirection: 'row', gap: sc.s(8), flexWrap: 'wrap' }}>
            <GlassButton label="添加清单地址" icon="add-outline" size="sm" onPress={() => setAdapterSheetOpen(true)} />
          </View>
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
            <View style={{ marginTop: sc.s(9) }}>
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
          <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint, lineHeight: sc.fs(17), marginBottom: sc.s(11) }}>
            低于阈值的 Key 会被静默标红并移入预警区，App 不会弹提示、也不会建议你删除它。
          </Text>

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
          <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint, lineHeight: sc.fs(17), marginBottom: sc.s(9) }}>
            默认会直接抓取内置的官方定价页与中转站首页（关键词 api）。你也可以追加自己的公开情报 JSON。
          </Text>
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
          <View style={{ marginTop: sc.s(10) }}>
            <Notice tone="muted" title="远程情报 JSON 的格式">
              {'{ "benefits": [ { "id":"x", "section":"official|relay", "provider":"厂商", "title":"标题", "summary":"说明", "quotaText":"赠送 $5", "url":"https://...", "steps":["第一步","第二步"] } ] }'}
            </Notice>
          </View>
        </Glass>

        {/* 数据与隐私 */}
        <Collapsible title="数据与隐私" subtitle="云端只放公开情报，私有数据一律留在本机" right={<Ionicons name="lock-closed-outline" size={sc.s(17)} color={palette.ok} />}>
          <View style={{ paddingTop: sc.s(10) }}>
            <KeyValue k="账号体系" v="无。免注册免登录，打开即用" />
            <KeyValue k="云端（公开）" v="providers / benefits / relays / clients 情报，匿名可读，不含任何私有信息" />
            <KeyValue k="本机 SQLite" v="中转站档案、API 掩码、签到日志、自建软件、设置" />
            <KeyValue k="本机加密区" v="真实 API Key、系统访问令牌（SecureStore，Keychain / Keystore 保护）" />
            <KeyValue k="上传行为" v="无。App 不向任何服务器发送你的密钥或签到记录" />
            <KeyValue k="启动导入方式" v="通过目标 App 官方 deep link 直写配置，不经过剪贴板" />
            <View style={{ marginTop: sc.s(9) }}>
              <Notice tone="ok">
                数据库里保存的 API Key 一律是掩码（如 sk-abc****wxyz）。删除一条记录时，对应的加密区条目会一起清掉。
              </Notice>
            </View>
          </View>
        </Collapsible>

        <Collapsible title="能力边界（如实标注）" subtitle="哪些做不到，App 会明说" right={<Ionicons name="information-circle-outline" size={sc.s(17)} color={palette.warn} />}>
          <View style={{ paddingTop: sc.s(10) }}>
            <Notice tone="warn" title="自动签到">
              只对开启了签到接口、且未强制人机验证的站点有效。其余站点会标「只能手动」，日志记为 manual_only，绝不伪造成功。
            </Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="自动建档">
              只适配 New API / One API 架构的面板。架构不同的站点会标「不支持自动建档」并给出手动粘贴入口。
            </Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="安装检测">
              {isWhitelistCapableShell()
                ? '当前运行环境可以扩展原生壳白名单，检测结果可信。'
                : '当前运行环境（Expo Go）无法扩展原生壳的 Scheme / 包名白名单，检测结果一律标「无法确认」，不会谎报未安装。'}
            </Notice>
            <View style={{ height: sc.s(8) }} />
            <Notice tone="warn" title="自动导入">
              目前只有 Chatbox 公开了「导入第三方提供方配置」的 deep link，能做到零复制粘贴。其它软件只能拉起，App 会明说。
            </Notice>
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

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="手动添加 AI 聊天软件" footer={<GlassButton label="添加" icon="add" size="lg" onPress={submitClient} />}>
        <Field label="软件名称" value={cName} onChangeText={setCName} placeholder="例如：Chatbox" autoCapitalize="words" />
        <Field label="URL Scheme" value={cScheme} onChangeText={setCScheme} placeholder="例如：chatbox" autoCapitalize="none" hint="填 App 的自定义协议名（不含 ://）。留空表示只能靠包名识别。" />
        <Text style={{ fontSize: sc.fs(12.5), color: palette.inkSoft, fontWeight: '700', marginBottom: sc.s(7) }}>导入能力</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(7), marginBottom: sc.s(10) }}>
          {(['deeplink_import', 'url_settings_import', 'launch_only', 'unconfirmed'] as ChatClient['importKind'][]).map((k) => (
            <Pressable
              key={k}
              onPress={() => setCKind(k)}
              style={{
                paddingHorizontal: sc.s(12),
                paddingVertical: sc.s(8),
                borderRadius: 999,
                backgroundColor: cKind === k ? palette.accentSoft : 'rgba(255,255,255,0.7)',
                borderWidth: 1,
                borderColor: cKind === k ? palette.accent : palette.hairline,
              }}
            >
              <Text style={{ fontSize: sc.fs(11.5), fontWeight: '800', color: cKind === k ? palette.accent : palette.inkSoft }}>
                {k === 'deeplink_import' ? 'deep link 直写' : k === 'url_settings_import' ? 'URL 参数写入' : k === 'launch_only' ? '仅能打开' : '无法确认'}
              </Text>
            </Pressable>
          ))}
        </View>
        {cKind === 'deeplink_import' || cKind === 'url_settings_import' || cKind === 'launch_only' ? (
          <Field
            label={cKind === 'launch_only' ? '拉起模板（可选）' : '导入模板'}
            value={cTemplate}
            onChangeText={setCTemplate}
            placeholder={cKind === 'deeplink_import' ? 'chatbox://app/import-config?type={type}&data={data}' : cKind === 'url_settings_import' ? '{base}/?settings={json}' : 'deepchat://start'}
            autoCapitalize="none"
            hint={cKind === 'deeplink_import' ? '占位符：{type} 协议类型、{data} base64 配置' : cKind === 'url_settings_import' ? '占位符：{base} 站点地址、{json} URL 编码后的配置' : '占位符：{scheme}'}
          />
        ) : null}
        {cKind === 'url_settings_import' ? <Field label="站点 base 地址" value={cBase} onChangeText={setCBase} placeholder="https://chat.lobehub.com" keyboardType="url" autoCapitalize="none" /> : null}
        <SwitchRow title="它是网页版 / PWA（走浏览器，无需安装检测）" value={cBrowser} onValueChange={setCBrowser} />
        <Notice tone="muted">
          自定义添加的软件默认标「安装状态无法确认」。原生壳的白名单是在构建期写死的，新加的 Scheme 需要重新构建（npx expo run:android）才能被真实检测到。
        </Notice>
      </Sheet>

      <Sheet visible={feedOpen} onClose={() => setFeedOpen(false)} title="添加情报源" footer={<GlassButton label="添加" icon="add" size="lg" onPress={submitFeed} />}>
        <Field label="情报 JSON 地址" value={feedUrl} onChangeText={setFeedUrl} placeholder="https://example.com/benefits.json" keyboardType="url" autoCapitalize="none" />
      </Sheet>
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
        <Field label="base 地址" value={baseEdit?.value || ''} onChangeText={(t) => setBaseEdit((b) => (b ? { ...b, value: t } : b))} placeholder="https://your-lobechat.example.com" keyboardType="url" autoCapitalize="none" hint="URL 参数写入会拼在这个地址后面，自建 LobeChat 填自己的域名。" />
      </Sheet>
      <Sheet visible={adapterSheetOpen} onClose={() => setAdapterSheetOpen(false)} title="添加适配器清单" footer={<GlassButton label="添加并拉取" icon="cloud-download-outline" size="lg" onPress={submitAdapterFeed} />}>
        <Field label="清单 JSON 地址" value={feedUrl} onChangeText={setFeedUrl} placeholder="https://raw.githubusercontent.com/你的仓库/main/adapters/clients.json" keyboardType="url" autoCapitalize="none" hint="清单格式见 README「适配器清单」。把仓库传到 GitHub 后，把 raw 地址填进来即可。" />
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
