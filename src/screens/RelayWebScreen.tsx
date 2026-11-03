import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, GlassButton, IconButton, KeyValue, Notice, Sheet } from '../components/Bits';
import { normalizeUrl, siteKeyOf } from '../lib/normalize';
import { palette, radius } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { useApp } from '../store/AppStore';
import { RelayBridge, SPY_JS } from '../services/relayBridge';
import { deriveApiCandidates, detectRelayFamily, domCheckin, fetchCheckinSupport, fetchSelf, joinApiBase, type SelfInfo } from '../services/relayApi';
import type { Relay } from '../lib/types';

/**
 * 中转站内嵌登录页（2.0 极简版）。
 * 登录后只出现两个按钮：「手动粘贴密钥」「我已登录，自动创建保存密钥和调用地址」。
 * 不展示任何执行日志。
 *
 * 关键能力：
 *  - 页面加载前注入网络探针，嗅探 SPA 真实调用的 API 根地址（公益站/路由站常常不在默认 /api 下）；
 *  - 逐个候选地址试读登录态，命中后用它建档；
 *  - 签到双通道：接口签到优先；接口 404 但主页有签到按钮时，自动点网页按钮完成签到；
 *  - 无论建档成败，只要读到登录态就把站点收进「每日签到」列表。
 */

interface AutoResult {
  ok: boolean;
  title: string;
  lines: { k: string; v: string }[];
  warn?: string;
}

