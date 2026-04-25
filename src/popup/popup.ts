import type { Message, StatusUpdateMessage, PDFReadyMessage } from "../shared/types.js";

const btnStart    = document.getElementById("btn-start")    as HTMLButtonElement;
const btnStop     = document.getElementById("btn-stop")     as HTMLButtonElement;
const btnResume   = document.getElementById("btn-resume")   as HTMLButtonElement;
const btnNew      = document.getElementById("btn-new")      as HTMLButtonElement;
const btnManual   = document.getElementById("btn-manual")   as HTMLButtonElement;
const btnPdf      = document.getElementById("btn-pdf")      as HTMLButtonElement;
const statusEl    = document.getElementById("status")!;
const countEl     = document.getElementById("count")!;
const intervalInput = document.getElementById("interval") as HTMLInputElement;
const intervalVal   = document.getElementById("interval-val")!;
const hammingInput  = document.getElementById("hamming")  as HTMLInputElement;
const hammingVal    = document.getElementById("hamming-val")!;

const buttonsInitial   = document.getElementById("buttons-initial")!;
const buttonsCapturing = document.getElementById("buttons-capturing")!;
const buttonsStopped   = document.getElementById("buttons-stopped")!;

type UIState = "initial" | "capturing" | "stopped";

function updateUI(capturing: boolean, count: number) {
  countEl.textContent = String(count);

  const state: UIState = capturing ? "capturing" : count > 0 ? "stopped" : "initial";

  buttonsInitial.style.display   = state === "initial"   ? "" : "none";
  buttonsCapturing.style.display = state === "capturing" ? "" : "none";
  buttonsStopped.style.display   = state === "stopped"   ? "" : "none";

  statusEl.textContent = capturing ? "録画中..." : "待機中";
  statusEl.classList.toggle("capturing", capturing);
}

intervalInput.addEventListener("input", () => {
  intervalVal.textContent = intervalInput.value;
});

hammingInput.addEventListener("input", () => {
  hammingVal.textContent = hammingInput.value;
});

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

btnStart.addEventListener("click", async () => {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  chrome.runtime.sendMessage({
    type: "START_CAPTURE",
    intervalMs: parseInt(intervalInput.value) * 1000,
    tabId,
    clearFrames: true,
  } satisfies Message);
  updateUI(true, 0);
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP_CAPTURE" } satisfies Message);
  updateUI(false, parseInt(countEl.textContent ?? "0"));
});

btnResume.addEventListener("click", async () => {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  chrome.runtime.sendMessage({
    type: "START_CAPTURE",
    intervalMs: parseInt(intervalInput.value) * 1000,
    tabId,
    clearFrames: false,
  } satisfies Message);
  updateUI(true, parseInt(countEl.textContent ?? "0"));
});

btnNew.addEventListener("click", async () => {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  chrome.runtime.sendMessage({
    type: "START_CAPTURE",
    intervalMs: parseInt(intervalInput.value) * 1000,
    tabId,
    clearFrames: true,
  } satisfies Message);
  updateUI(true, 0);
});

btnManual.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "MANUAL_CAPTURE" } satisfies Message);
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
