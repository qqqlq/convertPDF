import { CAPTURE_MAX_WIDTH } from "../shared/constants.js";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

export async function capturePNG(video: HTMLVideoElement): Promise<number[] | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const rawW = video.videoWidth;
  const rawH = video.videoHeight;
  const scale = rawW > CAPTURE_MAX_WIDTH ? CAPTURE_MAX_WIDTH / rawW : 1;
  const w = Math.round(rawW * scale);
  const h = Math.round(rawH * scale);

  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  }

  try {
    ctx!.drawImage(video, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  }
}
