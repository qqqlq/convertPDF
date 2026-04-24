import { PDFDocument } from "pdf-lib";
import type {
  Message,
  UseTabCaptureMessage,
  GeneratePDFFromDBMessage,
  SaveFrameMessage,
} from "../shared/types.js";
import { CAPTURE_MAX_WIDTH } from "../shared/constants.js";
import { computeDHash, dedupFrames, type HashedFrame } from "./dhash.js";

// ============================================================
// IndexedDB
// ============================================================

const DB_NAME = "slidepdf";
const STORE_NAME = "frames";

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const database = (e.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function getDB(): Promise<IDBDatabase> {
  if (!db) db = await openDB();
  return db;
}

function idbSaveFrame(database: IDBDatabase, pngBytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).add(pngBytes.buffer);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbGetAllFrames(database: IDBDatabase): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () =>
      resolve((req.result as ArrayBuffer[]).map((b) => new Uint8Array(b)));
    req.onerror = () => reject(req.error);
  });
}

function idbClearFrames(database: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============================================================
// tabCapture fallback
// ============================================================

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
    offCanvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
    const blob = await offCanvas.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    const pngBytes = new Uint8Array(buf);
    // IndexedDB に直接保存し、service worker には枚数カウント用のみ通知
    const database = await getDB();
    await idbSaveFrame(database, pngBytes);
    chrome.runtime.sendMessage({
      type: "FRAME_CAPTURED",
      pngData: [],  // データ本体は DB に保存済み。SW はカウントのみ更新
    } satisfies Message);
  }

  captureFrame();
  tabCaptureInterval = setInterval(captureFrame, intervalMs);
}

// ============================================================
// PDF generation with dedup
// ============================================================

async function buildPDF(hammingThreshold: number): Promise<void> {
  const database = await getDB();
  const rawFrames = await idbGetAllFrames(database);
  console.log(`[SlidePDF] buildPDF start: rawFrames=${rawFrames.length}`);

  const hashed: HashedFrame[] = [];
  for (const pngBytes of rawFrames) {
    const { hash, thumbPixels } = await computeDHash(pngBytes);
    hashed.push({ pngBytes, hash, thumbPixels });
  }

  const kept = dedupFrames(hashed, hammingThreshold);
  console.log(`[SlidePDF] dedup: ${rawFrames.length} → ${kept.length} (threshold=${hammingThreshold})`);

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

// ============================================================
// message listener
// ============================================================

chrome.runtime.onMessage.addListener((msg: Message) => {
  switch (msg.type) {
    case "SAVE_FRAME":
      getDB().then((database) => {
        const pngBytes = new Uint8Array((msg as SaveFrameMessage).pngData);
        idbSaveFrame(database, pngBytes).catch(console.error);
      });
      break;
    case "CLEAR_FRAMES":
      getDB().then((database) => idbClearFrames(database)).catch(console.error);
      break;
    case "GENERATE_PDF_FROM_DB":
      buildPDF((msg as GeneratePDFFromDBMessage).hammingThreshold).catch(console.error);
      break;
    case "USE_TAB_CAPTURE": {
      const m = msg as UseTabCaptureMessage;
      startTabCapture(m.tabId!, m.intervalMs).catch(console.error);
      break;
    }
    case "STOP_CAPTURE":
      if (tabCaptureInterval !== null) {
        clearInterval(tabCaptureInterval);
        tabCaptureInterval = null;
      }
      tabCaptureStream?.getTracks().forEach((t) => t.stop());
      tabCaptureStream = null;
      break;
  }
});
