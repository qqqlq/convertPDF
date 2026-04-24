import {
  CAPTURE_INTERVAL_DEFAULT_MS,
  FALLBACK_FAIL_THRESHOLD,
} from "../shared/constants.js";
import type { Message, StartCaptureMessage } from "../shared/types.js";
import { capturePNG } from "./capturer.js";

let isCapturing = false;
let intervalMs = CAPTURE_INTERVAL_DEFAULT_MS;
let intervalId: ReturnType<typeof setInterval> | null = null;
let fallbackFailCount = 0;

function findVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"));
  return videos.find((v) => v.duration > 0) ?? null;
}

async function tick() {
  if (!isCapturing) return;

  const video = findVideo();
  if (!video || video.paused || video.readyState < 2) return;

  const pngData = await capturePNG(video);
  if (!pngData) {
    fallbackFailCount++;
    if (fallbackFailCount >= FALLBACK_FAIL_THRESHOLD) {
      fallbackFailCount = 0;
      stop();
      chrome.runtime.sendMessage({
        type: "USE_TAB_CAPTURE",
        intervalMs,
      } satisfies Message);
    }
    return;
  }

  fallbackFailCount = 0;
  chrome.runtime.sendMessage({
    type: "FRAME_CAPTURED",
    pngData,
  } satisfies Message);
}

function start(msg: StartCaptureMessage) {
  if (isCapturing) return;
  intervalMs = msg.intervalMs;
  isCapturing = true;
  fallbackFailCount = 0;
  // 開始直後に1枚押さえてから間隔タイマーを開始
  tick();
  intervalId = setInterval(tick, intervalMs);
}

function stop() {
  isCapturing = false;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "START_CAPTURE") start(msg as StartCaptureMessage);
  else if (msg.type === "STOP_CAPTURE") stop();
});
