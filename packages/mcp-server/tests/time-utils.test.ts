import { secondsToTicks, ticksToSeconds, secondsToTicksString, snapToFrame, frameToTicks, TICKS_PER_SECOND } from "../src/time-utils.js";

describe("time-utils", () => {
  describe("secondsToTicks", () => {
    test("converts 0 seconds to 0 ticks", () => {
      expect(secondsToTicks(0)).toBe(0n);
    });

    test("converts 1 second correctly", () => {
      expect(secondsToTicks(1)).toBe(TICKS_PER_SECOND);
    });

    test("converts 30 seconds correctly", () => {
      expect(secondsToTicks(30)).toBe(TICKS_PER_SECOND * 30n);
    });

    test("handles sub-second precision", () => {
      const result = secondsToTicks(1.5);
      expect(result).toBe(TICKS_PER_SECOND + TICKS_PER_SECOND / 2n);
    });
  });

  describe("ticksToSeconds", () => {
    test("converts ticks back to seconds", () => {
      const ticks = TICKS_PER_SECOND * 10n;
      expect(ticksToSeconds(ticks)).toBeCloseTo(10.0, 3);
    });

    test("round-trips for integer seconds", () => {
      const original = 42;
      const ticks = secondsToTicks(original);
      expect(ticksToSeconds(ticks)).toBeCloseTo(original, 5);
    });
  });

  describe("secondsToTicksString", () => {
    test("returns a string", () => {
      expect(typeof secondsToTicksString(5)).toBe("string");
    });

    test("matches secondsToTicks result", () => {
      expect(secondsToTicksString(10)).toBe(secondsToTicks(10).toString());
    });
  });

  describe("frameToTicks", () => {
    test("frame 0 returns 0 ticks", () => {
      expect(frameToTicks(0, 24)).toBe(0n);
    });

    test("frame 24 at 24fps equals 1 second", () => {
      expect(frameToTicks(24, 24)).toBe(TICKS_PER_SECOND);
    });

    test("frame 30 at 30fps equals 1 second", () => {
      expect(frameToTicks(30, 30)).toBe(TICKS_PER_SECOND);
    });
  });

  describe("snapToFrame", () => {
    test("values already on a frame boundary are unchanged", () => {
      const ticks = frameToTicks(10, 24);
      expect(snapToFrame(ticks, 24)).toBe(ticks);
    });

    test("rounds down when below half-frame", () => {
      const ticks = frameToTicks(10, 24);
      const ticksPerFrame = TICKS_PER_SECOND / 24n;
      const subFrame = ticks + ticksPerFrame / 4n;
      expect(snapToFrame(subFrame, 24)).toBe(ticks);
    });

    test("rounds up when at or above half-frame", () => {
      const ticks = frameToTicks(10, 24);
      const ticksPerFrame = TICKS_PER_SECOND / 24n;
      const subFrame = ticks + ticksPerFrame / 2n;
      expect(snapToFrame(subFrame, 24)).toBe(ticks + ticksPerFrame);
    });
  });
});
