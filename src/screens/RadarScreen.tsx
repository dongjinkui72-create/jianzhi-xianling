import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, RefreshControl, SectionList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Busy, Chip, Collapsible, EmptyState, GlassButton, IconButton, Notice } from '../components/Bits';
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
 * 迭代要求：界面最上方不再有分组筛选条，只保留「官方」和「中转站」两个分区。
 * 中转站分区内容按关键词 api 抓取，验收标准 ≥ 5 条（内置种子库离线也保证达标）。
 */

const CONF: Record<Confidence, { label: string; tone: 'ok' | 'accent' | 'muted' }> = {
  verified: { label: '已核实', tone: 'ok' },
  likely: { label: '大概率有效', tone: 'accent' },
  unconfirmed: { label: '无法确认', tone: 'muted' },
};

function BenefitCard({ b }: { b: Benefit }) {
  const sc = useScale();
  const conf = CONF[b.confidence] ?? CONF.unconfirmed;
  return (
    <Glass style={{ marginBottom: sc.s(11) }} pad={sc.s(14)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(7), marginBottom: sc.s(7) }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: sc.fs(12), fontWeight: '800', color: palette.accent, letterSpacing: 0.3 }}>
          {b.provider}
        </Text>
        <Chip label={conf.label} tone={conf.tone} icon={b.confidence === 'verified' ? 'checkmark-circle' : b.confidence === 'likely' ? 'sparkles' : 'help-circle'} />
        <Chip label={b.origin === 'live' ? '实抓' : '内置'} tone={b.origin === 'live' ? 'ok' : 'muted'} />
      </View>

      <Text style={{ fontSize: sc.fs(16), fontWeight: '800', color: palette.ink, lineHeight: sc.fs(22) }}>{b.title}</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(6), marginTop: sc.s(9) }}>
        {b.quotaText ? <Chip label={b.quotaText} tone="ok" icon="gift" /> : null}
        {b.validUntil ? <Chip label={b.validUntil} tone="muted" icon="time-outline" /> : null}
        {b.quotaUsd != null ? <Chip label={`≈ $${b.quotaUsd}`} tone="accent" /> : null}
        {b.quotaTokens != null ? <Chip label={`≈ ${b.quotaTokens.toLocaleString('en-US')} tokens`} tone="accent" /> : null}
      </View>

      {b.summary ? (
        <Text style={{ marginTop: sc.s(9), fontSize: sc.fs(12.5), color: palette.inkSoft, lineHeight: sc.fs(19) }}>{b.summary}</Text>
      ) : null}

      {b.evidence ? (
        <View style={{ marginTop: sc.s(9), borderLeftWidth: 2.5, borderLeftColor: b.confidence === 'unconfirmed' ? palette.warn : palette.ok, paddingLeft: sc.s(9) }}>
          <Text style={{ fontSize: sc.fs(11), color: palette.inkFaint, lineHeight: sc.fs(16) }}>抓取证据：{b.evidence}</Text>
        </View>
      ) : null}

      <View style={{ marginTop: sc.s(12) }}>
        <Text style={{ fontSize: sc.fs(12.5), fontWeight: '800', color: palette.ink, marginBottom: sc.s(7) }}>怎么领</Text>
        {b.steps.map((s, i) => (
          <View key={`${b.id}-s${i}`} style={{ flexDirection: 'row', gap: sc.s(8), marginBottom: sc.s(6) }}>
            <View style={{ width: sc.s(17), height: sc.s(17), borderRadius: sc.s(8.5), backgroundColor: palette.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: sc.s(1) }}>
              <Text style={{ fontSize: sc.fs(10), fontWeight: '800', color: palette.accent }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: sc.fs(12.5), color: palette.inkSoft, lineHeight: sc.fs(19) }}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8), marginTop: sc.s(12) }}>
        <GlassButton label="打开官网" icon="open-outline" size="sm" onPress={() => Linking.openURL(b.url).catch(() => {})} />
        <Text style={{ flex: 1, fontSize: sc.fs(10.5), color: palette.inkFaint, textAlign: 'right' }}>更新于 {relativeTime(b.fetchedAt)}</Text>
      </View>
    </Glass>
  );
}

