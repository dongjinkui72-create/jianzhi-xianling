import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Busy, Chip, GlassButton, Notice, Sheet } from '../components/Bits';
import { Glass } from '../components/Glass';
import { apiHostFor, canAutoImport, launchOnly, launchWithImport, type LaunchResult } from '../services/launcher';
import { canOverlay, requestOverlay, showCredentialOverlay } from '../native/overlay';
import { navigationRef } from '../navigation/navRef';
import { useApp } from '../store/AppStore';
import { HeadlessCheckinHost } from './HeadlessCheckinHost';
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
  const [overlayPrompt, setOverlayPrompt] = useState(false);
  const [pendingCred, setPendingCred] = useState<{ title: string; base: string; key: string } | null>(null);
  const [pendingClient, setPendingClient] = useState<ChatClient | null>(null);
  const awaitingOverlay = useRef(false);

  const selectedKey = useMemo(
    () => app.keys.find((k) => k.id === app.selectedKeyId) ?? null,
    [app.keys, app.selectedKeyId],
  );

  /** 用户在设置里配置好的聊天软件（没有配置就禁用启动按钮） */
  const configuredClient = useMemo(() => {
    const id = app.settings.preferredClientId;
    return id ? app.clients.find((c) => c.id === id) ?? null : null;
  }, [app.clients, app.settings.preferredClientId]);

  const canLaunch =
    !!configuredClient &&
    (configuredClient.detected === 'installed' || !!configuredClient.browserBased) &&
    !!selectedKey &&
    (selectedKey.status === 'ok' || selectedKey.status === 'unknown');

  const launchEnabledReason = useMemo(() => {
    if (!configuredClient) return '还没有配置 AI 聊天软件：先去「设置 → AI 聊天软件」选一个';
    if (configuredClient.detected !== 'installed' && !configuredClient.browserBased) {
      return '配置的软件当前不在手机上，请在设置里重新选择';
    }
    if (!app.keys.length) return '可用池里还没有 API，先去「中转站」登录自动建档';
    if (!selectedKey) return '先在「可用池」里选中一条绿色可用的 API';
    if (!canLaunch) return '选中的 API 在预警区，请改选绿色可用的 API';
    return null;
  }, [configuredClient, app.keys.length, selectedKey, canLaunch]);

  /** 候选只用于设置页之外的兜底选择界面，启动时不参与：永远打开用户配置好的软件 */
  const candidates = useMemo(() => {
    const usable = app.clients.filter(
      (c) =>
        (c.platform === 'all' || c.platform === Platform.OS) &&
        ((canAutoImport(c) && (c.browserBased || c.detected !== 'not_installed')) ||
          (c.importKind === 'unconfirmed' && c.detected === 'installed')),
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
        if (!secret) {
          buzz();
          setResult({
            ok: false,
            mode: 'failed',
            title: '读取密钥失败',
            message: '本机加密区里没有找到这条 API 的明文密钥，请重新导入一次。',
            clientName: client.name,
          });
          setResultOpen(true);
          return;
        }

        const auto = canAutoImport(client);
        // 不能自动导入的软件必须先有悬浮窗权限，否则无法把地址和密钥送到目标 App 上。
        // 先在本 App 内提示授权，授权后会自动继续「打开 App 并显示悬浮窗」。
        if (!auto && !(await canOverlay())) {
          setPendingCred({ title: `${client.name} · 凭证`, base: apiHostFor(selectedKey), key: secret });
          setPendingClient(client);
          setOverlayPrompt(true);
          return;
        }
        let res: LaunchResult;

        if (auto) {
          // 先走官方自动导入协议
          res = await launchWithImport(client, selectedKey, secret);
          if (!res.ok) {
            // 协议失败也必须先把 App 打开，再改用悬浮窗
            const lo = await launchOnly(client);
            res = {
              ...res,
              ok: lo.ok,
              mode: lo.ok ? 'launch_only' : 'failed',
              title: lo.ok ? `已拉起 ${client.name}` : `${client.name} 未能拉起`,
              message: lo.ok ? '自动导入协议没有成功，已打开 App；调用地址与密钥改用悬浮窗送达。' : lo.message,
              url: lo.url,
            };
          }
        } else {
          // 没有自动导入协议：直接拉起，再用悬浮窗送达
          const lo = await launchOnly(client);
          res = {
            ok: lo.ok,
            mode: lo.ok ? 'unconfirmed' : 'failed',
            title: lo.ok ? `已拉起 ${client.name}` : lo.title,
            message: lo.ok
              ? `${client.name} 不能自动写入密钥，已打开 App；调用地址与密钥通过悬浮窗送达，点开小圆钮复制即可。`
              : lo.message,
            url: lo.url,
            clientName: client.name,
          };
        }

        // 仍然没打开：重新扫描已安装应用后再试一次，绝不原地卡住
        if (!res.ok) {
          await app.rescanClients();
          const lo2 = await launchOnly(client);
          if (lo2.ok) {
            res = {
              ...lo2,
              mode: auto ? 'launch_only' : 'unconfirmed',
              title: `已拉起 ${client.name}`,
              message: auto
                ? `已打开 ${client.name}，自动导入没有成功，地址与密钥改用悬浮窗送达。`
                : `${client.name} 不能自动写入密钥，已打开 App；地址与密钥通过悬浮窗送达。`,
            };
          }
        }

        // 需要悬浮窗：自动导入失败，或软件本身没有导入协议
        const needOverlay = res.ok && !(res.mode === 'auto_import' || res.mode === 'url_import');
        if (needOverlay) {
          // 等目标 App 到前台后再盖悬浮窗，避免盖在我们自己界面上
          await new Promise((r) => setTimeout(r, 800));
          const allowed = await canOverlay();
          if (allowed) {
            const shown = await showCredentialOverlay(`${client.name} · 凭证`, apiHostFor(selectedKey), secret);
            if (shown) {
              res = { ...res, message: `${res.message} 悬浮窗已开启：点小圆钮显示地址与密钥（可复制），再点收起，长按关闭。` };
            }
          } else {
            setPendingCred({ title: `${client.name} · 凭证`, base: apiHostFor(selectedKey), key: secret });
            setOverlayPrompt(true);
          }
        }

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
    if (!canLaunch || !selectedKey || !configuredClient) {
      buzz();
      return;
    }
    // 永远打开设置里配置好的那个 App；不再弹选择框、不再走商店兜底
    doLaunch(configuredClient);
  }, [canLaunch, selectedKey, configuredClient, doLaunch]);

  // 从系统「悬浮窗权限」页返回时自动继续：打开配置好的 App 并显示凭证
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !awaitingOverlay.current) return;
      awaitingOverlay.current = false;
      if (await canOverlay()) {
        if (pendingClient) await doLaunch(pendingClient);
      } else {
        setOverlayPrompt(true);
      }
    });
    return () => sub.remove();
  }, [pendingClient, doLaunch]);

  const value = useMemo(() => ({ requestLaunch, launchEnabledReason, canLaunch }), [requestLaunch, launchEnabledReason, canLaunch]);

  return (
    <LaunchCtx.Provider value={value}>
      {children}
      <HeadlessCheckinHost />

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
                      label={c.detected === 'installed' ? '已识别安装' : c.detected === 'unknown' ? '安装状态无法确认' : '未安装'}
                      tone={c.detected === 'installed' ? 'accent' : 'muted'}
                    />
                    {!auto && c.detected === 'installed' ? <Chip label='悬浮窗送达' tone='warn' /> : null}
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

      {/* 悬浮窗权限提示 */}
      <Sheet
        visible={overlayPrompt}
        onClose={() => setOverlayPrompt(false)}
        title="这个 App 没有自动导入协议"
        footer={
          <GlassButton
            label="开启悬浮窗权限并打开 App"
            icon="layers-outline"
            size="lg"
            onPress={async () => {
              setOverlayPrompt(false);
              awaitingOverlay.current = true;
              await requestOverlay();
            }}
          />
        }
      >
        <Notice tone="warn" title="改用悬浮窗凭证层">
          {" 不接受外部写入配置。授权「显示在其他应用上层」后，本 App 会自动打开它，并把调用地址与密钥以悬浮窗盖在它界面上：默认收起，点一下显示并可复制，再点收起，长按关闭。"}
        </Notice>
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
                <Text style={{ marginTop: sc.s(6), fontSize: sc.fs(11), color: palette.inkFaint }}>密钥明文只从本机加密区读出：能自动导入的直接交给目标 App；不能自动导入的放在悬浮窗里，由你点复制。全程不上传服务器。</Text>
              </Glass>
            ) : null}
            {result.mode === 'launch_only' ? (
              <Notice tone="accent" title="想全自动导入？">
                改用 Chatbox 即可：本 App 内置了它官方的「导入第三方提供方配置」deep link，点一下就能把密钥和调用地址直接写进去。
              </Notice>
            ) : null}
            <View style={{ marginTop: sc.s(12), flexDirection: 'row', flexWrap: 'wrap', gap: sc.s(8) }}>
              <GlassButton
                label="再拉起一次"
                icon="refresh-outline"
                disabled={!configuredClient}
                onPress={() => configuredClient && doLaunch(configuredClient)}
              />
              {!result.ok ? (
                <GlassButton
                  label="去设置选择软件"
                  icon="settings-outline"
                  tone="muted"
                  onPress={() => { setResultOpen(false); navigationRef.isReady() && navigationRef.navigate('Settings' as never); }}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </Sheet>
    </LaunchCtx.Provider>
  );
}
