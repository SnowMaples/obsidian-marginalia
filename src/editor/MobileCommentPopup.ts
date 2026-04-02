import {MarkdownRenderer, MarkdownView, Modal, setIcon, type Component} from 'obsidian';
import type MarginaliaPlugin from '../main';
import {isReplyComment, isAnchoredComment, getRootResolution} from '../types';
import type {AnchoredComment, CommentData, NoteComment, ReplyComment, RootComment} from '../types';
import {getThreads} from '../comment/threading';
import {CommentModal} from '../views/CommentModal';

export class MobileCommentPopup extends Modal {
	private plugin: MarginaliaPlugin;
	private commentIds: string[];

	constructor(plugin: MarginaliaPlugin, commentIds: string[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.commentIds = commentIds;
	}

	static show(plugin: MarginaliaPlugin, commentIds: string[]): void {
		new MobileCommentPopup(plugin, commentIds).open();
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.addClass('marginalia-mobile-popup');
		contentEl.empty();

		void this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const {contentEl} = this;

		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) {
			contentEl.createEl('p', {text: 'No active file.'});
			return;
		}

		const allComments = await this.plugin.store.getComments(file.path);
		const threads = getThreads(allComments);
		const matchedThreads = threads.filter(t => this.commentIds.includes(t.root.id));

		if (matchedThreads.length === 0) {
			contentEl.createEl('p', {text: 'No comments found.'});
			return;
		}

		const header = contentEl.createDiv({cls: 'marginalia-mobile-popup-header'});
		const handle = header.createDiv({cls: 'marginalia-mobile-popup-handle'});
		const title = header.createDiv({cls: 'marginalia-mobile-popup-title'});
		title.textContent = matchedThreads.length === 1
			? 'Comment'
			: `${matchedThreads.length} Comments`;

		const scrollContent = contentEl.createDiv({cls: 'marginalia-mobile-popup-content'});

		for (let i = 0; i < matchedThreads.length; i++) {
			const thread = matchedThreads[i]!;
			if (i > 0) {
				scrollContent.createDiv({cls: 'marginalia-mobile-popup-divider'});
			}
			await this.renderThread(scrollContent, thread, file.path, allComments);
		}
	}

	private async renderThread(
		container: HTMLElement,
		thread: ReturnType<typeof getThreads>[number],
		filePath: string,
		allComments: CommentData[]
	): Promise<void> {
		const resolved = getRootResolution(thread.root) === 'resolved';
		const threadEl = container.createDiv({
			cls: `marginalia-mobile-thread${resolved ? ' marginalia-mobile-resolved' : ''}`,
		});

		if (isAnchoredComment(thread.root)) {
			const quoteEl = threadEl.createEl('blockquote', {
				cls: 'marginalia-mobile-quote',
			});
			const exactText = thread.root.target.exact.length > 120
				? thread.root.target.exact.substring(0, 120) + '...'
				: thread.root.target.exact;
			quoteEl.createSpan({text: exactText});

			if (thread.root.status === 'orphaned') {
				quoteEl.createSpan({text: ' (orphaned)', cls: 'marginalia-mobile-orphaned-badge'});
			}
			if (resolved) {
				quoteEl.createSpan({text: ' (resolved)', cls: 'marginalia-mobile-resolved-badge'});
			}

			quoteEl.addEventListener('click', () => {
				this.scrollToAnchor(thread.root.id);
			});
		}

		const bodyEl = threadEl.createDiv({cls: 'marginalia-mobile-body'});
		await MarkdownRenderer.render(
			this.app,
			thread.root.body,
			bodyEl,
			filePath,
			this.plugin,
		);

		const actionsEl = threadEl.createDiv({cls: 'marginalia-mobile-actions'});
		await this.renderActionButtons(actionsEl, thread.root, filePath);

		if (thread.replies.length > 0) {
			const repliesEl = threadEl.createDiv({cls: 'marginalia-mobile-replies'});
			for (const reply of thread.replies) {
				await this.renderReply(repliesEl, reply, filePath);
			}
		}

		const replyBtn = threadEl.createEl('button', {
			cls: 'marginalia-mobile-reply-btn',
		});
		setIcon(replyBtn.createSpan(), 'message-circle');
		replyBtn.createSpan({text: thread.replies.length > 0 ? `Reply (${thread.replies.length})` : 'Reply'});
		replyBtn.addEventListener('click', () => {
			this.addReply(thread.root.id, filePath);
		});
	}

	private async renderReply(
		container: HTMLElement,
		reply: ReplyComment,
		filePath: string
	): Promise<void> {
		const replyEl = container.createDiv({cls: 'marginalia-mobile-reply'});

		const bodyEl = replyEl.createDiv({cls: 'marginalia-mobile-body'});
		await MarkdownRenderer.render(
			this.app,
			reply.body,
			bodyEl,
			filePath,
			this.plugin,
		);

		const actionsEl = replyEl.createDiv({cls: 'marginalia-mobile-actions'});
		await this.renderActionButtons(actionsEl, reply, filePath);
	}

	private async renderActionButtons(
		container: HTMLElement,
		comment: {id: string; body: string},
		filePath: string
	): Promise<void> {
		const isRoot = !isReplyComment(comment as CommentData);

		if (isRoot) {
			const resolveBtn = container.createEl('button', {
				cls: 'marginalia-mobile-action-btn',
				attr: {'aria-label': 'Toggle resolved'},
			});
			setIcon(resolveBtn, 'check-circle');
			resolveBtn.addEventListener('click', () => {
				void this.toggleResolution(comment.id, filePath);
			});
		}

		const editBtn = container.createEl('button', {
			cls: 'marginalia-mobile-action-btn',
			attr: {'aria-label': 'Edit'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(comment, filePath);
		});

		const deleteBtn = container.createEl('button', {
			cls: 'marginalia-mobile-action-btn marginalia-mobile-action-danger',
			attr: {'aria-label': 'Delete'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(comment.id, filePath);
		});
	}

	private async toggleResolution(commentId: string, filePath: string): Promise<void> {
		await this.plugin.store.toggleResolution(filePath, commentId);
		this.close();
		this.plugin.updateGutterEffects();
		MobileCommentPopup.show(this.plugin, this.commentIds);
	}

	private async deleteComment(commentId: string, filePath: string): Promise<void> {
		await this.plugin.store.deleteComment(filePath, commentId);
		this.close();
		this.plugin.updateGutterEffects();
	}

	private editComment(comment: {id: string; body: string}, filePath: string): void {
		this.close();

		new CommentModal(
			this.app,
			(body) => {
				void this.plugin.store.updateComment(filePath, comment.id, body).then(() => {
					this.plugin.updateGutterEffects();
				});
			},
			comment.body
		).open();
	}

	private addReply(parentId: string, filePath: string): void {
		this.close();

		new CommentModal(
			this.app,
			(body) => {
				void this.plugin.store.addReply(filePath, parentId, body).then(() => {
					this.plugin.updateGutterEffects();
				});
			},
			undefined,
			'Add reply'
		).open();
	}

	private scrollToAnchor(commentId: string): void {
		const anchor = this.plugin.getCachedAnchors().get(commentId);
		if (!anchor) return;

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) return;

		const editor = mdView.editor;
		const pos = editor.offsetToPos(anchor.from);
		editor.setCursor(pos);
		editor.scrollIntoView(
			{from: pos, to: editor.offsetToPos(anchor.to)},
			true
		);
		this.close();
	}
}
