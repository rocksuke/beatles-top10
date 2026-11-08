/** @OnlyCurrentDoc */
/*
 * ビートルズTOP10診断：匿名集計（Google Apps Script・スプレッドシートに紐づけて使う）
 * 手順は docs/SETUP_GAS.md を参照。
 *
 * - doPost：診断結果を受け取り、厳密に検証してから responses シートに1行追加する
 * - aggregate：responses を集計して summary シートの A1 に JSON で保存する（1時間ごとのトリガーで実行）
 * - doGet：summary の JSON を返すだけ（アクセスのたびに集計はしない）
 *
 * 検証・集計のロジックは Node.js でもテストできるよう、Google のサービスを使わない関数に分けている
 * （tests/gas.test.js）。
 */

// ===== 設定（必要に応じて変更する） =====
var RATE_LIMIT_PER_MINUTE = 300; // 1分あたりの受付件数の上限。超えた分は破棄する
var MAX_BODY_BYTES = 5 * 1024;   // 本文サイズの上限（5KB）
var MAX_PICKS1 = { simple: 72, detailed: 72 }; // ①の選択数の上限（24画面 × 最大3曲）

var SHEET_RESPONSES = 'responses';
var SHEET_SUMMARY = 'summary';
var HEADERS = ['受信日時', 'sid', 'mode', 'picks1', 'top10', 'top3', '除外フラグ'];
var MODES = ['simple', 'detailed'];

// 有効な曲IDの一覧（data/songs.json と同じ。曲名は持たない。テストで一致を確認している）
var VALID_IDS = 's001,s002,s003,s004,s005,s006,s007,s008,s009,s010,s011,s012,s013,s014,s015,s016,s017,s018,s019,s020,s021,s022,s023,s024,s025,s026,s027,s028,s029,s030,s031,s032,s033,s034,s035,s036,s037,s038,s039,s040,s041,s042,s043,s044,s045,s046,s047,s048,s049,s050,s051,s052,s053,s054,s055,s056,s057,s058,s059,s060,s061,s062,s063,s064,s065,s066,s067,s068,s069,s070,s071,s072,s073,s074,s075,s076,s077,s078,s079,s080,s081,s082,s083,s084,s085,s086,s087,s088,s089,s090,s091,s092,s093,s094,s095,s096,s097,s098,s099,s100,s101,s102,s103,s104,s105,s106,s107,s108,s109,s110,s111,s112,s113,s114,s115,s116,s117,s118,s119,s120,s121,s122,s123,s124,s125,s126,s127,s128,s129,s130,s131,s132,s133,s134,s135,s136,s137,s138,s139,s140,s141,s142,s143,s144,s145,s146,s147,s148,s149,s150,s151,s152,s153,s154,s155,s156,s157,s158,s159,s160,s161,s162,s163,s164,s165,s166,s167,s168,s169,s170,s171,s172,s173,s174,s175,s176,s177,s178,s179,s180,s181,s182,s183,s184,s185,s186,s187,s188,s189,s190,s191,s192,s193,s194,s195,s196,s197,s198,s199,s200,s201,s202,s203,s204,s205,s206,s207,s208,s209,s210,s211'.split(',');

// ===== 検証（純粋関数） =====
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var KEYS = ['v', 'sid', 'mode', 'picks1', 'top10', 'top3'];

function utf8ByteLength(str) {
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // サロゲートペア
    else n += 3;
  }
  return n;
}

var VALID_SET = (function () {
  var s = {};
  VALID_IDS.forEach(function (id) { s[id] = true; });
  return s;
})();

function isIdList(arr, min, max) {
  if (!Array.isArray(arr) || arr.length < min || arr.length > max) return false;
  var seen = {};
  for (var i = 0; i < arr.length; i++) {
    var id = arr[i];
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(VALID_SET, id)) return false;
    if (seen[id]) return false; // 重複
    seen[id] = true;
  }
  return true;
}

/**
 * 本文（文字列）を検証する。正しければ { ok: true, data }、そうでなければ { ok: false, reason }。
 * reason はテスト・ログ用で、レスポンスには含めない。
 */
