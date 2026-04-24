import type { Message, StatusUpdateMessage } from "../shared/types.js";

const btnToggle = document.getElementById("btn-toggle") as HTMLButtonElement;
const btnPdf = document.getElementById("btn-pdf") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const countEl = document.getElementById("count")!;
const thresholdInput = document.getElementById("threshold") as HTMLInputElement;
const thresholdVal = document.getElementById("threshold-val")!;

let isCapturing = false;

function updateUI(capturing: boolean, count: number) {
  isCapturing = capturing;
  countEl.textContent = String(count);
  btnToggle.textContent = capturing ? "録画停止" : "録画開始";
  statusEl.textContent = capturing ? "録画中..." : "待機中";
  statusEl.classList.toggle("capturing", capturing);
  btnPdf.disabled = capturing || count === 0;
}

thresholdInput.addEventListener("input", () => {
  thresholdVal.textContent = thresholdInput.value;
});

btnToggle.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (!isCapturing) {
    const threshold = parseFloat(thresholdInput.value);
    // service worker 経由で送ることで tabId を service worker が把握できる
    chrome.runtime.sendMessage({
      type: "START_CAPTURE",
      threshold,
      tabId: tab.id,
    } satisfies Message);
    updateUI(true, parseInt(countEl.textContent ?? "0"));
  } else {
    chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message);
    updateUI(false, parseInt(countEl.textContent ?? "0"));
  }
});

btnPdf.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GENERATE_PDF" } satisfies Message);
  btnPdf.disabled = true;
  statusEl.textContent = "PDF生成中...";
});

chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === "STATUS_UPDATE") {
    const m = msg as StatusUpdateMessage;
    updateUI(m.isCapturing, m.frameCount);
  } else if (msg.type === "PDF_READY") {
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: "slides.pdf",
    });
    statusEl.textContent = "PDF保存完了";
  }
});

// 起動時に現在の状態を service worker に問い合わせる
chrome.runtime.sendMessage({ type: "STATUS_UPDATE" } as unknown as Message).catch(() => {});
