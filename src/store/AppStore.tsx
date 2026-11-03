import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as DB from '../data/db';
import { DEFAULT_SETTINGS } from '../data/db';
import { CHAT_APP_REGISTRY } from '../data/chatAppRegistry';
import { SEED_RELAYS } from '../data/seed';
import { delSecret, getSecret, putSecret } from '../data/vault';
import { maskKey, quotaToUsd, todayKey, usdToTokensEstimate } from '../lib/format';
import { normalizeUrl, siteKeyOf } from '../lib/normalize';
import { secretRef, uid } from '../lib/id';
import type { ApiKeyItem, ApiProtocol, AppSettings, Benefit, ChatClient, CheckinLog, Relay } from '../lib/types';
import { detectClients, reconcileWithInstalled, shellCapabilityNote } from '../services/detectApps';
import { listInstalledApps } from '../native/installedApps';
import { checkKeyHealth } from '../services/healthCheck';
import { offlineBenefits, refreshRadar, type FetchReport } from '../services/radarFeed';
import { fetchAdapters, OFFICIAL_ADAPTER_FEED } from '../services/adapterFeed';
import { headlessCheckin, headlessProbeSite } from '../services/headlessCheckin';
import { autoProvisionApiKey, createSystemAccessToken, doCheckin, fetchCheckinSupport, fetchSelf, httpTransport, joinApiBase, type Transport } from '../services/relayApi';

interface NewKeyInput {
  label: string;
  key: string;
  baseUrl: string;
  provider?: string;
  protocol?: ApiProtocol;
  relayId?: string | null;
  source?: 'auto' | 'manual';
  remainingUsd?: number | null;
  remainingTokens?: number | null;
}

interface StoreValue {
  ready: boolean;
  bootError: string | null;
  settings: AppSettings;
  benefits: Benefit[];
  relays: Relay[];
  keys: ApiKeyItem[];
  clients: ChatClient[];
  logs: CheckinLog[];
  report: FetchReport | null;
  radarBusy: boolean;
  radarStage: string;
  healthBusy: boolean;
  checkinBusy: boolean;
  selectedKeyId: string | null;
  scanNote: string | null;

  patchSettings: (p: Partial<AppSettings>) => Promise<void>;
  refreshRadar: (force?: boolean) => Promise<void>;
  selectKey: (id: string | null) => void;
  addKey: (input: NewKeyInput) => Promise<ApiKeyItem | null>;
  updateKey: (id: string, patch: Partial<ApiKeyItem>) => Promise<void>;
  removeKey: (id: string) => Promise<void>;
  runHealthCheck: (onlySelected?: boolean) => Promise<void>;
  getSecretOf: (k: ApiKeyItem) => Promise<string | null>;

  addRelayByUrl: (name: string, url: string, note?: string) => Promise<Relay>;
  updateRelay: (r: Relay) => Promise<void>;
  removeRelay: (id: string) => Promise<void>;
  relayTransport: (r: Relay) => Transport | null;
  provisionRelay: (r: Relay, t: Transport, label?: string) => Promise<{ ok: boolean; message: string; key?: ApiKeyItem | null }>;
  persistAccessToken: (r: Relay, t: Transport) => Promise<{ ok: boolean; message: string }>;
  syncRelay: (r: Relay) => Promise<Relay>;
  probeRelay: (r: Relay) => Promise<Relay>;
  checkinRelay: (r: Relay, transport?: Transport) => Promise<CheckinLog>;
  checkinAll: (transports?: Record<string, Transport>) => Promise<CheckinLog[]>;

