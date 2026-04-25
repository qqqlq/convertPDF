# アーキテクチャ仕様書

## 構成部品とデータフロー

```
[SharePoint動画ページ]
  content script
    - <video> 要素を検出
    - 250ms ごとにバイナリカウント差分チェック
    - N秒ごとに定期キャプチャ
    - 手動キャプチャ（ボタン押下時）
         ↓ FRAME_CAPTURED (pngData: number[])
[service worker]
    - フレーム枚数カウント（メタデータのみ保持）
    - chrome.alarms で 20 秒ごとに keepalive
    - chrome.storage.session にメタデータを永続化
         ↓ SAVE_FRAME (pngData)
[offscreen document]
    - IndexedDB ("slidepdf" DB) にフレームを保存
         ↑ GENERATE_PDF_FROM_DB
[offscreen document]
    - IndexedDB から全フレームを読み込み
    - 各フレームの dHash + サムネイルを計算
    - dedupFrames() で重複削除
    - pdf-lib で PDF 生成
    - URL.createObjectURL() → PDF_READY
         ↓ chrome.downloads.download
[ローカルファイル: slides.pdf]
```

## キャプチャトリガー詳細

### バイナリカウント差分検知

- サンプリング間隔: 250ms
- 比較対象: 直前のキャプチャフレーム（参照フレーム）
- キャンバスサイズ: 320×180（軽量化のため縮小）
- 判定式: `変化ピクセル数 / 全ピクセル数 >= 0.015`
  - 変化ピクセル = max(|ΔR|, |ΔG|, |ΔB|) > 30 のピクセル
- クールダウン: 2000ms（同一アニメーションで複数回発火しない）
- 用途: アニメーションスライドの各ステップを捉える

### 定期キャプチャ

- 間隔: 既定 10 秒（popup スライダーで 5〜120 秒に変更可能）
- 無条件で発火
- 用途: 板書など緩やかな変化のコンテンツの保険

### 手動キャプチャ

- popup の「今すぐキャプチャ」ボタン押下時
- 録画中のみ有効

## 重複削除アルゴリズム（PDF生成時）

### 1. dHash（差分ハッシュ）

```
PNG → 9×8 にリサイズ → 輝度変換 → 横方向隣接ピクセル比較 → 64bit ハッシュ
```

2フレーム間のハミング距離 ≤ 8 → 同クラスタ（視覚的にほぼ同じ）

### 2. スーパーセット判定（`isSupersetOf`）

「新しいフレームが古いフレームに追記しただけのもの」かを判定する。

```
1. reference（古いフレーム）の全ピクセル輝度を計算
2. 輝度の中央値を「背景色」として推定
   例: 緑の黒板 → 中央値 ≈ 88
3. 背景輝度から SUPERSET_CONTENT_DEVIATION(40) 以上外れたピクセルをコンテンツとして抽出
   例: 白チョーク(輝度200) → |200-88|=112 > 40 → コンテンツ
       緑背景(輝度88)      → |88-88|=0 < 40  → 背景（除外）
4. そのコンテンツピクセルが candidate（新しいフレーム）でも保持されているか確認
5. 保持率 >= SUPERSET_RETAIN_RATIO(0.90) → 上位集合（同クラスタ）
```

背景色を中央値で動的に推定するため、緑黒板・白板・スライドツールなど
背景色の種類を問わず機能する。

### 3. クラスタリングと最終フレーム選択

```typescript
// dedupFrames のロジック
for (各フレーム) {
  if (dHash距離 <= threshold || isSupersetOf(frame, clusterLast)) {
    clusterLast = frame;  // 同クラスタ。より新しい（コンテンツが多い）方に更新
  } else {
    kept.push(clusterLast);  // クラスタ確定。最後のフレームを採用
    clusterLast = frame;     // 新クラスタ開始
  }
}
kept.push(clusterLast);
```

各クラスタの「最後のフレーム」= 最もコンテンツが多い状態のフレームを保持。

## サービスワーカー生存管理

MV3 のサービスワーカーは無操作 30 秒で強制終了される。対策：

1. **alarms keepalive**: 20 秒ごとにアラームを発火してSWを起こし続ける（録画中のみ）
2. **chrome.storage.session**: メタデータ（isCapturing, frameCount 等）を保存。SW再起動後に復元。
3. **IndexedDB**: フレームデータはSW外（offscreen管理）に保存するため、SW終了の影響なし。

## ファイル構成

```
src/
├── manifest.json              # MV3 宣言（権限・対象URL）
├── shared/
│   ├── constants.ts           # 各種パラメータ定数
│   └── types.ts               # メッセージ型定義
├── content/
│   ├── content.ts             # 差分検知 + 定期キャプチャ + 手動キャプチャ
│   └── capturer.ts            # Canvas描画・PNG生成・サンプリング
├── background/
│   └── service-worker.ts      # メッセージルーティング・状態管理
├── offscreen/
│   ├── offscreen.html
│   ├── offscreen.ts           # IndexedDB管理・tabCapture・PDF生成
│   └── dhash.ts               # dHash・ハミング距離・スーパーセット判定・dedup
└── popup/
    ├── popup.html
    ├── popup.ts
    └── popup.css

tools/
└── analyze-diff.html          # 画像差分分析ツール（ブラウザで開いて使う）

docs/
├── architecture.md            # 本ファイル（技術仕様）
└── overview.md                # ユーザー向け解説・開発経緯
```

## 主要パラメータ一覧

| 定数 | 値 | 説明 |
|---|---|---|
| `CAPTURE_INTERVAL_DEFAULT_MS` | 10,000 | 定期キャプチャの既定間隔（ms） |
| `DIFF_TICK_MS` | 250 | 差分チェックの間隔（ms） |
| `BINARY_PIXEL_THRESHOLD` | 30 | 「変化した」とみなすチャネル差の閾値 |
| `BINARY_CHANGE_THRESHOLD` | 0.015 | 差分検知の発火閾値（変化ピクセル率） |
| `DIFF_COOLDOWN_MS` | 2,000 | 差分検知のクールダウン（ms） |
| `HAMMING_THRESHOLD_DEFAULT` | 8 | dHash の重複判定距離 |
| `SUPERSET_MIN_CONTENT_RATIO` | 0.005 | referenceのコンテンツが0.5%未満なら判定しない（遷移フレーム除外） |
| `SUPERSET_RETAIN_RATIO` | 0.90 | コンテンツ保持率がこれ以上なら上位集合と判定 |
| `SUPERSET_CONTENT_DEVIATION` | 40 | 背景輝度からの偏差がこれ以上のピクセルをコンテンツとみなす |
| `THUMB_W / THUMB_H` | 128 / 72 | スーパーセット判定用サムネイルサイズ |
