import * as SQLite from 'expo-sqlite';
import type { ApiKeyItem, ApiProtocol, AppSettings, Benefit, CapabilityState, ChatClient, CheckinLog, DetectStatus, ImportKind, KeyStatus, RadarSection, Relay, RelayKind } from '../lib/types';

/**
 * 本机数据库（SQLite）。
 *
 * 产品红线 —— 数据分层：
 *   云端（公开情报）：providers / benefits / relays / clients，匿名可读，不含任何私有信息
 *   本机（私有）    ：api_keys（只存掩码）/ checkin_logs / 自建 clients / settings
 *   加密区          ：真实 Key、访问令牌、账号密码（见 vault.ts）
 * 所有私有数据一律不上传云端。
 */

const DB_NAME = 'jianzhi-xianling.db';
let instance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (instance) return instance;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS relays (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'unknown',
      user_id INTEGER,
      username TEXT,
      access_token_ref TEXT,
      credential_ref TEXT,
      has_session INTEGER NOT NULL DEFAULT 0,
      api_base TEXT,
      checkin_mode TEXT,
      checkin_support TEXT NOT NULL DEFAULT 'unknown',
      checkin_note TEXT,
      auto_key_support TEXT NOT NULL DEFAULT 'unknown',
      auto_key_note TEXT,
      quota REAL,
      used_quota REAL,
      remaining_usd REAL,
      remaining_tokens REAL,
      last_sync_at INTEGER,
      last_checkin_at INTEGER,
      note TEXT,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      relay_id TEXT,
      label TEXT NOT NULL,
      masked_key TEXT NOT NULL,
      base_url TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL DEFAULT 'openai_compatible',
      secret_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      remaining_tokens REAL,
      remaining_usd REAL,
      status_note TEXT,
      checked_at INTEGER,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkin_logs (
      id TEXT PRIMARY KEY,
      relay_id TEXT NOT NULL,
      relay_name TEXT NOT NULL,
      at INTEGER NOT NULL,
      result TEXT NOT NULL,
      message TEXT NOT NULL,
      gained_usd REAL
    );

    CREATE TABLE IF NOT EXISTS benefits (
      id TEXT PRIMARY KEY,
      section TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      quota_text TEXT NOT NULL DEFAULT '',
      quota_tokens REAL,
      quota_usd REAL,
      valid_until TEXT,
      url TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      source_url TEXT NOT NULL DEFAULT '',
      fetched_at INTEGER NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'unconfirmed',
      origin TEXT NOT NULL DEFAULT 'seed',
      evidence TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scheme TEXT,
      package_name TEXT,
      bundle_id TEXT,
      import_kind TEXT NOT NULL DEFAULT 'unconfirmed',
      import_template TEXT,
      settings_template TEXT,
      settings_base TEXT,
      launch_template TEXT,
      browser_based INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      platform TEXT NOT NULL DEFAULT 'all',
      builtin INTEGER NOT NULL DEFAULT 0,
      detected TEXT NOT NULL DEFAULT 'unknown',
      detect_reason TEXT,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_benefits_section ON benefits(section);
    CREATE INDEX IF NOT EXISTS idx_keys_status ON api_keys(status);
    CREATE INDEX IF NOT EXISTS idx_logs_relay ON checkin_logs(relay_id, at DESC);
  `);
  // 旧库迁移：补适配器新字段（新装用户不受影响）
  for (const stmt of [
    'ALTER TABLE relays ADD COLUMN api_base TEXT',
    'ALTER TABLE relays ADD COLUMN checkin_mode TEXT',
    'ALTER TABLE clients ADD COLUMN settings_template TEXT',
    'ALTER TABLE clients ADD COLUMN settings_base TEXT',
    'ALTER TABLE clients ADD COLUMN launch_template TEXT',
    'ALTER TABLE clients ADD COLUMN browser_based INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE clients ADD COLUMN note TEXT',
    "ALTER TABLE clients ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin'",
  ]) {
    try {
      await db.execAsync(stmt);
    } catch {
      /* 列已存在则忽略 */
    }
  }
  // 2.0：元信息表。升级安装时 SQLite 文件与 SecureStore 都保留，
  // 这里只做「加列 / 建表」式迁移，绝不删改用户旧数据（中转站、密钥、设置、适配器）。
  await db.execAsync('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  await db.runAsync(
    "INSERT INTO meta (k, v) VALUES ('schema_version', '2') ON CONFLICT(k) DO UPDATE SET v = excluded.v",
  );
  instance = db;
  return db;
}

/* ------------------------------ settings ------------------------------ */

export const DEFAULT_SETTINGS: AppSettings = {
  lowTokenThreshold: 200000,
  lowUsdThreshold: 0.5,
  preferredClientId: null,
  alwaysAskClient: true,
  feedUrls: [],
  adapterFeedUrls: [],
  autoHealthCheck: true,
  lastRadarFetchAt: null,
  lastAdapterFetchAt: null,
  announcementSeen: null,
};

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ k: string; v: string }>('SELECT k, v FROM settings');
  const out: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      const val = JSON.parse(r.v);
      if (r.k in out) (out as any)[r.k] = val;
    } catch {
      /* 忽略脏数据 */
    }
  }
  return out;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = await getDb();
  const cur = await loadSettings();
  const next = { ...cur, ...patch };
  for (const k of Object.keys(patch)) {
    await db.runAsync(
      'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      k,
      JSON.stringify((next as any)[k]) ?? 'null',
    );
  }
  return next;
}

/* ------------------------------ relays ------------------------------ */

interface RelayRow {
  id: string; name: string; base_url: string; kind: string; user_id: number | null;
  username: string | null; access_token_ref: string | null; credential_ref: string | null;
  has_session: number; api_base: string | null; checkin_mode: string | null; checkin_support: string; checkin_note: string | null;
  auto_key_support: string; auto_key_note: string | null;
  quota: number | null; used_quota: number | null; remaining_usd: number | null;
  remaining_tokens: number | null; last_sync_at: number | null; last_checkin_at: number | null;
  note: string | null; builtin: number; created_at: number;
}

function rowToRelay(r: RelayRow): Relay {
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url,
    kind: (r.kind as RelayKind) || 'unknown',
    userId: r.user_id,
    username: r.username,
    accessTokenRef: r.access_token_ref,
    credentialRef: r.credential_ref,
    hasSession: !!r.has_session,
    apiBase: r.api_base ?? null,
    checkinMode: (r.checkin_mode as Relay['checkinMode']) ?? null,
    checkinSupport: (r.checkin_support as CapabilityState) || 'unknown',
    checkinSupportNote: r.checkin_note,
    autoKeySupport: (r.auto_key_support as CapabilityState) || 'unknown',
    autoKeyNote: r.auto_key_note,
    quota: r.quota,
    usedQuota: r.used_quota,
    remainingUsd: r.remaining_usd,
    remainingTokens: r.remaining_tokens,
    lastSyncAt: r.last_sync_at,
    lastCheckinAt: r.last_checkin_at,
    note: r.note,
    builtin: !!r.builtin,
    createdAt: r.created_at,
  };
}

export async function listRelays(): Promise<Relay[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RelayRow>('SELECT * FROM relays ORDER BY builtin DESC, created_at ASC');
  return rows.map(rowToRelay);
}

export async function upsertRelay(relay: Relay): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO relays (id, name, base_url, kind, user_id, username, access_token_ref, credential_ref,
       has_session, checkin_support, checkin_note, auto_key_support, auto_key_note,
       quota, used_quota, remaining_usd, remaining_tokens, last_sync_at, last_checkin_at, note, builtin, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, base_url=excluded.base_url, kind=excluded.kind, user_id=excluded.user_id,
       username=excluded.username, access_token_ref=excluded.access_token_ref, credential_ref=excluded.credential_ref,
       has_session=excluded.has_session, api_base=excluded.api_base, checkin_mode=excluded.checkin_mode,
       checkin_support=excluded.checkin_support, checkin_note=excluded.checkin_note,
       auto_key_support=excluded.auto_key_support, auto_key_note=excluded.auto_key_note,
       quota=excluded.quota, used_quota=excluded.used_quota, remaining_usd=excluded.remaining_usd,
       remaining_tokens=excluded.remaining_tokens, last_sync_at=excluded.last_sync_at,
       last_checkin_at=excluded.last_checkin_at, note=excluded.note, builtin=excluded.builtin`,
    relay.id, relay.name, relay.baseUrl, relay.kind, relay.userId, relay.username,
    relay.accessTokenRef, relay.credentialRef, relay.hasSession ? 1 : 0,
    relay.checkinSupport, relay.checkinSupportNote, relay.autoKeySupport, relay.autoKeyNote,
    relay.quota, relay.usedQuota, relay.remainingUsd, relay.remainingTokens,
    relay.lastSyncAt, relay.lastCheckinAt, relay.note, relay.builtin ? 1 : 0, relay.createdAt,
  );
}

