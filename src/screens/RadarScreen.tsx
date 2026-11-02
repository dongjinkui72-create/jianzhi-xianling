import React, { useCallback, useMemo, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Busy, Chip, Collapsible, EmptyState, GlassButton, IconButton, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { Header, ScreenShell } from '../components/Screen';
import { relativeTime } from '../lib/format';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import type { Benefit, Confidence } from '../lib/types';

/**
 * 雷达站。
 * 迭代要求：「官方」和「中转站」是平行的两个分组，表头位于同一行，内容左右两栏并列。
 * 中转站内容按关键词 api 抓取，验收 ≥ 5 条（内置种子离线也达标）。
 */

const CONF: Record<Confidence, { label: string; tone: 'ok' | 'accent' | 'muted' }> = {
  verified: { label: '已核实', tone: 'ok' },
  likely: { label: '大概率有效', tone: 'accent' },
  unconfirmed: { label: '无法确认', tone: 'muted' },
};

function MiniCard({ b, onPress }: { b: Benefit; onPress: () => void }) {
  const sc = useScale();
  const conf = CONF[b.confidence] ?? CONF.unconfirmed;
  return (
    <Glass onPress={onPress} style={{ marginBottom: sc.s(9) }} pad={sc.s(11)}>
      <Text numberOfLines={1} style={{ fontSize: sc.fs(11), fontWeight: '800', color: palette.accent, letterSpacing: 0.2 }}>
        {b.provider}
      </Text>
      <Text numberOfLines={2} style={{ marginTop: sc.s(4), fontSize: sc.fs(12.5), fontWeight: '700', color: palette.ink, lineHeight: sc.fs(17) }}>
        {b.title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(4), marginTop: sc.s(7) }}>
        {b.quotaText ? <Chip label={b.quotaText} tone="ok" icon="gift" /> : null}
        <Chip label={conf.label} tone={conf.tone} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sc.s(7), gap: sc.s(4) }}>
        <Ionicons name="list-outline" size={sc.s(11)} color={palette.inkFaint} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(10), color: palette.inkFaint }}>
          {b.steps.length} 步领取 · {relativeTime(b.fetchedAt)}
        </Text>
      </View>
    </Glass>
  );
}

function GroupHeader({ title, count, accent }: { title: string; count: number; accent: string }) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(6), marginBottom: sc.s(8) }}>
      <View style={{ width: sc.s(4), height: sc.s(15), borderRadius: sc.s(2), backgroundColor: accent }} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(15), fontWeight: '800', color: palette.ink }}>
        {title}
      </Text>
      <View style={{ paddingHorizontal: sc.s(8), paddingVertical: sc.s(2), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.85)', borderWidth: 1, borderColor: palette.hairline }}>
        <Text style={{ fontSize: sc.fs(10.5), fontWeight: '800', color: palette.inkSoft }}>{count}</Text>
      </View>
    </View>
  );
}

