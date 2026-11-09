import { decideConditionalSave } from "./conditionalSave.ts";

const cases = [
  ["unchanged draft skips write", "base", "base", undefined, "skip"],
  ["changed draft can write", "mine", "base", undefined, "write"],
  ["matching disk can write", "mine", "base", "base", "write"],
  ["changed disk conflicts", "mine", "base", "other", "conflict"],
] as const;

for (const [name, draft, baseline, disk, expected] of cases) {
  const actual = decideConditionalSave(draft, baseline, disk);
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}

console.log(`${cases.length} conditional save tests passed`);