function validatePayload(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty' };
  if (utf8ByteLength(raw) > MAX_BODY_BYTES) return { ok: false, reason: 'too_large' };
  var d;
  try { d = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'json' }; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: 'not_object' };
  var keys = Object.keys(d);
  if (keys.length !== KEYS.length) return { ok: false, reason: 'keys' };
  for (var k = 0; k < KEYS.length; k++) {
    if (!Object.prototype.hasOwnProperty.call(d, KEYS[k])) return { ok: false, reason: 'keys' };
  }
  if (d.v !== 1) return { ok: false, reason: 'version' };
  if (typeof d.sid !== 'string' || !UUID_RE.test(d.sid)) return { ok: false, reason: 'sid' };
  if (MODES.indexOf(d.mode) < 0) return { ok: false, reason: 'mode' };
  if (!isIdList(d.picks1, 0, MAX_PICKS1[d.mode])) return { ok: false, reason: 'picks1' };
  if (!isIdList(d.top10, 1, 10)) return { ok: false, reason: 'top10' };
  if (!isIdList(d.top3, 3, 3)) return { ok: false, reason: 'top3' };
  for (var t = 0; t < d.top3.length; t++) {
    if (d.top10.indexOf(d.top3[t]) < 0) return { ok: false, reason: 'top3_not_in_top10' };
  }
  return {
    ok: true,
    data: { sid: d.sid.toLowerCase(), mode: d.mode, picks1: d.picks1, top10: d.top10, top3: d.top3 },
  };
}

// セルに入れる文字列が数式として解釈されないことを保証する
function safeCell(str) {
  if (typeof str !== 'string' || /^[=+\-@]/.test(str) || /[\t\r\n]/.test(str)) {
    throw new Error('unsafe cell');
  }
  return str;
}

// 保存する1行（受信日時 / sid / mode / picks1 / top10 / top3 / 除外フラグ）
function buildRow(data, now) {
  return [
    now,
    safeCell(data.sid),
    safeCell(data.mode),
    safeCell(data.picks1.join(',')),
    safeCell(data.top10.join(',')),
    safeCell(data.top3.join(',')),
    '',
  ];
}

/**
 * 受付の流れ。Google のサービスは deps として渡す（テストでは偽物を渡す）。
 * deps: { withLock(fn), countThisMinute() -> 加算後の件数, hasSid(sid), append(row), now() }
 */
function handlePost(raw, deps) {
  var v = validatePayload(raw);
  if (!v.ok) return v;
  return deps.withLock(function () {
    if (deps.countThisMinute() > RATE_LIMIT_PER_MINUTE) return { ok: false, reason: 'rate_limit' };
    if (deps.hasSid(v.data.sid)) return { ok: false, reason: 'duplicate' };
    deps.append(buildRow(v.data, deps.now()));
    return { ok: true };
  });
}

// ===== 集計（純粋関数） =====
function isExcluded(flag) {
  if (flag === true) return true;
  if (typeof flag === 'number') return flag !== 0;
  if (typeof flag === 'string') {
    var s = flag.trim().toUpperCase();
    return s !== '' && s !== 'FALSE' && s !== '0';
  }
  return false;
}

function round4(x) { return Math.round(x * 10000) / 10000; }

/**
 * rows: responses シートのデータ行（見出しを除く）。
 * 戻り値: { v, updatedAt, modes: { all|simple|detailed: { n, top10, top3, picks1 } } }
 * top10 / top3 / picks1 は { 曲ID: 割合(0〜1) }（0件の曲は省略）。
 */
