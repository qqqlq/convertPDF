import type { Message, StatusUpdateMessage, PDFReadyMessage } from "../shared/types.js";

const btnToggle = document.getElementById("btn-toggle") as HTMLButtonElement;
const btnPdf = document.getElementById("btn-pdf") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const countEl = document.getElementById("count")!;
const intervalInput = document.getElementById("interval") as HTMLInputElement;
const intervalVal = document.getElementById("interval-val")!;
const hammingInput = document.getElementById("hamming") as HTMLInputElement;
const hammingVal = document.getElementById("hamming-val")!;

let isCapturing = false;

function updateUI(capturing: boolean, count: number) {
  isCapturing = capturing;
  countEl.textContent = String(count);
  btnToggle.textContent = capturing ? "録画停止" : "録画開始";
  statusEl.textContent = capturing ? "録画中..." : "待機中";
  statusEl.classList.toggle("capturing", capturing);
  btnPdf.disabled = capturing || count === 0;
}

intervalInput.addEventListener("input", () => {
  intervalVal.textContent = intervalInput.value;
});

hammingInput.addEventListener("input", () => {
  hammingVal.textContent = hammingInput.value;
});

btnToggle.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (!isCapturing) {
    const intervalMs = parseInt(intervalInput.value) * 1000;
    chrome.runtime.sendMessage({
      type: "START_CAPTURE",
      intervalMs,
      tabId: tab.id,
    } satisfies Message);
    updateUI(true, parseInt(countEl.textContent ?? "0"));
  } else {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message);
    updateUI(false, parseInt(countEl.textContent ?? "0"));
  }
});

btnPdf.addEventListener("click", () => {
  const hammingThreshold = parseInt(hammingInput.value);
  chrome.runtime.sendMessage({
    type: "GENERATE_PDF",
    hammingThreshold,
  } satisfies Message);
  btnPdf.disabled = true;
  statusEl.textContent = "PDF生成中...";
});

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "STATUS_UPDATE") {
    const m = msg as StatusUpdateMessage;
    updateUI(m.isCapturing, m.frameCount);
  } else if (msg.type === "PDF_READY") {
    const m = msg as PDFReadyMessage;
    chrome.downloads.download({
      url: m.dataUrl,
      filename: "slides.pdf",
    });
    const info = m.originalCount != null
      ? `PDF保存完了（${m.originalCount}枚 → ${m.keptCount}枚）`
      : "PDF保存完了";
    statusEl.textContent = info;
  }
});

// 起動時に現在の状態を service worker に問い合わせる
chrome.runtime.sendMessage({ type: "STATUS_UPDATE" } as unknown as Message).catch(() => {});
