# ビートルズTOP10診断

ビートルズの公式曲（211曲）から、好きな曲の「上位10曲」と、その中の「TOP3」を診断する静的Webサイトです（順位は付けません）。
HTML / CSS / JavaScript だけで動き、ビルド不要で GitHub Pages にそのまま置けます。サーバー・データベース・有料APIは使いません。

非公式ファンサイトです。The Beatles、Apple Corps とは関係ありません。

## ファイル構成

```
index.html            画面の骨組み・OGP
config.js             設定（匿名集計に使う GAS のURL）
style.css             スタイル（スマホ優先・幅360pxで確認）
logic.js              診断ロジック（ブラウザと Node.js の両方で動く）
app.js                画面描画・保存・結果画像・共有
data/songs.json       曲とアルバムのデータ
ogp.png               OGP画像（1200×630、ジャケット写真は不使用）
scripts/fetch-artwork.js  ジャケット画像URLの取得（ローカルで1回だけ実行）
scripts/simulate.js       質問数のシミュレーション
scripts/ogp.html          OGP画像の元データ
gas/Code.gs           匿名集計のサーバー側（Google Apps Script）
docs/SETUP_GAS.md     匿名集計のセットアップ手順
tests/gas.test.js     gas/Code.gs の検証・集計ロジックのテスト
```

## 曲データの方針

対象は公式のコア・カタログです。UKオリジナルアルバム13枚、Magical Mystery Tour（US版LP）、Past Masters に収録の全曲で、**211曲**です（重複チェック済み）。

| アルバム | 曲数 |
|---|---|
| Please Please Me | 14 |
| With the Beatles | 14 |
| A Hard Day's Night | 13 |
| Beatles for Sale | 14 |
| Help! | 14 |
| Rubber Soul | 14 |
| Revolver | 14 |
| Sgt. Pepper's Lonely Hearts Club Band | 13 |
| Magical Mystery Tour | 11 |
| The Beatles | 30 |
| Yellow Submarine | 4（再収録の2曲とオーケストラ曲を除く） |
| Abbey Road | 17 |
| Let It Be | 12 |
| Past Masters | 27（重複する6曲を除く） |

**別バージョンの扱い**
- **1曲に統合したもの**（同じ曲のミックス違い・再収録・言語違いは別の曲として数えない）。最初に収録されたアルバムの曲として扱います。
  - Love Me Do（シングル版）、Get Back（シングル版）、Let It Be（シングル版）、Across the Universe（Wildlife版）。いずれも Past Masters から除き、アルバム収録曲に統合しました。
  - Yellow Submarine と All You Need Is Love。Yellow Submarine のアルバムから除き、Revolver と Magical Mystery Tour の収録曲に統合しました。
  - Komm, gib mir deine Hand と Sie liebt dich。ドイツ語版なので、I Want to Hold Your Hand と She Loves You に統合しました。
- **別の曲として残したもの**（アレンジや歌詞が大きく異なり、別の曲として認識されているもの）
  - Revolution（シングル）、Revolution 1、Revolution 9
  - Sgt. Pepper's Lonely Hearts Club Band とその (Reprise)
- カバー曲は含めます。George Martin によるオーケストラ曲（Yellow Submarine のB面）は、ビートルズの演奏ではないので含めません。

データ形式は次のとおりです。アルバムは `albums` 配列にまとめ、曲からは `album`（アルバム名）で参照します。
```json
{ "id": "s001", "title": "I Saw Her Standing There", "album": "Please Please Me", "year": 1963, "track": 1 }
```
`track` はアルバム内の曲順で、結果画面の並び替えに使います。Past Masters の曲の `year` は、シングルなどで最初に発表された年です。

## ジャケット画像

画像ファイルはリポジトリに置かず、Apple の画像URLをそのまま表示します。URLは iTunes Search API（無料・キー不要）から取得します。

```sh
node scripts/fetch-artwork.js   # data/songs.json の albums[].artwork / appleMusicUrl を更新
```

サイトの公開後に API を呼ぶことはありません。画像を読み込めない場合は、アルバムごとの色付きプレースホルダーを表示します。

## 診断の流れと質問数

両モード共通のルール：**1画面に表示する曲は最大9曲（3×3）、選べる曲は最大3曲**。上限は簡易版45画面、詳細版70画面です。

| 段階 | 簡易版（約36問） | 詳細版（約60問） |
|---|---|---|
| ① ふるい分け | 9曲から最大3曲・24画面（全211曲を1回ずつ） | 同左 |
| ② 敗者復活 | なし | 上限まで選んだ画面の残りから、9曲×最大4画面（各最大2曲） |
| ③ 絞り込み | 候補を1回ずつ表示し、TOP10に入れたい曲を最大3曲 | 候補を2回ずつ表示（最大20画面）し、選ばれるたびに+1点 |
| ④ 境目の決定 | ③で10曲ちょうどにならないときだけ。残りの曲でもう一周するか、「○曲選ぶ／外す」画面で確定 | 10位が同点のときだけ。2択（同程度あり）で最大10問、上限が近いときは「○曲選ぶ／外す」画面で確定 |
| ⑤ TOP3決定 | TOP10を5曲×2画面で表示し、最大3曲（必要なら追加の画面で確定） | トーナメント9画面（1回戦5、敗者復活戦1、2回戦3） |

