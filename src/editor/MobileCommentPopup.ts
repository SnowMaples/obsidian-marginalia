import {MarkdownRenderer, MarkdownView, setIcon, Component} from 'obsidian';
import type MarginaliaPlugin from '../main';
import {isReplyComment, isAnchoredComment, getRootResolution} from '../types';
import {getThreads} from '../comment/threading';
import {CommentModal} from '../views/CommentModal';

class MobilePopupComponent extends Component {
	constructor(private popupEl: HTMLElement) {
		super();
	}

	override onunload(): void {
		this.popupEl.empty();
	}
}

export class MobileCommentPopup {
	private static instance: MobileCommentPopup | null = null;

	private plugin: MarginaliaPlugin;
	private popupEl: HTMLElement;
	private overlayEl: HTMLElement;
	private popupComponent: MobilePopupComponent | null = null;
	private commentIds: string[] = [];

	private constructor(plugin: MarginaliaPlugin) {
		this.plugin = plugin;

		this.overlayEl = document.createElement('div');
		this.overlayEl.className = 'marginalia-mobile-overlay';
		this.overlayEl.addEventListener('click', () => this.hide());

		this.popupEl = document.createElement('div');
		this.popupEl.className = 'marginalia-mobile-popup';
		this.popupEl.addEventListener('click', (e) => e.stopPropagation());
	}

	static show(plugin: MarginaliaPlugin, commentIds: string[], anchorEl: HTMLElement): void {
		if (!this.instance) {
			this.instance = new MobileCommentPopup(plugin);
		}

		void this.instance.render(commentIds);
	}

	hide(): void {
		this.popupEl.removeClass('marginalia-mobile-popup-visible');
		this.overlayEl.removeClass('marginalia-mobile-overlay-visible');

		if (this.popupComponent) {
			this.popupComponent.unload();
			this.popupComponent = null;
		}

		setTimeout(() => {
			this.popupEl.remove();
			this.overlayEl.remove();
		}, 300);
	}

	private async render(commentIds: string[]): Promise<void> {
		this.commentIds = commentIds;

		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		const allComments = await this.plugin.store.getComments(file.path);
		const threads = getThreads(allComments);
		const matchedThreads = threads.filter(t => commentIds.includes(t.root.id));
		if (matchedThreads.length === 0) return;

		this.popupEl.empty();

		const header = this.popupEl.createDiv({cls: 'marginalia-mobile-popup-header'});
		header.createDiv({cls: 'marginalia-mobile-popup-handle'});
		const title = header.createDiv({cls: 'marginalia-mobile-popup-title'});
		title.textContent = matchedThreads.length === 1
			? 'Comment'
			: `${matchedThreads.length} Comments`;

		const content = this.popupEl.createDiv({cls: 'marginalia-mobile-popup-content'});

		for (let i = 0; i < matchedThreads.length; i++) {
			const thread = matchedThreads[i]!;
			if (i > 0) {
				content.createDiv({cls: 'marginalia-mobile-popup-divider'});
			}
			await this.renderThread(content, thread);
		}

		if (!this.popupEl.parentElement) {
			document.body.appendChild(this.overlayEl);
			document.body.appendChild(this.popupEl);
		}

		this.popupComponent = new MobilePopupComponent(this.popupEl);

		requestAnimationFrame(() => {
			this.overlayEl.addClass('marginalia-mobile-overlay-visible');
			this.popupEl.addClass('marginalia-mobile-popup-visible');
		});
	}

	private async renderThread(container: HTMLElement, thread: ReturnType<typeof getThreads>[number]): Promise<void> {
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
			this.plugin.app,
			thread.root.body,
			bodyEl,
			this.plugin.app.workspace.getActiveFile()?.path ?? '',
			this.popupComponent ?? this.plugin,
		);

		const actionsEl = threadEl.createDiv({cls: 'marginalia-mobile-actions'});
		await this.renderActionButtons(actionsEl, thread.root);

		if (thread.replies.length > 0) {
			const repliesEl = threadEl.createDiv({cls: 'marginalia-mobile-replies'});
			for (const reply of thread.replies) {
				await this.renderReply(repliesEl, reply);
			}
		}

		const replyBtn = threadEl.createEl('button', {
			cls: 'marginalia-mobile-reply-btn',
			text: 'Reply',
		});
		setIcon(replyBtn.createSpan(), 'message-circle');
		replyBtn.createSpan({text: thread.replies.length > 0 ? `Reply (${thread.replies.length})` : 'Reply'});
		replyBtn.addEventListener('click', () => {
			this.addReply(thread.root.id);
		});
	}

	private async renderReply(container: HTMLElement, reply: ReturnType<typeof getThreads>[number]['replies'][number]): Promise<void> {
		const replyEl = container.createDiv({cls: 'marginalia-mobile-reply'});

		const bodyEl = replyEl.createDiv({cls: 'marginalia-mobile-body'});
		await MarkdownRenderer.render(
			this.plugin.app,
			reply.body,
			bodyEl,
			this.plugin.app.workspace.getActiveFile()?.path ?? '',
			this.popupComponent ?? this.plugin,
		);

		const actionsEl = replyEl.createDiv({cls: 'marginalia-mobile-actions'});
		await this.renderActionButtons(actionsEl, reply);
	}

	private async renderActionButtons(container: HTMLElement, comment: {id: string; body: string}): Promise<void> {
		const isRoot = !isReplyComment(comment as never);

		if (isRoot) {
			const resolveBtn = container.createEl('button', {
				cls: 'marginalia-mobile-action-btn',
				attr: {'aria-label': 'Toggle resolved'},
			});
			setIcon(resolveBtn, 'check-circle');
			resolveBtn.addEventListener('click', () => {
				void this.toggleResolution(comment.id);
			});
		}

		const editBtn = container.createEl('button', {
			cls: 'marginalia-mobile-action-btn',
			attr: {'aria-label': 'Edit'},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', () => {
			this.editComment(comment);
		});

		const deleteBtn = container.createEl('button', {
			cls: 'marginalia-mobile-action-btn marginalia-mobile-action-danger',
			attr: {'aria-label': 'Delete'},
		});
		setIcon(deleteBtn, 'trash');
		deleteBtn.addEventListener('click', () => {
			void this.deleteComment(comment.id);
		});
	}

	private async toggleResolution(commentId: string): Promise<void> {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		await this.plugin.store.toggleResolution(file.path, commentId);
		await this.render(this.commentIds);
		this.plugin.updateGutterEffects();
	}

	private async deleteComment(commentId: string): Promise<void> {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		await this.plugin.store.deleteComment(file.path, commentId);
		this.hide();
		this.plugin.updateGutterEffects();
	}

	private editComment(comment: {id: string; body: string}): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		this.hide();

		new CommentModal(
			this.plugin.app,
			(body) => {
				void this.plugin.store.updateComment(file.path, comment.id, body).then(() => {
					this.plugin.updateGutterEffects();
				});
			},
			comment.body
		).open();
	}

	private addReply(parentId: string): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) return;

		this.hide();

		new CommentModal(
			this.plugin.app,
			(body) => {
				void this.plugin.store.addReply(file.path, parentId, body).then(() => {
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
		this.hide();
	}
}