export function RadarScreen() {
  const sc = useScale();
  const { benefits, refreshRadar, radarBusy, radarStage, report, settings } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<Benefit | null>(null);

  const official = useMemo(() => benefits.filter((b) => b.section === 'official'), [benefits]);
  const relay = useMemo(() => benefits.filter((b) => b.section === 'relay'), [benefits]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshRadar(true);
    setRefreshing(false);
  }, [refreshRadar]);

  useFocusEffect(
    useCallback(() => {
      const last = settings.lastRadarFetchAt;
      const stale = !last || Date.now() - last > 12 * 60 * 60 * 1000;
      if (stale && !radarBusy) refreshRadar(false).catch(() => {});
    }, [settings.lastRadarFetchAt, radarBusy, refreshRadar]),
  );

  const colGap = sc.s(9);

  return (
    <ScreenShell>
      <Header
        title="雷达站"
        subtitle={`每天自动巡检官方定价页与中转站 · 上次抓取 ${relativeTime(settings.lastRadarFetchAt)}`}
        right={
          <>
            <IconButton icon="refresh" onPress={onRefresh} disabled={radarBusy} tone="accent" />
            <IconButton icon="settings-outline" onPress={() => navigationRef.isReady() && navigationRef.navigate('Settings')} tone="muted" />
          </>
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: sc.gutter, paddingBottom: sc.tabHeight + sc.s(90) }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} colors={[palette.accent]} />}
      >
        {radarBusy ? (
          <Glass pad={sc.s(12)} style={{ marginBottom: sc.s(10) }}>
            <Busy label={radarStage || '正在抓取情报…'} />
          </Glass>
        ) : null}

        {report ? (
          <Collapsible title="本次抓取报告" subtitle={`${report.liveOk} 个站点实抓成功 · ${report.liveFail} 个失败`} right={<Ionicons name="pulse-outline" size={sc.s(17)} color={palette.accent} />}>
            <View style={{ paddingTop: sc.s(10) }}>
              {report.notes.map((n, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: sc.s(7), marginBottom: sc.s(6) }}>
                  <Ionicons name={n.startsWith('⚠️') ? 'alert-circle' : 'information-circle-outline'} size={sc.s(14)} color={n.startsWith('⚠️') ? palette.warn : palette.inkFaint} style={{ marginTop: sc.s(1) }} />
                  <Text style={{ flex: 1, fontSize: sc.fs(11.5), color: palette.inkSoft, lineHeight: sc.fs(17) }}>{n}</Text>
                </View>
              ))}
            </View>
          </Collapsible>
        ) : null}

        {relay.length < 5 ? (
          <View style={{ marginBottom: sc.s(10) }}>
            <Notice tone="warn" title="中转站分区未达到验收标准">
              当前只有 {relay.length} 条（要求 ≥ 5 条）。内置种子库正常时应至少有 10 条，请检查数据库是否被清空。
            </Notice>
          </View>
        ) : null}

        {/* 两个分组表头：同一行、平行 */}
        <View style={{ flexDirection: 'row', gap: colGap, marginTop: sc.s(4) }}>
          <View style={{ flex: 1 }}>
            <GroupHeader title="官方" count={official.length} accent={palette.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <GroupHeader title="中转站" count={relay.length} accent={palette.ok} />
          </View>
        </View>

        {/* 两栏并列内容 */}
        {official.length === 0 && relay.length === 0 ? (
          <Glass>
            <EmptyState icon="radio-outline" title="还没有情报" desc="下拉刷新开始抓取，或在设置里添加你自己的情报源。" action={<GlassButton label="立即抓取" icon="download-outline" onPress={onRefresh} />} />
          </Glass>
        ) : (
          <View style={{ flexDirection: 'row', gap: colGap, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              {official.map((b) => (
                <MiniCard key={b.id} b={b} onPress={() => setDetail(b)} />
              ))}
              {official.length === 0 ? <Text style={{ fontSize: sc.fs(11), color: palette.inkFaint }}>暂无</Text> : null}
            </View>
            <View style={{ flex: 1 }}>
              {relay.map((b) => (
                <MiniCard key={b.id} b={b} onPress={() => setDetail(b)} />
              ))}
              {relay.length === 0 ? <Text style={{ fontSize: sc.fs(11), color: palette.inkFaint }}>暂无</Text> : null}
            </View>
          </View>
        )}

        <View style={{ marginTop: sc.s(6) }}>
          <Notice tone="muted">
            额度情报来自公开页面抓取，已做「上下文窗口 / 速率限制」噪声排除；标注「无法确认」的条目表示本次没能核实，App 不会谎报。点卡片看完整「怎么领」步骤。
          </Notice>
        </View>
      </ScrollView>

      {/* 情报详情 */}
      <Sheet
        visible={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.provider || ''}
        footer={<GlassButton label="打开官网" icon="open-outline" size="lg" onPress={() => detail && Linking.openURL(detail.url).catch(() => {})} />}
      >
        {detail ? (
          <>
            <Text style={{ fontSize: sc.fs(16), fontWeight: '800', color: palette.ink, lineHeight: sc.fs(22) }}>{detail.title}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(6), marginTop: sc.s(9) }}>
              {detail.quotaText ? <Chip label={detail.quotaText} tone="ok" icon="gift" /> : null}
              {detail.validUntil ? <Chip label={detail.validUntil} tone="muted" icon="time-outline" /> : null}
              <Chip label={(CONF[detail.confidence] ?? CONF.unconfirmed).label} tone={(CONF[detail.confidence] ?? CONF.unconfirmed).tone} />
              <Chip label={detail.origin === 'live' ? '实抓' : '内置'} tone={detail.origin === 'live' ? 'ok' : 'muted'} />
            </View>
            {detail.summary ? <Text style={{ marginTop: sc.s(9), fontSize: sc.fs(12.5), color: palette.inkSoft, lineHeight: sc.fs(19) }}>{detail.summary}</Text> : null}
            {detail.evidence ? (
              <View style={{ marginTop: sc.s(9), borderLeftWidth: 2.5, borderLeftColor: detail.confidence === 'unconfirmed' ? palette.warn : palette.ok, paddingLeft: sc.s(9) }}>
                <Text style={{ fontSize: sc.fs(11), color: palette.inkFaint, lineHeight: sc.fs(16) }}>抓取证据：{detail.evidence}</Text>
              </View>
            ) : null}
            <View style={{ marginTop: sc.s(12) }}>
              <Text style={{ fontSize: sc.fs(13), fontWeight: '800', color: palette.ink, marginBottom: sc.s(7) }}>怎么领</Text>
              {detail.steps.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: sc.s(8), marginBottom: sc.s(6) }}>
                  <View style={{ width: sc.s(17), height: sc.s(17), borderRadius: sc.s(8.5), backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: sc.s(1) }}>
                    <Text style={{ fontSize: sc.fs(10), fontWeight: '800', color: palette.accent }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, fontSize: sc.fs(12.5), color: palette.inkSoft, lineHeight: sc.fs(19) }}>{s}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </Sheet>
    </ScreenShell>
  );
}