補足
- ①は211曲を24グループに均等に分けています（9曲×19画面、8曲×5画面）。
- 「ちょうど○曲選ぶ」必要があるとき、○が4曲以上なら「外す曲を選ぶ」画面にするか、2画面に分けるので、1画面で選ぶのは常に3曲以下です。
- 詳細版③で候補が70曲を超えると、7曲ずつでは20画面に収まりません。このときだけ一部のグループを8曲にします。

`node scripts/simulate.js` で、各ケースを1000回ずつシミュレーションした結果（画面数）です。

| | ランダムに回答 | 常に上限まで選ぶ（最悪のケース） |
|---|---|---|
| 簡易版 | 平均35.9・最大40 | 平均41.0・最大41 |
| 詳細版 | 平均59.1・最大67 | 平均61.7・最大68 |

スタート画面の表記は、ランダム回答の平均値に合わせて「簡易版 約36問」「詳細版 約60問」としています（`app.js` の `ESTIMATE` で変更できます）。シミュレーションでは、1画面9曲以下・3曲以下であることもあわせて確認しています。

ロジックの状態は「モード・乱数シード・回答の配列」だけです。`logic.js` の `run()` は毎回最初から回答を再生して次の質問を返すので、「戻る」は回答を1つ削るだけで、途中経過は localStorage に保存されます。

## ローカルで動かす

```sh
npx serve .          # または: python3 -m http.server 8000
```

`file://` で開くと `data/songs.json` を読み込めないため、ローカルサーバーを使ってください。

## 結果画像と共有

- Canvas で 1080×1350 の PNG を生成します。ジャケット画像は `crossOrigin = "anonymous"` で読み込みます（Apple の画像サーバーは `Access-Control-Allow-Origin: *` を返すため、Chrome では描画と書き出しの両方を確認済み）。
- 画像を読み込めない場合や Canvas が汚染された場合は、プレースホルダーで描き直し、「Artwork via Apple Music」の表記を省きます。どちらになったかは `[beatles-top10]` の接頭辞でコンソールに出力します。
- 「Xで共有」は、`navigator.canShare({ files })` が使える環境では Web Share API で画像と投稿文を共有します。使えない環境では、画像を保存してから Web Intent（`https://x.com/intent/post`）で投稿画面を開きます。X の API は使いません。
- 投稿文が 280（日本語は1文字を2、URLは23として数える）を超える場合は、7曲の部分を「ほか7曲」とだけ書きます。

## OGP画像を作り直す

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 --screenshot="$PWD/ogp.png" "file://$PWD/scripts/ogp.html"
```

## 匿名集計と「みんなのランキング」

診断結果を匿名で Google スプレッドシートに保存し、曲ごとの「TOP10入り率」「TOP3入り率」「①の選ばれ率」を表示します。
サーバーには Google Apps Script（GAS）のウェブアプリを使います（無料）。セットアップ手順は [docs/SETUP_GAS.md](docs/SETUP_GAS.md) を参照してください。

- **送るデータはこれだけ**：`{ v: 1, sid（診断ごとのランダムなUUID）, mode, picks1（①で選んだ曲ID）, top10, top3 }`。名前・IP・ユーザーエージェントは送りません。
- 結果画面の「集計に参加する（匿名）」がオン（初期値）のとき、共有・保存・もう一度診断・ランキングのボタンを押したとき、ページを閉じたとき、または結果画面を開いて15秒たったときに **1回だけ** 送ります。送信済みの sid は localStorage に記録します。
- 送信は `fetch` の POST（`Content-Type: text/plain`、`no-cors`）で、応答は読みません。失敗しても画面には影響しません。
- `config.js` の `gasUrl` が空のときは、送信・ランキング・フッターの集計の案内をすべて無効にします。
- ランキングは、モードごとに回答が30件以上になるまで「集計中」と表示します。曲名とジャケットは自分の `songs.json` から曲IDで引き、サーバーから受け取った値はHTMLとして挿入しません。
- TOP10 が3曲未満で終わった診断は、サーバー側の条件（`top3` はちょうど3件）を満たさないため送りません。
- サーバー側の `picks1` の上限は **72件**（①が24画面×最大3曲のため）です。

テスト（Node.js が必要）：

```sh
node --test tests/gas.test.js   # 正常なデータと不正なデータ（範囲外のID・重複・件数超過・「=」で始まる文字列・巨大な本文・不正な mode など）
```

## GitHub Pages で公開する

公開URL：**https://rocksuke.github.io/beatles-top10/**（リポジトリ：https://github.com/rocksuke/beatles-top10 、public）

無料プランで GitHub Pages を使うには、リポジトリを **public** にする必要があります。設定は次のとおりです。

- **Settings → Pages** で、Source を「Deploy from a branch」、Branch を `main`、フォルダを `/ (root)` にする。
- `main` に push すると、数分で公開中のサイトに反映されます。
- `.nojekyll` を置いているので、Jekyll の処理は行われません。
- OGP（`index.html` の `og:url`・`og:image`・`twitter:image`）は公開URLの絶対パスで書いています。リポジトリ名やユーザー名を変えたら書き換えてください。
