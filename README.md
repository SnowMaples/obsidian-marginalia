# Obsidian Marginalia

A powerful annotation plugin for Obsidian with highlighting, sidebar view, and bidirectional navigation.

## Features

- **Annotation Creation**: Right-click on selected text (PC) or use the floating menu (mobile) to create annotations
- **Real-time Highlighting**: Annotations are immediately highlighted in the document
- **Floating Card View**: Double-click highlighted text to view and edit annotations
- **Right Sidebar Panel**: View all annotations for the current file in a dedicated sidebar
- **Bidirectional Navigation**: Jump between annotations in the document and annotation files
- **Auto-save**: Edit annotations directly in the floating card with automatic saving
- **Mobile Support**: Full mobile support with touch-friendly interface
- **Customizable**: Configure folder location, highlight color, and more

## Installation

1. Download the latest release
2. Extract to your vault's `.obsidian/plugins/` folder
3. Enable the plugin in Obsidian settings

## Usage

### Creating Annotations

**On PC:**
1. Select text in your document
2. Right-click and select "Add annotation"
3. Enter your annotation in the popup

**On Mobile:**
1. Select text in your document
2. Tap the "Annotate" button in the floating menu
3. Enter your annotation in the popup

### Viewing Annotations

- Double-click highlighted text to open the annotation card
- View all annotations in the right sidebar panel

### Editing Annotations

- Edit directly in the floating card
- Changes are automatically saved when you close the card

### Deleting Annotations

- Click the delete button in the floating card or sidebar card

### Navigation

- **Ctrl+Click** (or Cmd+Click on Mac) on highlighted text to jump to the annotation file
- Click the "Go to source" button in the sidebar to jump to the highlighted text

## Settings

- **Annotation folder**: Where annotation files are stored (default: `_annotations`)
- **Auto-show sidebar**: Automatically show sidebar for annotated files
- **Highlight color**: Customize the highlight color
- **Enable on mobile**: Toggle mobile support

## File Structure

Annotations are stored in a separate folder as Markdown files with the format:
`{original-filename}-annotation.md`

Each annotation includes:
- Unique ID
- Selected text
- Position information
- Creation and update timestamps
- Markdown content

## License

MIT
