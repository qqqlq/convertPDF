import type {
  Message,
  StatusUpdateMessage,
  StartCaptureMessage,
  UseTabCaptureMessage,
  GeneratePDFMessage,
  FrameCapturedMessage,
} from "../shared/types.js";
import { CAPTURE_INTERVAL_DEFAULT_MS, HAMMING_THRESHOLD_DEFAULT } from "../shared/constants.js";

// --- 軽量メタデータのみ保持（フレームデータは IndexedDB に委譲）---
let frameCount = 0;
let isCapturing = false;
let activeTabId: number | null = null;
let captureIntervalMs = CAPTURE_INTERVAL_DEFAULT_MS;

// --- session storage（メタデータのみ、数十バイト）---
const SESSION_KEY = "captureState";

interface CaptureState {
  isCapturing: boolean;
  activeTabId: number | null;
  captureIntervalMs: number;
  frameCount: number;
}

async function saveState() {
  const state: CaptureState = { isCapturing, activeTabId, captureIntervalMs, frameCount };
  await chrome.storage.session.set({ [SESSION_KEY]: state }).catch(() => {});
}

async function loadState() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    const s = result[SESSION_KEY] as CaptureState | undefined;
    if (!s) return;
    isCapturing = s.isCapturing;
    activeTabId = s.activeTabId;
    captureIntervalMs = s.captureIntervalMs;
    frameCount = s.frameCount;
  } catch { /* ignore */ }
}

// --- alarms: SW を 20 秒ごとに起こして強制終了を防ぐ ---
function startKeepalive() {
  chrome.alarms.create("keepAlive", { periodInMinutes: 1 / 3 });
}
function stopKeepalive() {
  chrome.alarms.clear("keepAlive");
}
chrome.alarms.onAlarm.addListener(() => { /* no-op */ });

// --- offscreen ---
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "PDF generation, IndexedDB storage, tabCapture relay",
    });
  }
}

function broadcastStatus() {
  const status: StatusUpdateMessage = { type: "STATUS_UPDATE", frameCount, isCapturing };
  chrome.runtime.sendMessage(status).catch(() => {});
}

async function startCapture(tabId: number, intervalMs: number) {
  if (isCapturing) return;
  isCapturing = true;
  activeTabId = tabId;
  captureIntervalMs = intervalMs;
  frameCount = 0;
  startKeepalive();

  // offscreen の IndexedDB をクリア
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: "CLEAR_FRAMES" } satisfies Message).catch(() => {});

  await saveState();
  broadcastStatus();
  chrome.tabs.sendMessage(tabId, { type: "START_CAPTURE", intervalMs } satisfies Message);
}

async function stopCapture() {
  if (!isCapturing) return;
  stopKeepalive();
  isCapturing = false;
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, { type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    activeTabId = null;
  }
  await saveState();
  broadcastStatus();
}

async function generatePDF(hammingThreshold: number) {
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    type: "GENERATE_PDF_FROM_DB",
    hammingThreshold,
  } satisfies Message);
}

// --- 起動時に前回状態を復元 ---
loadState().then(() => {
  if (isCapturing) {
    startKeepalive();
    broadcastStatus();
  }
});

// --- メッセージハンドラ ---
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
    case "FRAME_CAPTURED": {
      // content script からのフレームを offscreen の IndexedDB に転送
      const m = msg as FrameCapturedMessage;
      ensureOffscreen().then(() => {
        chrome.runtime.sendMessage({ type: "SAVE_FRAME", pngData: m.pngData } satisfies Message)
          .catch(() => {});
      });
      frameCount++;
      saveState();
      broadcastStatus();
      break;
    }
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
    case "MANUAL_CAPTURE":
      if (activeTabId !== null) {
        chrome.tabs.sendMessage(activeTabId, { type: "MANUAL_CAPTURE" } satisfies Message);
      }
      break;
    case "STATUS_UPDATE":
      broadcastStatus();
      break;
  }
});
