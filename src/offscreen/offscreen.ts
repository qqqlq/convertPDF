import { PDFDocument } from "pdf-lib";
import type { Message, UseTabCaptureMessage, OffscreenReadyMessage } from "../shared/types.js";
import {
  CAPTURE_INTERVAL_MS,
  DIFF_THRESHOLD_DEFAULT,
  COOLDOWN_MS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SAMPLE_STEP,
  CENTER_CROP_RATIO,
} from "../shared/constants.js";

// --- tabCapture fallback ---

let tabCaptureStream: MediaStream | null = null;
let tabCaptureInterval: ReturnType<typeof setInterval> | null = null;
let tabCaptureThreshold = DIFF_THRESHOLD_DEFAULT;
let tabCapturePrevData: Uint8ClampedArray | null = null;
let tabCaptureLastCapture = 0;

function tabCaptureDiff(curr: Uint8ClampedArray): number {
  if (!tabCapturePrevData) {
    tabCapturePrevData = curr.slice();
    return 0;
  }
  const marginX = Math.floor((CANVAS_WIDTH * (1 - CENTER_CROP_RATIO)) / 2);
  const marginY = Math.floor((CANVAS_HEIGHT * (1 - CENTER_CROP_RATIO)) / 2);
  let diff = 0;
  let count = 0;
  for (let y = marginY; y < CANVAS_HEIGHT - marginY; y += SAMPLE_STEP) {
    for (let x = marginX; x < CANVAS_WIDTH - marginX; x += SAMPLE_STEP) {
      const i = (y * CANVAS_WIDTH + x) * 4;
      diff +=
        Math.abs(curr[i] - tabCapturePrevData[i]) +
        Math.abs(curr[i + 1] - tabCapturePrevData[i + 1]) +
        Math.abs(curr[i + 2] - tabCapturePrevData[i + 2]);
      count++;
    }
  }
  tabCapturePrevData = curr.slice();
  return diff / (count * 3 * 255);
}

async function startTabCapture(tabId: number, threshold: number) {
  tabCaptureThreshold = threshold;
  tabCapturePrevData = null;
  tabCaptureLastCapture = 0;

  tabCaptureStream = await new Promise<MediaStream>((resolve, reject) => {
    chrome.tabCapture.capture({ video: true, audio: false }, (stream) => {
      if (!stream) reject(new Error("tabCapture failed"));
      else resolve(stream);
    });
  });

  const video = document.createElement("video");
  video.srcObject = tabCaptureStream;
  video.muted = true;
  await video.play();

  const offCanvas = new OffscreenCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
  const ctx = offCanvas.getContext("2d")!;

  tabCaptureInterval = setInterval(async () => {
    ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const pixels = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT).data;
    const score = tabCaptureDiff(pixels);
    const now = Date.now();
    if (score >= tabCaptureThreshold && now - tabCaptureLastCapture > COOLDOWN_MS) {
      tabCaptureLastCapture = now;
      const blob = await offCanvas.convertToBlob({ type: "image/png" });
      const buf = await blob.arrayBuffer();
      const pngData = Array.from(new Uint8Array(buf));
      chrome.runtime.sendMessage({ type: "FRAME_CAPTURED", pngData } satisfies Message);
    }
  }, CAPTURE_INTERVAL_MS);
}

// --- PDF generation ---

async function buildPDF(frames: number[][]): Promise<void> {
  const pdfDoc = await PDFDocument.create();

  for (const frame of frames) {
    const pngBytes = new Uint8Array(frame);
    const img = await pdfDoc.embedPng(pngBytes);
    const { width, height } = img.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  chrome.runtime.sendMessage({ type: "PDF_READY", dataUrl: url } satisfies Message);
}

// --- message listener ---

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "USE_TAB_CAPTURE") {
    const m = msg as UseTabCaptureMessage;
    startTabCapture(m.tabId, m.threshold).catch(console.error);
  } else if (msg.type === "OFFSCREEN_READY") {
    const m = msg as OffscreenReadyMessage;
    buildPDF(m.frames).catch(console.error);
  } else if (msg.type === "STOP_CAPTURE") {
    if (tabCaptureInterval !== null) {
      clearInterval(tabCaptureInterval);
      tabCaptureInterval = null;
    }
    tabCaptureStream?.getTracks().forEach((t) => t.stop());
    tabCaptureStream = null;
  }
});
