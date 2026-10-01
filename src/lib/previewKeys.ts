export type PreviewKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;
const SLIDE_KEYS = new Set(["ArrowRight", "PageDown", " ", "ArrowLeft", "PageUp"]);

export function previewKeyFromMessage(event: MessageEvent, frame: Window): PreviewKey | null {
  if (event.source !== frame || event.origin !== "pirepfile://localhost") return null;
  const data = event.data;
  if (!data || data.type !== "pirep-keydown" || typeof data.key !== "string" || data.key.length > 32) return null;
  const key = {
    key: data.key,
    metaKey: data.metaKey === true,
    ctrlKey: data.ctrlKey === true,
    altKey: data.altKey === true,
    shiftKey: data.shiftKey === true,
  };
  return key.key === "Escape" || key.metaKey || key.ctrlKey || key.altKey || SLIDE_KEYS.has(key.key) ? key : null;
}
