import {Editor, MarkdownView, Notice, Platform, Plugin} from 'obsidian';
import {MarginaliaSettings, MarginaliaSettingTab, normalizeSettings, resolveStorageBasePath} from "./settings";
import {CommentStore} from "./storage/CommentStore";
import {VaultEventHandler} from "./events/VaultEventHandler";
import {resolveAnchor, findHeadingContext, extractContext} from "./anchoring/TextQuoteSelector";
import {CommentPopover} from "./editor/PopoverExtension";
import {createCommentGutter, updateCommentPositions} from "./editor/GutterExtension";
import {ReadingGutter} from "./editor/ReadingGutter";
import {CommentPanelView, VIEW_TYPE_COMMENT_PANEL} from "./views/CommentPanelView";
import {CommentModal} from "./views/CommentModal";
import {MobileCommentSheet} from "./views/MobileCommentSheet";
import type {CommentData, CommentTarget, ResolvedAnchor} from "./types";
import {getRootResolution, isRootComment} from "./types";
import {findNavigationTarget} from "./comment/navigation";
import type {Extension} from "@codemirror/state";
import {formatIndexRepairResult, t} from './i18n';

export default class MarginaliaPlugin extends Plugin {
	settings: MarginaliaSettings;
	store: CommentStore;
	private popover: CommentPopover;
	private mobileSheet: MobileCommentSheet | null = null;
	private gutterExtension: Extension;
	private readingGutter: ReadingGutter;
	private resolveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private cachedAnchors: Map<string, ResolvedAnchor> = new Map();
	private cachedComments: CommentData[] = [];
	private cachedFilePath: string | null = null;

	getCachedAnchors(): Map<string, ResolvedAnchor> {
		return this.cachedAnchors;
	}

	getCachedComments(): CommentData[] {
		return this.cachedComments;
	}

	getCachedFilePath(): string | null {
		return this.cachedFilePath;
	}

