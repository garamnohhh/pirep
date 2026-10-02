import {
  previewExternalUrlFromMessage, previewKeyFromMessage, previewLocationFromMessage,
  previewNavigationAction, previewPageChanged,
} from "./previewKeys.ts";

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

equal(previewExternalUrlFromMessage(event(frame, "pirepfile://localhost", {
  type: "pirep-external-link", url: "https://example.com/a?b=1",
}), frame), "https://example.com/a?b=1");
for (const url of ["http://example.com", "javascript:alert(1)", "mailto:a@example.com", "https://u:p@example.com"]) {
  equal(previewExternalUrlFromMessage(event(frame, "pirepfile://localhost", {
    type: "pirep-external-link", url,
  }), frame), null);
}
equal(previewExternalUrlFromMessage(event({} as Window, "pirepfile://localhost", {
  type: "pirep-external-link", url: "https://example.com",
}), frame), null);
equal(previewExternalUrlFromMessage(event(frame, "https://example.com", {
  type: "pirep-external-link", url: "https://example.com",
}), frame), null);

equal(previewLocationFromMessage(event(frame, "pirepfile://localhost", {
  type: "pirep-preview-location", href: "pirepfile://localhost/vault/other.html",
}), frame), "pirepfile://localhost/vault/other.html");
for (const href of ["https://example.com", "http://example.com", "javascript:alert(1)"]) {
  equal(previewLocationFromMessage(event(frame, "pirepfile://localhost", {
    type: "pirep-preview-location", href,
  }), frame), null);
}
equal(previewPageChanged("pirepfile://localhost/vault/other.html#part", "pirepfile://localhost/vault/start.html"), true);
equal(previewPageChanged("pirepfile://localhost/vault/start.html#part", "pirepfile://localhost/vault/start.html"), false);
equal(previewNavigationAction({ key: "[", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }), "back");
equal(previewNavigationAction({ key: "]", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }), "forward");
equal(previewNavigationAction({ key: "[", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }), null);

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
