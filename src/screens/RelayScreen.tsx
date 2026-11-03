import React, { useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Chip, Collapsible, EmptyState, Field, GlassButton, IconButton, KeyValue, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber, dateTime, formatUsd, quotaToUsd, relativeTime, todayKey } from '../lib/format';
import { siteKeyOf } from '../lib/normalize';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import type { ApiProtocol, Relay } from '../lib/types';

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

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [pkLabel, setPkLabel] = useState('');
  const [pkKey, setPkKey] = useState('');
  const [pkBase, setPkBase] = useState('');
  const [pkProtocol, setPkProtocol] = useState<ApiProtocol>('openai_compatible');

  const saved = useMemo(() => app.relays.filter((r) => r.hasSession || r.userId || r.accessTokenRef), [app.relays]);
  /** 每日签到列表：登录过的站点都会进这里；能不能签、怎么签由角标说明 */
  const checkinList = useMemo(() => saved, [saved]);
  const directory = useMemo(() => app.relays.filter((r) => !(r.hasSession || r.userId || r.accessTokenRef)), [app.relays]);
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
        setToast({ tone: 'warn', title: '还没有长期登录凭据', body: '请先点「打开并登录」在网页里登录一次；App 会尝试保存长期访问令牌，之后就能直接同步余额和代理签到。' });
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
    const item = await app.addKey({ label: pkLabel.trim() || '手动导入', key: pkKey.trim(), baseUrl: pkBase.trim(), protocol: pkProtocol, source: 'manual' });
    setPasteOpen(false);
    setPkKey('');
    setPkBase('');
    setPkLabel('');
    setToast({
      tone: item && item.statusNote ? 'warn' : 'ok',
      title: item ? '已保存到本机' : '保存失败',
      body: item ? `密钥 ${item.maskedKey} 已写入本机加密区，数据库里只留掩码。${item.statusNote || ''}` : '未知错误',
    });
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
            label={app.checkinBusy ? '签到中…' : `全部签到（${saved.length}）`}
            icon="flash"
            size="lg"
            loading={app.checkinBusy}
            disabled={!checkinList.length || app.checkinBusy}
            onPress={doCheckinAll}
          />

          {!checkinList.length ? (
            <View style={{ marginTop: sc.s(11) }}>
              <Notice tone="warn" title="还没有可签到的站点">
                登录后 App 会自动检测该站有没有免费签到：有就加进这个列表，没有就只建档。
              </Notice>
            </View>
          ) : (
            <View style={{ marginTop: sc.s(12) }}>
              {checkinList.map((r) => (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9), paddingVertical: sc.s(8), borderTopWidth: 1, borderTopColor: palette.hairlineSoft }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{r.name}</Text>
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
              ))}
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
            return (
              <Glass key={r.id} pad={0} style={{ marginBottom: sc.s(10) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: sc.s(13), gap: sc.s(9) }}>
                  <View style={{ width: sc.s(36), height: sc.s(36), borderRadius: sc.s(11), backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="server-outline" size={sc.s(18)} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: sc.fs(14.5), fontWeight: '800', color: palette.ink }}>{r.name}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(4) }}>
                      <Chip label={r.remainingTokens != null ? `剩余 ${compactNumber(r.remainingTokens)} tokens` : r.remainingUsd != null ? `剩余 ${formatUsd(r.remainingUsd)}` : '剩余 token 未知'} tone={r.remainingUsd != null && r.remainingUsd < app.settings.lowUsdThreshold ? 'danger' : 'ok'} icon="pie-chart-outline" />
                      <Chip label={r.accessTokenRef ? '已存长期凭据' : '需网页登录'} tone={r.accessTokenRef ? 'ok' : 'muted'} />
                    </View>
                  </View>
                  <PressableOpacity label={open ? '收起' : '展开'} icon={open ? 'chevron-up' : 'chevron-down'} onPress={() => setOpenRows((m) => ({ ...m, [r.id]: !open }))} />
                </View>

                {open ? (
                  <View style={{ paddingHorizontal: sc.s(13), paddingBottom: sc.s(13), borderTopWidth: 1, borderTopColor: palette.hairlineSoft, paddingTop: sc.s(10) }}>
                    <KeyValue k="站点链接" v={r.baseUrl} mono />
                    <KeyValue k="剩余 token" v={r.remainingTokens != null ? `${Math.round(r.remainingTokens).toLocaleString('en-US')} tokens（约 ${formatUsd(r.remainingUsd)}）` : '未同步，点下方「同步余额」'} />
                    <KeyValue k="账户余额" v={r.quota != null ? `${formatUsd(quotaToUsd(r.quota))}（已用 ${formatUsd(quotaToUsd(r.usedQuota))}）` : '未知'} />
                    <KeyValue k="站点用户" v={r.username ? `${r.username}（ID ${r.userId ?? '—'}）` : '未登录'} />
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
                          await app.removeRelay(r.id);
                          setToast({ tone: 'muted', title: '已移除', body: `${r.name} 及其本机凭据已从加密区删除` });
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
