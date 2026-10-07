import { propertySuggestions } from "./propertySuggestions.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

equal(propertySuggestions([{ key: "author", count: 3 }, { key: "status", count: 2 }], ["author"], ""), {
  pirep: ["pinned", "status", "tags", "created", "updated"].map((key) => ({ key })), base: [], create: null,
});
equal(propertySuggestions([{ key: "author", count: 3 }], [], "Pub Date"), { pirep: [], base: [], create: "pub_date" });
console.log("property suggestion tests passed");
