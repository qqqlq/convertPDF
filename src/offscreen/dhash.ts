import {
  DHASH_SIZE,
  THUMB_W,
  THUMB_H,
  SUPERSET_MIN_CONTENT_RATIO,
  SUPERSET_RETAIN_RATIO,
  SUPERSET_CONTENT_LUM_DARK,
  SUPERSET_CONTENT_LUM_LIGHT,
} from "../shared/constants.js";

const GRID_W = DHASH_SIZE + 1; // 9
const GRID_H = DHASH_SIZE;     // 8

export interface HashedFrame {
  pngBytes: Uint8Array;
  hash: Uint8Array;
  /** スーパーセット判定用のサムネイルピクセル (THUMB_W × THUMB_H) */
  thumbPixels: Uint8ClampedArray;
}

/**
 * PNG バイト列から dHash（64bit）とサムネイルピクセルを同時に取得する。
 * サムネイルを一度だけデコードし、それを 9×8 に縮小して dHash を計算することで
 * フル解像度デコードを 1 回に抑えている。
 */
export async function computeDHash(pngBytes: Uint8Array): Promise<{ hash: Uint8Array; thumbPixels: Uint8ClampedArray }> {
  const blob = new Blob([pngBytes], { type: "image/png" });

  // 1. サムネイルサイズでデコード（スーパーセット判定用）
  const thumbBitmap = await createImageBitmap(blob, {
    resizeWidth: THUMB_W,
    resizeHeight: THUMB_H,
    resizeQuality: "pixelated",
  });
  const thumbCanvas = new OffscreenCanvas(THUMB_W, THUMB_H);
  const thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true })!;
  thumbCtx.drawImage(thumbBitmap, 0, 0);
  thumbBitmap.close();
  const thumbPixels = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data;

  // 2. サムネイルをさらに 9×8 に縮小して dHash を計算
  const hashCanvas = new OffscreenCanvas(GRID_W, GRID_H);
  const hashCtx = hashCanvas.getContext("2d", { willReadFrequently: true })!;
  hashCtx.drawImage(thumbCanvas, 0, 0, GRID_W, GRID_H);
  const { data } = hashCtx.getImageData(0, 0, GRID_W, GRID_H);

  const hash = new Uint8Array(DHASH_SIZE);
  for (let row = 0; row < GRID_H; row++) {
    let byte = 0;
    for (let col = 0; col < DHASH_SIZE; col++) {
      const i = (row * GRID_W + col) * 4;
      const j = (row * GRID_W + col + 1) * 4;
      const lumL = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const lumR = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      byte = (byte << 1) | (lumL > lumR ? 1 : 0);
    }
    hash[row] = byte;
  }

  return { hash, thumbPixels: new Uint8ClampedArray(thumbPixels) };
}

/** 2 つのハッシュ間のハミング距離 */
export function hamming(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let v = a[i] ^ b[i];
    v = v - ((v >> 1) & 0x55);
    v = (v & 0x33) + ((v >> 2) & 0x33);
    v = (v + (v >> 4)) & 0x0f;
    dist += v;
  }
  return dist;
}

/**
 * candidate が reference の「上位集合」かどうかを判定する。
 *
 * 「candidate = reference にコンテンツが追加されたもの」のとき true を返す。
 * 判定基準：reference のコンテンツピクセルが candidate でも 90% 以上保持されていること。
 *
 * - 暗背景（黒板）: 明るいピクセル（チョーク）をコンテンツと見なす
 * - 明背景（白板）: 暗いピクセル（テキスト）をコンテンツと見なす
 *
 * 変化量の上限を設けないため、ページ下半分まるごと追記されても誤弾きしない。
 */
export function isSupersetOf(candidate: HashedFrame, reference: HashedFrame): boolean {
  const pA = reference.thumbPixels;
  const pB = candidate.thumbPixels;
  const total = THUMB_W * THUMB_H;

  // reference の平均輝度で背景色を判定
  let totalLum = 0;
  for (let i = 0; i < total * 4; i += 4) {
    totalLum += 0.299 * pA[i] + 0.587 * pA[i + 1] + 0.114 * pA[i + 2];
  }
  const isDarkBackground = totalLum / total < 128;
  const contentThreshold = isDarkBackground ? SUPERSET_CONTENT_LUM_DARK : SUPERSET_CONTENT_LUM_LIGHT;

  // reference のコンテンツピクセル数と、candidate でも保持されている数を数える
  let refContentCount = 0;
  let retainedCount = 0;
  for (let i = 0; i < total * 4; i += 4) {
    const lumA = 0.299 * pA[i] + 0.587 * pA[i + 1] + 0.114 * pA[i + 2];
    const isContent = isDarkBackground ? lumA > contentThreshold : lumA < contentThreshold;
    if (!isContent) continue;

    refContentCount++;
    const lumB = 0.299 * pB[i] + 0.587 * pB[i + 1] + 0.114 * pB[i + 2];
    const isRetained = isDarkBackground ? lumB > contentThreshold : lumB < contentThreshold;
    if (isRetained) retainedCount++;
  }

  // reference にコンテンツがほぼない（空白スライド）は判定しない
  if (refContentCount < total * SUPERSET_MIN_CONTENT_RATIO) return false;

  return retainedCount / refContentCount >= SUPERSET_RETAIN_RATIO;
}

/**
 * 時系列フレーム列の重複を削除する。
 * 各クラスタの最後のフレーム（最も多くのコンテンツが表示された状態）を残す。
 *
 * クラスタ境界の判定:
 *  1. dHash のハミング距離が threshold 以下 → 同クラスタ（ほぼ同じ画像）
 *  2. candidate が直前フレームの上位集合    → 同クラスタ（コンテンツが追加されただけ）
 *  それ以外                                → 新クラスタ（別スライド or 別黒板）
 */
export function dedupFrames(frames: HashedFrame[], threshold: number): HashedFrame[] {
  if (frames.length === 0) return [];

  const kept: HashedFrame[] = [];
  let clusterLast = frames[0];

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    if (
      hamming(frame.hash, clusterLast.hash) <= threshold ||
      isSupersetOf(frame, clusterLast)
    ) {
      clusterLast = frame;
    } else {
      kept.push(clusterLast);
      clusterLast = frame;
    }
  }
  kept.push(clusterLast);
  return kept;
}