export async function deleteRelay(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM relays WHERE id = ?', id);
}

/* ------------------------------ api keys ------------------------------ */

interface KeyRow {
  id: string; relay_id: string | null; label: string; masked_key: string; base_url: string;
  provider: string; protocol: string; secret_ref: string; status: string;
  remaining_tokens: number | null; remaining_usd: number | null; status_note: string | null;
  checked_at: number | null; source: string; created_at: number;
}

function rowToKey(r: KeyRow): ApiKeyItem {
  return {
    id: r.id,
    relayId: r.relay_id,
    label: r.label,
    maskedKey: r.masked_key,
    baseUrl: r.base_url,
    provider: r.provider,
    protocol: (r.protocol as ApiProtocol) || 'openai_compatible',
    secretRef: r.secret_ref,
    status: (r.status as KeyStatus) || 'unknown',
    remainingTokens: r.remaining_tokens,
    remainingUsd: r.remaining_usd,
    statusNote: r.status_note,
    checkedAt: r.checked_at,
    source: (r.source as 'auto' | 'manual') || 'manual',
    createdAt: r.created_at,
  };
}

export async function listKeys(): Promise<ApiKeyItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<KeyRow>('SELECT * FROM api_keys ORDER BY created_at DESC');
  return rows.map(rowToKey);
}

