import { previewKeyFromMessage } from "./previewKeys.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const frame = {} as Window;
const event = (source: MessageEventSource | null, origin: string, data: unknown) =>
  ({ source, origin, data }) as MessageEvent;

equal(
  previewKeyFromMessage(event(frame, "pirepfile://localhost", {
    type: "pirep-keydown", key: "k", metaKey: true, ctrlKey: false,
    altKey: false, shiftKey: false, ignored: "discard me",
  }), frame),
  { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
);

for (const message of [
  event({} as Window, "pirepfile://localhost", { type: "pirep-keydown", key: "k", metaKey: true }),
  event(frame, "https://example.com", { type: "pirep-keydown", key: "k", metaKey: true }),
  event(frame, "pirepfile://localhost", { type: "other", key: "k", metaKey: true }),
  event(frame, "pirepfile://localhost", { type: "pirep-keydown", key: "a" }),
]) equal(previewKeyFromMessage(message, frame), null);

equal(
  previewKeyFromMessage(event(frame, "pirepfile://localhost", {
    type: "pirep-keydown", key: "Escape",
  }), frame),
  { key: "Escape", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
);

console.log("preview key bridge tests passed");
