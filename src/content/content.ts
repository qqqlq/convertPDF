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
let fallbackNotified = false;

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
    // Canvas への描画が SecurityError で失敗 → service worker に tabCapture を依頼
    if (!fallbackNotified) {
      fallbackNotified = true;
      chrome.runtime.sendMessage({
        type: "USE_TAB_CAPTURE",
        threshold,
      } satisfies Message);
      // tabCapture に切り替えたら content script 側のループは不要
      stop();
    }
    return;
  }

  const score = detector.compare(pixels);
  const now = Date.now();

  if (score >= threshold && now - lastCaptureTime > COOLDOWN_MS) {
    lastCaptureTime = now;
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
  fallbackNotified = false;
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
