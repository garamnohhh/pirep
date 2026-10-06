import { isCloseWindowShortcut } from "./window-shortcuts.ts";

const cases = [
  ["Command-W closes one window", { key: "w", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false }, true],
  ["uppercase W is accepted", { key: "W", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false }, true],
  ["Command-Q is not close-window", { key: "q", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false }, false],
  ["plain W is ignored", { key: "w", metaKey: false, shiftKey: false, altKey: false, ctrlKey: false }, false],
  ["modified Command-W is ignored", { key: "w", metaKey: true, shiftKey: true, altKey: false, ctrlKey: false }, false],
] as const;

for (const [name, event, expected] of cases) {
  const actual = isCloseWindowShortcut(event);
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}
console.log(`${cases.length} window shortcut tests passed`);
