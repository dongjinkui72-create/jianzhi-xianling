import { allSeedBenefits, SEED_BENEFITS } from '../data/seed';
import { parseQuota, extractBenefitLines, normalizeText, htmlToText, siteKeyOf } from '../lib/normalize';
import type { Benefit, RadarSection } from '../lib/types';
import { uid } from '../lib/id';

/**
 * 雷达站情报抓取。
 *
 * 三层数据源，逐层降级，永远不让页面空掉：
 *  1. 远程公开情报 JSON（可在设置里追加，匿名可读，不含任何私有数据）
 *  2. 直接抓取厂商官网定价页 / 中转站首页，按关键词 api 提炼福利句
 *  3. 内置种子库（离线兜底，保证中转站分区 ≥ 5 条）
 *
 * 所有抓取结果都要过 normalize.ts 的「边界归一化 + 噪声词排除」，
 * 防止把「262,144 tokens 上下文窗口」当成赠送额度。
 */

/** 中转站情报抓取关键词（2.0 起为 api + 中转站） */
export const RELAY_KEYWORDS = ['api', '中转站', '公益站', '路由站'];
export const RELAY_KEYWORD = RELAY_KEYWORDS[0];

export interface FetchReport {
  startedAt: number;
  finishedAt: number;
  probed: number;
  liveOk: number;
  liveFail: number;
  remoteOk: number;
  remoteFail: number;
  officialCount: number;
  relayCount: number;
  notes: string[];
}

