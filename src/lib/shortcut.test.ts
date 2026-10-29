import { matchShortcut } from "./shortcut.ts";

const base = { metaKey: true, shiftKey: true, altKey: false, ctrlKey: false };
const cases = [
  ["Command-Shift-B accepts uppercase event key", { ...base, key: "B", code: "KeyB" }, "Meta+Shift+b", true],
  ["Command-Shift-R remains accepted", { ...base, key: "R", code: "KeyR" }, "Meta+Shift+r", true],
  ["Command-Shift-Backslash remains accepted", { ...base, key: "|", code: "Backslash" }, "Meta+Shift+\\", true],
  ["wrong modifiers are rejected", { ...base, shiftKey: false, key: "b", code: "KeyB" }, "Meta+Shift+b", false],
] as const;

for (const [name, event, combo, expected] of cases) {
  const actual = matchShortcut(event, combo);
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}

console.log(`${cases.length} shortcut tests passed`);
