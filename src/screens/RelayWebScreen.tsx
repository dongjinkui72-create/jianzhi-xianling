import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, GlassButton, IconButton, KeyValue, Notice, Sheet } from '../components/Bits';
import { normalizeUrl, siteKeyOf } from '../lib/normalize';
import { palette, radius } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { useApp } from '../store/AppStore';
import { RelayBridge } from '../services/relayBridge';
import { detectRelayFamily, fetchCheckinSupport, fetchSelf, joinApiBase } from '../services/relayApi';
import type { Relay } from '../lib/types';

/**
 * 中转站内嵌登录页（2.0 极简版）。
 * 登录后界面上只出现两个按钮：
 *   1. 手动粘贴密钥
 *   2. 我已登录，自动创建保存密钥和调用地址
 * 不展示任何任务执行代码 / 日志。结果一律用提示框如实回报。
 * 同时检测该站是否有免费签到：有则自动加入「每日签到」列表。
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

  /** 按钮 2：我已登录，自动创建保存密钥和调用地址 */
  const runAuto = async () => {
    setBusy(true);
    setResult(null);
    try {
      const relay = await ensureRelay();
      if (!bridge.ready) {
        setResult({ ok: false, title: '还没停在站点页面内', lines: [{ k: '提示', v: '请在下方页面完成登录后再点这个按钮' }] });
        return;
      }
      const fam = await detectRelayFamily(bridge);
      const selfRes = await fetchSelf(bridge);
      if (!selfRes.ok || !selfRes.self) {
        setResult({
          ok: false,
          title: '还没检测到登录态',
          lines: [{ k: '原因', v: selfRes.reason || '未登录' }, { k: '提示', v: '请先在下方页面里正常登录，再点「我已登录」' }],
        });
        return;
      }
      await app.persistAccessToken(relay, bridge);
      const prov = await app.provisionRelay(relay, bridge);
      const support = await fetchCheckinSupport(bridge);

      const lines: { k: string; v: string }[] = [];
      lines.push({ k: '站点架构', v: fam.detail });
      lines.push({ k: '账号', v: `${selfRes.self.username || '未知'}（ID ${selfRes.self.id}）` });

      let checkinNote = '';
      if (support.support === 'yes') {
        await app.updateRelay({ ...relay, checkinSupport: 'yes', checkinSupportNote: null, hasSession: true });
        checkinNote = '该站有免费签到领额度，已加入「每日签到」列表';
      } else if (support.support === 'no') {
        await app.updateRelay({ ...relay, checkinSupport: 'no', checkinSupportNote: support.reason });
        checkinNote = `该站没有免费签到功能（${support.reason || '站点未开启'}）`;
      } else {
        await app.updateRelay({ ...relay, checkinSupport: 'unknown', checkinSupportNote: support.reason });
        checkinNote = `签到能力无法确认（${support.reason || '尚未探测到'}）`;
      }

      if (prov.ok && prov.key) {
        lines.push({ k: 'API 密钥', v: `${prov.key.maskedKey}（已存本机加密区）` });
        lines.push({ k: '调用地址', v: prov.key.baseUrl });
        lines.push({ k: '每日签到', v: checkinNote });
        setResult({ ok: true, title: '已自动创建并保存', lines });
      } else {
        lines.push({ k: '每日签到', v: checkinNote });
        setResult({
          ok: false,
          title: '这个站点没法自动建档',
          lines,
          warn: `${prov.message || '自动创建失败'}。请用「手动粘贴密钥」把密钥存进来，效果完全一样。`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  /** 按钮 1：手动粘贴密钥 */
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
    setPasteOpen(false);
    if (item) {
      setResult({
        ok: true,
        title: '已保存到本机',
        lines: [
          { k: 'API 密钥', v: `${item.maskedKey}（已存本机加密区）` },
          { k: '调用地址', v: item.baseUrl },
        ],
      });
    }
  };

  const go = () => {
    setResult(null);
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
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: sc.s(38), paddingHorizontal: sc.s(11), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: palette.hairline }}>
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
              style={{ flex: 1, marginLeft: sc.s(7), fontSize: sc.fs(12.5), color: palette.ink, padding: 0 }}
            />
          </View>
          <GlassButton label="前往" size="sm" onPress={go} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <WebView
          ref={webRef}
          source={{ uri: url }}
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
              onPress={runAuto}
              style={{ width: '100%' } as any}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* 结果提示框 */}
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

      {/* 手动粘贴 */}
      <Sheet visible={pasteOpen} onClose={() => setPasteOpen(false)} title="手动粘贴密钥" footer={<GlassButton label="保存到本机" icon="save-outline" size="lg" onPress={submitPaste} />}>
        <Field label="备注名" value={pkLabel} onChangeText={setPkLabel} placeholder={route?.params?.name || '站点名'} />
        <Field label="API Key" value={pkKey} onChangeText={setPkKey} placeholder="sk-..." autoCapitalize="none" />
        <Field label="调用地址" value={pkBase} onChangeText={setPkBase} placeholder="https://example.com/v1" keyboardType="url" autoCapitalize="none" />
      </Sheet>
    </View>
  );
}