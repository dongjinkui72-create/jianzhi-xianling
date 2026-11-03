/* eslint-disable */
/**
 * 升级迁移仿真：用 Node 内置 sqlite 复刻「旧库 22 列 -> PRAGMA 自愈迁移 -> 新 24 列插入」，
 * 并断言旧数据（用户的中转站）在迁移后完好保留。
 * 对应真机事故：Error code 1: 24 values for 22 columns。
 */
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');

// ---- 1.0 时代的旧 schema：relays 22 列 ----
db.exec(`CREATE TABLE relays (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unknown',
  user_id INTEGER, username TEXT, access_token_ref TEXT, credential_ref TEXT,
  has_session INTEGER NOT NULL DEFAULT 0, checkin_support TEXT NOT NULL DEFAULT 'unknown', checkin_note TEXT,
  auto_key_support TEXT NOT NULL DEFAULT 'unknown', auto_key_note TEXT,
  quota REAL, used_quota REAL, remaining_usd REAL, remaining_tokens REAL,
  last_sync_at INTEGER, last_checkin_at INTEGER, note TEXT, builtin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
)`);
db.prepare('INSERT INTO relays (id, name, base_url, kind, created_at) VALUES (?, ?, ?, ?, ?)').run(
  'relay_old', '我的旧站', 'https://old.example.com', 'new-api', 1700000000000,
);

// ---- 与 src/data/db.ts 相同的自愈迁移 ----
const EXPECTED_COLUMNS = {
  relays: [
    ['api_base', 'TEXT'],
    ['checkin_mode', 'TEXT'],
  ],
};
for (const table of Object.keys(EXPECTED_COLUMNS)) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const have = new Set(info.map((r) => r.name));
  for (const [name, ddl] of EXPECTED_COLUMNS[table]) {
    if (have.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

// ---- 2.0 的 24 值 INSERT 必须成功 ----
db.prepare(
  `INSERT INTO relays (id, name, base_url, kind, user_id, username, access_token_ref, credential_ref,
     has_session, api_base, checkin_mode, checkin_support, checkin_note, auto_key_support, auto_key_note,
     quota, used_quota, remaining_usd, remaining_tokens, last_sync_at, last_checkin_at, note, builtin, created_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
).run(
  'relay_new', '新站', 'https://new.example.com', 'new-api', 7, 'u', null, null,
  1, 'https://new.example.com/apiroot', 'dom', 'yes', null, 'yes', null,
  500000, 0, 1, 700000, 1700000001000, null, null, 0, 1700000001000,
);

// ---- 旧数据必须还在，且新列可读 ----
const old = db.prepare('SELECT * FROM relays WHERE id = ?').get('relay_old');
assert.strictEqual(old.name, '我的旧站', '旧站点数据丢失');
assert.strictEqual(old.api_base, null, '旧行新列应为 null');
assert.strictEqual(old.checkin_mode, null);
const count = db.prepare('SELECT COUNT(*) AS n FROM relays').get();
assert.strictEqual(count.n, 2, '迁移后行数不对');

// ---- 再跑一遍迁移必须幂等 ----
for (const table of Object.keys(EXPECTED_COLUMNS)) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const have = new Set(info.map((r) => r.name));
  for (const [name, ddl] of EXPECTED_COLUMNS[table]) {
    if (have.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
const cols = db.prepare('PRAGMA table_info(relays)').all().map((r) => r.name);
assert.strictEqual(cols.length, 24, '列数应为 24，实际 ' + cols.length);

console.log('✅ 升级迁移仿真通过：22 列旧库 -> 24 列，旧数据保留，迁移幂等');