function summarize(rows, now) {
  var groups = { all: newGroup(), simple: newGroup(), detailed: newGroup() };
  function newGroup() { return { n: 0, top10: {}, top3: {}, picks1: {} }; }
  function addList(map, str) {
    if (typeof str !== 'string' || !str) return;
    var seen = {};
    str.split(',').forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(VALID_SET, id) || seen[id]) return;
      seen[id] = true;
      map[id] = (map[id] || 0) + 1;
    });
  }
  rows.forEach(function (r) {
    var mode = r[2];
    if (MODES.indexOf(mode) < 0 || isExcluded(r[6])) return;
    [groups.all, groups[mode]].forEach(function (g) {
      g.n++;
      addList(g.picks1, r[3]);
      addList(g.top10, r[4]);
      addList(g.top3, r[5]);
    });
  });
  var out = { v: 1, updatedAt: (now || new Date()).toISOString(), modes: {} };
  Object.keys(groups).forEach(function (name) {
    var g = groups[name], m = { n: g.n, top10: {}, top3: {}, picks1: {} };
    ['top10', 'top3', 'picks1'].forEach(function (metric) {
      VALID_IDS.forEach(function (id) {
        if (g[metric][id]) m[metric][id] = round4(g[metric][id] / g.n);
      });
    });
    out.modes[name] = m;
  });
  return out;
}

// ===== ここから Google Apps Script のサービスを使う部分 =====
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    var sheet = null;
    var result = handlePost(raw, {
      withLock: function (fn) {
        var lock = LockService.getScriptLock();
        if (!lock.tryLock(10000)) return { ok: false, reason: 'busy' };
        try { return fn(); } finally { lock.releaseLock(); }
      },
      countThisMinute: function () {
        var cache = CacheService.getScriptCache();
        var key = 'rate:' + Math.floor(Date.now() / 60000);
        var n = Number(cache.get(key) || 0) + 1;
        cache.put(key, String(n), 120);
        return n;
      },
      hasSid: function (sid) {
        sheet = sheet || getSheet_(SHEET_RESPONSES, HEADERS);
        var last = sheet.getLastRow();
        if (last < 2) return false;
        return !!sheet.getRange(2, 2, last - 1, 1).createTextFinder(sid).matchEntireCell(true).findNext();
      },
      append: function (row) {
        sheet = sheet || getSheet_(SHEET_RESPONSES, HEADERS);
        var range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
        range.setNumberFormats([['yyyy-mm-dd hh:mm:ss', '@', '@', '@', '@', '@', '@']]); // 文字列として保存
        range.setValues([row]);
      },
      now: function () { return new Date(); },
    });
    if (!result.ok) console.log('rejected: ' + result.reason);
    return json_({ ok: result.ok });
  } catch (err) {
    console.error(err); // 詳細は実行ログにだけ残し、レスポンスには含めない
    return json_({ ok: false });
  }
}

function doGet() {
  try {
    var text = getSheet_(SHEET_SUMMARY).getRange('A1').getValue();
    if (typeof text !== 'string' || text.charAt(0) !== '{') text = JSON.stringify(summarize([], new Date()));
    return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.error(err);
    return json_({ ok: false });
  }
}

/** 集計（1時間ごとの時間主導型トリガーで実行する） */
function aggregate() {
  var sh = getSheet_(SHEET_RESPONSES, HEADERS);
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
  var text = JSON.stringify(summarize(rows, new Date()));
  var cell = getSheet_(SHEET_SUMMARY).getRange('A1');
  cell.setNumberFormat('@');
  cell.setValue(text);
  console.log('aggregate: ' + rows.length + ' rows, ' + text.length + ' chars');
}

/** 初回の準備：シートを作り、空の集計結果を書き込む（エディタから1回だけ実行する） */
function setup() {
  getSheet_(SHEET_RESPONSES, HEADERS);
  aggregate();
}

// Node.js でテストするための書き出し（Apps Script では module が無いので何もしない）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validatePayload: validatePayload, buildRow: buildRow, handlePost: handlePost, summarize: summarize,
    safeCell: safeCell, isExcluded: isExcluded, utf8ByteLength: utf8ByteLength,
    VALID_IDS: VALID_IDS, MAX_PICKS1: MAX_PICKS1, RATE_LIMIT_PER_MINUTE: RATE_LIMIT_PER_MINUTE, MAX_BODY_BYTES: MAX_BODY_BYTES,
  };
}
