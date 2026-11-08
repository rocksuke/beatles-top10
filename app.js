/* ビートルズTOP10診断 — 画面・保存・結果画像・共有 */
(function () {
  'use strict';

  var STORAGE_KEY = 'beatlesTop10:v3'; // ロジックを変えたら番号を上げ、古い途中経過を無効にする
  var LABELS = { simple: '簡易版', detail: '詳細版' };
  var ESTIMATE = { simple: 36, detail: 60 }; // scripts/simulate.js の平均値（ランダム回答）
  var APPLE_MUSIC_URL = 'https://music.apple.com/jp/artist/the-beatles/136975';
  var HASHTAG = '#ビートルズTOP10診断';
  var LOG = '[beatles-top10]';

  // 匿名集計（config.js の gasUrl が未設定なら、送信もランキングも無効）
  var CONFIG = window.BEATLES_CONFIG || {};
  // https のURLだけ有効（動作確認用に http://127.0.0.1 と localhost も許可）
  var GAS_URL = typeof CONFIG.gasUrl === 'string' && /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/)\S*$/.test(CONFIG.gasUrl.trim())
    ? CONFIG.gasUrl.trim() : '';
  var SENT_KEY = 'beatlesTop10:sent';   // 送信済みの sid の一覧
  var OPTIN_KEY = 'beatlesTop10:optin'; // 「集計に参加する」の選択（'0' のときだけオフ）
  var MODE_API = { simple: 'simple', detail: 'detailed' };
  var MIN_RANKING = 30;      // これ未満はランキングではなく「集計中」と表示
  var SUBMIT_DELAY = 15000;  // 結果画面を開いてから送信するまでの時間（その間はチェックを外せる）
  var METRICS = { top10: 'TOP10入り率', top3: 'TOP3入り率', picks1: '①の選ばれ率' };
  var RANK_MODES = { all: '全体', simple: '簡易版', detailed: '詳細版' };
  var LEAVE_ACTS = ['share', 'download', 'new', 'ranking', 'home'];

  var app = document.getElementById('app');
  var progressEl = document.getElementById('progress');
  var DATA = null, SONG = {}, ALBUM = {}, IDS = [];
  var state = null; // { mode, seed, answers, key }
  var draft = null; // 「戻る」で戻った画面の前回の選択
  var image = null; // { blob, url, artwork:boolean }
  var view = 'start'; // 'start' | 'game' | 'result' | 'ranking'

  // ---------- 保存（すべて try/catch） ----------
  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.key !== dataKey() || !LABELS[s.mode] || !Array.isArray(s.answers)) return null;
      return s;
    } catch (e) { return null; }
  }
  function save() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function clearSaved() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 保存できなくても続行 */ }
  }
  function dataKey() { return IDS.length + ':' + IDS[0] + ':' + IDS[IDS.length - 1]; }

  // ---------- ユーティリティ ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function siteUrl() {
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }
  function albumOf(id) { return ALBUM[SONG[id].album]; }
  function byRelease(a, b) {
    return albumOf(a).order - albumOf(b).order || SONG[a].track - SONG[b].track;
  }
  function art(id, cls) {
    var al = albumOf(id);
    return '<span class="art ' + (cls || '') + '" style="--c:' + al.color + '">' +
      '<span class="ph">' + esc(al.name) + '</span>' +
      (al.artwork ? '<img src="' + esc(al.artwork) + '" alt="" loading="lazy" decoding="async">' : '') +
      '</span>';
  }
  function newSeed() { return Math.floor(Math.random() * 4294967295) >>> 0; }
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* 次の方法へ */ }
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // 画像が読み込めない場合はプレースホルダーを見せる
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.parentNode && t.parentNode.classList.contains('art')) t.remove();
  }, true);

  // ---------- 画面 ----------
  function start() {
    fetch('data/songs.json').then(function (r) { return r.json(); }).then(function (d) {
      DATA = d;
      d.albums.forEach(function (a) { ALBUM[a.name] = a; });
      d.songs.forEach(function (s) { SONG[s.id] = s; });
      IDS = d.songs.map(function (s) { return s.id; });
      if (GAS_URL) document.getElementById('statsNote').hidden = false;
      if (location.hash === '#ranking' && GAS_URL) renderRanking(); else renderStart();
    }).catch(function (e) {
      console.error(LOG, e);
      app.innerHTML = '<p class="notice">曲データを読み込めませんでした。ページを再読み込みしてください。</p>';
    });
  }

  function renderStart() {
    view = 'start';
    progressEl.hidden = true;
    var saved = load();
    var resume = '';
    if (saved) {
      var r = BeatlesLogic.run(IDS, saved.mode, saved.seed, saved.answers);
      var where = r.done ? '結果まで完了' : saved.answers.length + '問回答済み';
      resume = '<section class="resume"><p>前回の診断（' + LABELS[saved.mode] + '・' + where + '）があります。</p>' +
        '<div class="row"><button class="btn primary" data-act="resume">続きから</button>' +
        '<button class="btn" data-act="discard">最初から</button></div></section>';
    }
    app.innerHTML =
      '<section class="hero">' +
        '<h1>ビートルズ<br>TOP10診断</h1>' +
        '<p class="lead">全' + IDS.length + '曲から、あなたが好きな<strong>10曲</strong>と、その中の<strong>TOP3</strong>を選び出します。順位は付けません。</p>' +
      '</section>' + resume +
      '<section class="modes">' +
        '<button class="mode" data-act="new" data-mode="simple"><span class="mode-name">簡易版</span><span class="mode-q">約' + ESTIMATE.simple + '問</span>' +
          '<span class="mode-desc">テンポよく進む、手早い診断</span></button>' +
        '<button class="mode" data-act="new" data-mode="detail"><span class="mode-name">詳細版</span><span class="mode-q">約' + ESTIMATE.detail + '問</span>' +
          '<span class="mode-desc">敗者復活や1対1の対決もある、より正確な診断</span></button>' +
      '</section>' +
      (GAS_URL ? '<button class="btn wide" data-act="ranking">みんなのランキングを見る</button>' : '') +
      '<p class="small">対象：UKオリジナルアルバム13枚、Magical Mystery Tour、Past Masters の全曲。途中経過はこの端末に自動保存されます。</p>';
    window.scrollTo(0, 0);
  }

  function newGame(mode) {
    state = { mode: mode, seed: newSeed(), answers: [], key: dataKey(), sid: uuid() };
    draft = null;
    save();
    step();
  }

  function step() {
    var r = BeatlesLogic.run(IDS, state.mode, state.seed, state.answers);
    if (r.done) renderResult(r); else renderQuestion(r.question);
    window.scrollTo(0, 0);
  }

  function answer(a) {
    state.answers.push(a);
    draft = null;
    save();
    step();
  }

  function back() {
    if (!state.answers.length) { renderStart(); return; }
    draft = state.answers.pop();
    save();
    step();
  }

  function renderProgress(q) {
    progressEl.hidden = false;
    var segs = q.stages.map(function (s) {
      var f = s < q.stage ? 1 : s > q.stage ? 0 : (q.step - 1) / q.total;
      return '<span class="seg"><span style="width:' + Math.round(f * 100) + '%"></span></span>';
    }).join('');
    var total = q.totalIsMax ? '最大' + q.total : q.total;
    progressEl.innerHTML = '<div class="bar">' + segs + '</div>' +
      '<div class="ptext"><span>' + esc(q.label) + ' ' + q.step + '/' + total + '</span>' +
      '<span class="pmode">' + LABELS[state.mode] + '</span></div>';
  }

  function renderQuestion(q) {
    view = 'game';
    cancelSubmit(); // 結果から「やり直す」で戻ったら、まだ送らない
    renderProgress(q);
    if (q.type === 'select') renderSelect(q); else renderPair(q);
  }

  function renderSelect(q) {
    var picked = Array.isArray(draft) ? draft.filter(function (id) { return q.songs.indexOf(id) >= 0; }).slice(0, q.max) : [];
    app.innerHTML =
      '<h2 class="prompt">' + esc(q.prompt) + '</h2>' +
      '<p class="count" aria-live="polite"></p>' +
      '<div class="grid g3' + (q.exclude ? ' exclude' : '') + '">' + q.songs.map(function (id) {
        var s = SONG[id];
        return '<button class="card" data-id="' + id + '" aria-pressed="false">' + art(id, 'sm') +
          '<span class="meta"><span class="title">' + esc(s.title) + '</span><span class="album">' + esc(s.album) + '</span></span></button>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn" data-act="back">戻る</button><button class="btn primary" data-act="next"></button></div>';

    function sync() {
      var full = picked.length >= q.max;
      app.querySelectorAll('.card').forEach(function (c) {
        var on = picked.indexOf(c.dataset.id) >= 0;
        c.setAttribute('aria-pressed', on);
        c.classList.toggle('locked', full && !on);
        c.setAttribute('aria-disabled', full && !on);
      });
      app.querySelector('.count').textContent = q.exact
        ? (q.exclude ? '外す曲 ' : '') + picked.length + ' / ' + q.exact + '曲'
        : picked.length + ' / 最大' + q.max + '曲' + (full ? '（上限です。選び直すにはタップで解除）' : '');
      var next = app.querySelector('[data-act=next]');
      next.disabled = q.exact ? picked.length !== q.exact : false;
      next.textContent = picked.length || q.exact ? '次へ' : '選ばずに次へ';
    }
    app.querySelector('.grid').addEventListener('click', function (e) {
      var c = e.target.closest('.card');
      if (!c) return;
      var i = picked.indexOf(c.dataset.id);
      if (i >= 0) picked.splice(i, 1);
      else if (picked.length < q.max) picked.push(c.dataset.id);
      sync();
    });
    app.querySelector('[data-act=next]').addEventListener('click', function () { answer(picked.slice()); });
    sync();
  }

  function renderPair(q) {
    function card(id, side) {
      var s = SONG[id];
      var wide = side === 'L' ? '左が好き' : '右が好き', narrow = side === 'L' ? '上の曲が好き' : '下の曲が好き';
      return '<button class="pcard" data-ans="' + side + '">' + art(id, 'lg') +
        '<span class="title">' + esc(s.title) + '</span><span class="album">' + esc(s.album) + '（' + s.year + '）</span>' +
        '<span class="pick"><span class="wide">' + wide + '</span><span class="narrow">' + narrow + '</span></span></button>';
    }
    app.innerHTML =
      '<h2 class="prompt">' + esc(q.prompt) + '</h2>' +
      '<div class="pair">' + card(q.a, 'L') +
        (q.allowDraw ? '<button class="btn draw" data-ans="D">同程度</button>' : '<span class="vs">VS</span>') +
        card(q.b, 'R') + '</div>' +
      '<div class="actions single"><button class="btn" data-act="back">戻る</button></div>';
    var lockUntil = Date.now() + 350; // 連続タップによる誤回答を防ぐ
    app.querySelector('.pair').addEventListener('click', function (e) {
      var b = e.target.closest('[data-ans]');
      if (!b || Date.now() < lockUntil) return;
      answer(b.dataset.ans);
    });
  }

  // ---------- 結果 ----------
  function renderResult(r) {
    view = 'result';
    progressEl.hidden = true;
    var top3 = r.top3.slice().sort(byRelease);
    var rest = r.top10.filter(function (id) { return r.top3.indexOf(id) < 0; }).sort(byRelease);
    if (!r.top10.length) {
      app.innerHTML = '<h2 class="prompt">選ばれた曲がありませんでした</h2>' +
        '<p class="lead">もう一度、好きな曲を選んでみてください。</p>' +
        '<div class="stack"><button class="btn primary" data-act="new" data-mode="' + state.mode + '">もう一度診断する</button>' +
        '<button class="btn" data-act="back">最後の回答をやり直す</button></div>';
      return;
    }
    function bigCard(id) {
      var s = SONG[id], al = albumOf(id);
      return '<a class="rcard big" href="' + esc(al.appleMusicUrl || APPLE_MUSIC_URL) + '" target="_blank" rel="noopener">' + art(id, 'xl') +
        '<span class="title">' + esc(s.title) + '</span><span class="album">' + esc(s.album) + '</span></a>';
    }
    function smallCard(id) {
      var s = SONG[id];
      return '<div class="card static">' + art(id, 'sm') +
        '<span class="meta"><span class="title">' + esc(s.title) + '</span><span class="album">' + esc(s.album) + '</span></span></div>';
    }
    app.innerHTML =
      '<section class="result">' +
        '<p class="badge">' + LABELS[state.mode] + 'の診断結果</p>' +
        '<h2 class="rtitle">あなたのビートルズTOP10</h2>' +
        '<h3 class="rsub">★ TOP3</h3><div class="top3">' + top3.map(bigCard).join('') + '</div>' +
        (rest.length ? '<h3 class="rsub">ほか' + rest.length + '曲</h3><div class="grid">' + rest.map(smallCard).join('') + '</div>' : '') +
        '<p class="small center">並び順はアルバムの発売順です。</p>' +
      '</section>' + statsBlock(r) +
      '<section class="share">' +
        '<h3 class="rsub">結果画像</h3>' +
        '<div class="preview"><p class="small">画像を生成しています…</p></div>' +
        '<div class="stack">' +
          '<button class="btn primary" data-act="share" disabled>Xで共有</button>' +
          '<button class="btn" data-act="download" disabled>画像を保存</button>' +
          '<p class="notice" id="shareNote" hidden></p>' +
          (state.mode === 'simple' ? '<button class="btn accent" data-act="new" data-mode="detail">詳細版でもっと正確に診断する</button>' : '') +
          '<button class="btn" data-act="new" data-mode="' + state.mode + '">もう一度診断する</button>' +
          '<button class="btn ghost" data-act="back">最後の回答をやり直す</button>' +
        '</div>' +
      '</section>' +
      '<p class="credit"><a href="' + APPLE_MUSIC_URL + '" target="_blank" rel="noopener">Artwork via Apple Music</a></p>';

    armSubmit(r);
    var mode = state.mode, seed = state.seed, n = state.answers.length;
    makeImage(top3, rest, mode).then(function (img) {
      // 生成中に別の画面へ移っていたら何もしない
      if (!state || state.seed !== seed || state.answers.length !== n || !document.querySelector('.preview')) return;
      if (image && image.url) URL.revokeObjectURL(image.url);
      image = img;
      document.querySelector('.preview').innerHTML = '<img src="' + img.url + '" alt="診断結果の画像" width="1080" height="1350">';
      app.querySelectorAll('[data-act=share],[data-act=download]').forEach(function (b) { b.disabled = false; });
      image.text = shareText(top3, rest, mode);
    }).catch(function (e) {
      console.error(LOG, '結果画像を生成できませんでした', e);
      var p = document.querySelector('.preview');
      if (p) p.innerHTML = '<p class="notice">結果画像を生成できませんでした。</p>';
    });
  }

  // ---------- 結果画像（Canvas） ----------
  var W = 1080, H = 1350;
  var FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", system-ui, sans-serif';

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      var timer = setTimeout(function () { resolve(null); }, 10000);
      img.crossOrigin = 'anonymous';
      img.onload = function () { clearTimeout(timer); resolve(img); };
      img.onerror = function () { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  function makeImage(top3, rest, mode) {
    var names = {};
    top3.concat(rest).forEach(function (id) { names[SONG[id].album] = true; });
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    return fontsReady.then(function () {
      return Promise.all(Object.keys(names).map(function (n) {
        return loadImage(ALBUM[n].artwork).then(function (img) { return [n, img]; });
      }));
    }).then(function (pairs) {
      var imgs = {};
      var failed = pairs.filter(function (p) { return !p[1]; }).map(function (p) { return p[0]; });
      pairs.forEach(function (p) { imgs[p[0]] = p[1]; });
      var useArt = failed.length === 0;
      var canvas = draw(top3, rest, mode, useArt ? imgs : null);
      return toBlob(canvas).then(function (blob) {
        console.info(LOG, useArt
          ? 'Canvas: ジャケット画像を描画して書き出しました（CORS OK）'
          : 'Canvas: ジャケット画像を読み込めなかったため、プレースホルダーで描画しました: ' + failed.join(', '));
        return { blob: blob, artwork: useArt };
      }, function (err) {
        // Canvas が汚染された（CORS）場合はプレースホルダーで描き直す
        console.warn(LOG, 'Canvas: 書き出しに失敗したため、プレースホルダーで描き直します（' + err.name + '）');
        return toBlob(draw(top3, rest, mode, null)).then(function (blob) { return { blob: blob, artwork: false }; });
      });
    }).then(function (res) {
      res.url = URL.createObjectURL(res.blob);
      window.__beatlesArtwork = res.artwork; // 動作確認用
      return res;
    });
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('toBlob returned null')); }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  function wrap(ctx, text, maxW, maxLines) {
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] += '…';
    }
    return lines.map(function (l) { // 1語が長すぎる場合も切り詰める
      while (ctx.measureText(l).width > maxW && l.length > 1) l = l.slice(0, -2) + '…';
      return l;
    });
  }

  function drawArt(ctx, album, imgs, x, y, size) {
    var img = imgs && imgs[album.name];
    ctx.save();
    roundRect(ctx, x, y, size, size, size * 0.04);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      ctx.fillStyle = album.color;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      var fs = Math.max(14, Math.round(size / 9));
      ctx.font = '700 ' + fs + 'px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var lines = wrap(ctx, album.name, size * 0.84, 4);
      lines.forEach(function (l, i) { ctx.fillText(l, x + size / 2, y + size / 2 + (i - (lines.length - 1) / 2) * fs * 1.2); });
    }
    ctx.restore();
    // 白いジャケット（The Beatles）が背景に溶けないよう細い枠を付ける
    ctx.save();
    roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, size * 0.04);
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(top3, rest, mode, imgs) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f2e8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#b3121f'; ctx.fillRect(0, 0, W, 14);

    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillStyle = '#1d1a16';
    ctx.font = '800 66px ' + FONT;
    ctx.fillText('私のビートルズTOP10', 60, 125);
    ctx.font = '700 30px ' + FONT;
    var label = LABELS[mode], lw = ctx.measureText(label).width + 40;
    ctx.fillStyle = '#b3121f'; roundRect(ctx, 60, 152, lw, 50, 25); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, 80, 188);

    ctx.fillStyle = '#b3121f'; ctx.font = '800 36px ' + FONT;
    ctx.fillText('★ TOP3', 60, 270);
    var n3 = top3.length, size3 = 300, gap = (W - 120 - size3 * 3) / 2;
    var x0 = (W - (n3 * size3 + (n3 - 1) * gap)) / 2;
    top3.forEach(function (id, i) {
      var x = x0 + i * (size3 + gap), y = 295;
      drawArt(ctx, albumOf(id), imgs, x, y, size3);
      ctx.fillStyle = '#1d1a16'; ctx.font = '700 32px ' + FONT; ctx.textAlign = 'center';
      wrap(ctx, SONG[id].title, size3, 2).forEach(function (l, k) { ctx.fillText(l, x + size3 / 2, y + size3 + 48 + k * 40); });
      ctx.textAlign = 'left';
    });

    if (rest.length) {
      ctx.fillStyle = '#b3121f'; ctx.font = '800 32px ' + FONT;
      ctx.fillText('ほか' + rest.length + '曲', 60, 760);
      rest.forEach(function (id, i) {
        var col = i % 2, row = Math.floor(i / 2);
        var x = 60 + col * 495, y = 785 + row * 110, sz = 92;
        drawArt(ctx, albumOf(id), imgs, x, y, sz);
        ctx.fillStyle = '#1d1a16'; ctx.font = '700 28px ' + FONT;
        var lines = wrap(ctx, SONG[id].title, 370, 2);
        var ty = y + (lines.length === 1 ? 56 : 40);
        lines.forEach(function (l, k) { ctx.fillText(l, x + sz + 18, ty + k * 34); });
      });
    }

    ctx.fillStyle = '#d9cfbd'; ctx.fillRect(60, 1240, W - 120, 2);
    ctx.fillStyle = '#5c544a'; ctx.font = '500 24px ' + FONT;
    ctx.fillText((imgs ? 'Artwork via Apple Music ・ ' : '') + '非公式ファンサイト ' + HASHTAG, 60, 1285);
    ctx.fillText(siteUrl().replace(/^https?:\/\//, ''), 60, 1322);
    return c;
  }

  // ---------- 保存・共有 ----------
  function isIOS() {
    return /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function note(html) {
    var el = document.getElementById('shareNote');
    if (!el) return;
    el.innerHTML = html; el.hidden = false;
  }

  function download() {
    var a = document.createElement('a');
    a.href = image.url; a.download = 'beatles-top10.png';
    document.body.appendChild(a); a.click(); a.remove();
    if (isIOS()) {
      note('保存できない場合は <button class="link" data-act="openimg">画像を新しいタブで開く</button> をタップし、画像を長押しして「写真に保存」を選んでください。');
    }
  }

  function tweetLength(text) {
    // X の数え方：URL は23、日本語など（下記の範囲外）は1文字を2として数える
    var n = 0;
    var noUrl = text.replace(/https?:\/\/\S+/g, function () { n += 23; return ''; });
    Array.from(noUrl).forEach(function (ch) {
      var c = ch.codePointAt(0);
      n += (c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037)) ? 1 : 2;
    });
    return n;
  }

  function shareText(top3, rest, mode) {
    var head = ['私のビートルズTOP10（' + LABELS[mode] + '）', '★TOP3'].concat(top3.map(function (id) { return '・' + SONG[id].title; }));
    var tail = [HASHTAG, siteUrl()];
    var full = head.concat(rest.length ? ['★ほか' + rest.length + '曲'].concat(rest.map(function (id) { return '・' + SONG[id].title; })) : [], tail).join('\n');
    if (tweetLength(full) <= 280) return full;
    return head.concat(rest.length ? ['ほか' + rest.length + '曲'] : [], tail).join('\n');
  }

  function share() {
    var file;
    try { file = new File([image.blob], 'beatles-top10.png', { type: 'image/png' }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.share) {
      var canFiles = false;
      try { canFiles = navigator.canShare({ files: [file] }); } catch (e) { canFiles = false; }
      if (canFiles) {
        navigator.share({ files: [file], text: image.text }).catch(function (e) {
          if (e && e.name === 'AbortError') return; // ユーザーが閉じた
          console.warn(LOG, 'Web Share に失敗したため Web Intent に切り替えます', e);
          intent(false);
        });
        return;
      }
    }
    intent(true);
  }

  function intent(sync) {
    var url = 'https://x.com/intent/post?text=' + encodeURIComponent(image.text);
    download();
    var w = sync ? window.open(url, '_blank', 'noopener') : null;
    note('画像を保存しました。開いた投稿画面に、<strong>保存した画像を添付してください</strong>。' +
      (w ? '' : '<br><a href="' + url + '" target="_blank" rel="noopener">投稿画面を開く</a>'));
  }

  // ---------- 匿名集計への送信 ----------
  var pending = null; // { sid, body, timer }

  function optedIn() { return lsGet(OPTIN_KEY) !== '0'; }
  function sentList() {
    try { var a = JSON.parse(lsGet(SENT_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function wasSent(sid) { return sentList().indexOf(sid) >= 0; }
  function markSent(sid, on) {
    var a = sentList().filter(function (x) { return x !== sid; });
    if (on) a.push(sid);
    lsSet(SENT_KEY, JSON.stringify(a.slice(-50)));
  }
  function canSubmit(r) {
    return !!(GAS_URL && state && state.sid && r.top3.length === 3 && r.top10.length >= 3);
  }

  function statsBlock(r) {
    if (!GAS_URL) return '';
    var body;
    if (!canSubmit(r)) body = '';
    else if (wasSent(state.sid)) body = '<p class="small">この結果は集計に送信済みです。</p>';
    else {
      body = '<label class="optin"><input type="checkbox" id="optin"' + (optedIn() ? ' checked' : '') + '> 集計に参加する（匿名）</label>' +
        '<p class="small">送るのは、選んだ曲のIDとモードだけです。名前などの個人情報は送りません。</p>';
    }
    return '<section class="stats">' + body +
      '<button class="btn wide" data-act="ranking">みんなのランキングを見る</button></section>';
  }

  function armSubmit(r) {
    cancelSubmit();
    if (!canSubmit(r) || wasSent(state.sid)) return;
    var payload = { v: 1, sid: state.sid, mode: MODE_API[state.mode],
      picks1: r.picks1.slice(), top10: r.top10.slice(), top3: r.top3.slice() };
    pending = { sid: state.sid, body: JSON.stringify(payload) };
    pending.timer = setTimeout(function () { flushSubmit('timer'); }, SUBMIT_DELAY);
  }

  function cancelSubmit() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  // 送信は1回だけ。失敗しても画面には何も影響させない
  function flushSubmit(reason) {
    if (!pending || !optedIn()) return;
    var p = pending;
    cancelSubmit();
    if (wasSent(p.sid)) return;
    markSent(p.sid, true);
    try {
      // GAS はプリフライトに対応していないため text/plain で送る（応答は読まない）
      fetch(GAS_URL, { method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: p.body })
        .then(function () { console.info(LOG, '集計に送信しました（' + reason + '）'); })
        .catch(function (e) { markSent(p.sid, false); console.warn(LOG, '集計への送信に失敗しました', e); });
    } catch (e) {
      markSent(p.sid, false);
    }
  }

  // ---------- みんなのランキング ----------
  var rankView = { metric: 'top10', mode: 'all' };
  var rankData = null, rankAt = 0, returnTo = 'start', rankingPushed = false;

  function openRanking() {
    returnTo = view === 'game' || view === 'result' ? 'game' : 'start';
    rankingPushed = true;
    location.hash = '#ranking'; // hashchange で描画
    if (location.hash === '#ranking' && view !== 'ranking') renderRanking();
  }
  function closeRanking() {
    if (rankingPushed) { history.back(); return; } // hashchange → afterRanking
    history.replaceState(null, '', location.pathname + location.search);
    afterRanking();
  }
  function afterRanking() {
    rankingPushed = false;
    if (returnTo === 'game' && state) step(); else renderStart();
  }

  function renderRanking() {
    view = 'ranking';
    progressEl.hidden = true;
    app.innerHTML =
      '<section class="ranking">' +
        '<h2 class="rtitle">みんなのランキング</h2>' +
        '<p class="rk-count" id="rkCount">読み込み中…</p>' +
        '<div class="tabs" role="tablist">' + Object.keys(METRICS).map(function (k) {
          return '<button class="tab" role="tab" data-act="rkmetric" data-v="' + k + '">' + METRICS[k] + '</button>';
        }).join('') + '</div>' +
        '<div class="chips">' + Object.keys(RANK_MODES).map(function (k) {
          return '<button class="chip" data-act="rkmode" data-v="' + k + '">' + RANK_MODES[k] + '</button>';
        }).join('') + '</div>' +
        '<div id="rkBody" class="rk-body"></div>' +
        '<p class="small">1時間ごとに更新されます。<span id="rkUpdated"></span></p>' +
        '<div class="stack"><button class="btn" data-act="rkback">戻る</button></div>' +
      '</section>';
    window.scrollTo(0, 0);
    syncRankTabs();
    if (rankData && Date.now() - rankAt < 5 * 60 * 1000) { drawRanking(); return; }
    fetch(GAS_URL, { method: 'GET', cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (json) { rankData = sanitizeSummary(json); rankAt = Date.now(); if (view === 'ranking') drawRanking(); })
      .catch(function (e) {
        console.warn(LOG, 'ランキングを読み込めませんでした', e);
        if (view !== 'ranking') return;
        document.getElementById('rkCount').textContent = '';
        setMessage('ランキングを読み込めませんでした。時間をおいて、もう一度お試しください。');
      });
  }

  // サーバーからの値は検証し、自分の songs.json にある曲IDと 0〜1 の数値だけを使う
  function sanitizeSummary(d) {
    if (!d || typeof d !== 'object') throw new Error('invalid summary');
    var t = typeof d.updatedAt === 'string' ? Date.parse(d.updatedAt) : NaN;
    var out = { updatedAt: isNaN(t) ? null : new Date(t), modes: {} };
    Object.keys(RANK_MODES).forEach(function (m) {
      var src = d.modes && typeof d.modes === 'object' ? d.modes[m] : null;
      var g = { n: 0, top10: [], top3: [], picks1: [] };
      if (src && typeof src === 'object') {
        g.n = typeof src.n === 'number' && isFinite(src.n) && src.n >= 0 ? Math.floor(src.n) : 0;
        Object.keys(METRICS).forEach(function (k) {
          var map = src[k];
          if (!map || typeof map !== 'object') return;
          Object.keys(map).forEach(function (id) {
            var v = map[id];
            if (Object.prototype.hasOwnProperty.call(SONG, id) && typeof v === 'number' && v > 0 && v <= 1) g[k].push({ id: id, rate: v });
          });
          g[k].sort(function (a, b) { return b.rate - a.rate || byRelease(a.id, b.id); });
        });
      }
      out.modes[m] = g;
    });
    return out;
  }

  function syncRankTabs() {
    app.querySelectorAll('[data-act=rkmetric]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.v === rankView.metric);
    });
    app.querySelectorAll('[data-act=rkmode]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.v === rankView.mode);
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function artEl(id, cls) {
    var al = albumOf(id), box = el('span', 'art ' + cls);
    box.style.setProperty('--c', al.color);
    box.appendChild(el('span', 'ph', al.name));
    if (al.artwork) {
      var img = el('img');
      img.src = al.artwork; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      box.appendChild(img);
    }
    return box;
  }
  function setMessage(text) {
    var body = document.getElementById('rkBody');
    body.textContent = '';
    body.appendChild(el('p', 'notice', text));
  }

  function drawRanking() {
    if (view !== 'ranking' || !rankData) return;
    syncRankTabs();
    var all = rankData.modes.all, g = rankData.modes[rankView.mode];
    var count = all.n.toLocaleString('ja-JP') + '人が診断しました';
    if (rankView.mode !== 'all') count += '（' + RANK_MODES[rankView.mode] + ' ' + g.n.toLocaleString('ja-JP') + '人）';
    document.getElementById('rkCount').textContent = count;
    document.getElementById('rkUpdated').textContent = rankData.updatedAt
      ? '（最終更新：' + rankData.updatedAt.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' }) + '）' : '';
    if (g.n < MIN_RANKING) {
      setMessage('集計中です。' + MIN_RANKING + '人以上集まるとランキングを表示します（現在 ' + g.n + '人）。');
      return;
    }
    var body = document.getElementById('rkBody');
    body.textContent = '';
    var list = el('ol', 'rk-list'), rows = g[rankView.metric].slice(0, 20), rank = 0, prev = null;
    rows.forEach(function (row, i) {
      if (row.rate !== prev) { rank = i + 1; prev = row.rate; }
      var s = SONG[row.id], li = el('li', 'rk-item');
      li.appendChild(el('span', 'rk-no', String(rank)));
      li.appendChild(artEl(row.id, 'sm'));
      var meta = el('span', 'meta');
      meta.appendChild(el('span', 'title', s.title));
      meta.appendChild(el('span', 'album', s.album));
      var bar = el('span', 'rk-bar'), fill = el('span');
      fill.style.width = Math.round(row.rate * 100) + '%';
      bar.appendChild(fill);
      meta.appendChild(bar);
      li.appendChild(meta);
      li.appendChild(el('span', 'rk-rate', (row.rate * 100).toFixed(1) + '%'));
      list.appendChild(li);
    });
    if (!rows.length) { setMessage('まだデータがありません。'); return; }
    body.appendChild(list);
  }

  // ---------- イベント ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    // 結果画面での操作（共有・保存・次の診断・ランキング）をきっかけに送信する
    if (view === 'result' && LEAVE_ACTS.indexOf(act) >= 0) flushSubmit('action');
    if (act === 'new') { if (state) clearSaved(); newGame(b.dataset.mode); }
    else if (act === 'resume') {
      state = load();
      if (state && !state.sid) { state.sid = uuid(); save(); }
      if (state) step(); else renderStart();
    }
    else if (act === 'discard') { clearSaved(); state = null; renderStart(); }
    else if (act === 'back') back();
    else if (act === 'download' && image) download();
    else if (act === 'share' && image) share();
    else if (act === 'openimg' && image) window.open(image.url, '_blank');
    else if (act === 'home') renderStart();
    else if (act === 'ranking' && GAS_URL) openRanking();
    else if (act === 'rkback') closeRanking();
    else if (act === 'rkmetric' && METRICS[b.dataset.v]) { rankView.metric = b.dataset.v; drawRanking(); }
    else if (act === 'rkmode' && RANK_MODES[b.dataset.v]) { rankView.mode = b.dataset.v; drawRanking(); }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'optin') lsSet(OPTIN_KEY, e.target.checked ? '1' : '0');
  });
  // ページを離れる・閉じるときに、まだ送っていない結果を送る
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushSubmit('hidden');
  });
  window.addEventListener('pagehide', function () { flushSubmit('pagehide'); });
  window.addEventListener('hashchange', function () {
    if (location.hash === '#ranking' && GAS_URL) { if (view !== 'ranking') { returnTo = 'start'; renderRanking(); } }
    else if (view === 'ranking') afterRanking();
  });

  document.getElementById('homeLink').addEventListener('click', function (e) {
    e.preventDefault();
    if (view === 'result') flushSubmit('action');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    rankingPushed = false;
    renderStart();
  });

  start();
})();
