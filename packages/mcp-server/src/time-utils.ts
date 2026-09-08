/**
 * Premiere Pro tick conversion utilities.
 *
 * In Premiere Pro's scripting API, time is measured in "ticks":
 *   1 second = 254016000000 ticks (this is a fixed constant, independent of frame rate)
 *
 * Frame-based time depends on the sequence frame rate. Common rates:
 *   23.976 fps: 1 frame = ~10594898... ticks
 *   24 fps:     1 frame = 10584000000 ticks
 *   25 fps:     1 frame = 10160640000 ticks
 *   29.97 fps:  1 frame = ~8474158...  ticks
 *   30 fps:     1 frame = 8467200000  ticks
 *   60 fps:     1 frame = 4233600000  ticks
 *
 * We use BigInt for tick values to avoid floating point precision loss.
 */

export const TICKS_PER_SECOND = BigInt("254016000000");

/** Convert seconds (float) to Premiere ticks as a BigInt. */
export function secondsToTicks(seconds: number): bigint {
  // Multiply in integer space to avoid precision loss
  const wholeSeconds = BigInt(Math.floor(seconds));
  const fractionTicks = BigInt(Math.round((seconds % 1) * Number(TICKS_PER_SECOND)));
  return wholeSeconds * TICKS_PER_SECOND + fractionTicks;
}

/** Convert Premiere ticks to seconds (float). */
export function ticksToSeconds(ticks: bigint): number {
  return Number(ticks) / Number(TICKS_PER_SECOND);
}

/**
 * Convert seconds to a ticks string for injection into ExtendScript.
 * ExtendScript receives ticks as a string to avoid integer overflow in JS.
 */
export function secondsToTicksString(seconds: number): string {
  return secondsToTicks(seconds).toString();
}

/** Convert frame number to ticks given frames-per-second. */
export function frameToTicks(frame: number, fps: number): bigint {
  const ticksPerFrame = TICKS_PER_SECOND / BigInt(Math.round(fps));
  return BigInt(frame) * ticksPerFrame;
}

/**
 * Rounds a ticks value to the nearest frame boundary.
 * Important when placing cuts: sub-frame precision can cause unexpected behavior.
 */
export function snapToFrame(ticks: bigint, fps: number): bigint {
  const ticksPerFrame = TICKS_PER_SECOND / BigInt(Math.round(fps));
  const remainder = ticks % ticksPerFrame;
  if (remainder >= ticksPerFrame / 2n) {
    return ticks - remainder + ticksPerFrame;
  }
  return ticks - remainder;
}
