import {
  CAPTURE_INTERVAL_DEFAULT_MS,
  FALLBACK_FAIL_THRESHOLD,
  DIFF_TICK_MS,
  BINARY_PIXEL_THRESHOLD,
  BINARY_CHANGE_THRESHOLD,
  DIFF_COOLDOWN_MS,
} from "../shared/constants.js";
import type { Message, StartCaptureMessage } from "../shared/types.js";
import { capturePNG, samplePixels } from "./capturer.js";

let isCapturing = false;
let intervalMs = CAPTURE_INTERVAL_DEFAULT_MS;
let periodicId: ReturnType<typeof setInterval> | null = null;
let diffId: ReturnType<typeof setInterval> | null = null;
let fallbackFailCount = 0;

// 差分検知用の参照フレーム（最後にキャプチャした時点のピクセル）
let refPixels: Uint8ClampedArray | null = null;
let lastCaptureTime = 0;

function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  return videos.find((v) => v.duration > 0) ?? null;
}

/** バイナリカウント: 変化が大きいピクセルの割合を返す */
function binaryCount(current: Uint8ClampedArray, ref: Uint8ClampedArray): number {
  const total = current.length / 4;
  let changed = 0;
  for (let i = 0; i < current.length; i += 4) {
    const dr = Math.abs(current[i]     - ref[i]);
    const dg = Math.abs(current[i + 1] - ref[i + 1]);
    const db = Math.abs(current[i + 2] - ref[i + 2]);
    if (Math.max(dr, dg, db) > BINARY_PIXEL_THRESHOLD) changed++;
  }
  return changed / total;
}

/** フレームをキャプチャして service worker に送る（定期・差分・手動で共通使用）*/
async function doCapture(video: HTMLVideoElement): Promise<boolean> {
  const pngData = await capturePNG(video);
  if (!pngData) {
    fallbackFailCount++;
    if (fallbackFailCount >= FALLBACK_FAIL_THRESHOLD) {
      fallbackFailCount = 0;
      stop();
      chrome.runtime.sendMessage({ type: "USE_TAB_CAPTURE", intervalMs } satisfies Message);
    }
    return false;
  }

  fallbackFailCount = 0;
  lastCaptureTime = Date.now();

  // 参照フレームを更新（次回の差分検知の基準になる）
  const pixels = samplePixels(video);
  if (pixels) refPixels = pixels;

  chrome.runtime.sendMessage({ type: "FRAME_CAPTURED", pngData } satisfies Message);
  return true;
}

/** 差分検知ティック（250ms ごと） */
async function diffTick() {
  if (!isCapturing) return;
  const video = findVideo();
  if (!video || video.paused || video.readyState < 2) return;

  const pixels = samplePixels(video);
  if (!pixels) return;

  // 最初のフレームを参照として設定
  if (!refPixels) {
    refPixels = new Uint8ClampedArray(pixels);
    return;
  }

  const changeRatio = binaryCount(pixels, refPixels);
  const now = Date.now();

  if (changeRatio >= BINARY_CHANGE_THRESHOLD && now - lastCaptureTime > DIFF_COOLDOWN_MS) {
    await doCapture(video);
  }
}

/** 定期キャプチャティック（N 秒ごと） */
async function periodicTick() {
  if (!isCapturing) return;
  const video = findVideo();
  if (!video || video.paused || video.readyState < 2) return;
  await doCapture(video);
}

function start(msg: StartCaptureMessage) {
  if (isCapturing) return;
  intervalMs = msg.intervalMs;
  isCapturing = true;
  fallbackFailCount = 0;
  refPixels = null;
  lastCaptureTime = 0;

  // 開始直後に 1 枚押さえる
  const video = findVideo();
  if (video) doCapture(video);

  // 差分検知タイマー（250ms）
  diffId = setInterval(diffTick, DIFF_TICK_MS);
  // 定期キャプチャタイマー（N 秒）
  periodicId = setInterval(periodicTick, intervalMs);
}

function stop() {
  isCapturing = false;
  if (diffId !== null)     { clearInterval(diffId);     diffId     = null; }
  if (periodicId !== null) { clearInterval(periodicId); periodicId = null; }
  refPixels = null;
}

async function manualCapture() {
  const video = findVideo();
  if (!video || video.readyState < 2) return;
  await doCapture(video);
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "START_CAPTURE")   start(msg as StartCaptureMessage);
  else if (msg.type === "STOP_CAPTURE")    stop();
  else if (msg.type === "MANUAL_CAPTURE")  manualCapture();
});
