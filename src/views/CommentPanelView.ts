import {ItemView, WorkspaceLeaf, TFile} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {CommentData, ResolvedAnchor} from '../types';
import {isReplyComment} from '../types';
import {CommentThreadList, type CommentFilter} from './CommentThreadList';

export const VIEW_TYPE_COMMENT_PANEL = 'marginalia-panel';

export class CommentPanelView extends ItemView {
	private plugin: MarginaliaPlugin;
	private currentFile: TFile | null = null;
	private comments: CommentData[] = [];
	private anchors: Map<string, ResolvedAnchor> = new Map();
	private filter: CommentFilter = 'all';

	constructor(leaf: WorkspaceLeaf, plugin: MarginaliaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_COMMENT_PANEL;
	}

	getDisplayText(): string {
		return 'Comments';
	}

	getIcon(): string {
		return 'message-square';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => {
				void this.updateForActiveFile();
			})
		);

		// Handle internal wiki-link clicks in rendered Markdown
		this.registerDomEvent(this.contentEl, 'click', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			const link = target.closest('a.internal-link');
			if (link instanceof HTMLAnchorElement) {
				evt.preventDefault();
				const href = link.dataset.href;
				if (href) {
					void this.plugin.app.workspace.openLinkText(
						href,
						this.currentFile?.path ?? '',
						evt.ctrlKey || evt.metaKey,
					);
				}
			}
		});

		await this.updateForActiveFile();
	}

	onClose(): Promise<void> {
		this.contentEl.empty();
		return Promise.resolve();
	}

	async refresh(): Promise<void> {
		await this.updateForActiveFile();
	}

	async updateForActiveFile(): Promise<void> {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			this.currentFile = null;
			this.comments = [];
			this.anchors = new Map();
			this.renderPanel();
			return;
		}

		this.currentFile = file;
		this.comments = await this.plugin.store.getComments(file.path);

		const content = await this.plugin.app.vault.read(file);
		this.anchors = await this.plugin.store.resolveAnchors(
			file.path, content, this.plugin.settings.fuzzyMatchThreshold
		);

		this.renderPanel();
	}

	scrollToComment(commentId: string): void {
		// If the commentId is a reply, find its parent thread element
		const reply = this.comments.find(c => c.id === commentId && isReplyComment(c));
		const targetId = reply && isReplyComment(reply) ? reply.parentId : commentId;

		const el = this.contentEl.querySelector(`[data-comment-id="${targetId}"]`);
		if (el) {
			el.scrollIntoView({behavior: 'smooth', block: 'center'});
			el.addClass('marginalia-item-highlight');
			setTimeout(() => el.removeClass('marginalia-item-highlight'), 2000);
		}
	}

	private renderPanel(): void {
		const list = new CommentThreadList({
			plugin: this.plugin,
			host: this,
			container: this.contentEl,
			currentFile: this.currentFile,
			comments: this.comments,
			anchors: this.anchors,
			filter: this.filter,
			showToolbar: true,
			onFilterChange: (filter) => {
				this.filter = filter;
				this.renderPanel();
			},
			onAfterChange: () => {
				void this.refresh();
			},
		});
		list.render();
	}
}

