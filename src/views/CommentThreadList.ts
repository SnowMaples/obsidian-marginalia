import {MarkdownRenderer, MarkdownView, Menu, Notice, Platform, TFile, setIcon, type App, type Component} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {AnchoredComment, CommentData, CommentThread, NoteComment, PanelData, ReplyComment, RootComment, ResolvedAnchor} from '../types';
import {getRootResolution, isReplyComment, isNoteComment} from '../types';
import {filterPanelData, getPanelData} from '../comment/threading';
import {CommentModal} from './CommentModal';
import {t} from '../i18n';

export type CommentFilter = 'all' | 'open' | 'resolved' | 'active' | 'orphaned';

interface ThreadListOptions {
	plugin: MarginaliaPlugin;
	host: Component;
	container: HTMLElement;
	currentFile: TFile | null;
	comments: CommentData[];
	anchors: Map<string, ResolvedAnchor>;
	filter: CommentFilter;
	showToolbar: boolean;
	visibleCommentIds?: string[] | null;
	emptyText?: string;
	onFilterChange?: (filter: CommentFilter) => void;
	onAfterChange?: () => void;
}

export class CommentThreadList {
	private plugin: MarginaliaPlugin;
	private app: App;
	private host: Component;
	private container: HTMLElement;
	private currentFile: TFile | null;
	private comments: CommentData[];
	private anchors: Map<string, ResolvedAnchor>;
	private filter: CommentFilter;
	private showToolbar: boolean;
	private visibleCommentIds: Set<string> | null;
	private emptyText: string;
	private onFilterChange?: (filter: CommentFilter) => void;
	private onAfterChange?: () => void;
	private editingCommentId: string | null = null;
	private editingDraft = '';
	private savingCommentId: string | null = null;
	private pendingFocusCommentId: string | null = null;

	constructor(options: ThreadListOptions) {
		this.plugin = options.plugin;
		this.app = options.plugin.app;
		this.host = options.host;
		this.container = options.container;
		this.currentFile = options.currentFile;
		this.comments = options.comments;
		this.anchors = options.anchors;
		this.filter = options.filter;
		this.showToolbar = options.showToolbar;
		this.visibleCommentIds = options.visibleCommentIds ? new Set(options.visibleCommentIds) : null;
		this.emptyText = options.emptyText ?? t('panelNoComments');
		this.onFilterChange = options.onFilterChange;
		this.onAfterChange = options.onAfterChange;
	}

	render(): void {
		this.container.empty();
		this.container.addClass('marginalia-panel');

		if (!this.currentFile) {
			this.container.createEl('div', {
				text: t('panelOpenMarkdown'),
				cls: 'marginalia-empty',
			});
			return;
		}

		if (this.showToolbar) {
			this.renderToolbar(this.container);
		}

		const {noteComments, threads} = this.getVisiblePanelData();
		if (noteComments.length === 0 && threads.length === 0) {
			this.container.createEl('div', {
				text: this.emptyText,
				cls: 'marginalia-empty',
			});
			return;
		}

		const listEl = this.container.createDiv({cls: 'marginalia-list'});

		if (noteComments.length > 0) {
			const noteSection = listEl.createDiv({cls: 'marginalia-note-section'});
			const header = noteSection.createDiv({cls: 'marginalia-section-header'});
			setIcon(header.createSpan(), 'sticky-note');
			header.createSpan({text: t('panelNoteComments')});
			for (const nc of noteComments) {
				this.renderNoteComment(noteSection, nc);
			}
		}

		if (threads.length > 0) {
			if (noteComments.length > 0) {
				const anchoredHeader = listEl.createDiv({cls: 'marginalia-section-header'});
				setIcon(anchoredHeader.createSpan(), 'message-square');
				anchoredHeader.createSpan({text: t('panelAnchoredComments')});
			}
			for (const thread of threads) {
				this.renderThread(listEl, thread);
			}
		}

		this.flushPendingInlineEditorFocus();
	}