export async function upsertKey(k: ApiKeyItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO api_keys (id, relay_id, label, masked_key, base_url, provider, protocol, secret_ref,
       status, remaining_tokens, remaining_usd, status_note, checked_at, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       relay_id=excluded.relay_id, label=excluded.label, masked_key=excluded.masked_key,
       base_url=excluded.base_url, provider=excluded.provider, protocol=excluded.protocol,
       secret_ref=excluded.secret_ref, status=excluded.status, remaining_tokens=excluded.remaining_tokens,
       remaining_usd=excluded.remaining_usd, status_note=excluded.status_note,
       checked_at=excluded.checked_at, source=excluded.source`,
    k.id, k.relayId, k.label, k.maskedKey, k.baseUrl, k.provider, k.protocol, k.secretRef,
    k.status, k.remainingTokens, k.remainingUsd, k.statusNote, k.checkedAt, k.source, k.createdAt,
  );
}

export async function deleteKey(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM api_keys WHERE id = ?', id);
}

/* ------------------------------ checkin logs ------------------------------ */

export async function addCheckinLog(log: CheckinLog): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO checkin_logs (id, relay_id, relay_name, at, result, message, gained_usd) VALUES (?,?,?,?,?,?,?)',
    log.id, log.relayId, log.relayName, log.at, log.result, log.message, log.gainedUsd,
  );
}

export async function listCheckinLogs(limit = 60): Promise<CheckinLog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM checkin_logs ORDER BY at DESC LIMIT ?',
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    relayId: r.relay_id,
    relayName: r.relay_name,
    at: r.at,
    result: r.result,
    message: r.message,
    gainedUsd: r.gained_usd,
  }));
}

export async function hasCheckedInToday(relayId: string, dayKey: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ at: number }>(
    "SELECT at FROM checkin_logs WHERE relay_id = ? AND result = 'success' ORDER BY at DESC LIMIT 5",
    relayId,
  );
  return rows.some((r) => {
    const d = new Date(r.at);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === dayKey;
  });
}

/* ------------------------------ benefits ------------------------------ */

interface BenefitRow {
  id: string; section: string; provider: string; title: string; summary: string;
  quota_text: string; quota_tokens: number | null; quota_usd: number | null; valid_until: string | null;
  url: string; steps: string; keywords: string; source_url: string; fetched_at: number;
  confidence: string; origin: string; evidence: string | null;
}

function rowToBenefit(r: BenefitRow): Benefit {
  let steps: string[] = [];
  let keywords: string[] = [];
  try { steps = JSON.parse(r.steps) || []; } catch { steps = []; }
  try { keywords = JSON.parse(r.keywords) || []; } catch { keywords = []; }
  return {
    id: r.id,
    section: r.section as RadarSection,
    provider: r.provider,
    title: r.title,
    summary: r.summary,
    quotaText: r.quota_text,
    quotaTokens: r.quota_tokens,
    quotaUsd: r.quota_usd,
    validUntil: r.valid_until,
    url: r.url,
    steps,
    keywords,
    sourceUrl: r.source_url,
    fetchedAt: r.fetched_at,
    confidence: r.confidence as Benefit['confidence'],
    origin: r.origin as Benefit['origin'],
    evidence: r.evidence ?? null,
  };
}

export async function replaceBenefits(items: Benefit[]): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM benefits');
  for (const b of items) {
    await db.runAsync(
      `INSERT INTO benefits (id, section, provider, title, summary, quota_text, quota_tokens, quota_usd,
        valid_until, url, steps, keywords, source_url, fetched_at, confidence, origin, evidence)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.id, b.section, b.provider, b.title, b.summary, b.quotaText, b.quotaTokens, b.quotaUsd,
      b.validUntil, b.url, JSON.stringify(b.steps), JSON.stringify(b.keywords), b.sourceUrl,
      b.fetchedAt, b.confidence, b.origin, b.evidence ?? null,
    );
  }
}

