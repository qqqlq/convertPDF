// --- 定期キャプチャ ---
export const CAPTURE_INTERVAL_DEFAULT_MS = 10_000;   // 既定 10 秒（旧 30 秒）
export const CAPTURE_INTERVAL_MIN_MS = 5_000;
export const CAPTURE_INTERVAL_MAX_MS = 120_000;

// --- 差分検知（バイナリカウント方式）---
export const DIFF_TICK_MS = 250;
export const BINARY_PIXEL_THRESHOLD = 30;            // 1 チャネルあたりの変化閾値
export const BINARY_CHANGE_THRESHOLD = 0.015;        // 変化ピクセル率 1.5% で発火
export const DIFF_COOLDOWN_MS = 2_000;               // 同一アニメーション多重検知防止

// --- フォールバック ---
export const FALLBACK_FAIL_THRESHOLD = 5;
export const CAPTURE_MAX_WIDTH = 1920;

// --- dHash + スーパーセット判定 ---
export const DHASH_SIZE = 8;
export const HAMMING_THRESHOLD_DEFAULT = 8;
export const THUMB_W = 128;
export const THUMB_H = 72;
export const SUPERSET_DIRECTION_RATIO = 0.85;        // 85% 同方向変化 = 上位集合
export const SUPERSET_MIN_CHANGE_RATIO = 0.005;      // 変化ピクセルが 0.5% 未満は無視
export const SUPERSET_MAX_CHANGE_RATIO = 0.30;       // 30% 超の変化は別スライドと判断
