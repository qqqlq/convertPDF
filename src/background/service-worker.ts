import type {
  Message,
  FrameCapturedMessage,
  StatusUpdateMessage,
  StartCaptureMessage,
  UseTabCaptureMessage,
} from "../shared/types.js";

const frames: number[][] = [];
let isCapturing = false;
let activeTabId: number | null = null;
let captureThreshold = 0.15;

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

function startCapture(tabId: number, threshold: number) {
  if (isCapturing) return;
  isCapturing = true;
  activeTabId = tabId;
  captureThreshold = threshold;
  frames.length = 0;
  broadcastStatus();
  chrome.tabs.sendMessage(tabId, {
    type: "START_CAPTURE",
    threshold,
  } satisfies Message);
}

function stopCapture() {
  if (!isCapturing) return;
  isCapturing = false;
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, { type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    // offscreen にも停止を通知
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message).catch(() => {});
    activeTabId = null;
  }
  broadcastStatus();
}

async function generatePDF() {
  await ensureOffscreen();
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_READY",
    frames,
  } satisfies Message);
}

chrome.runtime.onMessage.addListener((msg: Message) => {
  switch (msg.type) {
    case "START_CAPTURE": {
      const m = msg as StartCaptureMessage;
      const tabId = m.tabId;
      if (tabId == null) return;
      startCapture(tabId, m.threshold);
      break;
    }
    case "STOP_CAPTURE":
      stopCapture();
      break;
    case "FRAME_CAPTURED":
      frames.push((msg as FrameCapturedMessage).pngData);
      broadcastStatus();
      break;
    case "GENERATE_PDF":
      generatePDF();
      break;
    case "USE_TAB_CAPTURE": {
      if (activeTabId === null) return;
      ensureOffscreen().then(() => {
        const payload: UseTabCaptureMessage = {
          type: "USE_TAB_CAPTURE",
          tabId: activeTabId!,
          threshold: (msg as UseTabCaptureMessage).threshold,
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
