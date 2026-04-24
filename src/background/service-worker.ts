import type {
  Message,
  FrameCapturedMessage,
  StatusUpdateMessage,
  StartCaptureMessage,
  UseTabCaptureMessage,
  GeneratePDFMessage,
} from "../shared/types.js";
import { CAPTURE_INTERVAL_DEFAULT_MS, HAMMING_THRESHOLD_DEFAULT } from "../shared/constants.js";

const frames: number[][] = [];
let isCapturing = false;
let activeTabId: number | null = null;
let captureIntervalMs = CAPTURE_INTERVAL_DEFAULT_MS;

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "PDF generation and tabCapture relay",
    });
  }
}

function broadcastStatus() {
  const status: StatusUpdateMessage = {
    type: "STATUS_UPDATE",
    frameCount: frames.length,
    isCapturing,
  };
  chrome.runtime.sendMessage(status).catch(() => {});
}

function startCapture(tabId: number, intervalMs: number) {
  if (isCapturing) return;
  isCapturing = true;
  activeTabId = tabId;
  captureIntervalMs = intervalMs;
  frames.length = 0;
  broadcastStatus();
  chrome.tabs.sendMessage(tabId, {
    type: "START_CAPTURE",
    intervalMs,
  } satisfies Message);
}

function stopCapture() {
  if (!isCapturing) return;
  isCapturing = false;
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, { type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    activeTabId = null;
  }
  broadcastStatus();
}

async function generatePDF(hammingThreshold: number) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_READY",
    frames,
    hammingThreshold,
  } satisfies Message);
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  switch (msg.type) {
    case "START_CAPTURE": {
      const m = msg as StartCaptureMessage;
      if (m.tabId == null) return;
      startCapture(m.tabId, m.intervalMs);
      break;
    }
    case "STOP_CAPTURE":
      stopCapture();
      break;
    case "FRAME_CAPTURED":
      frames.push((msg as FrameCapturedMessage).pngData);
      broadcastStatus();
      break;
    case "GENERATE_PDF": {
      const m = msg as GeneratePDFMessage;
      generatePDF(m.hammingThreshold ?? HAMMING_THRESHOLD_DEFAULT);
      break;
    }
    case "USE_TAB_CAPTURE": {
      if (activeTabId === null) return;
      ensureOffscreen().then(() => {
        const payload: UseTabCaptureMessage = {
          type: "USE_TAB_CAPTURE",
          tabId: activeTabId!,
          intervalMs: (msg as UseTabCaptureMessage).intervalMs,
        };
        chrome.runtime.sendMessage(payload).catch(() => {});
      });
      break;
    }
    case "STATUS_UPDATE":
      broadcastStatus();
      break;
  }
});
