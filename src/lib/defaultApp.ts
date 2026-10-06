export type MarkdownDefaultApp = { name: string | null; isSelf: boolean };

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForMarkdownDefault(
  read: () => Promise<MarkdownDefaultApp>,
  onUpdate: (app: MarkdownDefaultApp | null) => void,
  pause: (ms: number) => Promise<void> = delay,
): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await pause(500);
    let app: MarkdownDefaultApp | null = null;
    try {
      app = await read();
    } catch {
      // Keep polling: Launch Services may still be updating its handler database.
    }
    onUpdate(app);
    if (app?.isSelf) return true;
  }
  return false;
}
