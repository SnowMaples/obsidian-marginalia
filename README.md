# Marginalia

Non-destructive margin comments and annotations for [Obsidian](https://obsidian.md).

![Obsidian minimum version](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-blueviolet)
![License](https://img.shields.io/badge/License-0--BSD-green)
<!-- ![Downloads](https://img.shields.io/github/downloads/YOUR_GITHUB_USER/obsidian-marginalia/total) -->

![Screenshot](assets/screenshot-overview.png)

## Features

- **Non-destructive annotations** - Comments are stored as external sidecar JSON files. Your original `.md` files are never modified.
- **Anchored comments** - Select text and attach a comment to it. Anchors survive edits through text quote matching.
- **Note-level comments** - Add comments to an entire note without selecting specific text.
- **Threaded replies** - Reply to anchored comments to keep a lightweight discussion thread.
- **Resolve / unresolve** - Mark comments as resolved and reopen them when needed.
- **Editor gutter icons** - Commented lines are marked with icons in source/live preview mode.
- **Desktop comment panel** - Desktop keeps a dedicated sidebar panel with filters for All, Open, Resolved, Active, and Orphaned comments.
- **Mobile card surface** - Obsidian Mobile uses a touch-friendly card surface instead of the desktop sidebar.
- **Jump from quote to source** - On mobile, tap the quoted source text in a comment card to close the card surface and jump to the original text.
- **Mobile-safe editing** - Mobile add/edit/reply uses a top `Cancel` / `Done` editor so the keyboard does not hide the save action.
- **Markdown in comments** - Comment bodies support Markdown formatting, including `[[wikilinks]]`.
- **Custom data path** - Store comment data in the plugin folder, `.marginalia`, or any valid Vault-relative folder.

## Demo

![Adding a comment](assets/demo.gif)

## Installation

### Community plugins

1. Open **Settings -> Community plugins -> Browse**.
2. Search for **Marginalia**.
3. Select **Install**, then **Enable**.

<!-- Community plugin listing may be pending. Use manual installation if Marginalia is not listed yet. -->

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release.
2. Create `VaultFolder/.obsidian/plugins/marginalia/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Marginalia** in **Settings -> Community plugins**.

## Usage

### Add an anchored comment

1. Select text in the editor.
2. Run **Add comment to selection** from the Command Palette, or use the editor context menu.
3. Type your comment and save it.

The selected text becomes the anchor. Marginalia stores the comment externally and leaves the Markdown file unchanged.

### Add a note comment

Run **Add note comment** from the Command Palette, or use the add button in the comment UI. Note comments are attached to the current file, not to a selected text range.

### View comments on desktop

Open the comment panel with **Open comment panel** or select the Marginalia ribbon icon. The desktop panel lists comments for the active note.

Use the filter menu to switch between views:

| Filter | Shows |
| --- | --- |
| All | Every comment |
| Open | Unresolved comments |
| Resolved | Resolved comments |
| Active | Comments anchored to text that can still be found |
| Orphaned | Comments whose anchor text can no longer be found |

Desktop also supports hover previews on gutter icons when gutter icons are enabled.

### View comments on mobile

Marginalia uses a mobile-specific card surface on phones and tablets.

- Tap a paragraph comment icon to open the comments for that location.
- Open **Open comment panel** from the ribbon or command palette to show the current file's comment cards.
- Tap a card body to show or hide the action bar.
- Tap the quoted source text in an anchored comment card to close the card surface and jump to the original text.
- Use the action bar to resolve, unresolve, edit, reply, or delete.
- Use the top `Cancel` / `Done` editor for mobile add, edit, and reply actions.

Replies are summarized by count in the mobile card surface. The desktop panel still shows expanded reply threads.

### Resolve, reply, edit, and delete

- Select the check icon to resolve or unresolve a root comment.
- Select the reply icon to add a reply to an anchored comment.
- Select the edit icon to update a comment body.
- Select the delete icon to remove a comment. Deleting an anchored comment also removes its replies.

### Navigate between comments

Use **Go to next comment** and **Go to previous comment** to move between anchored comment positions in the editor.

## Commands

| Command | Description |
| --- | --- |
| Add comment to selection | Attach a comment to the selected text |
| Add note comment | Add a comment to the current note |
| Open comment panel | Open the desktop panel or the mobile card surface |
| Go to next comment | Move the cursor to the next anchored comment |
| Go to previous comment | Move the cursor to the previous anchored comment |

## Settings

| Setting | Options | Default | Description |
| --- | --- | --- | --- |
| Storage location | Plugin folder / Vault root / Custom path | Plugin folder | Where comment JSON files are stored. |
| Custom storage path | Any valid Vault-relative folder | `.marginalia` | Used when storage location is set to Custom path. |
| Comment sort order | Position in file / Creation date | Position in file | How comments are ordered in the panel and card surface. |
| Show gutter icons | On / Off | On | Display comment indicators in the editor and reading view. |
| Fuzzy match threshold | 0.1 - 0.5 | 0.3 | Maximum edit distance ratio for fuzzy anchor matching. Lower is stricter. |
| Orphaned comment handling | Keep / Delete automatically | Keep | What happens when a comment's target text can no longer be found. |

Use the migrate button next to the storage setting to move existing comment files to the selected location.

## How Comments Are Stored

Marginalia never writes comments into your Markdown files. Comment data is stored in JSON sidecar files inside the Vault.

Supported storage locations:

- **Plugin folder**: `VaultFolder/.obsidian/plugins/marginalia/comments/`
- **Vault root preset**: `VaultFolder/.marginalia/`
- **Custom path**: any valid Vault-relative folder, such as `read-logs/`

The storage folder contains:

- `_index.json`: maps Vault-relative Markdown paths to comment JSON files.
- One JSON file per commented note: stores `sourceFile` and the `comments` array.

Vault rename and delete events are tracked so mappings stay in sync. If you change the storage location, use the migrate button in settings before relying on the new path.

## Mobile Notes

Mobile support is designed around touch interaction instead of desktop hover behavior.

- Hover popovers are desktop-only.
- Mobile does not require the right sidebar.
- Mobile quote blocks are navigation targets.
- Mobile editor actions keep save controls at the top to avoid keyboard overlap.

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

Check encoding only:

```bash
npm run check:encoding
```

Release assets are:

- `main.js`
- `manifest.json`
- `styles.css`

## License

[0-BSD](LICENSE)
