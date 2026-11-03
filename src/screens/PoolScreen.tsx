import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Chip, EmptyState, Field, GlassButton, IconButton, KeyValue, Notice, Sheet, StatusDot } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { compactNumber, dateTime, formatUsd, relativeTime } from '../lib/format';
import { groupKeys, isSelectable } from '../lib/poolGroups';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import { useLaunch } from '../launch/LaunchProvider';
import { apiHostFor } from '../services/launcher';
import type { ApiKeyItem } from '../lib/types';

/**
 * 可用池。
 * 迭代要求：
 *  - 每条 API 都要显示额度；
 *  - 绿色可用 / 黄色预警 / 红色无效 三个分组，默认全部折叠，各自带展开按钮；
 *  - 只有绿色分组可选中；选中后右下角悬浮启动按钮亮起；
 *  - 「未选择 API + 启动提示」这一块居中放在底部「可用池」那一行的上面。
 * 红线：预警/无效只静默归组，绝不出现「建议删除该 API」这类提示。
 */

function quotaLine(k: ApiKeyItem): string {
  const parts: string[] = [];
  if (k.remainingTokens != null) parts.push(`${compactNumber(k.remainingTokens)} tokens`);
  if (k.remainingUsd != null) parts.push(formatUsd(k.remainingUsd));
  return parts.length ? parts.join(' · ') : '额度未知（站点未开放查询）';
}

