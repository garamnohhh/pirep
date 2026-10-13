import { htmlAffectedByChanges } from "./htmlRefresh.ts";

function equal(actual: boolean, expected: boolean) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

const html = "reports/deck/index.html";
equal(htmlAffectedByChanges(html, [html]), true);
equal(htmlAffectedByChanges(html, ["reports/deck/style.css"]), true);
equal(htmlAffectedByChanges(html, ["reports/deck/assets/logo.svg"]), true);
equal(htmlAffectedByChanges(html, ["reports/other/style.css"]), false);
equal(htmlAffectedByChanges(html, ["reports/deck/.pirep/state"]), false);
equal(htmlAffectedByChanges("index.html", ["image.png"]), true);
