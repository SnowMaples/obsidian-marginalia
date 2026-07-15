import {Component, MarkdownRenderer, MarkdownView, Modal, Notice, TFile, setIcon} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {CommentData, CommentTarget, ResolvedAnchor, RootComment} from '../types';
import {getRootResolution, isAnchoredComment, isReplyComment, isRootComment} from '../types';
import {filterPanelData, getPanelData} from '../comment/threading';
import {t} from '../i18n';

interface MobileSheetLayout {
	centerX: number;
	keyboardOffset: number;
	left: number;
	maxHeight: number;
	topLimit: number;
	viewportHeight: number;
	width: number;
}

const TABLET_SHEET_MIN_WIDTH = 768;
const TABLET_SHEET_MAX_WIDTH = 860;

interface MobileRootCard {
	root: RootComment;
	replyCount: number;
}

type EditorMode =
	| {kind: 'anchored'; target: CommentTarget}
	| {kind: 'edit'; commentId: string}
	| {kind: 'note'}
	| {kind: 'reply'; parentId: string}
	| null;

export class MobileCommentSheet extends Modal {
	private plugin: MarginaliaPlugin;
	private currentFile: TFile | null = null;
	private targetFilePath: string | null = null;
	private comments: CommentData[] = [];
	private anchors: Map<string, ResolvedAnchor> = new Map();
	private visibleCommentIds: string[] | null = null;
	private mode: 'focused' | 'all' = 'all';
	private readonly resizeHandler: () => void;
	private defaultCloseButton: HTMLElement | null = null;
	private selectedCommentId: string | null = null;
	private editorMode: EditorMode = null;
	private editorDraft = '';
	private isSavingEditor = false;
	private pendingEditorFocus = false;
	private renderComponent = new Component();
	private visualViewport: VisualViewport | null = null;
	isSheetOpen = false;

	constructor(plugin: MarginaliaPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.resizeHandler = () => {
			this.updateLayout();
		};
	}

	setVisibleCommentIds(commentIds: string[] | null): void {
		this.visibleCommentIds = commentIds;
		this.mode = commentIds && commentIds.length > 0 ? 'focused' : 'all';
	}

	setTargetFilePath(filePath: string | null): void {
		this.targetFilePath = filePath;
	}

	prepareForNoteComposer(): void {
		this.visibleCommentIds = null;
		this.mode = 'all';
		this.selectedCommentId = null;
		this.openEditor({kind: 'note'});
	}

	prepareForAnchoredComposer(target: CommentTarget): void {
		this.visibleCommentIds = null;
		this.mode = 'all';
		this.selectedCommentId = null;
		this.openEditor({kind: 'anchored', target});
	}

	onOpen(): void {
		this.renderComponent.load();
		this.isSheetOpen = true;
			this.modalEl.addClass('marginalia-mobile-sheet');
			this.modalEl.parentElement?.addClass('marginalia-mobile-sheet-backdrop');
			this.setDefaultCloseButtonVisible(false);
			this.bindViewportHandlers();
			void this.refresh();
	}

	onClose(): void {
		this.renderComponent.unload();
		this.renderComponent = new Component();
		this.isSheetOpen = false;
		this.resetInteractionState();
			this.visibleCommentIds = null;
			this.targetFilePath = null;
			this.teardownViewportHandlers();
			this.setDefaultCloseButtonVisible(true);
			this.clearLayout();
			this.contentEl.empty();
		this.modalEl.removeClass('marginalia-mobile-sheet');
		this.modalEl.parentElement?.removeClass('marginalia-mobile-sheet-backdrop');
	}

	async refresh(): Promise<void> {
		if (!this.isSheetOpen) return;

		const file = this.getTargetFile();
		if (!file || file.extension !== 'md') {
			this.currentFile = null;
			this.comments = [];
			this.anchors = new Map();
			this.resetInteractionState();
			this.updateLayout();
			this.render();
			return;
		}

		this.currentFile = file;
		this.comments = await this.plugin.store.getComments(file.path);
		const content = await this.plugin.app.vault.read(file);
		this.anchors = await this.plugin.store.resolveAnchors(
			file.path,
			content,
			this.plugin.settings.fuzzyMatchThreshold
		);
		this.updateLayout();
		this.syncSelectionState();
		this.render();
	}

