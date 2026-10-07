import {
  assetBaseHref, assetFileHref, localImageUrl, externalImageUrl, needsAssetBase, withAssetBase,
  detectSlideSelector, slideIndexForCommand, slidesStateFromMessage,
} from "./slides.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Path separators survive; only the segments are encoded. A whole-path
// encodeURIComponent would collapse this into one segment and break relative
// resolution — that's the bug this shape exists to avoid.
equal(assetBaseHref("/Users/g/My Base/docs"), "pirepfile://localhost/Users/g/My%20Base/docs/");
equal(assetBaseHref("/v/한글 폴더"), "pirepfile://localhost/v/%ED%95%9C%EA%B8%80%20%ED%8F%B4%EB%8D%94/");
equal(assetBaseHref("/"), "pirepfile://localhost/");
equal(assetFileHref("/Users/g/My Base", "docs/report.html"), "pirepfile://localhost/Users/g/My%20Base/docs/report.html");
equal(localImageUrl("images/간트.png", "/vault", "plans/plan.md"), "pirepfile://localhost/vault/plans/images/%EA%B0%84%ED%8A%B8.png");
equal(externalImageUrl("img/pic.png", "/Users/test/Outside/doc.md"), "pirepfile://localhost/Users/test/Outside/img/pic.png");
equal(externalImageUrl("../secret.png", "/Users/test/Outside/doc.md"), null);
equal(externalImageUrl("%2e%2e/secret.png", "/Users/test/Outside/doc.md"), null);
equal(externalImageUrl(".env", "/Users/test/Outside/doc.md"), null);
equal(externalImageUrl("img/app.js", "/Users/test/Outside/doc.md"), null);
equal(localImageUrl("../outside.png", "/vault", "plans/plan.md"), null);
equal(localImageUrl("/outside.png", "/vault", "plans/plan.md"), null);
equal(localImageUrl("https://example.com/x.png", "/vault", "plans/plan.md"), null);

// A relative reference resolves against the directory, not the origin root.
equal(
  new URL("./support.js", assetBaseHref("/Users/g/deck")).href,
  "pirepfile://localhost/Users/g/deck/support.js",
);
equal(
  new URL("_ds/styles.css", assetBaseHref("/Users/g/deck")).href,
  "pirepfile://localhost/Users/g/deck/_ds/styles.css",
);

const head = withAssetBase("<html><head><title>t</title></head><body>x</body></html>", "/d");
equal(head.indexOf("<base") < head.indexOf("<title"), true);

// No <head>, and no <html> either — still gets one.
equal(withAssetBase("<body>x</body>", "/d").startsWith("<head><base"), true);
equal(withAssetBase("<html><body>x</body></html>", "/d").includes("<head><base"), true);

// An author-supplied <base> is left alone.
const authored = '<html><head><base href="https://x/"></head></html>';
equal(withAssetBase(authored, "/d"), authored);

// A <base> is only worth its side effects when something actually needs it.
// Injecting one into a self-contained document re-points bare "#frag" links at
// the base URL and kills in-page navigation — the bug this guard prevents.
equal(needsAssetBase('<html><body><a href="#index">x</a></body></html>'), false);
equal(needsAssetBase('<link rel="stylesheet" href="https://cdn/x.css">'), false);
equal(needsAssetBase('<script src="//cdn/x.js"></script>'), false);
equal(needsAssetBase('<script src="./support.js"></script>'), true);
equal(needsAssetBase('<link rel="stylesheet" href="_ds/styles.css">'), true);
equal(needsAssetBase('<img src="assets/logo.svg">'), true);

equal(detectSlideSelector({ ".slide": 3, "[data-slide]": 4 }), { selector: ".slide", count: 3 });
equal(detectSlideSelector({ ".slide": 1, "[data-slide]": 2 }), { selector: "[data-slide]", count: 2 });
equal(detectSlideSelector({ ".slide": 1 }), null);
equal(slideIndexForCommand(1, 3, { action: "next" }), 2);
equal(slideIndexForCommand(2, 3, { action: "next" }), 2);
equal(slideIndexForCommand(1, 3, { action: "prev" }), 0);
equal(slideIndexForCommand(1, 3, { action: "first" }), 0);
equal(slideIndexForCommand(1, 3, { action: "last" }), 2);
equal(slideIndexForCommand(0, 3, { action: "goto", index: 9 }), 2);
equal(slideIndexForCommand(0, 3, { action: "goto", index: -2 }), 0);
equal(slideIndexForCommand(0, 3, { action: "goto", index: 1.5 }), 0);

const frame = {} as Window;
const stateEvent = (source: MessageEventSource | null, origin: string, data: unknown) =>
  ({ source, origin, data }) as MessageEvent;
equal(slidesStateFromMessage(stateEvent(frame, "pirepfile://localhost", {
  type: "pirep-slides-state", current: 2, total: 3, ignored: "discard",
}), frame), { current: 2, total: 3 });
equal(slidesStateFromMessage(stateEvent({} as Window, "pirepfile://localhost", {
  type: "pirep-slides-state", current: 2, total: 3,
}), frame), null);
equal(slidesStateFromMessage(stateEvent(frame, "https://example.com", {
  type: "pirep-slides-state", current: 2, total: 3,
}), frame), null);
equal(slidesStateFromMessage(stateEvent(frame, "pirepfile://localhost", {
  type: "pirep-slides-state", current: "2", total: 3,
}), frame), null);
equal(slidesStateFromMessage(stateEvent(frame, "pirepfile://localhost", {
  type: "pirep-slides-state", current: 4, total: 3,
}), frame), null);

console.log("slides tests passed");
