# pirep

A macOS app that reads a folder of Markdown files — and tells you when something else changed them.

![The pirep reader](docs/screenshot-reader.png)

## The problem it solves

You keep your notes as Markdown files in a folder. Lately you are not the only one writing to them: an AI tool rewrites a section, a script appends a log, a sync folder pulls in someone else's edit. Open a file a week later and you cannot tell what is new.

pirep watches one folder for you and answers that question.

- It renders your documents properly — tables, code, maths, diagrams, checklists.
- Every time a file changes outside the app, it keeps that version.
- It shows you a **word-level diff** between the version you last read and the file as it is now.
- You mark it read, or roll the file back to an earlier version.

No server, no account, no cloud. The files stay in your folder; pirep only reads them.

## What's in it

| | |
|---|---|
| Reading | Tables, syntax highlighting, KaTeX maths, Mermaid diagrams, task lists, callouts, wiki links |
| Change tracking | Watches the folder, keeps a version per outside change, lists what moved |
| Diff | Word-level. Several changes at once, or one step at a time |
| Rollback | Write an older version back to the file |
| Editing | `⌘E` opens the source; it saves itself 1.2 seconds after you stop typing |
| Other files | PDFs, images, CSV, HTML and code files. HTML slides and PDFs go full screen for presenting |
| Finding | `⌘K` for documents and commands, `⌘F` inside the open document |

![Word-level diff of a changed document](docs/screenshot-changes.png)

## Using it

1. Open the app and **pick a folder**. pirep calls it your *Base*.
2. Pick a document in the sidebar and read it.
3. When a file changes outside the app it appears under **Changes**. Open it to see what moved, then mark it read or roll it back.
4. Press `⌘E` if you want to edit.

## Install

```sh
curl -fsSL https://pirep.garamnoh.workers.dev/install.sh | sh
```

This installs the latest release in `/Applications`. It requires macOS on Apple silicon and does not use `sudo`.

### dmg

1. Download the dmg from the [latest release](https://github.com/garamnohhh/pirep/releases/latest).
2. Open the dmg.
3. Drag **pirep** onto the **Applications** folder next to it.
4. Open pirep from Applications.

#### "pirep can't be opened" on first launch

The app is not signed with a paid Apple certificate, so macOS blocks it once. Nothing is wrong with the app.

1. Dismiss the warning.
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the line saying pirep was blocked because it is from an unidentified developer, and press **Open Anyway**.
4. Confirm with **Open**.

That is a one-time step. After that it launches normally.

If macOS says the app is damaged, remove only its quarantine flag with `xattr -dr com.apple.quarantine /Applications/pirep.app`, then open it again.

### Before you download

- **Apple Silicon only** (M1 and later). It will not run on an Intel Mac.
- Built on macOS 26, and still fine on 27.
- `0.1.0` is the first release under the name pirep. It is built from the current source, so it carries every fix made so far.

## Building from source

You need [Node.js](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) and the Xcode Command Line Tools.

```bash
pnpm install
pnpm tauri dev     # run in development
pnpm tauri build   # produce the .app and .dmg
```

## Where your files and data live

- **Your documents**: exactly where they were. pirep never moves them out of your folder.
- **Version history**: in a `.pirep/` folder inside your Base — one copy per version, plus the change log. Delete that folder and the history goes with it.
- **App settings**: in the app's own storage under `~/Library/WebKit/com.garamnoh.pirep`.
- **What leaves your machine**: no document content, ever. The app has no telemetry and no sync. The only outbound request it can make is looking up the latest GitHub release, and only if you press *Check for updates* in Settings — that check is not finished yet and currently fails.

To remove pirep, move the app to the Trash and, if you want, delete the `.pirep/` folder in your Base and the settings folder above.

## Built with

[Tauri 2](https://tauri.app) (Rust) + React 19 + TypeScript. Markdown by markdown-it, highlighting by Shiki, maths by KaTeX, diagrams by Mermaid.

## Licence

[Apache License 2.0](LICENSE). The fonts bundled with the app have their own licences, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