export function RelayWebScreen({ route, navigation }: any) {
  const sc = useScale();
  const insets = useSafeAreaInsets();
  const app = useApp();

  const initialUrl = normalizeUrl(route?.params?.url || 'https://');
  const relayId: string | undefined = route?.params?.relayId;
  const autoCheckin: boolean = !!route?.params?.autoCheckin;

  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AutoResult | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pkLabel, setPkLabel] = useState('');
  const [pkKey, setPkKey] = useState('');
  const [pkBase, setPkBase] = useState(joinApiBase(initialUrl));

  const webRef = useRef<any>(null);
  const bridge = useRef(new RelayBridge()).current;
  const relayRef = useRef<Relay | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    bridge.attach(webRef);
    return () => bridge.detach();
  }, [bridge]);

  const ensureRelay = useCallback(async (): Promise<Relay> => {
    if (relayRef.current) return relayRef.current;
    const all = app.relays;
    let r = relayId ? all.find((x) => x.id === relayId) ?? null : null;
    if (!r) r = all.find((x) => siteKeyOf(x.baseUrl) === siteKeyOf(url)) ?? null;
    if (!r) r = await app.addRelayByUrl(route?.params?.name || siteKeyOf(url), url);
    relayRef.current = r;
    return r;
  }, [app, relayId, url, route?.params?.name]);

  /** 嗅探真实 API 根并读取登录态 */
  const discover = useCallback(async (): Promise<{ self: SelfInfo | null; apiBase: string | null; tried: string[] }> => {
    const hints = await bridge.eval('(window.__jzApis || [])');
    const cands = deriveApiCandidates(hints, bridge.currentOrigin);
    const tried: string[] = [];
    for (const c of cands) {
      bridge.setApiBase(c);
      tried.push(c);
      const s = await fetchSelf(bridge);
      if (s.ok && s.self) return { self: s.self, apiBase: c, tried };
    }
    bridge.setApiBase(null);
    return { self: null, apiBase: null, tried };
  }, [bridge]);

  /** 签到能力探测：接口优先，网页按钮兜底 */
  const probeCheckin = useCallback(
    async (relay: Relay) => {
      const support = await fetchCheckinSupport(bridge);
      if (support.support === 'yes') {
        const next = { ...relay, checkinSupport: 'yes' as const, checkinMode: 'api' as const, checkinSupportNote: null };
        await app.updateRelay(next);
        return { mode: 'api' as const, note: null as string | null };
      }
      const dom = await domCheckin(bridge);
      if (dom.ok) {
        const next = { ...relay, checkinSupport: 'yes' as const, checkinMode: 'dom' as const, checkinSupportNote: dom.message };
        await app.updateRelay(next);
        return { mode: 'dom' as const, note: dom.message };
      }
      const next = { ...relay, checkinSupport: support.support, checkinMode: null, checkinSupportNote: dom.message || support.reason };
      await app.updateRelay(next);
      return { mode: null, note: dom.message || support.reason };
    },
    [app, bridge],
  );

  /** 按钮 2 / 自动签到入口 */
  const runAuto = useCallback(
    async (onlyCheckin: boolean) => {
      setBusy(true);
      setResult(null);
      try {
        const relay0 = await ensureRelay();
        if (!bridge.ready) {
          setResult({ ok: false, title: '还没停在站点页面内', lines: [{ k: '提示', v: '请在下方页面完成登录后再点按钮' }] });
          return;
        }
        const { self, apiBase, tried } = await discover();
        if (!self) {
          setResult({
            ok: false,
            title: '还没检测到登录态',
            lines: [
              { k: '已尝试', v: tried.length ? tried.join('、') : '页面所在域' },
              { k: '提示', v: '请先在下方页面里正常登录，再点「我已登录」' },
            ],
          });
          return;
        }
        const fam = await detectRelayFamily(bridge);
        const relay: Relay = {
          ...relay0,
          apiBase: apiBase && apiBase !== bridge.currentOrigin ? apiBase : relay0.apiBase,
          hasSession: true,
          kind: fam.family === 'unknown' ? relay0.kind : fam.family,
          userId: self.id,
          username: self.username,
        };
        await app.updateRelay(relay);
        relayRef.current = relay;

        if (onlyCheckin) {
          const ck = await probeCheckin(relay);
          setResult({
            ok: ck.mode !== null,
            title: ck.mode === 'api' ? '签到完成（接口）' : ck.mode === 'dom' ? '签到完成（网页按钮）' : '这个站没有可用的自动签到',
            lines: [
              { k: '站点', v: relay.name },
              { k: '签到', v: ck.mode === 'api' ? '接口签到成功，已加入每日签到' : ck.mode === 'dom' ? '网页按钮签到成功，已加入每日签到' : `未能自动签到：${ck.note || '站点未开放'}` },
            ],
          });
          return;
        }

        await app.persistAccessToken(relay, bridge);
        const prov = await app.provisionRelay(relay, bridge);
        const ck = await probeCheckin(relay);

        const lines: { k: string; v: string }[] = [];
        lines.push({ k: '站点架构', v: fam.detail });
        lines.push({ k: '账号', v: `${self.username || '未知'}（ID ${self.id}）` });
        if (prov.ok && prov.key) {
          lines.push({ k: 'API 密钥', v: `${prov.key.maskedKey}（已存本机加密区）` });
          lines.push({ k: '调用地址', v: prov.key.baseUrl });
        }
        lines.push({
          k: '每日签到',
          v: ck.mode === 'api' ? '有免费签到（接口），已加入每日签到' : ck.mode === 'dom' ? '有免费签到（网页按钮），已加入每日签到' : `未检测到免费签到：${ck.note || '站点未开放'}`,
        });
        setResult({
          ok: prov.ok,
          title: prov.ok ? '已自动创建并保存' : '这个站点没法自动建档',
          lines,
          warn: prov.ok ? undefined : `${prov.message || '自动创建失败'}。请用「手动粘贴密钥」保存，效果一样。`,
        });
      } finally {
        setBusy(false);
      }
    },
    [app, bridge, discover, ensureRelay, probeCheckin],
  );

  // 从「每日签到」点「去签到」进来时：登录态就绪后自动完成网页签到
  useEffect(() => {
    if (!autoCheckin || autoRan.current) return;
    if (loading) return;
    autoRan.current = true;
    const t = setTimeout(() => runAuto(true), 1200);
    return () => clearTimeout(t);
  }, [autoCheckin, loading, runAuto]);

  const submitPaste = async () => {
    if (!pkKey.trim() || !pkBase.trim()) {
      setResult({ ok: false, title: '信息不完整', lines: [{ k: '提示', v: 'API Key 与调用地址都要填' }] });
      return;
    }
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
    if (item) await app.updateRelay({ ...relay, hasSession: true });
    setPasteOpen(false);
    if (item) {
      setResult({
        ok: true,
        title: '已保存到本机',
        lines: [
          { k: 'API 密钥', v: `${item.maskedKey}（已存本机加密区）` },
          { k: '调用地址', v: item.baseUrl },
          { k: '每日签到', v: '站点已收进每日签到列表，签到能力以列表标注为准' },
        ],
      });
    }
  };

  const go = () => {
    setResult(null);
    autoRan.current = false;
    const next = normalizeUrl(inputUrl);
    setUrl(next);
    setPkBase(joinApiBase(next));
    setLoading(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.bgTop }}>
      <View style={{ paddingTop: insets.top + sc.s(6), paddingHorizontal: sc.gutter, paddingBottom: sc.s(10), backgroundColor: 'rgba(255,255,255,0.86)', borderBottomWidth: 1, borderBottomColor: palette.hairline }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
          <IconButton icon="chevron-back" onPress={() => navigation.goBack()} tone="muted" />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: sc.fs(16), fontWeight: '800', color: palette.ink }}>{route?.params?.name || siteKeyOf(url)}</Text>
          </View>
          <IconButton icon={loading ? 'hourglass-outline' : 'refresh'} onPress={() => webRef.current?.reload()} tone="accent" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), marginTop: sc.s(9) }}>
          <View style={{ flex: 1, height: sc.s(40), flexDirection: 'row', alignItems: 'center', paddingHorizontal: sc.s(11), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: palette.hairline }}>
            <Ionicons name="link-outline" size={sc.s(14)} color={palette.inkFaint} />
            <TextInput
              value={inputUrl}
              onChangeText={setInputUrl}
              onSubmitEditing={go}
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              selectTextOnFocus
              placeholder="https://..."
              placeholderTextColor={palette.inkFaint}
              style={{ flex: 1, marginLeft: sc.s(7), height: sc.s(38), fontSize: sc.fs(12.5), color: palette.ink, padding: 0, textAlignVertical: 'center', includeFontPadding: false }}
            />
          </View>
          <GlassButton label="前往" size="sm" onPress={go} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <WebView
          ref={webRef}
          source={{ uri: url }}
          injectedJavaScriptBeforeContentLoaded={SPY_JS}
          onMessage={(e) => bridge.handleMessage(e.nativeEvent.data)}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => setLoading(false)}
          onNavigationStateChange={(nav: any) => bridge.setOrigin(nav?.url)}
          originWhitelist={['*']}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
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

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: sc.gutter, paddingTop: sc.s(10), paddingBottom: insets.bottom + sc.s(12), backgroundColor: 'rgba(250,252,255,0.97)', borderTopWidth: 1, borderTopColor: palette.hairline, flexDirection: 'row', gap: sc.s(9) }}>
          <View style={{ flex: 1 }}>
            <GlassButton label="手动粘贴密钥" icon="key-outline" tone="muted" size="lg" onPress={() => setPasteOpen(true)} style={{ width: '100%' } as any} />
          </View>
          <View style={{ flex: 1.4 }}>
            <GlassButton
              label={busy ? '处理中…' : '我已登录，自动创建保存密钥和调用地址'}
              icon="flash"
              size="lg"
              loading={busy}
              onPress={() => runAuto(false)}
              style={{ width: '100%' } as any}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={!!result} onClose={() => setResult(null)} title={result?.title || ''}>
        {result ? (
          <>
            {result.lines.map((l, i) => (
              <KeyValue key={i} k={l.k} v={l.v} mono={l.k === '调用地址' || l.k === 'API 密钥'} />
            ))}
            {result.warn ? (
              <View style={{ marginTop: sc.s(10) }}>
                <Notice tone="warn">{result.warn}</Notice>
              </View>
            ) : null}
            {result.ok ? (
              <View style={{ marginTop: sc.s(12), flexDirection: 'row', gap: sc.s(8) }}>
                <GlassButton label="去可用池" icon="shield-checkmark-outline" onPress={() => navigation.goBack()} />
                <GlassButton label="去每日签到" icon="calendar-outline" tone="muted" onPress={() => navigation.goBack()} />
              </View>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Sheet visible={pasteOpen} onClose={() => setPasteOpen(false)} title="手动粘贴密钥" footer={<GlassButton label="保存到本机" icon="save-outline" size="lg" onPress={submitPaste} />}>
        <Field label="备注名" value={pkLabel} onChangeText={setPkLabel} placeholder={route?.params?.name || '站点名'} />
        <Field label="API Key" value={pkKey} onChangeText={setPkKey} placeholder="sk-..." autoCapitalize="none" />
        <Field label="调用地址" value={pkBase} onChangeText={setPkBase} placeholder="https://example.com/v1" keyboardType="url" autoCapitalize="none" />
      </Sheet>
    </View>
  );
}