export type PreviewKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;
const SLIDE_KEYS = new Set(["ArrowRight", "PageDown", " ", "ArrowLeft", "PageUp"]);
const PREVIEW_ORIGIN = "pirepfile://localhost";

function previewMessage(event: MessageEvent, frame: Window, type: string): Record<string, unknown> | null {
  if (event.source !== frame || event.origin !== PREVIEW_ORIGIN) return null;
  const data = event.data;
  return data && typeof data === "object" && data.type === type ? data as Record<string, unknown> : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function previewKeyFromMessage(event: MessageEvent, frame: Window): PreviewKey | null {
  const data = previewMessage(event, frame, "pirep-keydown");
  if (!data) return null;
  if (typeof data.key !== "string" || data.key.length > 32) return null;
  const key = {
    key: data.key,
    metaKey: data.metaKey === true,
    ctrlKey: data.ctrlKey === true,
    altKey: data.altKey === true,
    shiftKey: data.shiftKey === true,
  };
  return key.key === "Escape" || key.metaKey || key.ctrlKey || key.altKey || SLIDE_KEYS.has(key.key) ? key : null;
}

export function previewExternalUrlFromMessage(event: MessageEvent, frame: Window): string | null {
  const data = previewMessage(event, frame, "pirep-external-link");
  return data ? safeHttpsUrl(data.url) : null;
}

export function previewLocationFromMessage(event: MessageEvent, frame: Window): string | null {
  const data = previewMessage(event, frame, "pirep-preview-location");
  if (!data || typeof data.href !== "string" || data.href.length > 8192) return null;
  try {
    const url = new URL(data.href);
    return url.protocol === "pirepfile:" && url.hostname === "localhost" && !url.port && !url.username && !url.password
      ? url.href
      : null;
  } catch { return null; }
}

export function previewPageChanged(current: string, original: string): boolean {
  try {
    const a = new URL(current), b = new URL(original);
    if ([a, b].some((url) => url.protocol !== "pirepfile:" || url.hostname !== "localhost")) return false;
    a.hash = "";
    b.hash = "";
    return a.href !== b.href;
  } catch { return false; }
}

export function previewNavigationAction(key: PreviewKey): "back" | "forward" | null {
  if (!key.metaKey || key.ctrlKey || key.altKey || key.shiftKey) return null;
  return key.key === "[" ? "back" : key.key === "]" ? "forward" : null;
}