export async function listBenefits(): Promise<Benefit[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BenefitRow>('SELECT * FROM benefits ORDER BY section ASC, fetched_at DESC');
  return rows.map(rowToBenefit);
}

/* ------------------------------ clients ------------------------------ */

interface ClientRow {
  id: string; name: string; scheme: string | null; package_name: string | null; bundle_id: string | null;
  import_kind: string; import_template: string | null; settings_template: string | null;
  settings_base: string | null; launch_template: string | null; browser_based: number;
  note: string | null; source: string; platform: string; builtin: number;
  detected: string; detect_reason: string | null; added_at: number;
}

function rowToClient(r: ClientRow): ChatClient {
  return {
    id: r.id,
    name: r.name,
    scheme: r.scheme,
    androidPackage: r.package_name,
    iosBundleId: r.bundle_id,
    importKind: (r.import_kind as ImportKind) || 'unconfirmed',
    importTemplate: r.import_template ?? undefined,
    settingsTemplate: r.settings_template ?? undefined,
    settingsBase: r.settings_base ?? undefined,
    launchTemplate: r.launch_template ?? undefined,
    browserBased: !!r.browser_based,
    note: r.note ?? undefined,
    source: (r.source as ChatClient['source']) || 'builtin',
    platform: (r.platform as ChatClient['platform']) || 'all',
    builtin: !!r.builtin,
    detected: (r.detected as DetectStatus) || 'unknown',
    detectReason: r.detect_reason,
    addedAt: r.added_at,
  };
}

export async function listClients(): Promise<ChatClient[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ClientRow>('SELECT * FROM clients ORDER BY builtin DESC, added_at ASC');
  return rows.map(rowToClient);
}

export async function upsertClient(c: ChatClient): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO clients (id, name, scheme, package_name, bundle_id, import_kind, import_template,
       settings_template, settings_base, launch_template, browser_based, note, source,
       platform, builtin, detected, detect_reason, added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, scheme=excluded.scheme, package_name=excluded.package_name,
       bundle_id=excluded.bundle_id, import_kind=excluded.import_kind, import_template=excluded.import_template,
       settings_template=excluded.settings_template, settings_base=excluded.settings_base,
       launch_template=excluded.launch_template, browser_based=excluded.browser_based,
       note=excluded.note, source=excluded.source,
       platform=excluded.platform, builtin=excluded.builtin, detected=excluded.detected,
       detect_reason=excluded.detect_reason`,
    c.id, c.name, c.scheme, c.androidPackage, c.iosBundleId, c.importKind, c.importTemplate ?? null,
    c.settingsTemplate ?? null, c.settingsBase ?? null, c.launchTemplate ?? null,
    c.browserBased ? 1 : 0, c.note ?? null, c.source || 'builtin',
    c.platform, c.builtin ? 1 : 0, c.detected, c.detectReason, c.addedAt,
  );
}

export async function deleteClient(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM clients WHERE builtin = 0 AND id = ?', id);
}