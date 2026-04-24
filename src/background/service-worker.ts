import type {
  Message,
  FrameCapturedMessage,
  StatusUpdateMessage,
  StartCaptureMessage,
  UseTabCaptureMessage,
  GeneratePDFMessage,
} from "../shared/types.js";
import { CAPTURE_INTERVAL_DEFAULT_MS, HAMMING_THRESHOLD_DEFAULT } from "../shared/constants.js";

// --- 状態 ---
let frames: number[][] = [];
let isCapturing = false;
let activeTabId: number | null = null;
let captureIntervalMs = CAPTURE_INTERVAL_DEFAULT_MS;

// --- chrome.storage.session のキー ---
const SESSION_KEY = "captureState";

interface CaptureState {
  isCapturing: boolean;
  activeTabId: number | null;
  captureIntervalMs: number;
  frames: string[]; // base64 エンコードした PNG バイト列
}

function pngToBase64(arr: number[]): string {
  return btoa(String.fromCharCode(...arr));
}

function base64ToPng(b64: string): number[] {
  return Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function saveState() {
  const state: CaptureState = {
    isCapturing,
    activeTabId,
    captureIntervalMs,
    frames: frames.map(pngToBase64),
  };
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: state });
  } catch {
    // 10MB 上限超過などは無視（フレームが失われても録画は継続）
  }
}

async function loadState() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    const state = result[SESSION_KEY] as CaptureState | undefined;
    if (!state) return;
    isCapturing = state.isCapturing;
    activeTabId = state.activeTabId;
    captureIntervalMs = state.captureIntervalMs;
    frames = state.frames.map(base64ToPng);
  } catch {
    // 読み込み失敗は無視
  }
}

async function clearState() {
  frames = [];
  isCapturing = false;
  activeTabId = null;
  await chrome.storage.session.remove(SESSION_KEY);
}

// --- サービスワーカー生存維持 ---
// alarms で 20 秒ごとに起こし続けることで 30 秒無操作による強制終了を防ぐ

function startKeepalive() {
  chrome.alarms.create("keepAlive", { periodInMinutes: 1 / 3 }); // 約 20 秒
}

function stopKeepalive() {
  chrome.alarms.clear("keepAlive");
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    // no-op: アラームを受け取るだけでサービスワーカーが再起動される
  }
});

// --- offscreen ---

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

async function startCapture(tabId: number, intervalMs: number) {
  if (isCapturing) return;
  isCapturing = true;
  activeTabId = tabId;
  captureIntervalMs = intervalMs;
  frames = [];
  startKeepalive();
  await saveState();
  broadcastStatus();
  chrome.tabs.sendMessage(tabId, {
    type: "START_CAPTURE",
    intervalMs,
  } satisfies Message);
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
    type: "OFFSCREEN_READY",
    frames,
    hammingThreshold,
  } satisfies Message);
}

// --- 起動時に前回状態を復元 ---
loadState().then(() => {
  if (isCapturing) {
    // サービスワーカーが再起動した場合、録画状態を復元してアラームを再登録
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
    case "FRAME_CAPTURED":
      frames.push((msg as FrameCapturedMessage).pngData);
      saveState(); // 非同期で逐次保存（await しない）
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