	private getTargetFile(): TFile | null {
		if (this.targetFilePath) {
			const file = this.plugin.app.vault.getAbstractFileByPath(this.targetFilePath);
			if (file instanceof TFile && file.extension === 'md') {
				return file;
			}
		}

		const activeFile = this.plugin.app.workspace.getActiveFile();
		if (activeFile?.extension === 'md') {
			return activeFile;
		}

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView?.file?.extension === 'md') {
			return mdView.file;
		}

		const cachedPath = this.plugin.getCachedFilePath();
		if (cachedPath) {
			const cachedFile = this.plugin.app.vault.getAbstractFileByPath(cachedPath);
			if (cachedFile instanceof TFile && cachedFile.extension === 'md') {
				return cachedFile;
			}
		}

		return null;
	}
	private render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('marginalia-mobile-sheet-content');

		const header = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-header'});
		header.createDiv({cls: 'marginalia-mobile-sheet-handle'});

		if (this.editorMode) {
			this.renderEditor();
			return;
		}

		const titleRow = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-title-row'});
		const titleWrap = titleRow.createDiv({cls: 'marginalia-mobile-sheet-title-wrap'});
		titleWrap.createEl('h3', {
			text: this.mode === 'focused' ? t('mobileTitleComment') : t('mobileTitleComments'),
			cls: 'marginalia-mobile-sheet-title',
		});
		if (this.currentFile) {
			titleWrap.createDiv({
				text: this.currentFile.basename,
				cls: 'marginalia-mobile-sheet-subtitle',
			});
		}

		const headerActions = titleRow.createDiv({cls: 'marginalia-mobile-sheet-header-actions'});
		if (this.mode === 'all') {
			const addBtn = headerActions.createEl('button', {
				cls: 'marginalia-mobile-sheet-add clickable-icon',
				attr: {'aria-label': t('actionAddNote')},
			});
			setIcon(addBtn, 'plus');
			addBtn.addEventListener('click', (evt) => {
				evt.stopPropagation();
				this.openEditor({kind: 'note'});
			});
		}

		const body = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-body'});
		body.addEventListener('click', (evt) => {
			if (evt.target === body && this.selectedCommentId) {
				this.selectedCommentId = null;
				this.render();
			}
		});

		const cards = this.getVisibleCards();
		if (cards.length === 0) {
			body.createEl('div', {
					text: this.mode === 'focused' ? t('mobileNoFocusedComment') : t('panelNoComments'),
				cls: 'marginalia-empty',
			});
			this.renderFloatingClose();
			return;
		}

		for (const card of cards) {
			this.renderCard(body, card);
		}

		this.renderFloatingClose();
	}

	private renderCard(container: HTMLElement, card: MobileRootCard): void {
		const isSelected = this.selectedCommentId === card.root.id;
		const resolved = getRootResolution(card.root) === 'resolved';
		const orphaned = isAnchoredComment(card.root) && card.root.status === 'orphaned';

		const wrap = container.createDiv({
			cls: `marginalia-mobile-card-wrap${isSelected ? ' is-selected' : ''}`,
			attr: {'data-root-id': card.root.id},
		});

		const cardEl = wrap.createDiv({
			cls: [
				'marginalia-mobile-card',
				resolved ? 'is-resolved' : '',
				orphaned ? 'is-orphaned' : '',
			].filter(Boolean).join(' '),
		});
		cardEl.addEventListener('click', (evt) => {
			if (this.isSavingEditor) return;
			const target = evt.target as HTMLElement | null;
			if (target?.closest('button, a')) return;
			this.selectedCommentId = this.selectedCommentId === card.root.id ? null : card.root.id;
			this.render();
		});

		const meta = cardEl.createDiv({cls: 'marginalia-mobile-card-meta'});
		const typeBadge = meta.createSpan({
			text: isAnchoredComment(card.root) ? t('labelLinkedComment') : t('labelNote'),
			cls: 'marginalia-mobile-card-badge',
		});
		if (resolved) typeBadge.addClass('is-resolved');
		if (orphaned) meta.createSpan({text: t('filterOrphaned'), cls: 'marginalia-mobile-card-badge is-warning'});
		if (card.replyCount > 0) {
			meta.createSpan({
					text: t('labelReplyCount', {count: card.replyCount}),
				cls: 'marginalia-mobile-card-badge',
			});
		}

		if (isAnchoredComment(card.root)) {
			const quoteEl = cardEl.createEl('blockquote', {
				text: card.root.target.exact.length > 120 ? `${card.root.target.exact.slice(0, 120)}...` : card.root.target.exact,
				cls: 'marginalia-mobile-card-quote',
					attr: {'aria-label': t('mobileJumpToSource')},
			});
			quoteEl.addEventListener('click', (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				void this.navigateToSource(card.root);
			});
		}

		const bodyEl = cardEl.createDiv({cls: 'marginalia-mobile-card-body'});
		void MarkdownRenderer.render(
			this.app,
			card.root.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this.renderComponent,
		);

		cardEl.createDiv({
			text: new Date(card.root.createdAt).toLocaleString(),
			cls: 'marginalia-mobile-card-time',
		});

		if (isSelected) {
			this.renderActionBar(wrap, card);
		}
	}

	private renderActionBar(container: HTMLElement, card: MobileRootCard): void {
		const actionBar = container.createDiv({cls: 'marginalia-mobile-actionbar'});
		this.renderActionButton(actionBar, getRootResolution(card.root) === 'resolved' ? 'circle' : 'check-circle', getRootResolution(card.root) === 'resolved' ? t('actionUnresolve') : t('actionResolve'), () => {
			void this.toggleResolution(card.root);
		});
		this.renderActionButton(actionBar, 'edit', t('actionEditComment'), () => {
			this.openEditor({kind: 'edit', commentId: card.root.id}, card.root.body);
		});
		if (isAnchoredComment(card.root)) {
			this.renderActionButton(actionBar, 'corner-down-left', t('previewReplies'), () => {
				this.openEditor({kind: 'reply', parentId: card.root.id});
			});
		}
		this.renderActionButton(actionBar, 'trash-2', t('actionDeleteComment'), () => {
			void this.deleteComment(card.root);
		});
	}

	private renderActionButton(container: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const button = container.createEl('button', {
			cls: 'marginalia-mobile-action clickable-icon',
			attr: {'aria-label': label},
		});
		setIcon(button, icon);
		button.createSpan({text: label});
		button.addEventListener('click', (evt) => {
			evt.stopPropagation();
			onClick();
		});
	}

	private renderFloatingClose(): void {
		const closeBtn = this.contentEl.createEl('button', {
			cls: 'marginalia-mobile-floating-close clickable-icon',
			attr: {'aria-label': t('mobileClose')},
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());
	}

	private renderEditor(): void {
		const editor = this.contentEl.createDiv({cls: 'marginalia-mobile-editor'});
		const toolbar = editor.createDiv({cls: 'marginalia-mobile-editor-toolbar'});
		const cancelBtn = toolbar.createEl('button', {
			text: t('modalCancel'),
			cls: 'marginalia-mobile-editor-cancel',
		});
		cancelBtn.addEventListener('click', () => this.cancelEditor());

		toolbar.createDiv({
			text: this.getEditorTitle(),
			cls: 'marginalia-mobile-editor-title',
		});

		const doneBtn = toolbar.createEl('button', {
			text: this.isSavingEditor ? t('statusSaving') : t('modalDone'),
			cls: 'marginalia-mobile-editor-done mod-cta',
		});
		doneBtn.disabled = this.isSavingEditor;
		doneBtn.addEventListener('click', () => {
			void this.commitEditor();
		});

		const textarea = editor.createEl('textarea', {
			cls: 'marginalia-mobile-editor-textarea',
			attr: {
				placeholder: t('modalPlaceholder'),
				'aria-label': this.getEditorTitle(),
			},
		});
		textarea.value = this.editorDraft;
		textarea.disabled = this.isSavingEditor;
		textarea.addEventListener('input', () => {
			this.editorDraft = textarea.value;
		});
		textarea.addEventListener('keydown', (evt) => {
			if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
				evt.preventDefault();
				void this.commitEditor();
			}
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.cancelEditor();
			}
		});

		if (this.pendingEditorFocus) {
			this.pendingEditorFocus = false;
			window.requestAnimationFrame(() => {
				textarea.focus();
				const end = textarea.value.length;
				textarea.setSelectionRange(end, end);
			});
		}
	}

	private getEditorTitle(): string {
		if (!this.editorMode) return t('mobileTitleComment');
		switch (this.editorMode.kind) {
			case 'anchored':
				return t('modalAddComment');
			case 'edit':
				return t('modalEditComment');
			case 'note':
				return t('modalAddNoteComment');
			case 'reply':
				return t('modalAddReply');
		}
	}

	private openEditor(mode: Exclude<EditorMode, null>, initialBody = ''): void {
		if (this.isSavingEditor) return;
		this.editorMode = mode;
		this.editorDraft = initialBody;
		this.pendingEditorFocus = true;
		this.render();
	}

	private cancelEditor(): void {
		if (this.isSavingEditor) return;
		this.editorMode = null;
		this.editorDraft = '';
		this.pendingEditorFocus = false;
		this.render();
	}

	private async commitEditor(): Promise<void> {
		if (!this.currentFile || !this.editorMode || this.isSavingEditor) return;

		const body = this.editorDraft.trim();
		if (!body) {
			new Notice(t('mobileEmptyComment'));
			this.pendingEditorFocus = true;
			this.render();
			return;
		}

		const mode = this.editorMode;
		if (mode.kind === 'edit') {
			const existing = this.comments.find((comment) => comment.id === mode.commentId);
			if (!existing) {
				new Notice(t('mobileCommentNotFound'));
				this.cancelEditor();
				return;
			}
			if (existing.body.trim() === body) {
				this.cancelEditor();
				return;
			}
		}

		this.isSavingEditor = true;
		this.render();
		try {
			if (mode.kind === 'anchored') {
				await this.plugin.store.addComment(this.currentFile.path, body, mode.target);
				this.plugin.updateGutterEffects();
			} else if (mode.kind === 'edit') {
				await this.plugin.store.updateComment(this.currentFile.path, mode.commentId, body);
			} else if (mode.kind === 'note') {
				await this.plugin.store.addNoteComment(this.currentFile.path, body);
			} else if (mode.kind === 'reply') {
				await this.plugin.store.addReply(this.currentFile.path, mode.parentId, body);
			}

			this.editorMode = null;
			this.editorDraft = '';
			this.isSavingEditor = false;
			this.pendingEditorFocus = false;
			this.notifyChanged();
		} catch (error) {
			this.isSavingEditor = false;
			this.pendingEditorFocus = true;
			new Notice(t('noticeSaveFailed', {error: error instanceof Error ? error.message : String(error)}));
			this.render();
		}
	}

	private getVisibleCards(): MobileRootCard[] {
		const panelData = filterPanelData(
			getPanelData(this.comments),
			'all',
			this.plugin.settings.commentSortOrder,
			this.anchors,
		);
		const cards: MobileRootCard[] = [
			...panelData.noteComments.map((root) => ({root, replyCount: 0})),
			...panelData.threads.map((thread) => ({root: thread.root, replyCount: thread.replies.length})),
		];

		if (this.mode === 'all' || !this.visibleCommentIds?.length) {
			return cards;
		}

		const visibleRootIds = new Set<string>();
		for (const id of this.visibleCommentIds) {
			const comment = this.comments.find((item) => item.id === id);
			if (!comment) continue;
			if (isRootComment(comment)) {
				visibleRootIds.add(comment.id);
			} else if (isReplyComment(comment)) {
				visibleRootIds.add(comment.parentId);
			}
		}
		return cards.filter((card) => visibleRootIds.has(card.root.id));
	}

	private syncSelectionState(): void {
		const cards = this.getVisibleCards();
		const visibleIds = new Set(cards.map((card) => card.root.id));
		if (!visibleIds.size) {
			this.selectedCommentId = null;
			return;
		}
		if (this.mode === 'focused') {
			this.selectedCommentId = cards[0]?.root.id ?? null;
		} else if (this.selectedCommentId && !visibleIds.has(this.selectedCommentId)) {
			this.selectedCommentId = null;
		}
	}

	private resetInteractionState(): void {
		this.selectedCommentId = null;
		this.editorMode = null;
		this.editorDraft = '';
		this.isSavingEditor = false;
		this.pendingEditorFocus = false;
	}

	private clearLayout(): void {
		this.modalEl.style.removeProperty('--marginalia-sheet-left');
		this.modalEl.style.removeProperty('--marginalia-sheet-width');
		this.modalEl.style.removeProperty('--marginalia-sheet-max-height');
		this.modalEl.style.removeProperty('--marginalia-sheet-top-limit');
		this.modalEl.style.removeProperty('--marginalia-sheet-keyboard-offset');
		this.modalEl.style.removeProperty('--marginalia-sheet-viewport-height');
		this.modalEl.style.removeProperty('--marginalia-sheet-center-x');
	}

	private setDefaultCloseButtonVisible(visible: boolean): void {
		if (!this.defaultCloseButton || !this.defaultCloseButton.isConnected) {
			this.defaultCloseButton = this.modalEl.querySelector<HTMLElement>('.modal-close-button');
		}
		if (this.defaultCloseButton) {
			this.defaultCloseButton.style.display = visible ? '' : 'none';
		}
	}

	private computeMobileSheetLayout(): MobileSheetLayout {
		const viewportWidth = window.innerWidth;
		const {keyboardOffset, viewportHeight} = this.getViewportMetrics();
		const sideMargin = 12;
		const bottomMargin = 92;
		const minWidth = 280;
		const minimumHeight = 240;
		const isTabletWidth = viewportWidth >= TABLET_SHEET_MIN_WIDTH;

		let left = sideMargin;
		let width = Math.max(minWidth, viewportWidth - sideMargin * 2);
		let topLimit = 56;

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (mdView) {
			const viewRect = mdView.containerEl.getBoundingClientRect();
			const contentRect = mdView.contentEl.getBoundingClientRect();
			const headerEl = mdView.containerEl.querySelector<HTMLElement>('.view-header');
			const headerBottom = headerEl?.getBoundingClientRect().bottom ?? viewRect.top;

			left = Math.max(sideMargin, Math.round(contentRect.left));
			width = Math.max(minWidth, Math.min(Math.round(contentRect.width), viewportWidth - sideMargin * 2));
			topLimit = Math.max(16, Math.round(Math.max(headerBottom, contentRect.top)));

			if (isTabletWidth) {
				const availableWidth = Math.min(Math.round(contentRect.width), viewportWidth - sideMargin * 2);
				width = Math.max(minWidth, Math.min(availableWidth, TABLET_SHEET_MAX_WIDTH));
				left = Math.round(contentRect.left + Math.max(0, availableWidth - width) / 2);
			}

			const maxAllowedLeft = viewportWidth - sideMargin - width;
			left = Math.min(left, Math.max(sideMargin, maxAllowedLeft));
		} else if (isTabletWidth) {
			width = Math.max(minWidth, Math.min(width, TABLET_SHEET_MAX_WIDTH));
			left = Math.round((viewportWidth - width) / 2);
		}

		const maxHeight = Math.max(minimumHeight, Math.floor(viewportHeight - topLimit - bottomMargin));
		const centerX = Math.round(left + width / 2);

		return {centerX, keyboardOffset, left, maxHeight, topLimit, viewportHeight, width};
	}

	private getViewportMetrics(): {keyboardOffset: number; viewportHeight: number} {
		const viewport = window.visualViewport ?? this.visualViewport;
		if (!viewport) {
			return {keyboardOffset: 0, viewportHeight: window.innerHeight};
		}

		const viewportHeight = Math.max(0, Math.round(viewport.height));
		const keyboardOffset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
		return {keyboardOffset, viewportHeight};
	}

	private bindViewportHandlers(): void {
		window.addEventListener('resize', this.resizeHandler, {passive: true});
		this.visualViewport = window.visualViewport ?? null;
		if (!this.visualViewport) return;
		this.visualViewport.addEventListener('resize', this.resizeHandler, {passive: true});
		this.visualViewport.addEventListener('scroll', this.resizeHandler, {passive: true});
	}

	private teardownViewportHandlers(): void {
		window.removeEventListener('resize', this.resizeHandler);
		if (this.visualViewport) {
			this.visualViewport.removeEventListener('resize', this.resizeHandler);
			this.visualViewport.removeEventListener('scroll', this.resizeHandler);
			this.visualViewport = null;
		}
	}

	private updateLayout(): void {
		const layout = this.computeMobileSheetLayout();
		this.modalEl.style.setProperty('--marginalia-sheet-left', `${layout.left}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-width', `${layout.width}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-top-limit', `${layout.topLimit}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-max-height', `${layout.maxHeight}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-keyboard-offset', `${layout.keyboardOffset}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-viewport-height', `${layout.viewportHeight}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-center-x', `${layout.centerX}px`);
	}


	private async navigateToSource(comment: RootComment): Promise<void> {
		if (!isAnchoredComment(comment)) return;

		const anchor = this.anchors.get(comment.id);
		const file = this.currentFile;
		if (!anchor || !file) {
			new Notice(t('mobileSourceUnavailable'));
			return;
		}

		this.close();

		const leaf = this.plugin.app.workspace.getLeaf(false);
		if (!leaf) return;

		await leaf.openFile(file);
		await this.waitForFrame();

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		if (mdView.getMode() === 'preview' && this.scrollPreviewToAnchor(mdView, anchor)) {
			return;
		}

		if (!this.scrollEditorToAnchor(mdView, anchor)) {
			new Notice(t('mobileJumpFailed'));
		}
	}

	private scrollPreviewToAnchor(mdView: MarkdownView, anchor: ResolvedAnchor): boolean {
		const previewEl = mdView.previewMode.containerEl;
		const sections = Array.from(previewEl.querySelectorAll<HTMLElement>('[data-marginalia-line-start]'));
		const section = sections.find((el) => {
			const lineStart = Number.parseInt(el.dataset['marginaliaLineStart'] ?? '', 10);
			const lineEnd = Number.parseInt(el.dataset['marginaliaLineEnd'] ?? '', 10);
			return !Number.isNaN(lineStart) && !Number.isNaN(lineEnd) && anchor.line >= lineStart && anchor.line <= lineEnd;
		});

		if (!section) return false;
		section.scrollIntoView({behavior: 'smooth', block: 'center'});
		section.addClass('marginalia-item-highlight');
		window.setTimeout(() => section.removeClass('marginalia-item-highlight'), 1600);
		return true;
	}

	private scrollEditorToAnchor(mdView: MarkdownView, anchor: ResolvedAnchor): boolean {
		try {
			const editor = mdView.editor;
			const from = editor.offsetToPos(anchor.from);
			const to = editor.offsetToPos(anchor.to);
			editor.setCursor(from);
			editor.scrollIntoView({from, to}, true);
			return true;
		} catch {
			return false;
		}
	}

	private async waitForFrame(): Promise<void> {
		await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
	}

	private async toggleResolution(comment: RootComment): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.toggleResolution(this.currentFile.path, comment.id);
		if (isAnchoredComment(comment)) {
			this.plugin.updateGutterEffects();
		}
		this.notifyChanged();
	}

	private async deleteComment(comment: RootComment): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.deleteComment(this.currentFile.path, comment.id);
		if (this.selectedCommentId === comment.id) {
			this.selectedCommentId = null;
		}
		if (isAnchoredComment(comment)) {
			this.plugin.updateGutterEffects();
		}
		this.notifyChanged();
	}

	private notifyChanged(): void {
		this.plugin.refreshPanel();
	}
}
