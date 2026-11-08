#!/usr/bin/env node
// iTunes Search API（無料・キー不要）から各アルバムのジャケット画像URLと
// Apple Music のリンクを取得し、data/songs.json の albums に書き込む。
// ローカルで1回だけ実行する: node scripts/fetch-artwork.js
// 公開後のサイトからは API を呼ばない。
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'songs.json');
const ARTIST_ID = 136975; // The Beatles
const COUNTRY = 'jp';
const SIZE = '600x600bb';

// iTunes 上の表記ゆれ用の別名。アルバム名そのものは完全一致、
// 別名は正規化後に前方一致で比較する（例: "Past Masters, Vols. 1 & 2"）
const ALIASES = {
  'The Beatles': ['the beatles the white album', 'the beatles white album'],
  'Past Masters': ['past masters'],
};
// 優先度を下げる版（デラックス盤など）
const AVOID = /(deluxe|anniversary|super|edition|remix|boxset|mono|naked|live|anthology|songtrack)/i;

const norm = (s) => s.toLowerCase().replace(/\(remastered\)|\[remastered\]|remastered/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function pick(album, results) {
  const want = [norm(album.name), ...(ALIASES[album.name] || [])];
  const cands = results.filter((r) => r.wrapperType === 'collection' && r.collectionName)
    .filter((r) => {
      const n = norm(r.collectionName);
      return n === want[0] || want.slice(1).some((w) => n.startsWith(w));
    });
  cands.sort((a, b) => (AVOID.test(a.collectionName) - AVOID.test(b.collectionName))
    || a.collectionName.length - b.collectionName.length);
  return cands[0];
}

(async () => {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const lookup = await getJSON(`https://itunes.apple.com/lookup?id=${ARTIST_ID}&entity=album&limit=200&country=${COUNTRY}`);
  for (const album of data.albums) {
    let hit = pick(album, lookup.results);
    if (!hit) { // フォールバック: キーワード検索
      const q = encodeURIComponent(`the beatles ${album.name}`);
      const s = await getJSON(`https://itunes.apple.com/search?term=${q}&entity=album&limit=25&country=${COUNTRY}`);
      hit = pick(album, s.results.filter((r) => r.artistId === ARTIST_ID));
    }
    if (!hit) { console.warn(`× 見つかりません: ${album.name}`); continue; }
    album.artwork = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, `/${SIZE}.`);
    album.appleMusicUrl = hit.collectionViewUrl.split('?')[0];
    console.log(`✓ ${album.name}  ←  ${hit.collectionName}`);
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  const missing = data.albums.filter((a) => !a.artwork).length;
  console.log(missing ? `${missing} 枚が未取得です` : '全アルバム取得しました');
})().catch((e) => { console.error(e); process.exit(1); });
