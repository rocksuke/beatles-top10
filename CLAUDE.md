# CLAUDE.md — ビートルズTOP10診断

## 制約（必ず守る）
- 費用ゼロ。サーバー・DB・有料APIは使わない。HTML/CSS/JS だけの静的サイト。ビルドツール・フレームワーク・外部ライブラリは使わない。
- X の API は使わない。共有は Web Intent（`https://x.com/intent/post?text=`）と Web Share API で行う。
- スマホ優先（幅360pxで快適に操作できること）。UIは日本語、曲名は英語の正式表記。
- フッターに「非公式ファンサイトです。The Beatles、Apple Corps とは関係ありません。」を表示する。
- 画像ファイルはリポジトリに置かない（ogp.png は例外。ジャケット写真は使わない）。ジャケットは Apple の画像URLをそのまま表示し、フッターと結果画面に「Artwork via Apple Music」のリンクを表示する。
- `git push` や GitHub の設定変更は、実行する前にユーザーに確認する。
- 匿名集計：送るのは `{v, sid, mode, picks1, top10, top3}` だけ（個人を特定できる情報は送らない）。Google へのログインやデプロイなどユーザーの操作が必要な作業は代行せず、`docs/SETUP_GAS.md` で依頼する。

## 構成
- `logic.js`：診断ロジック。状態は `{mode, seed, answers}` だけで、`run(ids, mode, seed, answers)` が毎回最初から回答を再生し、次の質問か結果を返す（シード付き乱数なので結果は決定的）。戻る＝回答を1つ削る。ブラウザと Node の両方で動く。
- `app.js`：画面、localStorage（読み書きはすべて try/catch）、Canvas の結果画像、保存と共有。
- `data/songs.json`：`albums`（name, order, year, color, artwork, appleMusicUrl）と `songs`（id, title, album, year, track）。211曲。
- `scripts/fetch-artwork.js`：iTunes Search API からジャケット画像URLを取得する（ローカルで実行）。
- `config.js`：`gasUrl`（GAS ウェブアプリのURL）。空なら送信・ランキングを無効にする。
- `gas/Code.gs`：集計のサーバー側（`@OnlyCurrentDoc`）。検証 `validatePayload`・受付 `handlePost`・集計 `summarize` は Google のサービスを使わない純粋な関数で、`tests/gas.test.js`（`node --test tests/gas.test.js`）でテストする。曲IDの一覧 `VALID_IDS` は songs.json と一致させる（テストで確認）。
- `scripts/simulate.js`：質問数のシミュレーション。ロジックを変えたら必ず実行し、全ケースが上限内に収まり、1画面9曲以下・3曲以下であることを確認する。

## 診断の仕様（要約）
- 開始前にユーザー名（必須・20文字まで）を入力する。結果画面・結果画像・投稿文の見出し「○○のビートルズTOP10」に使い、localStorage にだけ保存する。**集計には送らない。**
- 共通ルール：1画面に表示する曲は最大9曲（3×3）、選べる曲は最大3曲。上限は簡易版45画面・詳細版70画面（`MAX_SCREENS`）。
1. ① ふるい分け（共通）：211曲を24グループ（9曲以下）に分け、最大3曲選ぶ。
2. 簡易版：③で候補を1回ずつ表示し、最大3曲選ぶ → 10曲ちょうどでなければ④でもう一周、または「○曲選ぶ／外す」画面（chooseK）で確定 → ⑤はTOP10を5曲×2画面で最大3曲選ぶ（`resolve()`）。
3. 詳細版：② 敗者復活（上限まで選んだ画面の残りから、9曲×最大4画面・各最大2曲） → ③ 各曲2回登場・選ばれるたびに+1点（グループは5〜7曲、候補が70曲超のときだけ8曲） → ④ 10位の同点だけ2択（勝ち+1・同程度+0.5、最大10問。上限が近いと chooseK で確定） → ⑤ トーナメント（1対10…、敗者復活戦1曲、2回戦は6曲で1対6・2対5・3対4）。
- 「ちょうど k 曲選ぶ」（chooseK）は、k≤3 なら選ぶ画面、外す曲が3曲以下なら外す画面、それ以外は3曲＋残りの2画面に分ける。
- 候補が10曲以下なら③④は行わない。TOP10が3曲以下なら⑤は行わない。
- 結果：TOP3と残り7曲を、それぞれアルバムの発売順に並べる。結果画像は Canvas で 1080×1350 の PNG。
- スタート画面の「約○問」は simulate.js のランダム回答の平均値（簡易版36、詳細版60。`app.js` の `ESTIMATE`）。
- ロジックを変えたら `app.js` の `STORAGE_KEY` の番号を上げ、古い途中経過を無効にする。

## 開発
- ローカル確認：`npx serve .` または `python3 -m http.server`（`file://` では動かない）。
- 曲データの方針（統合した別バージョンなど）は README に記載。
