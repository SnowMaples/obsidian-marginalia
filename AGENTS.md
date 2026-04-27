# Marginalia Agent Guide

This repository contains **Marginalia**, an Obsidian community plugin for non-destructive margin comments and annotations.

## Project Overview

- Platform: Obsidian desktop and Obsidian Mobile.
- Language: TypeScript, bundled to `main.js` with esbuild.
- Entry point: `src/main.ts`.
- Release assets: `main.js`, `manifest.json`, and `styles.css`.
- Current release line: `1.0.3`.

Marginalia stores comments in sidecar JSON files. It must never modify the user's Markdown files when adding, editing, resolving, or deleting comments.

## Development Commands

```bash
npm install
npm run dev
npm run check:encoding
npm run build
```

`npm run build` runs the UTF-8 encoding check, TypeScript validation, and the production bundle.

## Code Structure

- `src/main.ts`: plugin lifecycle, commands, ribbon entry, platform branching, and shared cache.
- `src/storage/`: comment file storage and `_index.json` path mapping.
- `src/anchoring/`: text quote anchor resolution.
- `src/comment/`: threading and navigation helpers.
- `src/editor/`: editor gutter and desktop popover integration.
- `src/views/`: desktop comment panel, comment modal, and mobile comment surface.
- `styles.css`: desktop and mobile styles.

Keep `main.ts` focused on orchestration. Put UI, storage, anchoring, and rendering logic in dedicated modules.

## Mobile Requirements

Mobile behavior is intentionally different from desktop behavior.

- Use `Platform.isMobile` or the existing plugin helper for mobile branching.
- Desktop keeps the sidebar panel, hover popover, and desktop modal behavior.
- Mobile uses the card surface in `MobileCommentSheet`, not the desktop `CommentThreadList` as the primary UI.
- Mobile card body tap selects the card and shows the action bar.
- Mobile quote tap jumps to the anchored source text and closes the comment surface.
- Mobile edit/add/reply uses the top `Cancel` / `Done` editor flow so iPhone keyboards do not hide the save action.
- Replies are summarized by count in the mobile card surface; do not expand reply bodies there unless the mobile design is explicitly revised.

Mobile CSS must be scoped under `.is-mobile` and the mobile component classes. Do not let mobile styles change desktop panel, popover, or modal layout.

## Storage Rules

- Comments are stored in Vault-relative sidecar JSON files.
- Supported storage presets are plugin folder, Vault root `.marginalia`, and a custom Vault-relative path.
- `_index.json` maps Vault-relative Markdown paths to comment JSON file names.
- Comment files contain `sourceFile` and a `comments` array.
- Do not write outside the Vault.
- Do not edit Markdown note content to store comments.
- Path compatibility belongs in `PathIndex` / storage code, not in UI components.

When changing storage behavior, preserve existing data and keep migration explicit through the settings migrate action.

## Encoding Rules

All source and documentation files must be UTF-8. Prefer UTF-8 without BOM.

Before finishing changes that touch Chinese text or localized copy, run:

```bash
npm run check:encoding
npm run build
```

Avoid using shell commands that write files with a system-default legacy encoding. If a PowerShell write is necessary, explicitly write UTF-8.

## Release Rules

For a release:

1. Update `manifest.json` version.
2. Update `package.json` / `package-lock.json` version if needed.
3. Update `versions.json` so the plugin version maps to the minimum Obsidian version.
4. Run `npm run build`.
5. Create the release tag matching the manifest version exactly, without a leading `v`.
6. Attach these files as release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`

Do not publish a release without rebuilding `main.js` from the current source.

## Testing Checklist

Desktop:

- Add an anchored comment from selected text.
- Add a note-level comment.
- Open the comment panel from the ribbon and command palette.
- Hover gutter icons and verify the popover still works.
- Resolve, unresolve, reply, edit, and delete comments.
- Click a quote in the sidebar and verify editor navigation.

Mobile:

- Open comments from a paragraph icon.
- Open all comments from the ribbon or command palette.
- Tap a card to show the action bar.
- Tap the quote block to close the surface and jump to the original text.
- Add, edit, reply, resolve, unresolve, and delete using mobile controls.
- Test both phone bottom-drawer style and tablet side/large-screen layouts when possible.

Storage:

- Verify `_index.json` maps the active note path to the expected JSON file.
- Verify custom storage paths are Vault-relative and normalized.
- Verify migration moves data and comments still load afterward.

## Coding Conventions

- Use TypeScript with explicit types for public interfaces and data models.
- Prefer small, focused modules over expanding large files.
- Use Obsidian `register*` helpers for events and cleanup where applicable.
- Keep startup light; defer expensive work until a view or command needs it.
- Batch disk writes and avoid unnecessary Vault scans.
- Do not add network access or telemetry.

## Documentation Conventions

- Keep README user-facing and concise.
- Keep AGENTS.md maintainer-facing and explicit about constraints.
- Use UTF-8 characters normally, but avoid decorative symbols when ASCII is clearer.
- Release instructions must always mention `main.js`, `manifest.json`, and `styles.css`.
