import {
  CAPTURE_INTERVAL_MS,
  DIFF_THRESHOLD_DEFAULT,
  COOLDOWN_MS,
} from "../shared/constants.js";
import type { Message, StartCaptureMessage } from "../shared/types.js";
import { SlideDetector } from "./detector.js";
import { drawFrame, capturePNG } from "./capturer.js";

let isCapturing = false;
let threshold = DIFF_THRESHOLD_DEFAULT;
let lastCaptureTime = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let fallbackFailCount = 0;

const detector = new SlideDetector();

function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  return videos.find((v) => v.duration > 0) ?? null;
}

async function tick() {
  if (!isCapturing) return;

  const video = findVideo();
  if (!video || video.paused) return;

  const pixels = drawFrame(video);
  if (!pixels) {
    // drawFrame 失敗は稀なケース（HLS品質切替の瞬間など）のため
    // 連続10回失敗して初めて tabCapture フォールバックへ切り替える
    fallbackFailCount++;
    if (fallbackFailCount >= 10) {
      fallbackFailCount = 0;
      stop();
      chrome.runtime.sendMessage({
        type: "USE_TAB_CAPTURE",
        threshold,
      } satisfies Message);
    }
    return;
  }

  fallbackFailCount = 0;

  // 参照フレームが未設定（録画開始直後）なら最初のフレームを基準に設定
  if (!detector.hasReference()) {
    detector.updateReference(pixels);
    return;
  }

  const score = detector.compare(pixels);
  const now = Date.now();

  if (score >= threshold && now - lastCaptureTime > COOLDOWN_MS) {
    lastCaptureTime = now;
    // キャプチャ成功時に参照フレームを更新（次の比較基準をリセット）
    detector.updateReference(pixels);
    const pngData = await capturePNG(video);
    if (pngData) {
      chrome.runtime.sendMessage({
        type: "FRAME_CAPTURED",
        pngData,
      } satisfies Message);
    }
  }
}

function start(msg: StartCaptureMessage) {
  if (isCapturing) return;
  threshold = msg.threshold;
  isCapturing = true;
  fallbackFailCount = 0;
  detector.reset();
  lastCaptureTime = 0;
  intervalId = setInterval(tick, CAPTURE_INTERVAL_MS);
}

function stop() {
  isCapturing = false;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  detector.reset();
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "START_CAPTURE") start(msg as StartCaptureMessage);
  else if (msg.type === "STOP_CAPTURE") stop();
});