function KeyRow({ k, selected, selectable, onSelect, onDetail }: { k: ApiKeyItem; selected: boolean; selectable: boolean; onSelect: () => void; onDetail: () => void }) {
  const sc = useScale();
  const tone = k.status === 'ok' || k.status === 'unknown' ? 'ok' : k.status === 'low' ? 'warn' : 'danger';
  return (
    <Glass
      onPress={selectable ? onSelect : undefined}
      selected={selected}
      danger={k.status === 'dead'}
      style={{ marginBottom: sc.s(9) }}
      pad={sc.s(12)}
      tone={k.status === 'low' || k.status === 'dead' ? 'soft' : 'default'}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8) }}>
        <StatusDot tone={tone as any} size={sc.s(10)} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(14), fontWeight: '800', color: palette.ink }}>{k.label}</Text>
        {selected ? <Ionicons name="checkmark-circle" size={sc.s(19)} color={palette.accent} /> : null}
      </View>

      {/* 额度显示：每条都有 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(6), marginTop: sc.s(8) }}>
        <Ionicons name="pie-chart-outline" size={sc.s(13)} color={tone === 'ok' ? palette.ok : tone === 'warn' ? palette.warn : palette.danger} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(12.5), fontWeight: '700', color: palette.inkSoft }}>
          剩余额度 {quotaLine(k)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(7) }}>
        <Chip
          label={k.status === 'ok' ? '可用' : k.status === 'unknown' ? '待体检' : k.status === 'low' ? '额度预警' : '已失效'}
          tone={k.status === 'ok' ? 'ok' : k.status === 'unknown' ? 'muted' : k.status === 'low' ? 'warn' : 'danger'}
        />
        <Chip label={k.source === 'auto' ? '自动建档' : '手动导入'} tone="muted" />
        {k.checkedAt ? <Chip label={`体检 ${relativeTime(k.checkedAt)}`} tone="muted" /> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sc.s(7), gap: sc.s(8) }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(10.5), color: palette.inkFaint }}>{k.maskedKey}</Text>
        <Pressable onPress={onDetail} hitSlop={8}>
          <Text style={{ fontSize: sc.fs(11.5), color: palette.accent, fontWeight: '800' }}>详情</Text>
        </Pressable>
      </View>
    </Glass>
  );
}

function Group({ title, tone, count, hint, children }: { title: string; tone: 'ok' | 'warn' | 'danger'; count: number; hint: string; children: React.ReactNode }) {
  const sc = useScale();
  const [open, setOpen] = useState(false);
  const color = tone === 'ok' ? palette.ok : tone === 'warn' ? palette.warn : palette.danger;
  return (
    <Glass pad={0} style={{ marginBottom: sc.s(10) }}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', padding: sc.s(13), gap: sc.s(9) }}>
        <View style={{ width: sc.s(30), height: sc.s(30), borderRadius: sc.s(10), backgroundColor: tone === 'ok' ? palette.okSoft : tone === 'warn' ? palette.warnSoft : palette.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={tone === 'ok' ? 'checkmark-circle' : tone === 'warn' ? 'warning' : 'close-circle'} size={sc.s(16)} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: sc.fs(14.5), fontWeight: '800', color }}>{title}</Text>
          <Text numberOfLines={1} style={{ marginTop: sc.s(2), fontSize: sc.fs(10.5), color: palette.inkFaint }}>{hint}</Text>
        </View>
        <View style={{ paddingHorizontal: sc.s(9), paddingVertical: sc.s(3), borderRadius: 999, backgroundColor: palette.chipBg, borderWidth: 1, borderColor: palette.hairline }}>
          <Text style={{ fontSize: sc.fs(11), fontWeight: '800', color: palette.inkSoft }}>{count}</Text>
        </View>
        <View style={{ width: sc.s(30), height: sc.s(30), borderRadius: sc.s(15), backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: palette.hairline, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={sc.s(15)} color={color} />
        </View>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: sc.s(12), paddingBottom: sc.s(12), borderTopWidth: 1, borderTopColor: palette.hairlineSoft, paddingTop: sc.s(10) }}>{children}</View> : null}
    </Glass>
  );
}

export function PoolScreen() {
  const sc = useScale();
  const app = useApp();
  const { launchEnabledReason } = useLaunch();
  const [detail, setDetail] = useState<ApiKeyItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');

  const groups = useMemo(() => groupKeys(app.keys), [app.keys]);
  const selected = useMemo(() => app.keys.find((k) => k.id === app.selectedKeyId) ?? null, [app.keys, app.selectedKeyId]);

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
        subtitle={`共 ${app.keys.length} 条 · 绿 ${groups.green.length} / 黄 ${groups.yellow.length} / 红 ${groups.red.length}`}
        right={
          <>
            <IconButton icon="medkit-outline" onPress={() => app.runHealthCheck(false)} disabled={app.healthBusy || !app.keys.length} tone="ok" />
            <IconButton icon="settings-outline" onPress={() => navigationRef.isReady() && navigationRef.navigate('Settings')} tone="muted" />
          </>
        }
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(170) }} showsVerticalScrollIndicator={false}>
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
        ) : (
          <>
            <Group title="绿色可用" tone="ok" count={groups.green.length} hint="token 充足，可选中后启动">
              {groups.green.map((k) => (
                <KeyRow key={k.id} k={k} selected={k.id === app.selectedKeyId} selectable={isSelectable(k)} onSelect={() => app.selectKey(k.id === app.selectedKeyId ? null : k.id)} onDetail={() => { setDetail(k); setEditLabel(k.label); }} />
              ))}
            </Group>

            <Group title="黄色预警" tone="warn" count={groups.yellow.length} hint="额度低于阈值，已静默移入">
              {groups.yellow.map((k) => (
                <KeyRow key={k.id} k={k} selected={false} selectable={false} onSelect={() => {}} onDetail={() => { setDetail(k); setEditLabel(k.label); }} />
              ))}
              {groups.yellow.length === 0 ? <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint }}>当前没有预警的 Key。</Text> : null}
            </Group>

            <Group title="红色无效" tone="danger" count={groups.red.length} hint="接口不可用或额度耗尽，已静默移入">
              {groups.red.map((k) => (
                <KeyRow key={k.id} k={k} selected={false} selectable={false} onSelect={() => {}} onDetail={() => { setDetail(k); setEditLabel(k.label); }} />
              ))}
              {groups.red.length === 0 ? <Text style={{ fontSize: sc.fs(11.5), color: palette.inkFaint }}>当前没有失效的 Key。</Text> : null}
            </Group>

          </>
        )}
      </ScrollView>

      {/* 底部启动坞：居中放在「可用池」那一行的上面 */}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: sc.tabHeight + sc.s(10), alignItems: 'center', paddingHorizontal: sc.gutter }}>
        <Glass tone="strong" pad={sc.s(12)} style={{ alignItems: 'center', maxWidth: sc.width - sc.gutter * 2 }}>
          {selected ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7) }}>
                <StatusDot tone={selected.status === 'ok' ? 'ok' : 'muted'} />
                <Text numberOfLines={1} style={{ fontSize: sc.fs(14), fontWeight: '800', color: palette.ink, maxWidth: sc.width - sc.gutter * 2 - sc.s(70) }}>
                  {selected.label}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ marginTop: sc.s(4), fontSize: sc.fs(10.5), color: palette.inkFaint }}>
                剩余额度 {quotaLine(selected)} · {apiHostFor(selected)}
              </Text>
              <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(11.5), color: palette.accent, fontWeight: '700', textAlign: 'center' }}>
                点右下角启动按钮：打开已配置软件，能自动导入就自动写入，否则用悬浮窗送达
              </Text>
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7) }}>
                <Ionicons name="hand-left-outline" size={sc.s(15)} color={palette.inkFaint} />
                <Text style={{ fontSize: sc.fs(14), fontWeight: '800', color: palette.inkSoft }}>未选择 API</Text>
              </View>
              <Text style={{ marginTop: sc.s(5), fontSize: sc.fs(11), color: palette.inkFaint, textAlign: 'center', lineHeight: sc.fs(16) }}>
                先在「设置」里配置 AI 聊天软件，{'\n'}再展开「绿色可用」选中一条 API，启动按钮才会亮起
              </Text>
              {launchEnabledReason ? <Text style={{ marginTop: sc.s(4), fontSize: sc.fs(10), color: palette.inkFaint, textAlign: 'center' }}>{launchEnabledReason}</Text> : null}
            </>
          )}
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
              <GlassButton label="重新体检" icon="medkit-outline" onPress={async () => { await app.runHealthCheck(false); setDetail(null); }} style={{ flex: 1 } as any} />
            </View>
          )
        }
      >
        {detail ? (
          editing ? (
            <Field label="备注名" value={editLabel} onChangeText={setEditLabel} />
          ) : (
            <>
              <KeyValue k="分组" v={detail.status === 'ok' || detail.status === 'unknown' ? '绿色可用' : detail.status === 'low' ? '黄色预警（静默归组）' : '红色无效（静默归组）'} />
              <KeyValue k="剩余额度" v={quotaLine(detail)} />
              <KeyValue k="掩码密钥" v={detail.maskedKey} mono />
              <KeyValue k="调用地址" v={detail.baseUrl} mono />
              <KeyValue k="协议" v={detail.protocol} />
              <KeyValue k="来源" v={detail.source === 'auto' ? '中转站自动建档' : '手动导入'} />
              <KeyValue k="最近体检" v={dateTime(detail.checkedAt)} />
              <KeyValue k="体检说明" v={detail.statusNote || '—'} />
              <View style={{ height: sc.s(10) }} />
              <Notice tone="muted">
                真实密钥只存在于本机加密区（SecureStore），数据库里只有上面这串掩码。本 App 没有账号体系，也不会把任何私有数据上传云端。
              </Notice>
              <View style={{ height: sc.s(12) }} />
              <GlassButton label="从本机移除这条记录" icon="trash-outline" tone="danger" onPress={async () => { await app.removeKey(detail.id); setDetail(null); }} />
              <Text style={{ marginTop: sc.s(7), fontSize: sc.fs(10.5), color: palette.inkFaint, textAlign: 'center' }}>这是你主动发起的操作；App 不会主动建议你删除任何 API。</Text>
            </>
          )
        ) : null}
      </Sheet>
    </ScreenShell>
  );
}