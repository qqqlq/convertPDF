import { CAPTURE_MAX_WIDTH } from "../shared/constants.js";

// --- フル解像度キャプチャ（保存用）---

let captureCanvas: OffscreenCanvas | null = null;
let captureCtx: OffscreenCanvasRenderingContext2D | null = null;

export async function capturePNG(video: HTMLVideoElement): Promise<number[] | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const rawW = video.videoWidth;
  const rawH = video.videoHeight;
  const scale = rawW > CAPTURE_MAX_WIDTH ? CAPTURE_MAX_WIDTH / rawW : 1;
  const w = Math.round(rawW * scale);
  const h = Math.round(rawH * scale);

  if (!captureCanvas || captureCanvas.width !== w || captureCanvas.height !== h) {
    captureCanvas = new OffscreenCanvas(w, h);
    captureCtx = captureCanvas.getContext("2d", { willReadFrequently: false })!;
  }

  try {
    captureCtx!.drawImage(video, 0, 0, w, h);
    const blob = await captureCanvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  }
}

// --- 縮小サンプリング（差分検知用）---

const SAMPLE_W = 320;
const SAMPLE_H = 180;
const sampleCanvas = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;

export function samplePixels(video: HTMLVideoElement): Uint8ClampedArray | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  try {
    sampleCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    return sampleCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
  } catch {
    return null;
  }
}
