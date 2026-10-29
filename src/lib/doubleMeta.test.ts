import { initialDoubleMetaState, updateDoubleMeta } from "./doubleMeta.ts";

type Event = Parameters<typeof updateDoubleMeta>[1];

function run(events: Event[]): boolean[] {
  let state = initialDoubleMetaState;
  return events.map((event) => {
    const result = updateDoubleMeta(state, event);
    state = result.state;
    return result.triggered;
  });
}

const down = (at: number, blocked = false): Event => ({ type: "keydown", key: "Meta", at, blocked });
const up = (at: number, blocked = false): Event => ({ type: "keyup", key: "Meta", at, blocked });

const cases: [string, Event[], boolean][] = [
  ["two quick taps trigger", [down(0), up(40), down(200), up(240)], true],
  ["Command-C cancels the sequence", [down(0), up(30), down(100), { type: "keydown", key: "c", at: 110 }, { type: "keyup", key: "c", at: 120 }, up(130)], false],
  ["a late second press is ignored", [down(0), up(30), down(331), up(350)], false],
  ["a long press is ignored", [down(0), up(301), down(400), up(430)], false],
  ["blocked input is ignored", [down(0), up(30), down(100, true), up(130, true)], false],
  ["a pointer press cancels the sequence", [down(0), up(30), { type: "cancel" }, down(100), up(130)], false],
];

for (const [name, events, expected] of cases) {
  const actual = run(events).some(Boolean);
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}

console.log(`${cases.length} double Meta tests passed`);