	scrollToComment(commentId: string): void {
		const reply = this.comments.find(c => c.id === commentId && isReplyComment(c));
		const targetId = reply && isReplyComment(reply) ? reply.parentId : commentId;

		const el = this.container.querySelector(`[data-comment-id="${targetId}"]`);
		if (el) {
			el.scrollIntoView({behavior: 'smooth', block: 'center'});
			el.addClass('marginalia-item-highlight');
			setTimeout(() => el.removeClass('marginalia-item-highlight'), 2000);
		}
	}

	private getVisiblePanelData(): PanelData {
		const panelData = filterPanelData(
			getPanelData(this.comments),
			this.filter,
			this.plugin.settings.commentSortOrder,
			this.anchors,
		);

		if (!this.visibleCommentIds) {
			return panelData;
		}

		const visibleThreads = panelData.threads.filter(thread => this.visibleCommentIds?.has(thread.root.id));
		return {
			noteComments: [],
			threads: visibleThreads,
		};
	}

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createDiv({cls: 'marginalia-toolbar'});

		const filterGroup = toolbar.createDiv({cls: 'marginalia-filter-group'});
		type FilterValue = CommentFilter;

		const primaryFilters: Array<{label: string; value: FilterValue}> = [
			{label: t('filterAll'), value: 'all'},
			{label: t('filterOpen'), value: 'open'},
			{label: t('filterResolved'), value: 'resolved'},
		];

		const overflowFilters: Array<{label: string; value: FilterValue}> = [
			{label: t('filterActive'), value: 'active'},
			{label: t('filterOrphaned'), value: 'orphaned'},
		];

		for (const f of primaryFilters) {
			const btn = filterGroup.createEl('button', {
				text: f.label,
				cls: `marginalia-filter-btn${this.filter === f.value ? ' is-active' : ''}`,
			});
			btn.addEventListener('click', () => {
				this.onFilterChange?.(f.value);
			});
		}

		const isOverflowActive = overflowFilters.some(f => f.value === this.filter);
		const moreBtn = filterGroup.createEl('button', {
			cls: `marginalia-more-btn clickable-icon${isOverflowActive ? ' is-active' : ''}`,
			attr: {'aria-label': t('filterMore')},
		});
		setIcon(moreBtn, 'more-horizontal');
		moreBtn.addEventListener('click', () => {
			const menu = new Menu();
			for (const f of overflowFilters) {
				menu.addItem(item => {
					item.setTitle(f.label)
						.setChecked(this.filter === f.value)
						.onClick(() => {
							this.onFilterChange?.(f.value);
						});
				});
			}
			menu.showAtMouseEvent(new MouseEvent('click', {
				clientX: moreBtn.getBoundingClientRect().left,
				clientY: moreBtn.getBoundingClientRect().bottom,
			}));
		});

		if (Platform.isDesktopApp) {
			const previewBtn = toolbar.createEl('button', {
				cls: 'marginalia-preview-btn clickable-icon',
				attr: {'aria-label': t('actionPreviewAll')},
			});
			setIcon(previewBtn, 'eye');
			previewBtn.addEventListener('click', () => {
				void this.plugin.openCommentPreviewInBrowser();
			});
		}