  rescanClients: () => Promise<void>;
  refreshAdapters: (force?: boolean) => Promise<void>;
  adapterNotes: string[];
  updateClient: (c: ChatClient) => Promise<void>;
  addCustomClient: (input: {
    name: string;
    scheme: string;
    importKind: ChatClient['importKind'];
    importTemplate?: string;
    settingsTemplate?: string;
    settingsBase?: string;
    launchTemplate?: string;
    browserBased?: boolean;
    androidPackage?: string | null;
  }) => Promise<void>;
  removeCustomClient: (id: string) => Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

export function useApp(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用');
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [relays, setRelays] = useState<Relay[]>([]);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [clients, setClients] = useState<ChatClient[]>([]);
  const [logs, setLogs] = useState<CheckinLog[]>([]);
  const [report, setReport] = useState<FetchReport | null>(null);
  const [radarBusy, setRadarBusy] = useState(false);
  const [radarStage, setRadarStage] = useState('');
  const [healthBusy, setHealthBusy] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [adapterNotes, setAdapterNotes] = useState<string[]>([]);
  const booted = useRef(false);

  /* ------------------------------ 启动 ------------------------------ */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        await DB.getDb();
        const s = await DB.loadSettings();
        // 不自动替用户选软件：没配置时启动按钮保持灰色，由用户在设置里明确选择
        setSettings(s);

        // 聊天软件登记表：首次写入内置清单
        let cs = await DB.listClients();
        if (!cs.length) {
          for (const seed of CHAT_APP_REGISTRY) {
            await DB.upsertClient({
              ...seed,
              builtin: true,
              detected: 'unknown',
              detectReason: '尚未扫描',
              addedAt: Date.now(),
              source: 'builtin',
            } as ChatClient);
          }
          cs = await DB.listClients();
        }
        setClients(cs);

        // 中转站目录：首次写入内置站点
        let rs = await DB.listRelays();
        if (!rs.length) {
          for (const seed of SEED_RELAYS) {
            await DB.upsertRelay({
              id: uid('relay'),
              name: seed.name,
              baseUrl: normalizeUrl(seed.baseUrl),
              kind: seed.kind,
              userId: null,
              username: null,
              accessTokenRef: null,
              credentialRef: null,
              hasSession: false,
              apiBase: null,
              checkinMode: null,
              checkinSupport: 'unknown',
              checkinSupportNote: null,
              autoKeySupport: seed.kind === 'new-api' ? 'unknown' : 'no',
              autoKeyNote: seed.kind === 'new-api' ? null : seed.note,
              quota: null,
              usedQuota: null,
              remainingUsd: null,
              remainingTokens: null,
              lastSyncAt: null,
              lastCheckinAt: null,
              note: seed.note,
              builtin: true,
              createdAt: Date.now(),
            });
          }
          rs = await DB.listRelays();
        }
        setRelays(rs);

        const ks = await DB.listKeys();
        setKeys(ks);
        const lg = await DB.listCheckinLogs();
        setLogs(lg);

        let bs = await DB.listBenefits();
        if (!bs.length) {
          bs = offlineBenefits();
          await DB.replaceBenefits(bs);
        }
        setBenefits(bs);

        setReady(true);
      } catch (e: any) {
        setBootError(String(e?.message || e));
        setReady(true);
      }
    })();
  }, []);

  /* ------------------------- 打开即自动扫描聊天软件 ------------------------- */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const note = shellCapabilityNote();
      if (!cancelled) setScanNote(note);
      try {
        if (!cancelled) await rescanClients();
        refreshAdapters(false).catch(() => {});
      } catch {
        /* 扫描失败不影响主流程 */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* ------------------------- 打开即自动体检可用池 ------------------------- */
  useEffect(() => {
    if (!ready || !settings.autoHealthCheck || !keys.length) return;
    const last = keys.filter((k) => k.checkedAt).map((k) => k.checkedAt as number).sort((a, b) => b - a)[0];
    if (last && Date.now() - last < 10 * 60 * 1000) return;
    runHealthCheck(false).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.autoHealthCheck]);

  /* ------------------------------ 设置 ------------------------------ */
  const patchSettings = useCallback(async (p: Partial<AppSettings>) => {
    const next = await DB.saveSettings(p);
    setSettings(next);
  }, []);

  /* ------------------------------ 雷达站 ------------------------------ */
  const doRefreshRadar = useCallback(
    async (force = false) => {
      if (radarBusy) return;
      const last = settings.lastRadarFetchAt;
      if (!force && last && Date.now() - last < 6 * 60 * 60 * 1000) return;
      setRadarBusy(true);
      setRadarStage('正在准备抓取…');
      try {
        const { items, report: rep } = await refreshRadar(settings.feedUrls, (stage, done, total) => {
          setRadarStage(`${stage} ${done}/${total}`);
        });
        await DB.replaceBenefits(items);
        setBenefits(items);
        setReport(rep);
        await patchSettings({ lastRadarFetchAt: Date.now() });
      } catch (e: any) {
        setReport((prev) => prev ?? {
          startedAt: Date.now(),
          finishedAt: Date.now(),
          probed: 0,
          liveOk: 0,
          liveFail: 0,
          remoteOk: 0,
          remoteFail: 0,
          officialCount: benefits.filter((b) => b.section === 'official').length,
          relayCount: benefits.filter((b) => b.section === 'relay').length,
          notes: [`抓取异常：${e?.message || e}`],
        });
      } finally {
        setRadarStage('');
        setRadarBusy(false);
      }
    },
    [radarBusy, settings.feedUrls, settings.lastRadarFetchAt, patchSettings, benefits],
  );

  /* ------------------------------ 可用池 ------------------------------ */
  const selectKey = useCallback((id: string | null) => setSelectedKeyId(id), []);

  const getSecretOf = useCallback(async (k: ApiKeyItem) => getSecret(k.secretRef), []);

  const addKey = useCallback(async (input: NewKeyInput): Promise<ApiKeyItem | null> => {
    const raw = (input.key || '').trim();
    if (!raw) return null;
    const id = uid('key');
    const ref = secretRef('apikey', id);
    const stored = await putSecret(ref, raw);
    const item: ApiKeyItem = {
      id,
      relayId: input.relayId ?? null,
      label: input.label.trim() || '未命名 API',
      maskedKey: maskKey(raw),
      baseUrl: normalizeUrl(input.baseUrl),
      provider: input.provider || '',
      protocol: input.protocol || 'openai_compatible',
      secretRef: stored ? ref : '',
      status: 'unknown',
      remainingTokens: input.remainingTokens ?? null,
      remainingUsd: input.remainingUsd ?? null,
      statusNote: stored ? null : 'SecureStore 写入失败，密钥未落盘（本机加密区不可用）',
      checkedAt: null,
      source: input.source || 'manual',
      createdAt: Date.now(),
    };
    await DB.upsertKey(item);
    setKeys((prev) => [item, ...prev.filter((x) => x.id !== item.id)]);
    return item;
  }, []);

  const updateKey = useCallback(async (id: string, patch: Partial<ApiKeyItem>) => {
    const list = await DB.listKeys();
    const target = list.find((k) => k.id === id);
    if (!target) return;
    const next = { ...target, ...patch };
    await DB.upsertKey(next);
    setKeys((await DB.listKeys()));
  }, []);

  const removeKey = useCallback(async (id: string) => {
    const list = await DB.listKeys();
    const target = list.find((k) => k.id === id);
    if (target?.secretRef) await delSecret(target.secretRef);
    await DB.deleteKey(id);
    setKeys((await DB.listKeys()));
    setSelectedKeyId((cur) => (cur === id ? null : cur));
  }, []);

  const runHealthCheck = useCallback(
    async (onlySelected = false) => {
      if (healthBusy) return;
      setHealthBusy(true);
      try {
        const targets = onlySelected && selectedKeyId ? keys.filter((k) => k.id === selectedKeyId) : keys;
        for (const k of targets) {
          const secret = await getSecret(k.secretRef);
          const res = await checkKeyHealth(k, { lowTokens: settings.lowTokenThreshold, lowUsd: settings.lowUsdThreshold }, secret);
          const next: ApiKeyItem = {
            ...k,
            status: res.status,
            remainingTokens: res.remainingTokens,
            remainingUsd: res.remainingUsd,
            statusNote: res.note,
            checkedAt: Date.now(),
          };
          await DB.upsertKey(next);
          setKeys((prev) => prev.map((x) => (x.id === next.id ? next : x)));
        }
      } finally {
        setHealthBusy(false);
      }
    },
    [healthBusy, keys, selectedKeyId, settings.lowTokenThreshold, settings.lowUsdThreshold],
  );

  /* ------------------------------ 中转站 ------------------------------ */
  const addRelayByUrl = useCallback(async (name: string, url: string, note?: string): Promise<Relay> => {
    const baseUrl = normalizeUrl(url);
    const existing = (await DB.listRelays()).find((r) => siteKeyOf(r.baseUrl) === siteKeyOf(baseUrl));
    if (existing) return existing;
    const relay: Relay = {
      id: uid('relay'),
      name: name.trim() || siteKeyOf(baseUrl),
      baseUrl,
      kind: 'unknown',
      userId: null,
      username: null,
      accessTokenRef: null,
      credentialRef: null,
      hasSession: false,
      apiBase: null,
      checkinMode: null,
      checkinSupport: 'unknown',
      checkinSupportNote: null,
      autoKeySupport: 'unknown',
      autoKeyNote: null,
      quota: null,
      usedQuota: null,
      remainingUsd: null,
      remainingTokens: null,
      lastSyncAt: null,
      lastCheckinAt: null,
      note: note ?? null,
      builtin: false,
      createdAt: Date.now(),
    };
    await DB.upsertRelay(relay);
    setRelays(await DB.listRelays());
    return relay;
  }, []);

  const updateRelay = useCallback(async (r: Relay) => {
    await DB.upsertRelay(r);
    setRelays(await DB.listRelays());
  }, []);

  const removeRelay = useCallback(async (id: string) => {
    const list = await DB.listRelays();
    const target = list.find((r) => r.id === id);
    if (target?.accessTokenRef) await delSecret(target.accessTokenRef);
    if (target?.credentialRef) await delSecret(target.credentialRef);
    await DB.deleteRelay(id);
    setRelays(await DB.listRelays());
  }, []);

  /** 登录/粘贴 Key 后：后台读登录态、API 根与签到方式，把站点收进每日签到 */
  const probeRelay = useCallback(async (r: Relay): Promise<Relay> => {
    const p = await headlessProbeSite(r);
    const remainingUsd = p.self ? quotaToUsd(p.self.quota) : r.remainingUsd;
    const next: Relay = {
      ...r,
      hasSession: p.session || r.hasSession,
      apiBase: p.apiBase ?? r.apiBase,
      userId: p.self?.id ?? r.userId,
      username: p.self?.username ?? r.username,
      quota: p.self?.quota ?? r.quota,
      usedQuota: p.self?.usedQuota ?? r.usedQuota,
      remainingUsd,
      remainingTokens: p.self ? usdToTokensEstimate(remainingUsd) : r.remainingTokens,
      checkinSupport: p.session ? p.checkinSupport : r.checkinSupport,
      checkinMode: p.session ? p.checkinMode : r.checkinMode,
      checkinSupportNote: p.session ? p.note : p.note || r.checkinSupportNote,
      lastSyncAt: Date.now(),
    };
    await DB.upsertRelay(next);
    setRelays(await DB.listRelays());
    return next;
  }, []);

  /** 已保存长期访问令牌时，可在 App 侧直接代理请求（无需打开 WebView） */
  const relayTransport = useCallback(
    (r: Relay): Transport | null => {
      if (!r.accessTokenRef) return null;
      return {
        name: 'http',
        async request(path, init = {}) {
          const token = await getSecret(r.accessTokenRef);
          const t = httpTransport(r.apiBase || r.baseUrl, { accessToken: token, userId: r.userId });
          return t.request(path, init);
        },
      } as Transport;
    },
    [],
  );

  const persistAccessToken = useCallback(
    async (r: Relay, t: Transport) => {
      const res = await createSystemAccessToken(t, '剪纸仙灵');
      if (!res.ok || !res.token) {
        return { ok: false, message: res.reason || '站点未开放系统访问令牌' };
      }
      const ref = secretRef('relay_at', r.id);
      const stored = await putSecret(ref, res.token);
      if (!stored) return { ok: false, message: '令牌已拿到，但本机加密区写入失败' };
      await DB.upsertRelay({ ...r, accessTokenRef: ref, hasSession: true });
      setRelays(await DB.listRelays());
      return { ok: true, message: '已保存长期访问令牌，之后签到/查余额无需再打开网页' };
    },
    [],
  );

  /** 核心功能①：自动建档 API Key 并落库 */
  const provisionRelay = useCallback(
    async (r: Relay, t: Transport, label?: string) => {
      // 用嗅探出的真实 API 根（如 /apiroot），而不是页面地址（如 /docs）
      const res = await autoProvisionApiKey(t, r.apiBase || r.baseUrl, label || r.name);
      const trace = res.trace?.join('\n') || '';
      if (!res.ok || !res.key || !res.apiBase) {
        const support: Relay = {
          ...r,
          autoKeySupport: res.needManual ? 'no' : 'unknown',
          autoKeyNote: `${res.reason || '自动建档失败'}${trace ? `\n${trace}` : ''}`,
          userId: res.userId ?? r.userId,
          username: res.username ?? r.username,
          quota: res.quota ?? r.quota,
          usedQuota: res.usedQuota ?? r.usedQuota,
          remainingUsd: res.remainingUsd ?? r.remainingUsd,
          remainingTokens: res.remainingTokens ?? r.remainingTokens,
          lastSyncAt: Date.now(),
        };
        await DB.upsertRelay(support);
        setRelays(await DB.listRelays());
        return { ok: false, message: res.reason || '自动建档失败', key: null };
      }

      const item = await addKey({
        label: label || `${r.name} · ${res.tokenName || '自动建档'}`,
        key: res.key,
        baseUrl: res.apiBase,
        provider: r.name,
        protocol: 'openai_compatible',
        relayId: r.id,
        source: 'auto',
        remainingUsd: res.remainingUsd ?? null,
        remainingTokens: res.remainingTokens ?? null,
      });

      const next: Relay = {
        ...r,
        kind: r.kind === 'unknown' ? 'new-api' : r.kind,
        userId: res.userId ?? r.userId,
        username: res.username ?? r.username,
        hasSession: true,
        autoKeySupport: 'yes',
        autoKeyNote: trace || '自动建档成功',
        quota: res.quota ?? r.quota,
        usedQuota: res.usedQuota ?? r.usedQuota,
        remainingUsd: res.remainingUsd ?? r.remainingUsd,
        remainingTokens: res.remainingTokens ?? r.remainingTokens,
        lastSyncAt: Date.now(),
      };
      await DB.upsertRelay(next);
      setRelays(await DB.listRelays());
      return { ok: true, message: `已自动创建并保存：${maskKey(res.key)}`, key: item };
    },
    [addKey],
  );

  const syncRelay = useCallback(async (r: Relay): Promise<Relay> => {
    const t = relayTransport(r);
    if (!t) return r;
    const selfRes = await fetchSelf(t);
    const support = await fetchCheckinSupport(t);
    const remainingUsd = selfRes.ok ? quotaToUsd(selfRes.self?.quota ?? null) : r.remainingUsd;
    const next: Relay = {
      ...r,
      userId: selfRes.ok ? selfRes.self!.id : r.userId,
      username: selfRes.ok ? selfRes.self!.username : r.username,
      quota: selfRes.ok ? selfRes.self!.quota : r.quota,
      usedQuota: selfRes.ok ? selfRes.self!.usedQuota : r.usedQuota,
      remainingUsd,
      remainingTokens: usdToTokensEstimate(remainingUsd),
      checkinSupport: support.support,
      checkinSupportNote: support.reason,
      lastSyncAt: Date.now(),
    };
    await DB.upsertRelay(next);
    setRelays(await DB.listRelays());
    return next;
  }, [relayTransport]);

  /* ------------------------------ 签到 ------------------------------ */
  const writeLog = useCallback(async (relay: Relay, result: CheckinLog['result'], message: string, gainedUsd: number | null) => {
    const log: CheckinLog = {
      id: uid('log'),
      relayId: relay.id,
      relayName: relay.name,
      at: Date.now(),
      result,
      message,
      gainedUsd,
    };
    await DB.addCheckinLog(log);
    setLogs(await DB.listCheckinLogs());
    return log;
  }, []);

  const checkinRelay = useCallback(
    async (r: Relay, transport?: Transport): Promise<CheckinLog> => {
      const t = transport || relayTransport(r);
      const useApi = !!t && r.checkinMode !== 'dom';
      let outcome: CheckinLog['result'];
      let message: string;
      let gained: number | null = null;

      let hb: Awaited<ReturnType<typeof headlessCheckin>> | null = null;
      if (useApi) {
        const res = await doCheckin(t);
        outcome = res.outcome;
        message = res.message;
        gained = res.gainedUsd;
        if (res.outcome === 'unconfirmed') {
          hb = await headlessCheckin(r);
          outcome = hb.outcome;
          message = hb.message;
        }
      } else {
        // 无长期凭据 / 签到在网页按钮上：后台隐形 WebView 一键完成，不跳转界面
        hb = await headlessCheckin(r);
        outcome = hb.outcome;
        message = hb.message;
      }

      const p = hb?.probe;
      const basePatch: Partial<Relay> = p?.session
        ? {
            hasSession: true,
            apiBase: p.apiBase ?? r.apiBase,
            userId: p.self?.id ?? r.userId,
            username: p.self?.username ?? r.username,
            quota: p.self?.quota ?? r.quota,
            usedQuota: p.self?.usedQuota ?? r.usedQuota,
            remainingUsd: p.self ? quotaToUsd(p.self.quota) : r.remainingUsd,
            remainingTokens: p.self ? usdToTokensEstimate(quotaToUsd(p.self.quota)) : r.remainingTokens,
            checkinSupport: p.checkinSupport,
            checkinMode: hb?.mode ?? p.checkinMode,
            checkinSupportNote: p.note,
          }
        : {};

      if (outcome === 'success') {
        await DB.upsertRelay({
          ...r,
          ...basePatch,
          checkinSupport: 'yes',
          checkinMode: hb?.mode ?? r.checkinMode,
          checkinSupportNote: null,
          lastCheckinAt: Date.now(),
          lastSyncAt: Date.now(),
        });
        setRelays(await DB.listRelays());
      } else if (outcome === 'manual_only' || outcome === 'unconfirmed') {
        await DB.upsertRelay({ ...r, ...basePatch, checkinSupportNote: message });
        setRelays(await DB.listRelays());
      } else {
        await DB.upsertRelay({ ...r, ...basePatch });
        setRelays(await DB.listRelays());
      }
      return writeLog(r, outcome, message, gained);
    },
    [relayTransport, writeLog],
  );
  const checkinAll = useCallback(
    async (transports?: Record<string, Transport>) => {
      setCheckinBusy(true);
      try {
        const out: CheckinLog[] = [];
        const targets = relays.filter(
          (r) => r.accessTokenRef || r.hasSession || keys.some((k) => k.relayId === r.id),
        );
        for (const r of targets) {
          const t = transports?.[r.id] || relayTransport(r);
          // 没有长期凭据也照样走后台隐形 WebView（与登录 WebView 共享 Cookie），
          // 不能直接判成「只能手动」。
          out.push(await checkinRelay(r, t || undefined));
        }
        return out;
      } finally {
        setCheckinBusy(false);
      }
    },
    [relays, keys, relayTransport, checkinRelay, writeLog],
  );

  /* ------------------------------ 远程适配器清单 ------------------------------ */
  const refreshAdapters = useCallback(
    async (force = false) => {
      const urls = settings.adapterFeedUrls || [];
      if (!urls.length) {
        setAdapterNotes([]);
        return;
      }
      const last = settings.lastAdapterFetchAt;
      if (!force && last && Date.now() - last < 12 * 60 * 60 * 1000) return;
      const { adapters, notes } = await fetchAdapters(urls);
      setAdapterNotes(notes);
      if (adapters.length) {
        const existing = await DB.listClients();
        for (const a of adapters) {
          const cur = existing.find((x) => x.id === a.id);
          const merged: ChatClient = cur
            ? {
                ...cur,
                name: a.name,
                scheme: a.scheme,
                androidPackage: a.androidPackage,
                iosBundleId: a.iosBundleId,
                importKind: a.importKind,
                importTemplate: a.importTemplate,
                settingsTemplate: a.settingsTemplate,
                settingsBase: a.settingsBase,
                launchTemplate: a.launchTemplate,
                browserBased: a.browserBased,
                note: a.note,
                platform: a.platform,
                source: 'feed',
              }
            : a;
          await DB.upsertClient(merged);
        }
        setClients(await DB.listClients());
      }
      await patchSettings({ lastAdapterFetchAt: Date.now() });
    },
    [settings.adapterFeedUrls, settings.lastAdapterFetchAt, patchSettings],
  );

  const updateClient = useCallback(async (c: ChatClient) => {
    await DB.upsertClient(c);
    setClients(await DB.listClients());
  }, []);

  /* ------------------------------ 聊天软件 ------------------------------ */  const rescanClients = useCallback(async () => {
    const note = shellCapabilityNote();
    setScanNote(note);
    // 第一层：全量已安装列表（QUERY_ALL_PACKAGES），包名精确匹配 + 名称启发式自动建档
    const installed = await listInstalledApps();
    let cur = await DB.listClients();
    const { updates, creates } = reconcileWithInstalled(installed, cur);
    for (const u of updates) await DB.upsertClient(u);
    for (const n of creates) await DB.upsertClient(n);
    cur = await DB.listClients();
    // 第二层：scheme 白名单探测（只跑还没被包名确认的）
    const needScheme = cur.filter((c) => !!c.scheme && c.detected !== 'installed');
    const detected = await detectClients(needScheme);
    for (const d of detected) await DB.upsertClient(d);
    setClients(await DB.listClients());
  }, []);
  const addCustomClient = useCallback(
    async (input: {
      name: string;
      scheme: string;
      importKind: ChatClient['importKind'];
      importTemplate?: string;
      settingsTemplate?: string;
      settingsBase?: string;
      launchTemplate?: string;
      browserBased?: boolean;
      androidPackage?: string | null;
    }) => {
      const id = `custom_${uid('c')}`.replace(/[^A-Za-z0-9_]/g, '_');
      const c: ChatClient = {
        id,
        name: input.name.trim() || '自定义软件',
        scheme: input.scheme.trim().replace(/:\/+$/, '') || null,
        androidPackage: input.androidPackage || null,
        iosBundleId: null,
        importKind: input.importKind,
        importTemplate: input.importTemplate || undefined,
        settingsTemplate: input.settingsTemplate || undefined,
        settingsBase: input.settingsBase || undefined,
        launchTemplate: input.launchTemplate || undefined,
        browserBased: !!input.browserBased,
        platform: 'all',
        builtin: false,
        detected: input.androidPackage ? 'installed' : 'unknown',
        detectReason: input.androidPackage ? '从本机已安装应用列表添加' : '自定义条目，未扫描',
        addedAt: Date.now(),
        source: 'custom',
      };
      await DB.upsertClient(c);
      setClients(await DB.listClients());
    },
    [],
  );

  const removeCustomClient = useCallback(async (id: string) => {
    await DB.deleteClient(id);
    setClients(await DB.listClients());
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      bootError,
      settings,
      benefits,
      relays,
      keys,
      clients,
      logs,
      report,
      radarBusy,
      radarStage,
      healthBusy,
      checkinBusy,
      selectedKeyId,
      scanNote,
      patchSettings,
      refreshRadar: doRefreshRadar,
      selectKey,
      addKey,
      updateKey,
      removeKey,
      runHealthCheck,
      getSecretOf,
      addRelayByUrl,
      updateRelay,
      removeRelay,
      relayTransport,
      provisionRelay,
      persistAccessToken,
      syncRelay,
      probeRelay,
      checkinRelay,
      checkinAll,
      rescanClients,
      refreshAdapters,
      adapterNotes,
      updateClient,
      addCustomClient,
      removeCustomClient,
    }),
    [
      ready, bootError, settings, benefits, relays, keys, clients, logs, report,
      radarBusy, radarStage, healthBusy, checkinBusy, selectedKeyId, scanNote,
      patchSettings, doRefreshRadar, selectKey, addKey, updateKey, removeKey,
      runHealthCheck, getSecretOf, addRelayByUrl, updateRelay, removeRelay,
      relayTransport, provisionRelay, persistAccessToken, syncRelay, probeRelay,
      checkinRelay, checkinAll, rescanClients, refreshAdapters, adapterNotes, updateClient,
      addCustomClient, removeCustomClient,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
