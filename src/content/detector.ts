import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  SAMPLE_STEP,
  CENTER_CROP_RATIO,
} from "../shared/constants.js";

export class SlideDetector {
  private prevData: Uint8ClampedArray | null = null;

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

  compare(current: Uint8ClampedArray): number {
    if (!this.prevData) {
      this.prevData = current.slice();
      return 0;
    }

    const { x0, y0, x1, y1 } = this.getCropBounds();
    let diff = 0;
    let count = 0;

    for (let y = y0; y < y1; y += SAMPLE_STEP) {
      for (let x = x0; x < x1; x += SAMPLE_STEP) {
        const i = (y * CANVAS_WIDTH + x) * 4;
        diff +=
          Math.abs(current[i] - this.prevData[i]) +
          Math.abs(current[i + 1] - this.prevData[i + 1]) +
          Math.abs(current[i + 2] - this.prevData[i + 2]);
        count++;
      }
    }

    this.prevData = current.slice();
    return diff / (count * 3 * 255);
  }

  reset() {
    this.prevData = null;
  }
}
