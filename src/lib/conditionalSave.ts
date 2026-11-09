export type ConditionalSaveDecision = "skip" | "write" | "conflict";

export function decideConditionalSave(
  draft: string,
  baseline: string,
  disk?: string,
): ConditionalSaveDecision {
  if (draft === baseline) return "skip";
  if (disk !== undefined && disk !== baseline) return "conflict";
  return "write";
}
