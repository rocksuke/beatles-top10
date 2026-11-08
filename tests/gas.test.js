// gas/Code.gs の検証・集計ロジックのテスト: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// .gs は CommonJS では JavaScript として読み込まれる
const gas = require(path.join(__dirname, '..', 'gas', 'Code.gs'));
const songs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'songs.json'), 'utf8')).songs;

const SID = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f';
const valid = (over = {}) => ({
  v: 1, sid: SID, mode: 'simple',
  picks1: ['s001', 's045', 's100', 's150'],
  top10: ['s001', 's045', 's100', 's150', 's002', 's003', 's004', 's005', 's006', 's007'],
  top3: ['s001', 's045', 's100'],
  ...over,
});
const check = (obj) => gas.validatePayload(typeof obj === 'string' ? obj : JSON.stringify(obj));
const ids = (n, from = 1) => Array.from({ length: n }, (_, i) => 's' + String(from + i).padStart(3, '0'));

test('有効なID一覧が songs.json と一致する', () => {
  assert.deepEqual(gas.VALID_IDS, songs.map((s) => s.id));
});

test('正常なデータは受け付ける', () => {
  assert.equal(check(valid()).ok, true);
  assert.equal(check(valid({ mode: 'detailed' })).ok, true);
  assert.equal(check(valid({ picks1: [] })).ok, true, '①で0曲');
  assert.equal(check(valid({ picks1: ids(72) })).ok, true, '①で上限72曲');
  assert.equal(check(valid({ top10: ['s001', 's045', 's100'] })).ok, true, 'TOP10が3曲');
  assert.equal(check(valid({ sid: SID.toUpperCase() })).data.sid, SID, 'sid は小文字で保存');
});

test('範囲外・形式違いのIDは破棄する', () => {
  for (const bad of ['s000', 's212', 'S001', 's1', 's0001', '', ' s001', 1]) {
    assert.equal(check(valid({ picks1: ['s001', bad] })).ok, false, `picks1: ${bad}`);
    assert.equal(check(valid({ top10: ['s001', 's045', 's100', bad] })).ok, false, `top10: ${bad}`);
  }
  assert.equal(check(valid({ top3: ['s001', 's045', 's999'] })).ok, false);
});

test('重複は破棄する', () => {
  assert.equal(check(valid({ picks1: ['s001', 's001'] })).ok, false);
  assert.equal(check(valid({ top10: ['s001', 's045', 's100', 's001'] })).ok, false);
  assert.equal(check(valid({ top3: ['s001', 's001', 's045'] })).ok, false);
});

test('件数が正しくないものは破棄する', () => {
  assert.equal(check(valid({ picks1: ids(73) })).ok, false, '①が73曲');
  assert.equal(check(valid({ mode: 'detailed', picks1: ids(73) })).ok, false);
  assert.equal(check(valid({ top10: ids(11) })).ok, false, 'TOP10が11曲');
  assert.equal(check(valid({ top10: [], top3: [] })).ok, false, 'TOP10が0曲');
  assert.equal(check(valid({ top3: ['s001', 's045'] })).ok, false, 'TOP3が2曲');
  assert.equal(check(valid({ top3: ['s001', 's045', 's100', 's150'] })).ok, false, 'TOP3が4曲');
  assert.equal(check(valid({ top3: ['s001', 's045', 's200'] })).ok, false, 'TOP3がTOP10の外');
});

test('「=」「+」「-」「@」で始まる文字列は破棄する', () => {
  for (const s of ['=SUM(1,2)', '+1', '-1', '@x', '=HYPERLINK("http://example.com")']) {
    assert.equal(check(valid({ sid: s })).ok, false, `sid: ${s}`);
    assert.equal(check(valid({ mode: s })).ok, false, `mode: ${s}`);
    assert.equal(check(valid({ picks1: [s] })).ok, false, `picks1: ${s}`);
    assert.equal(check(valid({ top3: ['s001', 's045', s] })).ok, false, `top3: ${s}`);
    assert.throws(() => gas.safeCell(s), `safeCell: ${s}`);
  }
  // 保存する行のどのセルも危険な文字で始まらない
  const row = gas.buildRow(check(valid()).data, new Date());
  row.slice(1).forEach((c) => assert.ok(typeof c === 'string' && !/^[=+\-@]/.test(c)));
});

test('巨大な本文は破棄する', () => {
  const big = JSON.stringify(valid()) + ' '.repeat(6000);
  assert.equal(check(big).ok, false);
  assert.equal(check(big).reason, 'too_large');
  assert.equal(check('あ'.repeat(1800)).reason, 'too_large', '日本語はバイト数で判定');
});

