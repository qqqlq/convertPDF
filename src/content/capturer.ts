import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../shared/constants.js";

const canvas = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

export function drawFrame(video: HTMLVideoElement): Uint8ClampedArray | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  try {
    ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    return ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
  } catch {
    return null;
  }
}

export async function capturePNG(video: HTMLVideoElement): Promise<number[] | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  try {
    ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    return Array.from(new Uint8Array(buf));
  } catch {
    return null;
  }
}
