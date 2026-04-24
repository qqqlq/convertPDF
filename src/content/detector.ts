import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SAMPLE_STEP,
  CENTER_CROP_RATIO,
} from "../shared/constants.js";

export class SlideDetector {
  private refFrame: Uint8ClampedArray | null = null;

  private getCropBounds() {
    const marginX = Math.floor((CANVAS_WIDTH * (1 - CENTER_CROP_RATIO)) / 2);
    const marginY = Math.floor((CANVAS_HEIGHT * (1 - CENTER_CROP_RATIO)) / 2);
    return {
      x0: marginX,
      y0: marginY,
      x1: CANVAS_WIDTH - marginX,
      y1: CANVAS_HEIGHT - marginY,
    };
  }

  /**
   * 現在フレームと「最後にキャプチャしたフレーム（参照フレーム）」との差分を返す。
   * 250ms前との比較ではなく、前回保存時点からの累積変化を見るため
   * 板書動画のようにゆっくり変化するコンテンツにも対応できる。
   */
  compare(current: Uint8ClampedArray): number {
    if (!this.refFrame) return 0;

    const { x0, y0, x1, y1 } = this.getCropBounds();
    let diff = 0;
    let count = 0;

    for (let y = y0; y < y1; y += SAMPLE_STEP) {
      for (let x = x0; x < x1; x += SAMPLE_STEP) {
        const i = (y * CANVAS_WIDTH + x) * 4;
        diff +=
          Math.abs(current[i] - this.refFrame[i]) +
          Math.abs(current[i + 1] - this.refFrame[i + 1]) +
          Math.abs(current[i + 2] - this.refFrame[i + 2]);
        count++;
      }
    }

    return diff / (count * 3 * 255);
  }

  hasReference(): boolean {
    return this.refFrame !== null;
  }

  /** キャプチャ成功時に呼ぶ。次の比較基準をこのフレームに更新する。 */
  updateReference(frame: Uint8ClampedArray) {
    this.refFrame = frame.slice();
  }

  reset() {
    this.refFrame = null;
  }
}