	async onload() {
		await this.loadSettings();

		const basePath = resolveStorageBasePath(this.settings, this.manifest.dir);
		this.store = new CommentStore(this.app.vault, basePath);
		this.store.setAnchorResolver(resolveAnchor);
		const indexLoadResult = await this.store.initialize();
		if (indexLoadResult.status === 'rebuilt' && indexLoadResult.repair) {
			new Notice(t('noticeIndexRebuilt', {details: formatIndexRepairResult(indexLoadResult.repair)}));
		}

		this.popover = new CommentPopover(this);

		new VaultEventHandler(this, this.store).registerEvents();

		// Register side panel view
		this.registerView(VIEW_TYPE_COMMENT_PANEL, (leaf) => new CommentPanelView(leaf, this));

		// Register CM6 gutter extension
		this.gutterExtension = createCommentGutter(this);
		this.registerEditorExtension(this.gutterExtension);

		// Register Reading View gutter
		this.readingGutter = new ReadingGutter(this);
		this.registerMarkdownPostProcessor((el, ctx) => {
			this.readingGutter.processSection(el, ctx);
		});

		// Commands
		this.addCommand({
			id: 'add-comment',
			name: t('commandAddComment'),
			editorCheckCallback: (checking, editor, view) => {
				const hasSelection = editor.somethingSelected();
				if (checking) return hasSelection;
				if (hasSelection && view instanceof MarkdownView && view.file) {
					this.addCommentFromSelection(editor, view);
				}
				return true;
			},
		});

		this.addCommand({
			id: 'open-comment-panel',
			name: t('commandOpenPanel'),
			callback: () => {
				void this.activatePanel();
			},
		});

		this.addCommand({
			id: 'next-comment',
			name: t('commandNextComment'),
			editorCallback: (editor, view) => {
				if (view.file) {
					void this.navigateComment(editor, view.file.path, 'next');
				}
			},
		});

		this.addCommand({
			id: 'prev-comment',
			name: t('commandPreviousComment'),
			editorCallback: (editor, view) => {
				if (view.file) {
					void this.navigateComment(editor, view.file.path, 'prev');
				}
			},
		});

		this.addCommand({
			id: 'add-note-comment',
			name: t('commandAddNoteComment'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (checking) return true;
				this.addNoteComment(file.path);
				return true;
			},
		});

		// Context menu
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (editor.somethingSelected() && view.file) {
					menu.addItem((item) => {
						item.setTitle(t('menuAddComment'))
							.setIcon('message-square')
							.onClick(() => {
								this.addCommentFromSelection(editor, view as MarkdownView);
							});
					});
				}
				if (view.file) {
					menu.addItem((item) => {
						item.setTitle(t('menuAddNoteComment'))
							.setIcon('sticky-note')
							.onClick(() => {
								this.addNoteComment(view.file!.path);
							});
					});
				}
			})
		);

		// Ribbon icon
		this.addRibbonIcon('message-square', t('commandOpenPanel'), () => {
			void this.activatePanel();
		});

		// Settings tab
		this.addSettingTab(new MarginaliaSettingTab(this.app, this));

		// Debounced anchor re-resolve on document change
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file.path.endsWith('.md')) {
					this.scheduleResolve(file.path);
				}
			})
		);

		// Update gutter on active leaf change
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				void this.updateGutterForActiveFile();
			})
		);

		// Update gutter on mode switch (source / preview)
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				void this.updateGutterForActiveFile();
			})
		);
	}

	onunload() {
		this.popover?.destroy();
		if (this.resolveDebounceTimer) clearTimeout(this.resolveDebounceTimer);
		void this.store?.flushAll();
	}

	refreshPanel(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof CommentPanelView) {
				void view.refresh();
			}
		}

		if (this.mobileSheet) {
			void this.mobileSheet.refresh();
		}
	}

	updateGutterEffects(): void {
		void this.updateGutterForActiveFile();
	}

	scrollPanelToComment(commentId: string): void {
		if (this.isMobile()) {
			this.openMobileSheet([commentId]);
			return;
		}

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof CommentPanelView) {
				view.scrollToComment(commentId);
				return;
			}
		}
		// If panel not open, open it then scroll
		void this.activatePanel().then(() => {
			const newLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
			for (const leaf of newLeaves) {
				const view = leaf.view;
				if (view instanceof CommentPanelView) {
					// Delay to let panel render
					setTimeout(() => view.scrollToComment(commentId), 200);
					return;
				}
			}
		});
	}

	showPopover(anchor: HTMLElement, commentIds: string[]): void {
		if (!this.isMobile() && this.settings.showGutterIcons) {
			void this.popover?.show(anchor, commentIds);
		}
	}

	hidePopover(): void {
		if (!this.isMobile()) {
			this.popover?.scheduleHide();
		}
	}

	isMobile(): boolean {
		return Platform.isMobile;
	}

	openCommentsForIds(commentIds: string[]): void {
		if (this.isMobile()) {
			this.openMobileSheet(commentIds);
			return;
		}

		const firstId = commentIds[0];
		if (firstId) {
			this.scrollPanelToComment(firstId);
		}
	}

	async loadSettings() {
		this.settings = normalizeSettings(
			await this.loadData() as Partial<MarginaliaSettings> & {storageLocation?: string},
			this.manifest.dir,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async openCommentPreviewInBrowser(): Promise<void> {
		if (!Platform.isDesktopApp) {
			new Notice(t('noticePreviewDesktopOnly'));
			return;
		}

		try {
			const {BrowserCommentPreview} = await import('./preview/BrowserCommentPreview');
			const previewRootPath = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
			await new BrowserCommentPreview(this.app, this.store, previewRootPath).open();
		} catch (error) {
			new Notice(t('noticePreviewFailed', {error: error instanceof Error ? error.message : String(error)}));
		}
	}

	async repairCommentIndex(): Promise<void> {
		try {
			const result = await this.store.repairIndex();
			new Notice(t('noticeIndexRepaired', {details: formatIndexRepairResult(result)}));
			this.refreshPanel();
			this.updateGutterEffects();
		} catch (error) {
			new Notice(t('noticeIndexRepairFailed', {error: error instanceof Error ? error.message : String(error)}));
		}
	}

	private addCommentFromSelection(editor: Editor, view: MarkdownView): void {
		const selectedText = editor.getSelection();
		if (!selectedText || !view.file) return;

		const cursor = editor.getCursor('from');
		const docText = editor.getValue();
		const offset = editor.posToOffset(cursor);

		const target: CommentTarget = {
			exact: selectedText,
			prefix: extractContext(docText, offset - 50, 50),
			suffix: extractContext(docText, offset + selectedText.length, 50),
			headingContext: findHeadingContext(docText, offset) ?? undefined,
			lineHint: cursor.line,
		};

		const filePath = view.file.path;

		if (this.isMobile()) {
			this.openMobileSheet(null, {composeTarget: target, filePath});
			return;
		}

		new CommentModal(this.app, (body) => {
			void this.store.addComment(filePath, body, target).then(() => {
				void this.updateGutterForActiveFile();
				this.refreshPanel();
			});
		}).open();
	}

	private addNoteComment(filePath: string): void {
		if (this.isMobile()) {
			this.openMobileSheet(null, {composeNote: true, filePath});
			return;
		}

		new CommentModal(this.app, (body) => {
			void this.store.addNoteComment(filePath, body).then(() => {
				this.refreshPanel();
			});
		}, undefined, t('modalAddNoteComment')).open();
	}

	private async activatePanel(): Promise<void> {
		if (this.isMobile()) {
			this.openMobileSheet(null);
			return;
		}

		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT_PANEL);
		if (existing.length > 0) {
			void this.app.workspace.revealLeaf(existing[0]!);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({type: VIEW_TYPE_COMMENT_PANEL, active: true});
			void this.app.workspace.revealLeaf(leaf);
		}
	}

	private openMobileSheet(commentIds: string[] | null, options?: {composeNote?: boolean; composeTarget?: CommentTarget; filePath?: string}): void {
		if (!this.mobileSheet) {
			this.mobileSheet = new MobileCommentSheet(this);
		}

		this.mobileSheet.setVisibleCommentIds(commentIds);
		this.mobileSheet.setTargetFilePath(options?.filePath ?? this.getActiveMarkdownFilePath());
		if (options?.composeTarget) {
			this.mobileSheet.prepareForAnchoredComposer(options.composeTarget);
		} else if (options?.composeNote) {
			this.mobileSheet.prepareForNoteComposer();
		}
		if (this.mobileSheet.isSheetOpen) {
			void this.mobileSheet.refresh();
			return;
		}
		this.mobileSheet.open();
	}

	private getActiveMarkdownFilePath(): string | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile?.extension === 'md') {
			return activeFile.path;
		}

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView?.file?.extension === 'md') {
			return mdView.file.path;
		}

		return this.cachedFilePath;
	}
	private async navigateComment(editor: Editor, filePath: string, direction: 'next' | 'prev'): Promise<void> {
		const docText = editor.getValue();
		const anchors = await this.store.resolveAnchors(filePath, docText, this.settings.fuzzyMatchThreshold);
		const currentOffset = editor.posToOffset(editor.getCursor());

		const target = findNavigationTarget(anchors, currentOffset, direction);
		if (target) {
			const pos = editor.offsetToPos(target.from);
			editor.setCursor(pos);
			editor.scrollIntoView(
				{from: pos, to: editor.offsetToPos(target.to)},
				true
			);
		}
	}

	private scheduleResolve(filePath: string): void {
		if (this.resolveDebounceTimer) clearTimeout(this.resolveDebounceTimer);
		this.resolveDebounceTimer = setTimeout(() => {
			this.resolveDebounceTimer = null;
			void this.resolveAndUpdate(filePath);
		}, 400);
	}

	private async resolveAndUpdate(filePath: string): Promise<void> {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.path !== filePath) return;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const docText = mdView.getMode() === 'source'
			? mdView.editor.getValue()
			: await this.app.vault.read(activeFile);
		const anchors = await this.store.resolveAnchors(filePath, docText, this.settings.fuzzyMatchThreshold);
		const comments = await this.store.getComments(filePath);

		this.cachedAnchors = anchors;
		this.cachedComments = comments;
		this.cachedFilePath = filePath;

		if (mdView.getMode() === 'preview') {
			this.readingGutter.refreshActiveView();
		} else {
			this.dispatchGutterUpdate(anchors, comments);
		}
		this.refreshPanel();
	}

	private async updateGutterForActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || !file.path.endsWith('.md')) return;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const docText = mdView.getMode() === 'source'
			? mdView.editor.getValue()
			: await this.app.vault.read(file);
		const anchors = await this.store.resolveAnchors(file.path, docText, this.settings.fuzzyMatchThreshold);
		const comments = await this.store.getComments(file.path);

		this.cachedAnchors = anchors;
		this.cachedComments = comments;
		this.cachedFilePath = file.path;

		if (mdView.getMode() === 'preview') {
			this.readingGutter.refreshActiveView();
		} else {
			this.dispatchGutterUpdate(anchors, comments);
		}
	}

	private dispatchGutterUpdate(anchors: Map<string, ResolvedAnchor>, comments: CommentData[]): void {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		// Access CM6 EditorView through Obsidian's editor
		const editorObj: Record<string, unknown> = mdView.editor as unknown as Record<string, unknown>;
		const cmEditor = editorObj['cm'] as {dispatch: (spec: {effects: unknown}) => void} | undefined;
		if (!cmEditor) return;

		// Build a map of commentId to resolution for root comments
		const resolutionMap = new Map<string, 'open' | 'resolved'>();
		for (const c of comments) {
			if (isRootComment(c)) {
				resolutionMap.set(c.id, getRootResolution(c));
			}
		}

		const infos = [...anchors.entries()].map(([commentId, anchor]) => ({
			line: anchor.line,
			commentId,
			count: 1,
			allResolved: resolutionMap.get(commentId) === 'resolved',
		}));

		cmEditor.dispatch({
			effects: updateCommentPositions.of(infos),
		});
	}
}