export interface RefreshResult {
  items: Benefit[];
  report: FetchReport;
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function fetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; text: string; status: number; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      signal: ctrl.signal as any,
    });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch (e: any) {
    return { ok: false, text: '', status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function hasMojibake(text: string): boolean {
  if (!text) return false;
  const bad = (text.match(/\uFFFD/g) || []).length;
  return bad > 5;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 远程公开情报 JSON 的容错解析 */
function parseRemoteBenefits(raw: any, sourceUrl: string): Benefit[] {
  const arr: any[] = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.benefits)
      ? raw.benefits
      : [...(Array.isArray(raw?.official) ? raw.official : []), ...(Array.isArray(raw?.relay) ? raw.relay : [])];

  const out: Benefit[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const section: RadarSection = it.section === 'official' ? 'official' : it.section === 'relay' ? 'relay' : null as any;
    if (!section) continue;
    const title = String(it.title || it.name || '').trim();
    const provider = String(it.provider || it.vendor || title || '未知来源').trim();
    if (!title && !provider) continue;
    const quotaText = String(it.quotaText || it.quota_text || it.quota || '').trim();
    const q = parseQuota(quotaText);
    const steps = Array.isArray(it.steps) ? it.steps.map((s: any) => String(s)).filter(Boolean) : [];
    out.push({
      id: String(it.id || `${siteKeyOf(sourceUrl)}-${uid('b')}`),
      section,
      provider,
      title: title || provider,
      summary: String(it.summary || it.desc || '').trim(),
      quotaText,
      quotaTokens: q.rejected ? null : q.tokens,
      quotaUsd: q.rejected ? null : q.usd,
      validUntil: it.validUntil || it.valid_until || null,
      url: String(it.url || sourceUrl || ''),
      steps,
      keywords: Array.isArray(it.keywords) ? it.keywords.map(String) : [RELAY_KEYWORD],
      sourceUrl: String(it.sourceUrl || it.source_url || sourceUrl || ''),
      fetchedAt: Date.now(),
      confidence: q.rejected ? 'unconfirmed' : q.confidence === 'verified' ? 'likely' : 'unconfirmed',
      origin: 'live',
      evidence: quotaText ? `远程情报：${quotaText}` : null,
    });
  }
  return out;
}

export async function refreshRadar(
  extraUrls: string[] = [],
  onProgress?: (stage: string, done: number, total: number) => void,
): Promise<RefreshResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  const seeds = allSeedBenefits();
  const byId = new Map<string, Benefit>();
  for (const b of seeds) byId.set(b.id, b);

  let remoteOk = 0;
  let remoteFail = 0;

  /* ---- 1. 远程公开情报 JSON ---- */
  const remoteUrls = extraUrls.filter((u) => /^https?:\/\//i.test(u));
  if (remoteUrls.length) {
    onProgress?.('拉取远程情报源', 0, remoteUrls.length);
    const results = await mapLimit(remoteUrls, 3, async (u, i) => {
      const r = await fetchText(u, 12000);
      onProgress?.('拉取远程情报源', i + 1, remoteUrls.length);
      return { u, r };
    });
    for (const { u, r } of results) {
      if (!r.ok || !r.text) {
        remoteFail++;
        notes.push(`远程源 ${u} 拉取失败（${r.status === 0 ? r.error || '网络不可达' : `HTTP ${r.status}`}）`);
        continue;
      }
      try {
        const parsed = parseRemoteBenefits(JSON.parse(r.text), u);
        if (!parsed.length) {
          remoteFail++;
          notes.push(`远程源 ${u} 格式可解析但没有有效条目`);
          continue;
        }
        remoteOk++;
        for (const b of parsed) if (!byId.has(b.id)) byId.set(b.id, b);
      } catch {
        remoteFail++;
        notes.push(`远程源 ${u} 不是合法的 JSON`);
      }
    }
  }

  /* ---- 2. 直接抓取官网定价页 / 中转站首页 ---- */
  const probeTargets = SEED_BENEFITS.filter((s) => !!s.probeUrl);
  let liveOk = 0;
  let liveFail = 0;
  onProgress?.('抓取官网定价页与中转站', 0, probeTargets.length);

  await mapLimit(probeTargets, 3, async (seedItem, index) => {
    const r = await fetchText(seedItem.probeUrl, 12000);
    onProgress?.('抓取官网定价页与中转站', index + 1, probeTargets.length);
    const existing = byId.get(seedItem.id);
    if (!existing) return;

    if (!r.ok || !r.text) {
      liveFail++;
      existing.confidence = existing.confidence === 'verified' ? 'verified' : 'unconfirmed';
      existing.evidence = `本次抓取失败（${r.status === 0 ? '网络不可达' : `HTTP ${r.status}`}），沿用内置情报`;
      return;
    }
    if (hasMojibake(r.text)) {
      liveFail++;
      existing.evidence = '页面编码非 UTF-8，解析结果不可信，已标为无法确认';
      existing.confidence = 'unconfirmed';
      return;
    }

    const keyword = seedItem.section === 'relay' ? RELAY_KEYWORDS : 'api';
    const lines = extractBenefitLines(r.text, keyword);
    if (!lines.length) {
      liveFail++;
      existing.evidence = '页面已抓到，但没有命中「福利 + 额度单位」的句子（可能改版或需登录）';
      if (existing.confidence === 'likely') existing.confidence = 'unconfirmed';
      return;
    }

    liveOk++;
    const best = lines
      .map((l) => ({ line: l, q: parseQuota(l) }))
      .filter((x) => !x.q.rejected)
      .sort((a, b) => (b.q.value ?? 0) - (a.q.value ?? 0))[0];

    if (best) {
      existing.evidence = normalizeText(best.line).slice(0, 160);
      if (best.q.tokens != null && existing.quotaTokens == null) existing.quotaTokens = best.q.tokens;
      if (best.q.usd != null) existing.quotaUsd = best.q.usd;
      existing.confidence = best.q.confidence === 'verified' ? 'verified' : 'likely';
      existing.origin = 'live';
      existing.fetchedAt = Date.now();
    } else {
      existing.evidence = normalizeText(lines[0]).slice(0, 160);
      existing.confidence = 'likely';
      existing.origin = 'live';
      existing.fetchedAt = Date.now();
    }
  });

  /* ---- 3. 汇总 + 验收校验 ---- */
  const items = Array.from(byId.values());
  const officialCount = items.filter((i) => i.section === 'official').length;
  const relayCount = items.filter((i) => i.section === 'relay').length;

  if (relayCount < 5) {
    notes.push(`⚠️ 验收未达标：中转站分区只有 ${relayCount} 条（要求 ≥5），请检查网络或情报源`);
  }

  notes.push(`官网/中转站实抓：成功 ${liveOk}，失败 ${liveFail}`);
  if (remoteUrls.length) notes.push(`远程情报源：成功 ${remoteOk}，失败 ${remoteFail}`);
  notes.push('情报仅供参考，实际额度以各厂商官网实时页面为准');

  return {
    items,
    report: {
      startedAt,
      finishedAt: Date.now(),
      probed: probeTargets.length,
      liveOk,
      liveFail,
      remoteOk,
      remoteFail,
      officialCount,
      relayCount,
      notes,
    },
  };
}

/** 冷启动兜底：不做任何网络请求，直接用内置种子 */
export function offlineBenefits(): Benefit[] {
  return allSeedBenefits();
}