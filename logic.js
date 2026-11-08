/*
 * 診断ロジック（ブラウザと Node.js の両方で動く）
 *
 * 状態は「モード・乱数シード・これまでの回答の配列」だけで表す。
 * run() は毎回最初から回答を再生して、次の質問か結果を返す。
 * 乱数はシード付きなので、同じ回答を与えれば必ず同じ質問列になる。
 * これにより「戻る」（回答を1つ削るだけ）と localStorage への保存が単純になる。
 *
 * 共通ルール：1画面に表示する曲は最大9曲（3×3）、選べる曲は最大3曲。
 */
(function (root) {
  'use strict';

  var MAX_SCREENS = { simple: 45, detail: 70 };
  var PER_SCREEN = 9;
  var MAX_PICK = 3;
  var FINAL_SCREENS = { simple: 4, detail: 9 }; // ⑤の最大画面数（上限計算で確保する）
  var STAGES = {
    simple: [1, 3, 4, 5],
    detail: [1, 2, 3, 4, 5],
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 合計 total を n 個にできるだけ均等に分けたサイズの配列
  function evenSizes(total, n) {
    var base = Math.floor(total / n), extra = total % n, out = [];
    for (var i = 0; i < n; i++) out.push(base + (i < extra ? 1 : 0));
    return out;
  }

  function splitBySizes(arr, sizes) {
    var out = [], k = 0;
    sizes.forEach(function (s) { out.push(arr.slice(k, k + s)); k += s; });
    return out;
  }

  // 9曲以下のグループに均等に分ける
  function splitScreens(arr) {
    return splitBySizes(arr, evenSizes(arr.length, Math.max(1, Math.ceil(arr.length / PER_SCREEN))));
  }

  function without(arr, remove) {
    return arr.filter(function (id) { return remove.indexOf(id) < 0; });
  }

  // 「S からちょうど k 曲を選ぶ」を、9曲以下・3曲以下の画面に分ける計画（乱数を使わない）
  function choosePlan(n, k) {
    var sizes = evenSizes(n, Math.max(1, Math.ceil(n / PER_SCREEN)));
    var alloc = sizes.map(function (s) { return Math.floor((k * s) / n); });
    var rest = k - alloc.reduce(function (a, b) { return a + b; }, 0);
    var order = sizes.map(function (s, i) { return i; })
      .sort(function (a, b) { return ((k * sizes[b]) % n) - ((k * sizes[a]) % n) || a - b; });
    for (var j = 0; rest > 0; j = (j + 1) % order.length) {
      if (alloc[order[j]] < sizes[order[j]]) { alloc[order[j]]++; rest--; }
    }
    return { sizes: sizes, alloc: alloc };
  }
  function smallCost(size, k) {
    if (k === 0 || k === size) return 0;
    return k <= MAX_PICK || size - k <= MAX_PICK ? 1 : 2;
  }
  function chooseCost(n, k) {
    var p = choosePlan(n, k), c = 0;
    p.sizes.forEach(function (s, i) { c += smallCost(s, p.alloc[i]); });
    return c;
  }

  function NeedAnswer(q) { this.question = q; }

  // ③ 絞り込み（詳細版）：各曲を2回ずつ登場させ、2回目はなるべく別の曲と組み合わせる
  function buildNarrowGroups(cand, rng) {
    var C = cand.length;
    var size = Math.min(7, Math.max(5, Math.ceil((C * 2) / 20)));
    var n = Math.ceil((2 * C) / size);
    if (n > 20) n = 20; // 候補が70曲を超える場合のみ。一部のグループが8曲になる
    var sizes = evenSizes(2 * C, n);

    var first = shuffle(cand, rng);
    var idx = {};
    cand.forEach(function (id, i) { idx[id] = i; });

    function cost(seq) {
      var groups = splitBySizes(seq, sizes);
      var seen = new Uint8Array(C * C), c = 0;
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        for (var x = 0; x < grp.length; x++) {
          for (var y = x + 1; y < grp.length; y++) {
            var a = idx[grp[x]], b = idx[grp[y]];
            if (a === b) { c += 1000; continue; } // 同じ画面に同じ曲
            var key = a < b ? a * C + b : b * C + a;
            if (seen[key]) c += 1; // 1回目と同じ組み合わせ
            seen[key] = 1;
          }
        }
      }
      return c;
    }

    // 初期案：1回目のグループを「転置」して並べる（同じグループの曲を別々の画面へ散らす）
    var firstGroups = splitBySizes(first, sizes.slice(0, Math.ceil(n / 2)));
    var transposed = [];
    for (var col = 0; col < PER_SCREEN; col++) {
      firstGroups.forEach(function (g) { if (g[col] !== undefined) transposed.push(g[col]); });
    }
    var used = {};
    transposed = transposed.filter(function (id) { return used[id] ? false : (used[id] = true); });
    first.forEach(function (id) { if (!used[id]) transposed.push(id); });

    var best = first.concat(transposed), bestCost = cost(best);
    for (var t = 0; t < 80 && bestCost > 0; t++) {
      var seq = first.concat(t % 2 ? shuffle(cand, rng) : rotate(transposed, Math.floor(rng() * C)));
      var c = cost(seq);
      if (c < bestCost) { best = seq; bestCost = c; }
    }
    return splitBySizes(best, sizes);
  }

  function rotate(arr, k) { return arr.slice(k).concat(arr.slice(0, k)); }

  function sanitizeSelect(ans, songs, max) {
    if (!Array.isArray(ans)) return [];
    var out = [];
    ans.forEach(function (id) {
      if (songs.indexOf(id) >= 0 && out.indexOf(id) < 0 && out.length < max) out.push(id);
    });
    return out;
  }

  /**
   * @param {string[]} songIds 全曲のID
   * @param {'simple'|'detail'} mode
   * @param {number} seed
   * @param {Array} answers これまでの回答（select: ID配列 / pair: 'L'|'D'|'R'）
   * @returns {{done:false, question:object}|{done:true, top10:string[], top3:string[], screens:number}}
   */
  function run(songIds, mode, seed, answers) {
    try {
      return runInner(songIds, mode, seed, answers);
    } catch (e) {
      if (e instanceof NeedAnswer) return { done: false, question: e.question };
      throw e;
    }
  }

  function runInner(songIds, mode, seed, answers) {
    var rng = mulberry32(seed >>> 0);
    var i = 0;
    var stages = STAGES[mode];
    var MAX = MAX_SCREENS[mode];

    function ask(q) {
      q.index = i;
      q.stages = stages;
      if (i < answers.length) {
        var a = answers[i++];
        if (q.type === 'select') {
          var s = sanitizeSelect(a, q.songs, q.max);
          // exact 指定の画面は、足りない分を補って必ず指定数にする
          for (var k = 0; q.exact && s.length < q.exact && k < q.songs.length; k++) {
            if (s.indexOf(q.songs[k]) < 0) s.push(q.songs[k]);
          }
          return s;
        }
        return a === 'L' || a === 'R' || (a === 'D' && q.allowDraw) ? a : 'L';
      }
      throw new NeedAnswer(q);
    }

    function selectQ(stage, label, step, total, songs, max, prompt, extra) {
      var q = { type: 'select', stage: stage, label: label, step: step, total: total,
        songs: songs, max: max, prompt: prompt };
      for (var key in extra || {}) q[key] = extra[key];
      return ask(q);
    }

    // S からちょうど k 曲を選ぶ（1画面9曲以下・3曲以下）。words: { what: 'TOP10' }
    function chooseK(S, k, stage, label, what) {
      if (k <= 0) return [];
      if (k >= S.length) return S.slice();
      var plan = choosePlan(S.length, k);
      var groups = splitBySizes(shuffle(S, rng), plan.sizes);
      var total = chooseCost(S.length, k), step = 0, chosen = [];
      groups.forEach(function (g, gi) {
        var need = plan.alloc[gi];
        while (need > 0 && need < g.length) {
          step++;
          var note = groups.length > 1 ? '（この画面から）' : '';
          if (need <= MAX_PICK) {
            var p = selectQ(stage, label, step, total, g, need,
              what + 'に入れる曲を' + need + '曲選んでください' + note, { exact: need });
            chosen = chosen.concat(p); need = 0; g = [];
          } else if (g.length - need <= MAX_PICK) {
            var x = selectQ(stage, label, step, total, g, g.length - need,
              what + 'から外す曲を' + (g.length - need) + '曲選んでください' + note, { exact: g.length - need, exclude: true });
            chosen = chosen.concat(without(g, x)); need = 0; g = [];
          } else { // 4曲以上を選ぶ必要があるときは、まず3曲選んでもらい残りを次の画面で
            var f = selectQ(stage, label, step, total, g, MAX_PICK,
              what + 'に入れる曲を3曲選んでください' + note, { exact: MAX_PICK });
            chosen = chosen.concat(f); need -= MAX_PICK; g = without(g, f);
          }
        }
        if (need > 0) chosen = chosen.concat(g); // need === g.length
      });
      return chosen;
    }

    /*
     * T からちょうど k 曲を選ぶ（簡易版の③④⑤）。
     * 9曲以下の画面で「最大3曲」選んでもらう周回を繰り返し、選ばれた曲で決まらなければ
     * 次の周回で絞る。上限が近い／誰も選ばれない場合は chooseK で確定させる。
     */
    function resolve(T, k, opt) {
      var chosen = [], pass = 0;
      for (;;) {
        if (k <= 0) break;
        if (T.length <= k) { chosen = chosen.concat(T); break; }
        var screens = Math.ceil(T.length / PER_SCREEN);
        var label = pass === 0 ? opt.firstLabel : opt.label, stage = pass === 0 ? opt.firstStage : opt.stage;
        var roomForPass = i + screens + 2 * Math.ceil(T.length / PER_SCREEN) <= opt.limit;
        if (T.length <= PER_SCREEN || (pass > 0 && !roomForPass)) {
          chosen = chosen.concat(chooseK(T, k, opt.stage, opt.label, opt.what));
          break;
        }
        var groups = splitScreens(shuffle(T, rng)), picks = [];
        var mx = Math.min(MAX_PICK, k);
        groups.forEach(function (g, gi) {
          var a = selectQ(stage, label, gi + 1, groups.length, g, mx,
            opt.what + 'に入れたい曲を最大' + mx + '曲選んでください' + (pass > 0 ? '（あと' + k + '曲）' : ''));
          picks = picks.concat(a);
        });
        picks.forEach(function (id) { opt.score[id] = (opt.score[id] || 0) + 1; });
        pass++;
        if (!picks.length) { chosen = chosen.concat(chooseK(T, k, opt.stage, opt.label, opt.what)); break; }
        if (picks.length === k) { chosen = chosen.concat(picks); break; }
        if (picks.length > k) { T = picks; continue; }
        chosen = chosen.concat(picks); k -= picks.length; T = without(T, picks);
      }
      return chosen;
    }

    // ① ふるい分け（両モード共通：9曲から最大3曲）
    var order = shuffle(songIds, rng);
    var siftGroups = splitScreens(order);
    var cand = [], fromSift = {}, fullGroups = [];
    siftGroups.forEach(function (g, k) {
      var a = selectQ(1, '① ふるい分け', k + 1, siftGroups.length, g, MAX_PICK,
        '好きな曲を最大' + MAX_PICK + '曲選んでください');
      a.forEach(function (id) { cand.push(id); fromSift[id] = true; });
      if (a.length === MAX_PICK) fullGroups.push({ songs: g, picked: a });
    });

    var score = {};
    var top10, top3;

    if (mode === 'simple') {
      // ③④ 各曲1回ずつの絞り込み → 決まらなければ境目の決定
      top10 = cand.length <= 10 ? cand.slice() : resolve(cand, 10, {
        firstStage: 3, firstLabel: '③ 絞り込み', stage: 4, label: '④ 境目の決定',
        what: 'TOP10', score: score, limit: MAX - FINAL_SCREENS.simple,
      });
      // ⑤ TOP10 からTOP3を選ぶ
      top3 = top10.length <= 3 ? top10.slice() : resolve(top10, 3, {
        firstStage: 5, firstLabel: '⑤ TOP3決定', stage: 5, label: '⑤ TOP3決定',
        what: 'TOP3', score: {}, limit: MAX,
      });
      return { done: true, top10: top10, top3: top3, screens: i, candidates: cand.length,
        picks1: Object.keys(fromSift) };
    }

    // ② 敗者復活（詳細版）：上限まで選んだグループの残りから、9曲×最大4画面
    var pool = [];
    fullGroups.forEach(function (fg) {
      fg.songs.forEach(function (id) { if (fg.picked.indexOf(id) < 0) pool.push(id); });
    });
    var revScreens = splitScreens(shuffle(pool, rng).slice(0, PER_SCREEN * 4));
    if (!pool.length) revScreens = [];
    revScreens.forEach(function (g, k) {
      var a = selectQ(2, '② 敗者復活', k + 1, revScreens.length, g, 2,
        '惜しくも選ばなかった曲から、最大2曲選んでください');
      a.forEach(function (id) { cand.push(id); });
    });

    cand.forEach(function (id) { score[id] = 0; });

    if (cand.length <= 10) {
      top10 = cand.slice();
    } else {
      // ③ 絞り込み（各曲2回）
      var groups = buildNarrowGroups(cand, rng);
      groups.forEach(function (g, k) {
        var mx = g.length >= 7 ? 3 : 2;
        var a = selectQ(3, '③ 絞り込み', k + 1, groups.length, g, mx, 'TOP10に入れたい曲を最大' + mx + '曲選んでください');
        a.forEach(function (id) { score[id] += 1; });
      });

      // ④ 境目の決定（2択。上限が近づいたら選択画面で確定）
      var sorted = cand.slice().sort(function (a, b) { return score[b] - score[a]; });
      var t = score[sorted[9]];
      var above = cand.filter(function (id) { return score[id] > t; });
      var tied = cand.filter(function (id) { return score[id] === t; });
      var k = 10 - above.length;
      var chosen;
      if (tied.length === k) {
        chosen = tied;
      } else {
        var tb = {}, games = {}, met = {};
        tied.forEach(function (id) { tb[id] = 0; games[id] = 0; });
        var m = 0;
        var pairMax = Math.max(0, Math.min(10, MAX - i - FINAL_SCREENS.detail - chooseCost(tied.length, k)));
        for (;;) {
          var st = tied.slice().sort(function (a, b) { return tb[b] - tb[a]; });
          if (tb[st[k - 1]] > tb[st[k]]) { chosen = st.slice(0, k); break; }
          var bnd = tb[st[k - 1]];
          var sure = tied.filter(function (id) { return tb[id] > bnd; });
          var contested = tied.filter(function (id) { return tb[id] === bnd; });
          var need = k - sure.length;
          if (m >= 10 || i + 1 + chooseCost(contested.length, need) + FINAL_SCREENS.detail > MAX) {
            chosen = sure.concat(chooseK(contested, need, 4, '④ 境目の決定', 'TOP10'));
            break;
          }
          // なるべく対戦回数の少ない曲同士、未対戦の組み合わせを優先
          var r = {};
          contested.forEach(function (id) { r[id] = rng(); });
          var byGames = contested.slice().sort(function (a, b) { return games[a] - games[b] || r[a] - r[b]; });
          var x = byGames[0];
          var rest = byGames.slice(1).sort(function (a, b) {
            var ma = met[x + '|' + a] ? 1 : 0, mb = met[x + '|' + b] ? 1 : 0;
            return games[a] - games[b] || ma - mb || r[a] - r[b];
          });
          var y = rest[0];
          var left = rng() < 0.5 ? x : y, right = left === x ? y : x;
          var ans = ask({ type: 'pair', stage: 4, label: '④ 境目の決定', step: m + 1, total: Math.max(pairMax, m + 1),
            totalIsMax: true, a: left, b: right, allowDraw: true, prompt: 'どちらが好きですか？' });
          if (ans === 'L') tb[left] += 1;
          else if (ans === 'R') tb[right] += 1;
          else { tb[left] += 0.5; tb[right] += 0.5; }
          games[left]++; games[right]++;
          met[x + '|' + y] = met[y + '|' + x] = true;
          m++;
        }
        tied.forEach(function (id) { score[id] += tb[id]; });
      }
      top10 = above.concat(chosen);
    }

    // ⑤ TOP3決定トーナメント（詳細版）
    var rk = {};
    top10.forEach(function (id) { rk[id] = rng(); });
    function bySeed(a, b) {
      return (score[b] || 0) - (score[a] || 0)
        || (fromSift[b] ? 1 : 0) - (fromSift[a] ? 1 : 0)
        || rk[a] - rk[b];
    }
    var seeds = top10.slice().sort(bySeed);

    function playRound(pairs, label) {
      var winners = [], losers = [];
      pairs.forEach(function (p, n) {
        var flip = rng() < 0.5;
        var L = flip ? p[1] : p[0], R = flip ? p[0] : p[1];
        var ans = ask({ type: 'pair', stage: 5, label: '⑤ TOP3決定戦 ' + label, step: n + 1, total: pairs.length,
          a: L, b: R, allowDraw: false, prompt: 'どちらが好きですか？' });
        var w = ans === 'R' ? R : L;
        winners.push(w); losers.push(w === L ? R : L);
      });
      return { winners: winners, losers: losers };
    }

    function foldPairs(list) {
      var p = [];
      for (var a = 0; a < Math.floor(list.length / 2); a++) p.push([list[a], list[list.length - 1 - a]]);
      return p;
    }

    // 3曲になるまで減らす（1番目対最後、2番目対最後から2番目…。上位は不戦勝）
    function reduce(list, roundNo) {
      while (list.length > 3) {
        var e = list.length - 3;
        var label = roundNo + '回戦';
        if (e <= Math.floor(list.length / 2)) {
          var byes = list.length - 2 * e;
          var advance = list.slice(0, byes), r = list.slice(byes), pairs = [];
          for (var a = 0; a < e; a++) pairs.push([r[a], r[r.length - 1 - a]]);
          list = advance.concat(playRound(pairs, label).winners).sort(bySeed);
        } else {
          var pr = foldPairs(list), mid = list.length % 2 ? [list[Math.floor(list.length / 2)]] : [];
          list = mid.concat(playRound(pr, label).winners).sort(bySeed);
        }
        roundNo++;
      }
      return list;
    }

    if (seeds.length <= 3) {
      top3 = seeds.slice();
    } else {
      var r1 = foldPairs(seeds);
      var bye = seeds.length % 2 ? [seeds[Math.floor(seeds.length / 2)]] : [];
      var res1 = playRound(r1, '1回戦');
      var winners = bye.concat(res1.winners).sort(bySeed);
      var losers = res1.losers.slice().sort(bySeed);
      var rev = selectQ(5, '⑤ TOP3決定戦 敗者復活戦', 1, 1, losers, 1,
        '1回戦で負けた曲から、1曲だけ復活させてください', { exact: 1 });
      top3 = reduce(winners.concat([rev[0]]).sort(bySeed), 2);
    }

    return { done: true, top10: top10, top3: top3, screens: i, candidates: cand.length,
        picks1: Object.keys(fromSift) };
  }

  var api = { run: run, MAX_SCREENS: MAX_SCREENS, PER_SCREEN: PER_SCREEN, MAX_PICK: MAX_PICK, STAGES: STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatlesLogic = api;
})(this);
