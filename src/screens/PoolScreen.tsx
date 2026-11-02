import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Chip, EmptyState, Field, GlassButton, IconButton, KeyValue, Notice, Sheet, StatusDot } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber, dateTime, formatUsd, relativeTime } from '../lib/format';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import { useLaunch } from '../launch/LaunchProvider';
import { apiHostFor } from '../services/launcher';
import type { ApiKeyItem } from '../lib/types';

/**
 * 可用池。
 *  - 打开即自动体检，筛出「绿色 / token 充足」的 API 供选择
 *  - 选中后底部圆形启动按钮亮起；未选中时按钮灰色且不可点击
 *  - 额度不足或失效的 Key 静默标红移入预警区（绝不出现「建议删除该 API」这类提示）
 *  - 「未选择 API + 启动」这一块居中放在底部「可用池」那一行的上面
 */

function KeyCard({ k, selected, onSelect, onDetail }: { k: ApiKeyItem; selected: boolean; onSelect: () => void; onDetail: () => void }) {
  const sc = useScale();
  const tone = k.status === 'ok' ? 'ok' : k.status === 'low' ? 'danger' : k.status === 'dead' ? 'danger' : 'muted';
  const usable = k.status === 'ok' || k.status === 'unknown';
  return (
    <Glass
      onPress={onSelect}
      onLongPress={onDetail}
      selected={selected}
      danger={k.status === 'low' || k.status === 'dead'}
      style={{ marginBottom: sc.s(10) }}
      pad={sc.s(14)}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
        <StatusDot tone={tone as any} size={sc.s(11)} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(15), fontWeight: '800', color: palette.ink }}>{k.label}</Text>
        {selected ? <Ionicons name="checkmark-circle" size={sc.s(20)} color={palette.accent} /> : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(6), marginTop: sc.s(9) }}>
        <Chip
          label={k.status === 'ok' ? '可用 · token 充足' : k.status === 'low' ? '额度预警' : k.status === 'dead' ? '已失效' : '待体检'}
          tone={k.status === 'ok' ? 'ok' : k.status === 'unknown' ? 'muted' : 'danger'}
          icon={k.status === 'ok' ? 'checkmark-circle' : k.status === 'unknown' ? 'help-circle' : 'alert-circle'}
        />
        <Chip label={k.remainingTokens != null ? `${compactNumber(k.remainingTokens)} tokens` : 'token 未知'} tone="accent" icon="pie-chart-outline" />
        {k.remainingUsd != null ? <Chip label={formatUsd(k.remainingUsd)} tone="accent" /> : null}
        <Chip label={k.source === 'auto' ? '自动建档' : '手动导入'} tone="muted" />
      </View>

      <Text numberOfLines={1} style={{ marginTop: sc.s(9), fontSize: sc.fs(12), color: palette.inkSoft, fontFamily: undefined }}>
        {k.maskedKey}
      </Text>
      <Text numberOfLines={1} style={{ marginTop: sc.s(3), fontSize: sc.fs(11), color: palette.inkFaint }}>
        {k.baseUrl}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sc.s(9), gap: sc.s(8) }}>
        <Text style={{ flex: 1, fontSize: sc.fs(10.5), color: palette.inkFaint }}>
          {k.checkedAt ? `体检于 ${relativeTime(k.checkedAt)}` : '尚未体检'}
        </Text>
        {!usable ? <Text style={{ fontSize: sc.fs(10.5), color: palette.danger, fontWeight: '700' }}>已移入预警区</Text> : null}
        <Pressable onPress={onDetail} hitSlop={8}>
          <Text style={{ fontSize: sc.fs(11.5), color: palette.accent, fontWeight: '800' }}>详情</Text>
        </Pressable>
      </View>
    </Glass>
  );
}

