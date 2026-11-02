import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Busy, Chip, GlassButton, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { apiHostFor, canAutoImport, launchWithImport, type LaunchResult } from '../services/launcher';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import type { ChatClient } from '../lib/types';

/**
 * 启动流程编排：
 *  1. 取「可用池」当前选中的 API 与本机加密区里的真实密钥
 *  2. 扫描结果里挑候选聊天软件；只有 1 个就直接拉起，多个就让用户自选
 *  3. 一个都没识别到 -> 如实告知「需在设置中手动添加」
 *  4. 结果如实回报：全自动导入 / 仅拉起 / 无法确认 / 失败
 */

interface LaunchCtxValue {
  requestLaunch: () => void;
  launchEnabledReason: string | null;
  canLaunch: boolean;
}

const LaunchCtx = createContext<LaunchCtxValue | null>(null);

export function useLaunch(): LaunchCtxValue {
  const v = useContext(LaunchCtx);
  if (!v) throw new Error('useLaunch 必须在 LaunchProvider 内使用');
  return v;
}

function buzz() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

export function LaunchProvider({ children }: { children: React.ReactNode }) {
  const sc = useScale();
  const app = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [noAppOpen, setNoAppOpen] = useState(false);

  const selectedKey = useMemo(
    () => app.keys.find((k) => k.id === app.selectedKeyId) ?? null,
    [app.keys, app.selectedKeyId],
  );

  const canLaunch = !!selectedKey && (selectedKey.status === 'ok' || selectedKey.status === 'unknown');

  const launchEnabledReason = useMemo(() => {
    if (!app.keys.length) return '可用池里还没有 API，先去「中转站」登录自动建档';
    if (!selectedKey) return '先在「可用池」里选中一条绿色可用的 API';
    if (!canLaunch) return '选中的 API 在预警区，请改选绿色可用的 API';
    return null;
  }, [app.keys.length, selectedKey, canLaunch]);

  /** 候选：优先能全自动导入的，其次已识别安装的，最后是「无法确认」的 */
  const candidates = useMemo(() => {
    // 只把「能把密钥全自动写进去」的软件当作候选；不可导入的官方 App 不参与启动流程
    const usable = app.clients.filter(
      (c) =>
        canAutoImport(c) &&
        (c.browserBased || c.detected !== 'not_installed') &&
        (c.platform === 'all' || c.platform === Platform.OS),
    );
    const rank = (c: ChatClient) => (canAutoImport(c) ? 0 : c.detected === 'installed' ? 1 : 2);
    return [...usable].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [app.clients]);

  const doLaunch = useCallback(
    async (client: ChatClient) => {
      if (!selectedKey) return;
      setBusy(true);
      setPickerOpen(false);
      try {
        const secret = await app.getSecretOf(selectedKey);
        const res = await launchWithImport(client, selectedKey, secret);
        buzz();
        setResult(res);
        setResultOpen(true);
      } finally {
        setBusy(false);
      }
    },
    [selectedKey, app],
  );

  const requestLaunch = useCallback(() => {
    if (!canLaunch || !selectedKey) {
      buzz();
      return;
    }
    if (!candidates.length) {
      setNoAppOpen(true);
      return;
    }
    const preferredId = app.settings.preferredClientId;
    const preferred = preferredId ? candidates.find((c) => c.id === preferredId) : null;
    if (preferred && !app.settings.alwaysAskClient) {
      doLaunch(preferred);
      return;
    }
    if (!app.settings.alwaysAskClient && candidates.length === 1) {
      doLaunch(candidates[0]);
      return;
    }
    if (candidates.length === 1) {
      doLaunch(candidates[0]);
      return;
    }
    buzz();
    setPickerOpen(true);
  }, [canLaunch, selectedKey, candidates, app.settings, doLaunch]);

  const value = useMemo(() => ({ requestLaunch, launchEnabledReason, canLaunch }), [requestLaunch, launchEnabledReason, canLaunch]);

  return (
    <LaunchCtx.Provider value={value}>
      {children}

      {/* 选择聊天软件 */}
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="选择要启动的 AI 聊天软件">
        <Notice tone="accent" title="全自动导入说明">
          选中带「可全自动导入」标记的软件：Chatbox 走官方 deep link 直写配置，LobeChat 走官方 URL 参数写入（网页版 / PWA / 桌面版）。全程不需要你复制粘贴。其它软件只能拉起，App 会明说。
        </Notice>
        <View style={{ height: sc.s(12) }} />
        {candidates.map((c) => {
          const auto = canAutoImport(c);
          return (
            <Glass key={c.id} onPress={() => doLaunch(c)} style={{ marginBottom: sc.s(10) }} selected={c.id === app.settings.preferredClientId} pad={sc.s(13)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(10) }}>
                <View style={{ width: sc.s(38), height: sc.s(38), borderRadius: sc.s(12), backgroundColor: auto ? palette.okSoft : 'rgba(122,144,178,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={auto ? 'flash' : 'chatbubble-ellipses-outline'} size={sc.s(19)} color={auto ? palette.ok : palette.inkSoft} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: sc.fs(15), fontWeight: '800', color: palette.ink }}>
                    {c.name}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(5), marginTop: sc.s(5) }}>
                    <Chip
                      label={
                        c.importKind === 'deeplink_import'
                          ? '可全自动导入（deep link）'
                          : c.importKind === 'url_settings_import'
                            ? '可全自动导入（URL 参数）'
                            : c.importKind === 'launch_only'
                              ? '仅能打开'
                              : '导入能力无法确认'
                      }
                      tone={auto ? 'ok' : c.importKind === 'launch_only' ? 'warn' : 'muted'}
                    />
                    <Chip
                      label={c.detected === 'installed' ? '已识别安装' : c.detected === 'unknown' ? '安装状态无法确认' : '未安装'}
                      tone={c.detected === 'installed' ? 'accent' : 'muted'}
                    />
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={sc.s(18)} color={palette.inkFaint} />
              </View>
            </Glass>
          );
        })}
        {app.scanNote ? (
          <View style={{ marginTop: sc.s(4) }}>
            <Notice tone="warn" title="扫描能力说明">
              {app.scanNote}
            </Notice>
          </View>
        ) : null}
      </Sheet>

      {/* 一个都没识别到 */}
      <Sheet
        visible={noAppOpen}
        onClose={() => setNoAppOpen(false)}
        title="没有识别到 AI 聊天软件"
        footer={<GlassButton label="去设置里手动添加" icon="add-circle-outline" onPress={() => { setNoAppOpen(false); navigationRef.isReady() && navigationRef.navigate('Settings' as never); }} size="lg" />}
      >
        <Notice tone="warn" title="需要手动添加">
          本机扫描没有找到「可全自动导入」的 AI 聊天软件。ChatGPT / Claude / Gemini / 豆包这类官方 App 不接受第三方密钥，本来就不在可导入范围内。请到「设置 → 从已安装应用添加」里挑一个开源客户端，或先安装 Chatbox（本 App 已内置其官方一键导入协议）。
        </Notice>
        <View style={{ height: sc.s(10) }} />
        <GlassButton label="重新扫描一次" icon="refresh-outline" onPress={async () => { setNoAppOpen(false); await app.rescanClients(); }} />
      </Sheet>

      {/* 启动结果（如实回报） */}
      <Sheet visible={resultOpen} onClose={() => setResultOpen(false)} title="启动结果">
        {busy ? <Busy label="正在拉起…" /> : null}
        {result ? (
          <>
            <Notice
              tone={result.ok ? (result.mode === 'auto_import' || result.mode === 'url_import' ? 'ok' : 'warn') : 'danger'}
              title={result.title}
            >
              {result.message}
            </Notice>
            <View style={{ height: sc.s(12) }} />
            {selectedKey ? (
              <Glass pad={sc.s(13)} style={{ marginBottom: sc.s(12) }}>
                <Text style={{ fontSize: sc.fs(12.5), color: palette.inkSoft }}>本次导入的内容</Text>
                <View style={{ height: sc.s(6) }} />
                <Text style={{ fontSize: sc.fs(13), color: palette.ink, fontWeight: '700' }}>调用地址：{apiHostFor(selectedKey)}</Text>
                <Text style={{ marginTop: sc.s(4), fontSize: sc.fs(13), color: palette.ink, fontWeight: '700' }}>密钥：{selectedKey.maskedKey}</Text>
                <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(11), color: palette.inkFaint }}>密钥明文只从本机加密区读出并交给目标 App，未经过剪贴板，也没有上传任何服务器。</Text>
              </Glass>
            ) : null}
            {result.mode === 'launch_only' ? (
              <Notice tone="accent" title="想全自动导入？">
                改用 Chatbox 即可：本 App 内置了它官方的「导入第三方提供方配置」deep link，点一下就能把密钥和调用地址直接写进去。
              </Notice>
            ) : null}
            {result.ok && result.url ? (
              <View style={{ marginTop: sc.s(12) }}>
                <GlassButton label="再拉起一次" icon="refresh-outline" onPress={() => { if (selectedKey) doLaunch(app.clients.find((c) => c.name === result.clientName) ?? app.clients[0]); }} />
              </View>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </LaunchCtx.Provider>
  );
}
