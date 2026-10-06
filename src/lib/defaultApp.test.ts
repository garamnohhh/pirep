import { waitForMarkdownDefault } from "./defaultApp.ts";

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const intervals: number[] = [];
const updates: (boolean | null)[] = [];
let reads = 0;
const matched = await waitForMarkdownDefault(
  async () => ({ name: ++reads === 13 ? "pirep" : "Xcode", isSelf: reads === 13 }),
  (app) => updates.push(app?.isSelf ?? null),
  async (ms) => { intervals.push(ms); },
);
equal(matched, true);
equal(intervals.length, 13);
deepEqual(intervals, Array(13).fill(500));
deepEqual(updates.slice(-2), [false, true]);

const timeoutIntervals: number[] = [];
let timeoutReads = 0;
const timedOut = await waitForMarkdownDefault(
  async () => { timeoutReads++; return { name: "Xcode", isSelf: false }; },
  () => {},
  async (ms) => { timeoutIntervals.push(ms); },
);
equal(timedOut, false);
equal(timeoutReads, 30);
deepEqual(timeoutIntervals, Array(30).fill(500));

console.log("default app polling tests passed");