export function PoolScreen() {
  const sc = useScale();
  const app = useApp();
  const { requestLaunch, canLaunch, launchEnabledReason } = useLaunch();
  const [warnOpen, setWarnOpen] = useState(false);
  const [detail, setDetail] = useState<ApiKeyItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');

  const selected = useMemo(() => app.keys.find((k) => k.id === app.selectedKeyId) ?? null, [app.keys, app.selectedKeyId]);

  const usable = useMemo(
    () => app.keys.filter((k) => k.status === 'ok' || k.status === 'unknown').sort((a, b) => (b.remainingTokens ?? 0) - (a.remainingTokens ?? 0)),
    [app.keys],
  );
  const warned = useMemo(() => app.keys.filter((k) => k.status === 'low' || k.status === 'dead'), [app.keys]);

  useFocusEffect(
    React.useCallback(() => {
      if (app.ready && app.keys.length && !app.healthBusy) app.runHealthCheck(false).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [app.ready]),
  );

  const saveLabel = async () => {
    if (!detail) return;
    await app.updateKey(detail.id, { label: editLabel.trim() || detail.label });
    setEditing(false);
    setDetail(null);
  };

  return (
    <ScreenShell>
      <Header
        title="可用池"
        subtitle={`共 ${app.keys.length} 条 · 绿色可用 ${usable.length} · 预警 ${warned.length}`}
        right={
          <>
            <IconButton icon="medkit-outline" onPress={() => app.runHealthCheck(false)} disabled={app.healthBusy || !app.keys.length} tone="ok" />
            <IconButton icon="settings-outline" onPress={() => navigationRef.isReady() && navigationRef.navigate('Settings')} tone="muted" />
          </>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(150) }}
        showsVerticalScrollIndicator={false}
      >
        {app.healthBusy ? (
          <Glass style={{ marginBottom: sc.s(12) }} pad={sc.s(13)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(9) }}>
              <Ionicons name="pulse" size={sc.s(17)} color={palette.accent} />
              <Text style={{ flex: 1, fontSize: sc.fs(12.5), color: palette.inkSoft }}>正在体检每条 Key 的连通性与剩余额度…</Text>
            </View>
          </Glass>
        ) : null}

        {!app.keys.length ? (
          <Glass>
            <EmptyState
              icon="key-outline"
              title="可用池还是空的"
              desc="去「中转站」页登录一个站点，App 会自动创建 API 密钥并保存到这里；也可以用手动粘贴入口建档。"
              action={<GlassButton label="去中转站" icon="swap-horizontal-outline" onPress={() => navigationRef.isReady() && navigationRef.navigate('Main', { screen: 'Relay' } as never)} />}
            />
          </Glass>
        ) : null}

        {usable.length ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: sc.s(9) }}>
              <View style={{ width: sc.s(4), height: sc.s(17), borderRadius: sc.s(2), backgroundColor: palette.ok }} />
              <Text style={{ marginLeft: sc.s(8), flex: 1, fontSize: sc.fs(17), fontWeight: '800', color: palette.ink }}>可用区</Text>
              <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint }}>已自动筛出绿色、token 充足的 API</Text>
            </View>
            {usable.map((k) => (
              <KeyCard
                key={k.id}
                k={k}
                selected={k.id === app.selectedKeyId}
                onSelect={() => app.selectKey(k.id === app.selectedKeyId ? null : k.id)}
                onDetail={() => { setDetail(k); setEditLabel(k.label); }}
              />
            ))}
          </>
        ) : null}

        {warned.length ? (
          <Glass style={{ marginTop: sc.s(6), marginBottom: sc.s(10) }} pad={0}>
            <Pressable onPress={() => setWarnOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', padding: sc.s(14), gap: sc.s(9) }}>
              <View style={{ width: sc.s(30), height: sc.s(30), borderRadius: sc.s(10), backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="warning" size={sc.s(16)} color={palette.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: sc.fs(14.5), fontWeight: '800', color: palette.danger }}>红色预警区</Text>
                <Text style={{ marginTop: sc.s(2), fontSize: sc.fs(11), color: palette.inkFaint }}>{warned.length} 条已静默移入，仍保留在本机</Text>
              </View>
              <Ionicons name={warnOpen ? 'chevron-up' : 'chevron-down'} size={sc.s(18)} color={palette.danger} />
            </Pressable>
            {warnOpen ? (
              <View style={{ paddingHorizontal: sc.s(13), paddingBottom: sc.s(13) }}>
                {warned.map((k) => (
                  <View key={k.id} style={{ borderTopWidth: 1, borderTopColor: 'rgba(229,72,77,0.16)', paddingVertical: sc.s(10) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8) }}>
                      <StatusDot tone="danger" />
                      <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(13.5), fontWeight: '700', color: palette.ink }}>{k.label}</Text>
                      <Chip label={k.status === 'dead' ? '已失效' : '额度预警'} tone="danger" />
                    </View>
                    <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(11.5), color: palette.inkSoft, lineHeight: sc.fs(17) }}>{k.statusNote || '剩余额度低于阈值'}</Text>
                    <Text style={{ marginTop: sc.s(3), fontSize: sc.fs(10.5), color: palette.inkFaint }}>{k.maskedKey} · {k.baseUrl}</Text>
                    <View style={{ flexDirection: 'row', gap: sc.s(8), marginTop: sc.s(8) }}>
                      <GlassButton label="重新体检" size="sm" tone="muted" icon="medkit-outline" onPress={async () => { await app.runHealthCheck(false); }} />
                      <GlassButton label="详情" size="sm" tone="muted" onPress={() => { setDetail(k); setEditLabel(k.label); }} />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </Glass>
        ) : null}

        {app.keys.length ? (
          <Notice tone="muted">
            体检只发一次轻量请求（读取模型列表与余额），不会消耗你的对话额度。网络不可达时标「无法确认」，不会谎报失效。
          </Notice>
        ) : null}
      </ScrollView>

      {/* ============ 底部启动坞：位于「可用池」那一行的上面，居中放置 ============ */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: sc.tabHeight + sc.s(10), alignItems: 'center', paddingHorizontal: sc.gutter }}>
        <Glass tone="strong" pad={sc.s(13)} style={{ alignItems: 'center', maxWidth: sc.width - sc.gutter * 2 }}>
          <View style={{ alignItems: 'center' }}>
            {selected ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7) }}>
                  <StatusDot tone={selected.status === 'ok' ? 'ok' : 'muted'} />
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(14.5), fontWeight: '800', color: palette.ink, maxWidth: sc.width - sc.gutter * 2 - sc.s(60) }}>
                    {selected.label}
                  </Text>
                </View>
                <Text numberOfLines={1} style={{ marginTop: sc.s(4), fontSize: sc.fs(11), color: palette.inkFaint }}>
                  {selected.maskedKey} · {apiHostFor(selected)}
                </Text>
                <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(11.5), color: palette.accent, fontWeight: '700', textAlign: 'center' }}>
                  点下方圆形按钮启动，密钥与调用地址全自动导入
                </Text>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7) }}>
                  <Ionicons name="hand-left-outline" size={sc.s(16)} color={palette.inkFaint} />
                  <Text style={{ fontSize: sc.fs(14.5), fontWeight: '800', color: palette.inkSoft }}>未选择 API</Text>
                </View>
                <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(11.5), color: palette.inkFaint, textAlign: 'center', lineHeight: sc.fs(17) }}>
                  在上面选中一条绿色可用的 API，{'\n'}下方圆形启动按钮就会亮起
                </Text>
              </>
            )}
            <View style={{ marginTop: sc.s(11), alignSelf: 'center' }}>
              <GlassButton
                label={canLaunch ? '启动并自动导入' : '启动'}
                icon={canLaunch ? 'flash' : 'lock-closed-outline'}
                tone={canLaunch ? 'accent' : 'muted'}
                disabled={!canLaunch}
                onPress={requestLaunch}
              />
            </View>
            {!canLaunch && launchEnabledReason ? (
              <Text style={{ marginTop: sc.s(7), fontSize: sc.fs(10.5), color: palette.inkFaint, textAlign: 'center' }}>{launchEnabledReason}</Text>
            ) : null}
          </View>
        </Glass>
      </View>

      {/* 详情 */}
      <Sheet
        visible={!!detail}
        onClose={() => { setDetail(null); setEditing(false); }}
        title={detail?.label || 'API 详情'}
        footer={
          editing ? (
            <GlassButton label="保存备注名" icon="save-outline" size="lg" onPress={saveLabel} />
          ) : (
            <View style={{ flexDirection: 'row', gap: sc.s(8) }}>
              <GlassButton label="改名" icon="create-outline" tone="muted" onPress={() => setEditing(true)} style={{ flex: 1 } as any} />
              <GlassButton
                label="重新体检"
                icon="medkit-outline"
                onPress={async () => { await app.runHealthCheck(false); setDetail(null); }}
                style={{ flex: 1 } as any}
              />
            </View>
          )
        }
      >
        {detail ? (
          editing ? (
            <Field label="备注名" value={editLabel} onChangeText={setEditLabel} />
          ) : (
            <>
              <KeyValue k="状态" v={detail.status === 'ok' ? '可用' : detail.status === 'low' ? '额度预警（已静默移入预警区）' : detail.status === 'dead' ? '已失效（已静默移入预警区）' : '待体检'} />
              <KeyValue k="掩码密钥" v={detail.maskedKey} mono />
              <KeyValue k="调用地址" v={detail.baseUrl} mono />
              <KeyValue k="协议" v={detail.protocol} />
              <KeyValue k="剩余 token" v={detail.remainingTokens != null ? Math.round(detail.remainingTokens).toLocaleString('en-US') : '未知'} />
              <KeyValue k="剩余金额" v={formatUsd(detail.remainingUsd)} />
              <KeyValue k="来源" v={detail.source === 'auto' ? '中转站自动建档' : '手动导入'} />
              <KeyValue k="最近体检" v={dateTime(detail.checkedAt)} />
              <KeyValue k="体检说明" v={detail.statusNote || '—'} />
              <View style={{ height: sc.s(10) }} />
              <Notice tone="muted">
                真实密钥只存在于本机加密区（SecureStore），数据库里只有上面这串掩码。本 App 没有账号体系，也不会把任何私有数据上传云端。
              </Notice>
              <View style={{ height: sc.s(12) }} />
              <GlassButton
                label="从本机移除这条记录"
                icon="trash-outline"
                tone="danger"
                onPress={async () => { await app.removeKey(detail.id); setDetail(null); }}
              />
              <Text style={{ marginTop: sc.s(7), fontSize: sc.fs(10.5), color: palette.inkFaint, textAlign: 'center' }}>
                这是你主动发起的操作；App 不会主动建议你删除任何 API。
              </Text>
            </>
          )
        ) : null}
      </Sheet>
    </ScreenShell>
  );
}
