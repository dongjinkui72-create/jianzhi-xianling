import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Collapsible, EmptyState, Field, GlassButton, IconButton, KeyValue, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber, dateTime, formatUsd, quotaToUsd, relativeTime, todayKey } from '../lib/format';
import { siteKeyOf } from '../lib/normalize';
import { splitRelaysForCheckin } from '../lib/relayGroups';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import type { ApiKeyItem, ApiProtocol, Relay } from '../lib/types';

/**
 * 中转站。
 *  - 顶部：一键签到（App 内代理请求签到接口，可一次签到多个已保存站点，结果写入本机签到日志）
 *  - 下面：本地已保存的中转站（名称 + 链接 + 剩余 token），默认折叠，可展开查看
 *  - 站点目录 / 添加自定义站点 / 手动粘贴 Key 入口
 * 红线：不支持自动签到的站点如实说明只能手动，绝不伪造签到成功。
 */

const PROTOCOLS: { id: ApiProtocol; label: string }[] = [
  { id: 'openai_compatible', label: 'OpenAI 兼容' },
  { id: 'openai_response', label: 'OpenAI Responses' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
];

interface KeyBalanceHint {
  usd: number | null;
  tokens: number | null;
  count: number;
  deadCount: number;
}

/** 站点没有会话余额时，用本站已保存 Key 的体检结果兜底。已失效 Key 不参与余额显示。 */
function keyBalanceFor(relayId: string, keys: ApiKeyItem[]): KeyBalanceHint | null {
  const all = keys.filter((k) => k.relayId === relayId);
  if (!all.length) return null;
  const rows = all.filter((k) => k.status !== 'dead' && (k.remainingUsd != null || k.remainingTokens != null));
  const deadCount = all.filter((k) => k.status === 'dead').length;
  if (!rows.length) return { usd: null, tokens: null, count: 0, deadCount };
  let usd: number | null = null;
  let tokens: number | null = null;
  for (const k of rows) {
    if (k.remainingUsd != null && (usd == null || k.remainingUsd > usd)) usd = k.remainingUsd;
    if (k.remainingTokens != null && (tokens == null || k.remainingTokens > tokens)) tokens = k.remainingTokens;
  }
  return { usd, tokens, count: rows.length, deadCount };
}

/** 已保存中转站列表直接显示的站点代币余额 */
function relayBalance(r: Relay, keyBalance?: KeyBalanceHint | null): string {
  const deadSuffix = keyBalance && keyBalance.count === 0 && keyBalance.deadCount > 0 ? ' · 已存 Key 已失效' : '';
  if (r.balanceText) {
    const usd = r.remainingUsd != null ? ` · 约 ${formatUsd(r.remainingUsd)}` : '';
    return `${r.balanceText}${usd}${deadSuffix}`;
  }
  if (r.quota != null) {
    const usd = r.remainingUsd != null ? `（约 ${formatUsd(r.remainingUsd)}）` : '';
    return `${Math.round(r.quota).toLocaleString('en-US')} 站点代币${usd}${deadSuffix}`;
  }
  if (r.remainingUsd != null) return `${formatUsd(r.remainingUsd)}${deadSuffix}`;
  if (keyBalance?.usd != null) return `${formatUsd(keyBalance.usd)}（Key 体检）`;
  if (keyBalance?.tokens != null) return `${compactNumber(keyBalance.tokens)} tokens（Key 体检）`;
  if (r.remainingTokens != null) return `${compactNumber(r.remainingTokens)} tokens${deadSuffix}`;
  if (keyBalance && keyBalance.count === 0 && keyBalance.deadCount > 0) return '已保存 Key 已失效';
  return r.hasSession || r.accessTokenRef ? '暂无可查询余额' : '登录后自动同步';
}

function supportChip(state: Relay['checkinSupport']) {
  if (state === 'yes') return <Chip label="支持自动签到" tone="ok" icon="checkmark-circle" />;
  if (state === 'no') return <Chip label="不支持自动签到" tone="warn" icon="hand-left-outline" />;
  return <Chip label="签到能力无法确认" tone="muted" icon="help-circle" />;
}

export function RelayScreen() {
  const sc = useScale();
  const app = useApp();
  const [allOpen, setAllOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'ok' | 'warn' | 'danger' | 'muted'; title: string; body: string } | null>(null);
  const [relayHealth, setRelayHealth] = useState<Record<string, 'ok' | 'down' | 'unknown'>>({});

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [pkLabel, setPkLabel] = useState('');
  const [pkKey, setPkKey] = useState('');
  const [pkBase, setPkBase] = useState('');
  const [pkProtocol, setPkProtocol] = useState<ApiProtocol>('openai_compatible');

  // 只要登录过、存过长期凭据、或在本站存过 API Key，都算「已保存的站点」。
  // 这样手动粘贴 Key 的站点也一定会出现在本地已保存列表里。
  const saved = useMemo(
    () =>
      app.relays.filter(
        (r) => r.hasSession || r.userId || r.accessTokenRef || app.keys.some((k) => k.relayId === r.id),
      ),
    [app.relays, app.keys],
  );
  // 站点可用性检查：不能把旧余额当成现在还能用。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, 'ok' | 'down' | 'unknown'> = {};
      await Promise.all(saved.map(async (r) => {
        let origin = r.baseUrl;
        try { origin = new URL(r.baseUrl).origin; } catch { /* keep raw */ }
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => ctrl?.abort(), 8000);
        try {
          const res = await fetch(origin, { method: 'GET', headers: { Accept: 'text/html,application/json' }, signal: ctrl?.signal });
          next[r.id] = res.status > 0 && res.status < 500 ? 'ok' : 'down';
        } catch {
          next[r.id] = 'down';
        } finally {
          clearTimeout(timer);
        }
      }));
      if (!cancelled) setRelayHealth(next);
    })();
    return () => { cancelled = true; };
  }, [saved]);

  /** 每日签到列表：只放已检测到免费签到入口的站点；没有签到功能的只留在下方本地列表。 */
  const { checkin: checkinList } = useMemo(() => splitRelaysForCheckin(saved), [saved]);
  const directory = useMemo(() => app.relays.filter((r) => !saved.some((x) => x.id === r.id)), [app.relays, saved]);
  const today = todayKey();
  const todayDone = useMemo(
    () => {
      const localDay = (ts: number) => {
        const d = new Date(ts);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      };
      return app.logs.filter((l) => l.result === 'success' && localDay(l.at) === today).length;
    },
    [app.logs, today],
  );

  // 升级后旧数据里的「不支持签到」可能是误判：进入页面时后台重探一次，拿到真实结果
  const probedOnce = useRef(false);
  useEffect(() => {
    if (probedOnce.current) return;
    probedOnce.current = true;
    // 升级后旧数据里可能只有签到能力、没有余额：进入页面时也重新同步一次，把 77625 这类自定义站的积分读回来。
    const targets = saved.filter((r) => r.checkinSupport !== 'yes' || !r.balanceText).slice(0, 3);
    (async () => {
      for (const r of targets) {
        if (r.accessTokenRef) await app.syncRelay(r).catch(() => {});
        else await app.probeRelay(r).catch(() => {});
      }
    })();
  }, [saved, app]);

  const openRelay = (r: Relay, autoCheckin = false) =>
    navigationRef.isReady() && navigationRef.navigate('RelayWeb', { relayId: r.id, url: r.baseUrl, name: r.name, autoCheckin });

  const doCheckin = async (r: Relay) => {
    setBusyId(r.id);
    try {
      const log = await app.checkinRelay(r);
      setToast({
        tone: log.result === 'success' ? 'ok' : log.result === 'manual_only' ? 'warn' : 'danger',
        title: log.result === 'success' ? `${r.name} 签到成功` : log.result === 'manual_only' ? `${r.name} 只能手动签到` : log.result === 'unconfirmed' ? `${r.name} 结果无法确认` : `${r.name} 签到失败`,
        body: log.message,
      });
    } finally {
      setBusyId(null);
    }
  };

  const doCheckinAll = async () => {
    setBusyId('all');
    try {
      const logs = await app.checkinAll();
      const ok = logs.filter((l) => l.result === 'success').length;
      const manual = logs.filter((l) => l.result === 'manual_only').length;
      const fail = logs.filter((l) => l.result === 'failed' || l.result === 'unconfirmed').length;
      setToast({
        tone: ok ? 'ok' : manual ? 'warn' : 'muted',
        title: `批量签到完成`,
        body: `成功 ${ok} 个，只能手动 ${manual} 个，失败/无法确认 ${fail} 个。全部结果已记入本机签到日志，可在下方「签到日志」查看。`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const doSync = async (r: Relay) => {
    setBusyId(r.id);
    try {
      if (!r.accessTokenRef) {
        // 没有长期令牌：用与登录页共享 Cookie 的后台 WebView 读余额与签到方式
        const next = await app.probeRelay(r);
        setToast({
          tone: next.hasSession ? 'ok' : 'warn',
          title: next.hasSession ? `${next.name} 已同步` : `${next.name} 未读到登录态`,
          body: next.hasSession
            ? `余额 ${formatUsd(next.remainingUsd)}，签到：${next.checkinSupport === 'yes' ? (next.checkinMode === 'dom' ? '网页按钮一键签到' : '接口一键签到') : next.checkinSupport === 'no' ? '该站不支持自动签到' : '无法确认'}`
            : '请点「打开并登录」在页面里登录一次，再回来同步。',
        });
        return;
      }
      const next = await app.syncRelay(r);
      setToast({ tone: 'ok', title: `${next.name} 已同步`, body: `余额 ${formatUsd(next.remainingUsd)}，签到能力：${next.checkinSupport === 'yes' ? '支持' : next.checkinSupport === 'no' ? '不支持' : '无法确认'}${next.checkinSupportNote ? `（${next.checkinSupportNote}）` : ''}` });
    } finally {
      setBusyId(null);
    }
  };

  const submitAdd = async () => {
    if (!/^https?:\/\/|^[a-z0-9.-]+\.[a-z]{2,}/i.test(newUrl.trim())) {
      setToast({ tone: 'danger', title: '地址不合法', body: '请填写形如 https://example.com 的站点地址' });
      return;
    }
    const r = await app.addRelayByUrl(newName.trim() || siteKeyOf(newUrl), newUrl.trim());
    setAddOpen(false);
    setNewName('');
    setNewUrl('');
    openRelay(r);
  };

  const submitPaste = async () => {
    if (!pkKey.trim() || !pkBase.trim()) {
      setToast({ tone: 'danger', title: '信息不完整', body: 'API Key 与调用地址都必须填写' });
      return;
    }
    const base = pkBase.trim();
    // 把 Key 绑定到对应站点档案：同域已存在就复用，不存在就新建。
    // 否则手动粘贴的 Key 会变成「孤儿」，站点不会出现在每日签到列表。
    let relay = app.relays.find((r) => siteKeyOf(r.baseUrl) === siteKeyOf(base)) ?? null;
    if (!relay) relay = await app.addRelayByUrl(pkLabel.trim() || siteKeyOf(base), base);
    const item = await app.addKey({
      label: pkLabel.trim() || '手动导入',
      key: pkKey.trim(),
      baseUrl: base,
      protocol: pkProtocol,
      relayId: relay.id,
      provider: relay.name,
      source: 'manual',
    });
    setPasteOpen(false);
    setPkKey('');
    setPkBase('');
    setPkLabel('');
    setToast({
      tone: item && item.statusNote ? 'warn' : 'ok',
      title: item ? '已保存到本机' : '保存失败',
      body: item ? `密钥 ${item.maskedKey} 已写入本机加密区，数据库里只留掩码；站点已加入每日签到，正在后台识别登录态。${item.statusNote || ''}` : '未知错误',
    });
    if (item && relay) {
      // 不阻塞界面：后台读取登录态、余额与签到方式
      app.probeRelay({ ...relay, apiBase: relay.apiBase || base }).then((next) => {
        setToast({
          tone: next.hasSession ? 'ok' : 'warn',
          title: next.hasSession ? `${next.name} 已加入每日签到` : `${next.name} 已保存`,
          body: next.hasSession
            ? `已读到账号 ${next.username ?? ''}，余额 ${formatUsd(next.remainingUsd)}；${next.checkinSupport === 'yes' ? '可一键签到' : next.checkinSupport === 'no' ? '该站不支持自动签到' : '签到方式无法确认'}。`
            : '后台暂时读不到登录态：点「打开并登录」登录一次后会自动恢复一键签到。',
        });
      }).catch(() => {});
    }
  };

  return (
    <ScreenShell>
      <Header
        title="中转站"
        subtitle={`已保存 ${saved.length} 个站点 · 今日签到成功 ${todayDone} 个`}
        right={
          <>
            <IconButton icon="list-outline" onPress={() => setLogOpen(true)} tone="accent" />
            <IconButton icon="add" onPress={() => setAddOpen(true)} tone="accent" />
            <IconButton icon="settings-outline" onPress={() => navigationRef.isReady() && navigationRef.navigate('Settings')} tone="muted" />
          </>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.tabHeight + sc.s(96) }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {toast ? (
          <View style={{ marginBottom: sc.s(12) }}>
            <Notice tone={toast.tone} title={toast.title}>
              {toast.body}
            </Notice>
          </View>
        ) : null}

        {/* ===================== 一键签到 ===================== */}
        <Glass pad={sc.s(15)} style={{ marginBottom: sc.s(14) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(4) }}>
            <Ionicons name="calendar-outline" size={sc.s(19)} color={palette.accent} />
            <Text style={{ flex: 1, marginLeft: sc.s(8), fontSize: sc.fs(17), fontWeight: '800', color: palette.ink }}>每日签到</Text>
            <GlassButton label="签到日志" icon="receipt-outline" size="sm" tone="muted" onPress={() => setLogOpen(true)} />
          </View>

          <GlassButton
            label={app.checkinBusy ? '签到中…' : `全部签到（${checkinList.length}）`}
            icon="flash"
            size="lg"
            loading={app.checkinBusy}
            disabled={!checkinList.length || app.checkinBusy}
            onPress={doCheckinAll}
          />

          {!checkinList.length ? (
            <View style={{ marginTop: sc.s(11) }}>
              <Notice tone="warn" title="还没有可签到的站点">
                登录后 App 会自动检测免费签到：有签到入口的会出现在这里，没有签到的只保留在下方本地列表。
              </Notice>
            </View>
          ) : (
            <View style={{ marginTop: sc.s(12) }}>
              {checkinList.map((r) => {
                const cbal = relayBalance(r, keyBalanceFor(r.id, app.keys));
                const cdown = relayHealth[r.id] === 'down';
                return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(8), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{r.name}</Text>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(11.5), fontWeight: '700', color: cdown ? palette.danger : palette.accent, marginTop: sc.s(2) }}>{cdown ? `站点不可用 · 上次余额：${cbal}` : `余额：${cbal}`}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(4) }}>
                      {supportChip(r.checkinSupport)}
                      <Chip label={r.lastCheckinAt ? `上次 ${relativeTime(r.lastCheckinAt)}` : '从未签到'} tone="muted" />
                    </View>
                  </View>
                  <GlassButton
                    label={busyId === r.id ? '…' : '签到'}
                    size="sm"
                    tone={r.checkinSupport === 'no' ? 'warn' : 'accent'}
                    loading={busyId === r.id}
                    disabled={app.checkinBusy}
                    onPress={() => doCheckin(r)}
                  />
                </View>
                );
              })}
            </View>
          )}

        </Glass>

        {/* ===================== 本地已保存的中转站（默认折叠） ===================== */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(9) }}>
          <View style={{ width: sc.s(4), height: sc.s(17), borderRadius: sc.s(2), backgroundColor: palette.accent }} />
          <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(17), fontWeight: '800', color: palette.ink }}>本地已保存的中转站</Text>
          <PressableOpacity label={allOpen ? '全部收起' : '全部展开'} onPress={() => {
            const next = !allOpen;
            setAllOpen(next);
            const map: Record<string, boolean> = {};
            for (const r of saved) map[r.id] = next;
            setOpenRows(map);
          }} />
        </View>

        {!saved.length ? (
          <Glass style={{ marginBottom: sc.s(14) }}>
            <EmptyState icon="file-tray-outline" title="还没有保存任何中转站" desc="从下面的站点目录里挑一个登录，或右上角 + 添加自己的站点。" />
          </Glass>
        ) : (
          saved.map((r) => {
            const open = allOpen ? true : !!openRows[r.id];
            const kb = keyBalanceFor(r.id, app.keys);
            const bal = relayBalance(r, kb);
            const down = relayHealth[r.id] === 'down';
            const warn = down || /失效|不可用/.test(bal);
            return (
              <Glass key={r.id} pad={0} style={{ marginBottom: sc.s(10) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: sc.s(13), gap: sc.s(9) }}>
                  <View style={{ width: sc.s(36), height: sc.s(36), borderRadius: sc.s(11), backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="server-outline" size={sc.s(18)} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(14.5), fontWeight: '800', color: palette.ink }}>{r.name}</Text>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(12), fontWeight: '700', color: warn ? palette.danger : palette.accent, marginTop: sc.s(2) }}>{down ? `站点不可用 · 上次余额：${bal}` : `余额：${bal}`}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(4) }}>
                      {down ? <Chip label="站点无法访问" tone="danger" icon="alert-circle" /> : null}
                      {!r.balanceText && !kb ? (
                        <Chip label={r.remainingTokens != null ? `剩余 ${compactNumber(r.remainingTokens)} tokens` : r.remainingUsd != null ? `剩余 ${formatUsd(r.remainingUsd)}` : 'Key 未体检'} tone={r.remainingUsd != null && r.remainingUsd < app.settings.lowUsdThreshold ? 'danger' : 'ok'} icon="pie-chart-outline" />
                      ) : null}
                      <Chip
                        label={r.accessTokenRef ? '已存长期凭据' : r.hasSession ? '已登录（网页会话）' : '需网页登录'}
                        tone={r.accessTokenRef || r.hasSession ? 'ok' : 'muted'}
                      />
                    </View>
                  </View>
                  <PressableOpacity label={open ? '收起' : '展开'} icon={open ? 'chevron-up' : 'chevron-down'} onPress={() => setOpenRows((m) => ({ ...m, [r.id]: !open }))} />
                </View>

                {open ? (
                  <View style={{ paddingHorizontal: sc.s(13), paddingBottom: sc.s(13), borderTopWidth: 1, borderTopColor: palette.hairlineSoft, paddingTop: sc.s(10) }}>
                    <KeyValue k="站点链接" v={r.baseUrl} mono />
                    <KeyValue k="站点余额" v={relayBalance(r, kb)} />
                    <KeyValue k="账户余额" v={r.quota != null ? `${formatUsd(quotaToUsd(r.quota))}（已用 ${formatUsd(quotaToUsd(r.usedQuota))}）` : r.balanceText || '未同步'} />
                    <KeyValue k="站点用户" v={r.username ? `${r.username}（ID ${r.userId ?? '—'}）` : r.hasSession ? '已登录（网页会话已保存）' : '未登录（点下方「打开并登录」）'} />
                    <KeyValue k="签到能力" v={r.checkinSupport === 'yes' ? '支持自动签到' : r.checkinSupport === 'no' ? `不支持：${r.checkinSupportNote || '站点未开启'}` : `无法确认：${r.checkinSupportNote || '尚未探测'}`} />
                    <KeyValue k="自动建档" v={r.autoKeySupport === 'yes' ? '已成功自动建档' : r.autoKeySupport === 'no' ? `不支持：${r.autoKeyNote || ''}` : `无法确认${r.autoKeyNote ? `：${r.autoKeyNote}` : ''}`} />
                    <KeyValue k="最近同步" v={dateTime(r.lastSyncAt)} />

                    {r.checkinSupportNote && r.checkinSupport !== 'yes' ? (
                      <View style={{ marginTop: sc.s(8) }}>
                        <Notice tone="warn">{r.checkinSupportNote}</Notice>
                      </View>
                    ) : null}

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(8), marginTop: sc.s(12) }}>
                      <GlassButton label="打开并登录" icon="globe-outline" size="sm" onPress={() => openRelay(r)} />
                      <GlassButton label={busyId === r.id ? '同步中' : '同步余额'} icon="sync-outline" size="sm" tone="muted" loading={busyId === r.id} onPress={() => doSync(r)} />
                      <GlassButton label="签到" icon="calendar-outline" size="sm" tone="muted" onPress={() => doCheckin(r)} />
                      <GlassButton label="打开网站" icon="open-outline" size="sm" tone="muted" onPress={() => Linking.openURL(r.baseUrl).catch(() => {})} />
                      <GlassButton
                        label="移除"
                        icon="trash-outline"
                        size="sm"
                        tone="danger"
                        onPress={async () => {
                          const n = await app.removeRelay(r.id);
                          setToast({
                            tone: 'muted',
                            title: '已移除',
                            body: n > 0
                              ? `${r.name} 及其 ${n} 条 API Key 已从可用池和本机加密区删除`
                              : `${r.name} 及其本机凭据已从加密区删除`,
                          });
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </Glass>
            );
          })
        )}

        {/* ===================== 站点目录 ===================== */}
        <Collapsible
          title="站点目录"
          subtitle={`${directory.length} 个常见中转站，点进去登录即可自动建档`}
          right={<Ionicons name="library-outline" size={sc.s(17)} color={palette.accent} />}
        >
          <View style={{ paddingTop: sc.s(10) }}>
            {directory.map((r) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(9), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{r.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(11), color: palette.inkFaint, marginTop: sc.s(2) }}>{r.baseUrl}</Text>
                </View>
                <GlassButton label="打开并登录" size="sm" icon="log-in-outline" onPress={() => openRelay(r)} />
              </View>
            ))}
            <View style={{ marginTop: sc.s(10) }}>
              <Notice tone="muted">
                以上为第三方站点，本 App 不代收任何费用、不经手你的充值。请自行甄别站点可信度。
              </Notice>
            </View>
          </View>
        </Collapsible>

        {/* ===================== 手动入口 ===================== */}
        <Glass style={{ marginTop: sc.s(4), marginBottom: sc.s(12) }} pad={sc.s(14)}>
          <Text style={{ fontSize: sc.fs(15), fontWeight: '800', color: palette.ink, marginBottom: sc.s(6) }}>站点结构不支持自动建档？</Text>
          <View style={{ flexDirection: 'row', gap: sc.s(8), flexWrap: 'wrap' }}>
            <GlassButton label="手动粘贴 API Key" icon="key-outline" onPress={() => setPasteOpen(true)} />
            <GlassButton label="添加自定义站点" icon="add-circle-outline" tone="muted" onPress={() => setAddOpen(true)} />
          </View>
        </Glass>
      </ScrollView>

      {/* 添加站点 */}
      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="添加自定义中转站" footer={<GlassButton label="保存并打开登录" icon="log-in-outline" size="lg" onPress={submitAdd} />}>
        <Field label="站点名称" value={newName} onChangeText={setNewName} placeholder="例如：我的小站" />
        <Field label="站点地址" value={newUrl} onChangeText={setNewUrl} placeholder="https://example.com" keyboardType="url" autoCapitalize="none" />
      </Sheet>

      {/* 手动粘贴 */}
      <Sheet visible={pasteOpen} onClose={() => setPasteOpen(false)} title="手动建档 API Key" footer={<GlassButton label="保存到本机加密区" icon="save-outline" size="lg" onPress={submitPaste} />}>
        <Notice tone="muted">真实密钥只写入本机 SecureStore，数据库里只保存掩码，绝不上传云端。</Notice>
        <View style={{ height: sc.s(12) }} />
        <Field label="备注名" value={pkLabel} onChangeText={setPkLabel} placeholder="例如：云雾-主号" />
        <Field label="API Key" value={pkKey} onChangeText={setPkKey} placeholder="sk-..." autoCapitalize="none" />
        <Field label="调用地址" value={pkBase} onChangeText={setPkBase} placeholder="https://example.com/v1" keyboardType="url" autoCapitalize="none" />
        <Text style={{ fontSize: sc.fs(12.5), color: palette.inkSoft, fontWeight: '700', marginBottom: sc.s(7) }}>协议</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(8), marginBottom: sc.s(12) }}>
          {PROTOCOLS.map((p) => (
            <PressableOpacity
              key={p.id}
              label={p.label}
              active={pkProtocol === p.id}
              onPress={() => setPkProtocol(p.id)}
            />
          ))}
        </View>
      </Sheet>

      {/* 签到日志 */}
      <Sheet visible={logOpen} onClose={() => setLogOpen(false)} title="本机签到日志">
        {!app.logs.length ? (
          <EmptyState icon="receipt-outline" title="还没有签到记录" desc="签到结果只会写在这台手机上，不会上传。" />
        ) : (
          app.logs.map((l) => (
            <Glass key={l.id} style={{ marginBottom: sc.s(9) }} pad={sc.s(12)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7), marginBottom: sc.s(5) }}>
                <Text style={{ flex: 1, fontSize: sc.fs(13.5), fontWeight: '800', color: palette.ink }} numberOfLines={1}>{l.relayName}</Text>
                <Chip
                  label={l.result === 'success' ? '成功' : l.result === 'manual_only' ? '只能手动' : l.result === 'unconfirmed' ? '无法确认' : '失败'}
                  tone={l.result === 'success' ? 'ok' : l.result === 'manual_only' ? 'warn' : 'danger'}
                />
              </View>
              <Text style={{ fontSize: sc.fs(11.5), color: palette.inkSoft, lineHeight: sc.fs(17) }}>{l.message}</Text>
              <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(10.5), color: palette.inkFaint }}>{dateTime(l.at)}{l.gainedUsd != null ? ` · 获得 ${formatUsd(l.gainedUsd)}` : ''}</Text>
            </Glass>
          ))
        )}
      </Sheet>
    </ScreenShell>
  );
}

/** 小型文字/图标按钮 */
function PressableOpacity({ label, onPress, icon, active }: { label: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; active?: boolean }) {
  const sc = useScale();
  return (
    <GlassButton label={label} icon={icon} size="sm" tone={active ? 'accent' : 'muted'} onPress={onPress} />
  );
}