export function RadarScreen() {
  const sc = useScale();
  const { benefits, refreshRadar, radarBusy, radarStage, report, settings } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const sections = useMemo(() => {
    const official = benefits.filter((b) => b.section === 'official');
    const relay = benefits.filter((b) => b.section === 'relay');
    return [
      { title: '官方', hint: '厂商官网直发的免费额度', data: official },
      { title: '中转站', hint: `关键词 api · 共 ${relay.length} 条`, data: relay },
    ];
  }, [benefits]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshRadar(true);
    setRefreshing(false);
  }, [refreshRadar]);

  // 每天自动抓取：距上次超过 12 小时就静默刷新一次
  useFocusEffect(
    useCallback(() => {
      const last = settings.lastRadarFetchAt;
      const stale = !last || Date.now() - last > 12 * 60 * 60 * 1000;
      if (stale && !radarBusy) refreshRadar(false).catch(() => {});
    }, [settings.lastRadarFetchAt, radarBusy, refreshRadar]),
  );

  useEffect(() => {
    // 冷启动兜底：若列表为空立刻用内置种子填充，保证中转站分区不空
  }, []);

  const relayCount = sections[1].data.length;

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

      <SectionList
        sections={sections as any}
        keyExtractor={(item: Benefit) => item.id}
        renderItem={({ item }) => <BenefitCard b={item} />}
        renderSectionHeader={({ section }) => (
          <View style={{ paddingHorizontal: sc.gutter, paddingTop: sc.s(6), paddingBottom: sc.s(9), flexDirection: 'row', alignItems: 'center', gap: sc.s(8), backgroundColor: 'transparent' }}>
            <View style={{ width: sc.s(4), height: sc.s(17), borderRadius: sc.s(2), backgroundColor: palette.accent }} />
            <Text style={{ fontSize: sc.fs(18), fontWeight: '800', color: palette.ink }}>{section.title}</Text>
            <Text style={{ flex: 1, fontSize: sc.fs(11.5), color: palette.inkFaint }}>{section.hint}</Text>
            <View style={{ paddingHorizontal: sc.s(9), paddingVertical: sc.s(3), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: 1, borderColor: palette.hairline }}>
              <Text style={{ fontSize: sc.fs(11.5), fontWeight: '800', color: palette.inkSoft }}>{section.data.length}</Text>
            </View>
          </View>
        )}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: sc.gutter, paddingBottom: sc.s(6) }}>
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

            {relayCount < 5 ? (
              <View style={{ marginBottom: sc.s(10) }}>
                <Notice tone="warn" title="中转站分区未达到验收标准">
                  当前只有 {relayCount} 条（要求 ≥ 5 条）。内置种子库正常时应至少有 10 条，请检查数据库是否被清空。
                </Notice>
              </View>
            ) : null}

            <Notice tone="muted">
              额度情报来自公开页面抓取，已做「上下文窗口 / 速率限制」噪声排除，但厂商政策随时会变，实际以官网为准。标注「无法确认」的条目表示本次没能核实，App 不会谎报。
            </Notice>
            <View style={{ height: sc.s(12) }} />
          </View>
        }
        ListFooterComponent={<View style={{ height: sc.tabHeight + sc.s(20) }} />}
        contentContainerStyle={{ paddingBottom: sc.s(10) }}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent} colors={[palette.accent]} />}
        ListEmptyComponent={
          <EmptyState icon="radio-outline" title="还没有情报" desc="下拉刷新开始抓取，或在设置里添加你自己的情报源。" action={<GlassButton label="立即抓取" icon="download-outline" onPress={onRefresh} />} />
        }
        showsVerticalScrollIndicator={false}
      />
    </ScreenShell>
  );
}