test('不正な mode・バージョン・sid・余計な項目は破棄する', () => {
  for (const m of ['detail', 'Simple', '', null, 1, ['simple']]) assert.equal(check(valid({ mode: m })).ok, false, `mode: ${m}`);
  for (const v of [2, '1', 0, null]) assert.equal(check(valid({ v })).ok, false, `v: ${v}`);
  for (const s of ['abc', '3f2b8c1e9a4d4c7b8e2f1a2b3c4d5e6f', SID + 'x', '', 123]) assert.equal(check(valid({ sid: s })).ok, false, `sid: ${s}`);
  assert.equal(check(valid({ name: '太郎' })).ok, false, '余計な項目');
  assert.equal(check(valid({ ua: 'Mozilla' })).ok, false);
  const missing = valid(); delete missing.picks1;
  assert.equal(check(missing).ok, false, '項目が足りない');
  assert.equal(check('{"v":1,"__proto__":{}}').ok, false);
});

test('JSON 以外・オブジェクト以外は破棄する', () => {
  for (const raw of ['', 'not json', '[]', '"text"', '1', 'null', '{"v":1']) assert.equal(gas.validatePayload(raw).ok, false, raw);
  assert.equal(gas.validatePayload(undefined).ok, false);
  assert.equal(check(valid({ picks1: 's001,s002' })).ok, false, '配列でない');
  assert.equal(check(valid({ top10: [['s001']] })).ok, false, '入れ子の配列');
});

// ---- 受付の流れ（Google のサービスは偽物を使う） ----
function fakeDeps() {
  const rows = [];
  let count = 0;
  return {
    rows,
    deps: {
      withLock: (fn) => fn(),
      countThisMinute: () => ++count,
      hasSid: (sid) => rows.some((r) => r[1] === sid),
      append: (row) => rows.push(row),
      now: () => new Date('2026-11-08T00:00:00Z'),
    },
  };
}

test('handlePost：保存・同じ sid の重複・不正データ', () => {
  const { rows, deps } = fakeDeps();
  assert.equal(gas.handlePost(JSON.stringify(valid()), deps).ok, true);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(1), [SID, 'simple', 's001,s045,s100,s150', valid().top10.join(','), 's001,s045,s100', '']);
  assert.equal(gas.handlePost(JSON.stringify(valid()), deps).reason, 'duplicate');
  assert.equal(gas.handlePost(JSON.stringify(valid({ sid: SID.toUpperCase() })), deps).reason, 'duplicate', '大文字小文字違いも重複');
  assert.equal(gas.handlePost('{"bad":1}', deps).ok, false);
  assert.equal(rows.length, 1);
});

test('handlePost：1分あたりの上限を超えたら破棄する', () => {
  const { rows, deps } = fakeDeps();
  const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  for (let i = 0; i < gas.RATE_LIMIT_PER_MINUTE; i++) assert.equal(gas.handlePost(JSON.stringify(valid({ sid: uuid(i) })), deps).ok, true);
  assert.equal(gas.handlePost(JSON.stringify(valid({ sid: uuid(99999) })), deps).reason, 'rate_limit');
  assert.equal(rows.length, gas.RATE_LIMIT_PER_MINUTE);
});

// ---- 集計 ----
test('summarize：モード別・全体の割合と除外フラグ', () => {
  const r = (mode, p1, t10, t3, flag = '') => [new Date(), SID, mode, p1, t10, t3, flag];
  const rows = [
    r('simple', 's001,s002', 's001,s002,s003', 's001,s002,s003'),
    r('simple', 's001', 's001,s004,s005', 's001,s004,s005'),
    r('detailed', 's002', 's002,s003,s004', 's002,s003,s004'),
    r('detailed', 's001', 's001,s002,s003', 's001,s002,s003', true), // 除外（チェックボックス）
    r('simple', 's001', 's001,s002,s003', 's001,s002,s003', 'x'), // 除外（文字）
    r('simple', '=BAD', 's001,s002,s003', 's001,s002,s003', 'FALSE'), // 除外しない。不正なIDは数えない
  ];
  const s = gas.summarize(rows, new Date('2026-11-08T00:00:00Z'));
  assert.equal(s.modes.all.n, 4);
  assert.equal(s.modes.simple.n, 3);
  assert.equal(s.modes.detailed.n, 1);
  assert.equal(s.modes.all.top10.s001, 0.75);
  assert.equal(s.modes.simple.picks1.s001, round(2 / 3));
  assert.equal(s.modes.detailed.top3.s002, 1);
  assert.equal(s.modes.all.top10.s211, undefined, '0件の曲は省略');
  assert.equal(s.updatedAt, '2026-11-08T00:00:00.000Z');
  const empty = gas.summarize([]);
  assert.equal(empty.modes.all.n, 0);
});
const round = (x) => Math.round(x * 10000) / 10000;

test('summarize：結果がスプレッドシートの1セル（5万文字）に収まる', () => {
  // 全曲が全指標で0でない、最も長くなるケース
  const all = gas.VALID_IDS;
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const shift = (k) => all.slice((i * 7 + k) % all.length).concat(all).slice(0, 10);
    rows.push([new Date(), SID, i % 2 ? 'simple' : 'detailed', all.slice(i % 140, (i % 140) + 72).join(','), shift(0).join(','), shift(0).slice(0, 3).join(','), '']);
  }
  const text = JSON.stringify(gas.summarize(rows));
  assert.ok(text.length < 50000, `${text.length} 文字`);
});
