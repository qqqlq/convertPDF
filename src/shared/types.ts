export type MessageType =
  | "START_CAPTURE"
  | "STOP_CAPTURE"
  | "FRAME_CAPTURED"
  | "GENERATE_PDF"
  | "PDF_READY"
  | "STATUS_UPDATE"
  | "USE_TAB_CAPTURE"
  | "OFFSCREEN_READY";

export interface BaseMessage {
  type: MessageType;
}

export interface StartCaptureMessage extends BaseMessage {
  type: "START_CAPTURE";
  threshold: number;
  /** popup が service worker に送る際にのみ付与する */
  tabId?: number;
}

export interface StopCaptureMessage extends BaseMessage {
  type: "STOP_CAPTURE";
}

export interface FrameCapturedMessage extends BaseMessage {
  type: "FRAME_CAPTURED";
  pngData: number[];
}

export interface GeneratePDFMessage extends BaseMessage {
  type: "GENERATE_PDF";
}

export interface PDFReadyMessage extends BaseMessage {
  type: "PDF_READY";
  dataUrl: string;
}

export interface StatusUpdateMessage extends BaseMessage {
  type: "STATUS_UPDATE";
  frameCount: number;
  isCapturing: boolean;
}

export interface UseTabCaptureMessage extends BaseMessage {
  type: "USE_TAB_CAPTURE";
  /** content script からは省略可（service worker が補完） */
  tabId?: number;
  threshold: number;
}

export interface OffscreenReadyMessage extends BaseMessage {
  type: "OFFSCREEN_READY";
  frames: number[][];
}

export type Message =
  | StartCaptureMessage
  | StopCaptureMessage
  | FrameCapturedMessage
  | GeneratePDFMessage
  | PDFReadyMessage
  | StatusUpdateMessage
  | UseTabCaptureMessage
  | OffscreenReadyMessage;
