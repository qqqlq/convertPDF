import { DHASH_SIZE } from "../shared/constants.js";

const GRID_W = DHASH_SIZE + 1; // 9
const GRID_H = DHASH_SIZE;     // 8

/** PNG バイト列から 8 バイト(64bit) の dHash を計算する */
export async function computeDHash(pngBytes: Uint8Array): Promise<Uint8Array> {
  const blob = new Blob([pngBytes], { type: "image/png" });
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: GRID_W,
    resizeHeight: GRID_H,
    resizeQuality: "pixelated",
  });

  const canvas = new OffscreenCanvas(GRID_W, GRID_H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, GRID_W, GRID_H);
  const hash = new Uint8Array(DHASH_SIZE); // 8 bytes = 64 bits

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

  return hash;
}

/** 2つのハッシュ間のハミング距離（立っているビットの差異数）を返す */
export function hamming(a: Uint8Array, b: Uint8Array): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let v = a[i] ^ b[i];
    // popcount
    v = v - ((v >> 1) & 0x55);
    v = (v & 0x33) + ((v >> 2) & 0x33);
    v = (v + (v >> 4)) & 0x0f;
    dist += v;
  }
  return dist;
}

export interface HashedFrame {
  pngBytes: Uint8Array;
  hash: Uint8Array;
}

/**
 * 時系列順のフレームをクラスタリングして重複を削除する。
 * 直前フレームとのハミング距離が threshold 以下なら同一クラスタと判定し、
 * 各クラスタの最後のフレーム（最も書き込まれた状態）だけを残す。
 */
export function dedupFrames(frames: HashedFrame[], threshold: number): HashedFrame[] {
  if (frames.length === 0) return [];

  const kept: HashedFrame[] = [];
  let clusterLast = frames[0];

  for (let i = 1; i < frames.length; i++) {
    if (hamming(frames[i].hash, clusterLast.hash) <= threshold) {
      clusterLast = frames[i];
    } else {
      kept.push(clusterLast);
      clusterLast = frames[i];
    }
  }
  kept.push(clusterLast);
  return kept;
}
