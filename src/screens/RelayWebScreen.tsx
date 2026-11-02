import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Field, GlassButton, IconButton, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { normalizeUrl, siteKeyOf } from '../lib/normalize';
import { palette, radius } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { useApp } from '../store/AppStore';
import { RelayBridge } from '../services/relayBridge';
import { fetchSelf, joinApiBase, probeSite, type SiteInfo } from '../services/relayApi';
import type { Relay } from '../lib/types';

/**
 * 中转站内嵌浏览器登录页 —— 核心功能①的入口。
 *
 * 流程（全自动，用户不需要复制粘贴任何东西）：
 *  1. 用户在这个 WebView 里正常登录中转站
 *  2. 页面加载完成后，App 通过页面内 fetch 桥接自动读取登录态
 *  3. 自动创建「系统访问令牌」并写入本机加密区（之后签到/查余额无需再开网页）
 *  4. 自动创建 API Key，取回完整密钥，连同调用地址一起落库
 *  5. 任一步做不到 -> UI 如实说明原因，并给出手动粘贴入口
 */

type Phase = 'idle' | 'probing' | 'waiting_login' | 'provisioning' | 'done' | 'failed';

export function RelayWebScreen({ route, navigation }: any) {
  const sc = useScale();
  const insets = useSafeAreaInsets();
  const app = useApp();

  const initialUrl = normalizeUrl(route?.params?.url || 'https://');
  const relayId: string | undefined = route?.params?.relayId;

  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pkLabel, setPkLabel] = useState('');
  const [pkKey, setPkKey] = useState('');
  const [pkBase, setPkBase] = useState(joinApiBase(initialUrl));
  const [resultKey, setResultKey] = useState<{ label: string; masked: string; base: string } | null>(null);

  const webRef = useRef<any>(null);
  const bridge = useRef(new RelayBridge()).current;
  const autoRan = useRef(false);
  const relayRef = useRef<Relay | null>(null);

  useEffect(() => {
    bridge.attach(webRef);
    return () => bridge.detach();
  }, [bridge]);

  /** 找到（或创建）本地站点档案 */
  const ensureRelay = useCallback(async (): Promise<Relay> => {
    if (relayRef.current) return relayRef.current;
    const all = app.relays;
    let r = relayId ? all.find((x) => x.id === relayId) ?? null : null;
    if (!r) r = all.find((x) => siteKeyOf(x.baseUrl) === siteKeyOf(url)) ?? null;
    if (!r) r = await app.addRelayByUrl(route?.params?.name || siteKeyOf(url), url);
    relayRef.current = r;
    return r;
  }, [app, relayId, url, route?.params?.name]);

  const pushTrace = (line: string) => setTrace((t) => [...t.slice(-24), line]);

  /** 自动建档主流程 */
  const runAuto = useCallback(
    async (manual = false) => {
      const relay = await ensureRelay();
      if (!bridge.ready) {
        pushTrace('WebView 还没停在站点页面内，桥接不可用');
        if (manual) setPhase('failed');
        return;
      }
      setPhase('probing');
      pushTrace('正在探测站点架构…');
      const info = await probeSite(bridge);
      setSiteInfo(info);
      pushTrace(info.detail);

      pushTrace('正在读取登录态…');
      const selfRes = await fetchSelf(bridge);
      if (!selfRes.ok || !selfRes.self) {
        setPhase('waiting_login');
        setAccount(null);
        pushTrace(`未登录或登录态不可用：${selfRes.reason}`);
        if (manual) setPhase('failed');
        return;
      }
      const self = selfRes.self;
      setAccount(`${self.username || '未知用户'}（ID ${self.id}）`);
      pushTrace(`已登录：${self.username || ''} ID=${self.id}`);

      setPhase('provisioning');
      pushTrace('尝试保存长期访问令牌（之后可免网页签到）…');
      const atRes = await app.persistAccessToken(relay, bridge);
      pushTrace(atRes.message);

      pushTrace('开始自动创建 API Key…');
      const prov = await app.provisionRelay(relay, bridge);
      for (const line of prov.message.split('\n')) if (line.trim()) pushTrace(line);

      if (prov.ok && prov.key) {
        setResultKey({ label: prov.key.label, masked: prov.key.maskedKey, base: prov.key.baseUrl });
        setPkBase(prov.key.baseUrl);
        setPhase('done');
        pushTrace(`自动建档成功：${prov.key.maskedKey} -> ${prov.key.baseUrl}`);
        autoRan.current = true;
        return;
      }

      autoRan.current = true;
      setPhase('failed');
      pushTrace(`自动建档未完成：${prov.message}`);
    },
    [app, bridge, ensureRelay],
  );

  /** 页面加载结束后自动尝试一次；未登录则静默等待 */
  const onLoadEnd = useCallback(() => {
    setLoading(false);
    if (autoRan.current) return;
    setTimeout(() => {
      runAuto(false).catch(() => {});
    }, 900);
  }, [runAuto]);

  const go = () => {
    autoRan.current = false;
    setTrace([]);
    setResultKey(null);
    setPhase('idle');
    const next = normalizeUrl(inputUrl);
    setUrl(next);
    setPkBase(joinApiBase(next));
    setLoading(true);
  };

  const phaseMeta = useMemo(() => {
    switch (phase) {
      case 'probing':
        return { tone: 'accent' as const, text: '正在探测站点与登录态…' };
      case 'waiting_login':
        return { tone: 'warn' as const, text: '还没检测到登录态，请在下方页面里正常登录' };
      case 'provisioning':
        return { tone: 'accent' as const, text: '已登录，正在自动创建 API Key…' };
      case 'done':
        return { tone: 'ok' as const, text: '自动建档完成，密钥已存入本机加密区' };
      case 'failed':
        return { tone: 'danger' as const, text: '这个站点没法自动建档，下面给了手动入口' };
      default:
        return { tone: 'muted' as const, text: '打开页面后 App 会自动接管' };
    }
  }, [phase]);

  const submitPaste = async () => {
    if (!pkKey.trim() || !pkBase.trim()) return;
    const relay = await ensureRelay();
    const item = await app.addKey({
      label: pkLabel.trim() || `${relay.name} · 手动导入`,
      key: pkKey.trim(),
      baseUrl: pkBase.trim(),
      provider: relay.name,
      protocol: 'openai_compatible',
      relayId: relay.id,
      source: 'manual',
    });
    setPasteOpen(false);
    if (item) setResultKey({ label: item.label, masked: item.maskedKey, base: item.baseUrl });
    setPhase('done');
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.bgTop }}>
      {/* 顶栏 */}
      <View style={{ paddingTop: insets.top + sc.s(6), paddingHorizontal: sc.gutter, paddingBottom: sc.s(10), backgroundColor: 'rgba(255,255,255,0.86)', borderBottomWidth: 1, borderBottomColor: palette.hairline }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
          <IconButton icon="chevron-back" onPress={() => navigation.goBack()} tone="muted" />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>{route?.params?.name || siteKeyOf(url)}</Text>
            <Text numberOfLines={1} style={{ fontSize: sc.fs(10.5), color: palette.inkFaint }}>{url}</Text>
          </View>
          <IconButton icon={loading ? 'hourglass-outline' : 'refresh'} onPress={() => webRef.current?.reload()} tone="accent" />
          <IconButton icon={panelOpen ? 'chevron-down' : 'terminal-outline'} onPress={() => setPanelOpen((o) => !o)} tone="muted" />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), marginTop: sc.s(9) }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: sc.s(38), paddingHorizontal: sc.s(11), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: palette.hairline }}>
            <Ionicons name="link-outline" size={sc.s(14)} color={palette.inkFaint} />
            <TextInputInline value={inputUrl} onChangeText={setInputUrl} onSubmit={go} />
          </View>
          <GlassButton label="前往" size="sm" onPress={go} />
        </View>
      </View>

      {/* 网页 */}
      <View style={{ flex: 1 }}>
        <WebView
          ref={webRef as any}
          source={{ uri: url }}
          onMessage={(e) => bridge.handleMessage(e.nativeEvent.data)}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={onLoadEnd}
          onError={() => setLoading(false)}
          onNavigationStateChange={(nav: any) => bridge.setOrigin(nav?.url)}
          originWhitelist={['*']}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          startInLoadingState={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: '#fff' }}
        />
        {loading ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sc.s(3), backgroundColor: palette.accentSoft, overflow: 'hidden' }}>
            <View style={{ width: '40%', height: '100%', backgroundColor: palette.accent }} />
          </View>
        ) : null}
      </View>

      {/* 自动建档控制面板 */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: sc.gutter, paddingTop: sc.s(10), paddingBottom: insets.bottom + sc.s(12), backgroundColor: 'rgba(250,252,255,0.97)', borderTopWidth: 1, borderTopColor: palette.hairline }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8) }}>
            {phase === 'probing' || phase === 'provisioning' ? <ActivityIndicator color={palette.accent} /> : <Ionicons name={phaseMeta.tone === 'ok' ? 'checkmark-circle' : phaseMeta.tone === 'danger' ? 'alert-circle' : phaseMeta.tone === 'warn' ? 'time-outline' : 'information-circle'} size={sc.s(18)} color={phaseMeta.tone === 'ok' ? palette.ok : phaseMeta.tone === 'danger' ? palette.danger : phaseMeta.tone === 'warn' ? palette.warn : palette.inkFaint} />}
            <Text style={{ flex: 1, fontSize: sc.fs(13), fontWeight: '700', color: palette.ink }}>{phaseMeta.text}</Text>
            {account ? <Chip label={account} tone="ok" /> : null}
            {siteInfo?.looksLikeNewApi ? <Chip label="New API 架构" tone="accent" /> : siteInfo ? <Chip label="非标准架构" tone="warn" /> : null}
          </View>

          {phase === 'done' && resultKey ? (
            <Glass style={{ marginTop: sc.s(10) }} pad={sc.s(12)}>
              <Text style={{ fontSize: sc.fs(12), color: palette.inkSoft }}>已保存到本机</Text>
              <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(13.5), fontWeight: '800', color: palette.ink }}>{resultKey.label}</Text>
              <Text style={{ marginTop: sc.s(3), fontSize: sc.fs(12), color: palette.inkSoft }}>{resultKey.masked}</Text>
              <Text style={{ marginTop: sc.s(2), fontSize: sc.fs(11), color: palette.inkFaint }}>{resultKey.base}</Text>
              <View style={{ flexDirection: 'row', gap: sc.s(8), marginTop: sc.s(11), flexWrap: 'wrap' }}>
                <GlassButton label="去可用池" icon="shield-checkmark-outline" size="sm" onPress={() => navigation.goBack()} />
                <GlassButton label="再建一个" icon="add-outline" size="sm" tone="muted" onPress={() => { autoRan.current = false; setPhase('idle'); setResultKey(null); runAuto(true); }} />
              </View>
            </Glass>
          ) : null}

          {phase === 'failed' ? (
            <View style={{ marginTop: sc.s(10) }}>
              <Notice tone="warn" title="这个站点没法自动建档">
                {siteInfo && !siteInfo.looksLikeNewApi
                  ? '该站点的面板不是 New API / One API 架构，App 无法代替它创建密钥。这是如实说明，不是失败重试就能解决的。请用下面的手动入口把密钥粘进来。'
                  : '登录态或权限不足，App 拿不到完整密钥。请用下面的手动入口把密钥粘进来。'}
              </Notice>
              <View style={{ marginTop: sc.s(9), flexDirection: 'row', gap: sc.s(8), flexWrap: 'wrap' }}>
                <GlassButton label="手动粘贴 Key" icon="key-outline" size="sm" onPress={() => setPasteOpen(true)} />
                <GlassButton label="重试自动建档" icon="refresh-outline" size="sm" tone="muted" onPress={() => { autoRan.current = false; runAuto(true); }} />
              </View>
            </View>
          ) : null}

          {phase === 'waiting_login' ? (
            <View style={{ marginTop: sc.s(10), flexDirection: 'row', gap: sc.s(8), flexWrap: 'wrap' }}>
              <GlassButton label="我已登录，继续自动建档" icon="flash" size="sm" onPress={() => { autoRan.current = false; runAuto(true); }} />
              <GlassButton label="手动粘贴 Key" icon="key-outline" size="sm" tone="muted" onPress={() => setPasteOpen(true)} />
            </View>
          ) : null}

          {phase === 'idle' || phase === 'probing' || phase === 'provisioning' ? (
            <View style={{ marginTop: sc.s(10), flexDirection: 'row', gap: sc.s(8), flexWrap: 'wrap' }}>
              <GlassButton label="手动触发自动建档" icon="flash-outline" size="sm" tone="muted" onPress={() => { autoRan.current = false; runAuto(true); }} />
              <GlassButton label="手动粘贴 Key" icon="key-outline" size="sm" tone="muted" onPress={() => setPasteOpen(true)} />
            </View>
          ) : null}

          {panelOpen && trace.length ? (
            <View style={{ marginTop: sc.s(10), maxHeight: sc.s(150) }}>
              <ScrollView style={{ backgroundColor: 'rgba(13,27,42,0.05)', borderRadius: radius.md, padding: sc.s(10) }} nestedScrollEnabled>
                {trace.map((t, i) => (
                  <Text key={i} style={{ fontSize: sc.fs(10.5), color: palette.inkSoft, lineHeight: sc.fs(16), fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) }}>
                    · {t}
                  </Text>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={pasteOpen} onClose={() => setPasteOpen(false)} title="手动建档 API Key" footer={<GlassButton label="保存到本机" icon="save-outline" size="lg" onPress={submitPaste} />}>
        <Notice tone="muted">只有当站点结构不支持自动建档时才需要用这个入口。密钥仅写入本机加密区。</Notice>
        <View style={{ height: sc.s(12) }} />
        <Field label="备注名" value={pkLabel} onChangeText={setPkLabel} placeholder={route?.params?.name || '站点名'} />
        <Field label="API Key" value={pkKey} onChangeText={setPkKey} placeholder="sk-..." autoCapitalize="none" />
        <Field label="调用地址" value={pkBase} onChangeText={setPkBase} placeholder="https://example.com/v1" keyboardType="url" autoCapitalize="none" hint={`已按站点地址预填：${joinApiBase(url)}`} />
      </Sheet>
    </View>
  );
}

function TextInputInline({ value, onChangeText, onSubmit }: { value: string; onChangeText: (t: string) => void; onSubmit: () => void }) {
  const sc = useScale();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={onSubmit}
      returnKeyType="go"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      selectTextOnFocus
      style={{ flex: 1, marginLeft: sc.s(7), fontSize: sc.fs(12.5), color: palette.ink, padding: 0 }}
    />
  );
}

import { TextInput as TextInputRaw } from 'react-native';
