#!/usr/bin/env node
// 質問数（画面数）のシミュレーション: node scripts/simulate.js [回数]
// - random: 各画面でランダムに回答（0〜上限の曲数をランダムに選ぶ／2択もランダム）
// - worst : 各画面で常に上限まで選ぶ。2択では常に「同程度」（決着が最も遅れる）
// 1画面の曲数が9曲以下・選べる曲数が3曲以下であることも確認する
'use strict';
const path = require('path');
const { run, MAX_SCREENS, PER_SCREEN, MAX_PICK } = require(path.join(__dirname, '..', 'logic.js'));
const data = require(path.join(__dirname, '..', 'data', 'songs.json'));

const N = Number(process.argv[2]) || 1000;
const ids = data.songs.map((s) => s.id);

function answer(q, strategy, rnd) {
  if (q.type === 'select') {
    let k;
    if (q.exact) k = q.exact;
    else if (strategy === 'worst') k = q.max;
    else k = Math.floor(rnd() * (q.max + 1));
    const pool = q.songs.slice();
    const out = [];
    while (out.length < k && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    return out;
  }
  if (strategy === 'worst') return q.allowDraw ? 'D' : 'L';
  const opts = q.allowDraw ? ['L', 'D', 'R'] : ['L', 'R'];
  return opts[Math.floor(rnd() * opts.length)];
}

function check(cond, msg) { if (!cond) throw new Error(msg); }

function simulate(mode, strategy) {
  const totals = [], byStage = {};
  let rngState = 12345 + (mode === 'detail' ? 1 : 0) + (strategy === 'worst' ? 2 : 0);
  const rnd = () => ((rngState = (rngState * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < N; t++) {
    const seed = Math.floor(rnd() * 2 ** 31);
    const answers = [];
    const stageCount = {};
    const narrowSeen = {};
    let res;
    for (let guard = 0; guard < 200; guard++) {
      res = run(ids, mode, seed, answers);
      if (res.done) break;
      const q = res.question;
      stageCount[q.stage] = (stageCount[q.stage] || 0) + 1;
      if (q.type === 'select') {
        check(q.songs.length <= PER_SCREEN, `1画面に${q.songs.length}曲`);
        check(q.max <= MAX_PICK && (!q.exact || q.exact <= MAX_PICK), `選択数の上限が${q.max}`);
      }
      if (q.stage === 3 && mode === 'detail') {
        check(new Set(q.songs).size === q.songs.length, '③で同じ画面に同じ曲');
        q.songs.forEach((id) => { narrowSeen[id] = (narrowSeen[id] || 0) + 1; });
      }
      answers.push(answer(q, strategy, rnd));
    }
    check(res.done, '終了しない');
    check(res.screens === answers.length, '画面数の不一致');
    check(res.top10.length === Math.min(10, res.candidates), 'TOP10の曲数');
    check(new Set(res.top10).size === res.top10.length, 'TOP10に重複');
    check(res.top3.length === Math.min(3, res.top10.length), 'TOP3の曲数');
    check(res.top3.every((id) => res.top10.includes(id)), 'TOP3がTOP10外');
    if (stageCount[3] && mode === 'detail') check(Object.values(narrowSeen).every((c) => c === 2), '③で2回ずつ登場していない');
    // 戻る（回答を1つ削る）→ 同じ回答で同じ結果になるか
    const again = run(ids, mode, seed, answers);
    check(JSON.stringify(again.top3) === JSON.stringify(res.top3), '再生結果が一致しない');
    totals.push(answers.length);
    for (const s of [1, 2, 3, 4, 5]) (byStage[s] = byStage[s] || []).push(stageCount[s] || 0);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const max = (a) => Math.max(...a);
  return { totals, byStage, avg, max };
}

let ok = true;
for (const mode of ['simple', 'detail']) {
  for (const strategy of ['random', 'worst']) {
    const r = simulate(mode, strategy);
    const stages = [1, 2, 3, 4, 5].filter((s) => !(mode === 'simple' && s === 2))
      .map((s) => `${'①②③④⑤'[s - 1]} 平均${r.avg(r.byStage[s]).toFixed(1)}/最大${r.max(r.byStage[s])}`).join('  ');
    const mx = r.max(r.totals);
    if (mx > MAX_SCREENS[mode]) ok = false;
    console.log(`${mode === 'simple' ? '簡易版' : '詳細版'} ${strategy.padEnd(6)} 合計 平均${r.avg(r.totals).toFixed(1)} 最大${mx} 最小${Math.min(...r.totals)}`);
    console.log(`    ${stages}`);
  }
}
console.log(ok ? `OK: 簡易版 ${MAX_SCREENS.simple}・詳細版 ${MAX_SCREENS.detail} 画面以内` : 'NG: 上限を超えるケースあり');
process.exit(ok ? 0 : 1);
