import { PDFDocument } from "pdf-lib";
import type { Message, UseTabCaptureMessage, OffscreenReadyMessage } from "../shared/types.js";
import { CAPTURE_MAX_WIDTH } from "../shared/constants.js";
import { computeDHash, dedupFrames, type HashedFrame } from "./dhash.js";

// --- tabCapture fallback ---

let tabCaptureStream: MediaStream | null = null;
let tabCaptureInterval: ReturnType<typeof setInterval> | null = null;

async function startTabCapture(tabId: number, intervalMs: number) {
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

  async function captureFrame() {
    const rawW = video.videoWidth || 1280;
    const rawH = video.videoHeight || 720;
    const scale = rawW > CAPTURE_MAX_WIDTH ? CAPTURE_MAX_WIDTH / rawW : 1;
    const w = Math.round(rawW * scale);
    const h = Math.round(rawH * scale);

    const offCanvas = new OffscreenCanvas(w, h);
    const ctx = offCanvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await offCanvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    chrome.runtime.sendMessage({
      type: "FRAME_CAPTURED",
      pngData: Array.from(new Uint8Array(buf)),
    } satisfies Message);
  }

  // 開始直後に1枚、以後は intervalMs ごとに定期キャプチャ
  captureFrame();
  tabCaptureInterval = setInterval(captureFrame, intervalMs);
}

// --- PDF generation with dedup ---

async function buildPDF(rawFrames: number[][], hammingThreshold: number): Promise<void> {
  console.log(`[SlidePDF] buildPDF start: rawFrames=${rawFrames.length}`);

  // 1. 各フレームの dHash を計算
  const hashed: HashedFrame[] = [];
  for (const arr of rawFrames) {
    const pngBytes = new Uint8Array(arr);
    const hash = await computeDHash(pngBytes);
    hashed.push({ pngBytes, hash });
  }

  // 2. 重複削除
  const kept = dedupFrames(hashed, hammingThreshold);
  console.log(`[SlidePDF] dedup done: ${rawFrames.length} → ${kept.length} frames (threshold=${hammingThreshold})`);

  // 3. PDF 生成
  const pdfDoc = await PDFDocument.create();
  for (const f of kept) {
    const img = await pdfDoc.embedPng(f.pngBytes);
    const { width, height } = img.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  chrome.runtime.sendMessage({
    type: "PDF_READY",
    dataUrl: url,
    originalCount: rawFrames.length,
    keptCount: kept.length,
  } satisfies Message);
}

// --- message listener ---

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "USE_TAB_CAPTURE") {
    const m = msg as UseTabCaptureMessage;
    startTabCapture(m.tabId!, m.intervalMs).catch(console.error);
  } else if (msg.type === "OFFSCREEN_READY") {
    const m = msg as OffscreenReadyMessage;
    buildPDF(m.frames, m.hammingThreshold).catch(console.error);
  } else if (msg.type === "STOP_CAPTURE") {
    if (tabCaptureInterval !== null) {
      clearInterval(tabCaptureInterval);
      tabCaptureInterval = null;
    }
    tabCaptureStream?.getTracks().forEach((t) => t.stop());
    tabCaptureStream = null;
  }
});
