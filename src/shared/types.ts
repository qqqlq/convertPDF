export type MessageType =
  | "START_CAPTURE"
  | "STOP_CAPTURE"
  | "FRAME_CAPTURED"
  | "MANUAL_CAPTURE"
  | "SAVE_FRAME"
  | "CLEAR_FRAMES"
  | "GENERATE_PDF"
  | "GENERATE_PDF_FROM_DB"
  | "PDF_READY"
  | "STATUS_UPDATE"
  | "USE_TAB_CAPTURE";

export interface BaseMessage {
  type: MessageType;
}

export interface StartCaptureMessage extends BaseMessage {
  type: "START_CAPTURE";
  intervalMs: number;
  /** popup が service worker に送る際にのみ付与する */
  tabId?: number;
  /** false = 再開（既存フレームを引き継ぐ）、省略または true = 新規（フレームをクリア） */
  clearFrames?: boolean;
}

export interface StopCaptureMessage extends BaseMessage {
  type: "STOP_CAPTURE";
}

export interface FrameCapturedMessage extends BaseMessage {
  type: "FRAME_CAPTURED";
  pngData: number[];
}

export interface SaveFrameMessage extends BaseMessage {
  type: "SAVE_FRAME";
  pngData: number[];
}

export interface ManualCaptureMessage extends BaseMessage {
  type: "MANUAL_CAPTURE";
}

export interface ClearFramesMessage extends BaseMessage {
  type: "CLEAR_FRAMES";
}

export interface GeneratePDFMessage extends BaseMessage {
  type: "GENERATE_PDF";
  hammingThreshold?: number;
}

export interface GeneratePDFFromDBMessage extends BaseMessage {
  type: "GENERATE_PDF_FROM_DB";
  hammingThreshold: number;
}

export interface PDFReadyMessage extends BaseMessage {
  type: "PDF_READY";
  dataUrl: string;
  originalCount?: number;
  keptCount?: number;
}

export interface StatusUpdateMessage extends BaseMessage {
  type: "STATUS_UPDATE";
  frameCount: number;
  isCapturing: boolean;
}

export interface UseTabCaptureMessage extends BaseMessage {
  type: "USE_TAB_CAPTURE";
  tabId?: number;
  intervalMs: number;
}

export type Message =
  | StartCaptureMessage
  | StopCaptureMessage
  | FrameCapturedMessage
  | ManualCaptureMessage
  | SaveFrameMessage
  | ClearFramesMessage
  | GeneratePDFMessage
  | GeneratePDFFromDBMessage
  | PDFReadyMessage
  | StatusUpdateMessage
  | UseTabCaptureMessage;