		const addBtn = toolbar.createEl('button', {
			cls: 'marginalia-add-btn clickable-icon',
			attr: {'aria-label': t('actionAddNote')},
		});
		setIcon(addBtn, 'plus');
		addBtn.disabled = !this.currentFile;
		addBtn.addEventListener('click', () => {
			this.addNoteComment();
		});
	}

	private addNoteComment(): void {
		if (!this.currentFile) return;
		const filePath = this.currentFile.path;

		new CommentModal(
			this.app,
			(body) => {
				void this.plugin.store.addNoteComment(filePath, body).then(() => {
					this.notifyChanged();
				});
			},
			undefined,
			t('modalAddNoteComment')
		).open();
	}

	private renderNoteComment(container: HTMLElement, nc: NoteComment): void {
		const resolved = getRootResolution(nc) === 'resolved';
		const editing = this.isEditingComment(nc.id);
		const item = container.createDiv({
			cls: `marginalia-note-item${resolved ? ' marginalia-resolved' : ''}${editing ? ' marginalia-item-editing' : ''}`,
			attr: {'data-comment-id': nc.id},
		});

		const label = item.createDiv({cls: 'marginalia-note-label'});
		setIcon(label.createSpan(), 'sticky-note');
		label.createSpan({text: t('labelNote')});
		if (resolved) {
			label.createSpan({text: t('labelResolvedSuffix'), cls: 'marginalia-resolved-badge'});
		}

		this.renderCommentBody(item, nc);
		this.renderFooter(item, nc, () => {
			void this.toggleResolution(nc);
		}, undefined, () => {
			this.editComment(nc);
		}, () => {
			void this.deleteComment(nc);
		}, resolved, editing);
	}

	private renderThread(container: HTMLElement, thread: CommentThread): void {
		const resolved = getRootResolution(thread.root) === 'resolved';
		let cls = 'marginalia-thread';
		if (thread.root.status === 'orphaned') cls += ' marginalia-orphaned';
		if (resolved) cls += ' marginalia-resolved';
		const threadEl = container.createDiv({
			cls,
			attr: {'data-comment-id': thread.root.id},
		});

		this.renderRootComment(threadEl, thread.root, thread.replies.length);

		if (thread.replies.length > 0) {
			const repliesEl = threadEl.createDiv({cls: 'marginalia-replies'});
			for (const reply of thread.replies) {
				this.renderReply(repliesEl, reply);
			}
		}
	}

	private renderRootComment(container: HTMLElement, root: AnchoredComment, replyCount: number): void {
		const resolved = getRootResolution(root) === 'resolved';
		const editing = this.isEditingComment(root.id);
		const item = container.createDiv({
			cls: `marginalia-item${editing ? ' marginalia-item-editing' : ''}`,
		});

		const quote = item.createEl('blockquote', {cls: 'marginalia-quote'});
		const exactText = root.target.exact.length > 100
			? root.target.exact.substring(0, 100) + '...'
			: root.target.exact;
		quote.createEl('span', {text: exactText});

		if (root.status === 'orphaned') {
			quote.createEl('span', {
				text: t('labelOrphanedSuffix'),
				cls: 'marginalia-orphaned-badge',
			});
		}
		if (resolved) {
			quote.createEl('span', {
				text: t('labelResolvedSuffix'),
				cls: 'marginalia-resolved-badge',
			});
		}

		quote.addEventListener('click', () => {
			this.scrollEditorToComment(root);
		});

		this.renderCommentBody(item, root);
		this.renderFooter(item, root, () => {
			void this.toggleResolution(root);
		}, () => {
			this.addReply(root);
		}, () => {
			this.editComment(root);
		}, () => {
			void this.deleteComment(root);
		}, resolved, editing, replyCount);
	}

	private renderReply(container: HTMLElement, reply: ReplyComment): void {
		const editing = this.isEditingComment(reply.id);
		const item = container.createDiv({
			cls: `marginalia-reply${editing ? ' marginalia-item-editing' : ''}`,
			attr: {'data-reply-id': reply.id},
		});

		this.renderCommentBody(item, reply);
		this.renderFooter(item, reply, undefined, undefined, () => {
			this.editComment(reply);
		}, () => {
			void this.deleteComment(reply);
		}, false, editing);
	}

	private renderCommentBody(container: HTMLElement, comment: CommentData): void {
		if (this.isEditingComment(comment.id)) {
			this.renderInlineEditor(container, comment);
			return;
		}

		const bodyEl = container.createDiv({cls: 'marginalia-body'});
		void MarkdownRenderer.render(
			this.app,
			comment.body,
			bodyEl,
			this.currentFile?.path ?? '',
			this.host,
		);
	}

	private renderInlineEditor(container: HTMLElement, comment: CommentData): void {
		const editorWrap = container.createDiv({
			cls: `marginalia-inline-editor-wrap${this.savingCommentId === comment.id ? ' is-saving' : ''}`,
		});
		const textarea = editorWrap.createEl('textarea', {
			cls: 'marginalia-inline-editor',
			attr: {
				'data-inline-editor-for': comment.id,
				'aria-label': t('actionEditComment'),
			},
		});
		textarea.value = this.editingDraft;
		textarea.disabled = this.savingCommentId === comment.id;
		textarea.addEventListener('input', () => {
			this.editingDraft = textarea.value;
			this.autosizeInlineEditor(textarea);
		});
		textarea.addEventListener('blur', () => {
			void this.commitInlineEdit('blur');
		});
		textarea.addEventListener('keydown', (evt) => {
			if (evt.key === 'Escape') {
				evt.preventDefault();
				this.cancelInlineEdit();
				return;
			}
			if ((evt.metaKey || evt.ctrlKey) && evt.key === 'Enter') {
				evt.preventDefault();
				textarea.blur();
			}
		});

		editorWrap.createDiv({
			text: this.savingCommentId === comment.id ? t('statusSaving') : t('statusTapOutside'),
			cls: 'marginalia-inline-edit-status',
		});
	}

	private renderFooter(
		container: HTMLElement,
		comment: CommentData,
		onToggleResolve: (() => void) | undefined,
		onReply: (() => void) | undefined,
		onEdit: (() => void) | undefined,
		onDelete: (() => void) | undefined,
		resolved: boolean,
		editing: boolean,
		replyCount?: number,
	): void {
		const footer = container.createDiv({cls: 'marginalia-footer'});
		const time = new Date(comment.createdAt);
		footer.createEl('span', {
			text: time.toLocaleString(),
			cls: 'marginalia-timestamp',
		});

		if (editing) {
			footer.createEl('span', {
				text: this.savingCommentId === comment.id ? t('statusSaving') : t('statusEditing'),
				cls: 'marginalia-inline-edit-status',
			});
			return;
		}

		const actions = footer.createDiv({cls: 'marginalia-actions'});
		if (onToggleResolve) {
			const resolveBtn = actions.createEl('button', {
				cls: 'marginalia-action-btn clickable-icon',
				attr: {'aria-label': resolved ? t('actionUnresolve') : t('actionResolve')},
			});
			setIcon(resolveBtn, resolved ? 'circle' : 'check-circle');
			resolveBtn.addEventListener('click', onToggleResolve);
		}

		if (onReply) {
			const replyBtn = actions.createEl('button', {
				cls: 'marginalia-action-btn clickable-icon',
				attr: {'aria-label': t('actionReply', {count: replyCount ?? 0})},
			});
			setIcon(replyBtn, 'corner-down-left');
			if (replyCount && replyCount > 0) {
				replyBtn.createEl('span', {
					text: String(replyCount),
					cls: 'marginalia-reply-count-badge',
				});
			}
			replyBtn.addEventListener('click', onReply);
		}

		if (onEdit) {
			const editBtn = actions.createEl('button', {
				cls: 'marginalia-action-btn clickable-icon',
				attr: {'aria-label': isReplyComment(comment) ? t('actionEditReply') : t('actionEditComment')},
			});
			setIcon(editBtn, 'edit');
			editBtn.addEventListener('click', onEdit);
		}

		if (onDelete) {
			const deleteBtn = actions.createEl('button', {
				cls: 'marginalia-action-btn clickable-icon',
				attr: {'aria-label': isReplyComment(comment) ? t('actionDeleteReply') : t('actionDeleteComment')},
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', onDelete);
		}
	}

	private scrollEditorToComment(root: AnchoredComment): void {
		const anchor = this.anchors.get(root.id);
		if (!anchor || !this.currentFile) return;

		const leaf = this.app.workspace.getLeaf(false);
		if (!leaf) return;

		void leaf.openFile(this.currentFile).then(() => {
			const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (mdView) {
				const editor = mdView.editor;
				const pos = editor.offsetToPos(anchor.from);
				editor.setCursor(pos);
				editor.scrollIntoView(
					{from: pos, to: editor.offsetToPos(anchor.to)},
					true
				);
			}
		});
	}

	private addReply(root: AnchoredComment): void {
		if (!this.currentFile) return;
		const filePath = this.currentFile.path;

		new CommentModal(
			this.app,
			(body) => {
				void this.plugin.store.addReply(filePath, root.id, body).then(() => {
					this.notifyChanged();
				});
			},
			undefined,
			t('modalAddReply')
		).open();
	}

	private editComment(comment: CommentData): void {
		if (!this.currentFile) return;

		if (this.isMobileInlineEditEnabled()) {
			void this.startInlineEdit(comment);
			return;
		}

		const filePath = this.currentFile.path;
		new CommentModal(
			this.app,
			(body) => {
				void this.plugin.store.updateComment(filePath, comment.id, body).then(() => {
					this.notifyChanged();
				});
			},
			comment.body
		).open();
	}

	private async startInlineEdit(comment: CommentData): Promise<void> {
		if (!this.currentFile || this.savingCommentId) return;
		if (this.editingCommentId === comment.id) {
			this.pendingFocusCommentId = comment.id;
			this.flushPendingInlineEditorFocus();
			return;
		}

		if (this.editingCommentId && this.editingCommentId !== comment.id) {
			await this.commitInlineEdit('refresh');
			if (this.editingCommentId) {
				return;
			}
		}

		this.editingCommentId = comment.id;
		this.editingDraft = comment.body;
		this.savingCommentId = null;
		this.pendingFocusCommentId = comment.id;
		this.render();
	}

	private async commitInlineEdit(_reason: 'blur' | 'close' | 'refresh'): Promise<void> {
		if (!this.currentFile || !this.editingCommentId) return;
		const comment = this.findCommentById(this.editingCommentId);
		if (!comment) {
			this.cancelInlineEdit();
			return;
		}
		if (this.savingCommentId === comment.id) return;

		const nextBody = this.editingDraft.trim();
		const currentBody = comment.body.trim();
		if (!nextBody || nextBody === currentBody) {
			this.cancelInlineEdit();
			return;
		}

		this.savingCommentId = comment.id;
		try {
			await this.plugin.store.updateComment(this.currentFile.path, comment.id, nextBody);
			this.editingCommentId = null;
			this.editingDraft = '';
			this.savingCommentId = null;
			this.pendingFocusCommentId = null;
			this.notifyChanged();
		} catch (error) {
			this.savingCommentId = null;
			this.pendingFocusCommentId = comment.id;
			new Notice(t('noticeSaveFailed', {error: error instanceof Error ? error.message : String(error)}));
			this.render();
		}
	}

	private cancelInlineEdit(): void {
		if (!this.editingCommentId && !this.editingDraft) return;
		this.editingCommentId = null;
		this.editingDraft = '';
		this.savingCommentId = null;
		this.pendingFocusCommentId = null;
		this.render();
	}

	private findCommentById(commentId: string): CommentData | undefined {
		return this.comments.find(comment => comment.id === commentId);
	}

	private isMobileInlineEditEnabled(): boolean {
		return Platform.isMobile;
	}

	private isEditingComment(commentId: string): boolean {
		return this.isMobileInlineEditEnabled() && this.editingCommentId === commentId;
	}

	private flushPendingInlineEditorFocus(): void {
		if (!this.pendingFocusCommentId) return;
		const pendingCommentId = this.pendingFocusCommentId;
		this.pendingFocusCommentId = null;
		window.requestAnimationFrame(() => {
			const textarea = this.container.querySelector<HTMLTextAreaElement>(`textarea[data-inline-editor-for="${pendingCommentId}"]`);
			if (!textarea) return;
			this.autosizeInlineEditor(textarea);
			textarea.focus();
			const position = textarea.value.length;
			textarea.setSelectionRange(position, position);
			textarea.scrollIntoView({block: 'nearest'});
		});
	}

	private autosizeInlineEditor(textarea: HTMLTextAreaElement): void {
		textarea.setCssProps({'height': 'auto'});
		textarea.setCssProps({'height': `${Math.max(textarea.scrollHeight, 84)}px`});
	}

	private async toggleResolution(comment: RootComment): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.toggleResolution(this.currentFile.path, comment.id);
		if (!isNoteComment(comment)) {
			this.plugin.updateGutterEffects();
		}
		this.notifyChanged();
	}

	private async deleteComment(comment: CommentData): Promise<void> {
		if (!this.currentFile) return;
		await this.plugin.store.deleteComment(this.currentFile.path, comment.id);
		if (!isNoteComment(comment)) {
			this.plugin.updateGutterEffects();
		}
		this.notifyChanged();
	}

	private notifyChanged(): void {
		this.plugin.refreshPanel();
		this.onAfterChange?.();
	}
}
