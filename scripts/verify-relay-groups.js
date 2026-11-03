const path = require('path');
const assert = require('assert');

const base = path.join(__dirname, '..', '.tmptest');
const G = require(path.join(base, 'lib', 'relayGroups.js'));
const R = require(path.join(base, 'services', 'relayApi.js'));

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  PASS ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}

const relay = (id, checkinSupport, checkinMode) => ({ id, checkinSupport, checkinMode });

(async () => {
  console.log('\n[relay check-in grouping]');
  await t('API check-in site goes to daily list', () => {
    const out = G.splitRelaysForCheckin([relay('a', 'yes', 'api')]);
    assert.deepStrictEqual(out.checkin.map((x) => x.id), ['a']);
    assert.deepStrictEqual(out.localOnly, []);
  });

  await t('web-button check-in site goes to daily list', () => {
    const out = G.splitRelaysForCheckin([relay('b', 'unknown', 'dom')]);
    assert.deepStrictEqual(out.checkin.map((x) => x.id), ['b']);
  });

  await t('site without check-in stays only in local list', () => {
    const out = G.splitRelaysForCheckin([
      relay('a', 'yes', 'api'),
      relay('c', 'no', null),
      relay('d', 'unknown', null),
    ]);
    assert.deepStrictEqual(out.checkin.map((x) => x.id), ['a']);
    assert.deepStrictEqual(out.localOnly.map((x) => x.id), ['c', 'd']);
  });

  await t('HTTP 404 endpoint is unknown, not falsely reported as no check-in', async () => {
    let posts = 0;
    const transport = {
      name: 'test',
      async request(_path, init) {
        if (init && init.method === 'POST') posts++;
        return { ok: false, status: 404, error: 'not found' };
      },
    };
    const support = await R.fetchCheckinSupport(transport);
    assert.strictEqual(support.support, 'unknown');
    const result = await R.doCheckin(transport);
    assert.strictEqual(result.outcome, 'unconfirmed');
    assert.strictEqual(posts, 0, 'must not POST when check-in endpoint is unconfirmed');
  });

  console.log(`\nPassed ${pass}, failed ${fail}`);
  if (fail) process.exit(1);
})();
