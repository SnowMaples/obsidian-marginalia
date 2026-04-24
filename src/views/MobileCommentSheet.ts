import {MarkdownView, Modal, TFile, setIcon} from 'obsidian';
import type MarginaliaPlugin from '../main';
import type {CommentData, ResolvedAnchor} from '../types';
import {CommentThreadList, type CommentFilter} from './CommentThreadList';

interface MobileSheetLayout {
	left: number;
	maxHeight: number;
	topLimit: number;
	width: number;
}

export class MobileCommentSheet extends Modal {
	private plugin: MarginaliaPlugin;
	private filter: CommentFilter = 'all';
	private currentFile: TFile | null = null;
	private comments: CommentData[] = [];
	private anchors: Map<string, ResolvedAnchor> = new Map();
	private visibleCommentIds: string[] | null = null;
	private readonly resizeHandler: () => void;
	private defaultCloseButton: HTMLElement | null = null;
	isSheetOpen = false;

	constructor(plugin: MarginaliaPlugin) {
		super(plugin.app);
		this.plugin = plugin;
		this.resizeHandler = () => {
			void this.refresh();
		};
	}

	setVisibleCommentIds(commentIds: string[] | null): void {
		this.visibleCommentIds = commentIds;
	}

	onOpen(): void {
		this.isSheetOpen = true;
		this.modalEl.addClass('marginalia-mobile-sheet');
		this.modalEl.parentElement?.addClass('marginalia-mobile-sheet-backdrop');
		this.setDefaultCloseButtonVisible(false);
		window.addEventListener('resize', this.resizeHandler, {passive: true});
		void this.refresh();
	}

	onClose(): void {
		this.isSheetOpen = false;
		this.visibleCommentIds = null;
		window.removeEventListener('resize', this.resizeHandler);
		this.setDefaultCloseButtonVisible(true);
		this.clearLayout();
		this.contentEl.empty();
		this.modalEl.removeClass('marginalia-mobile-sheet');
		this.modalEl.parentElement?.removeClass('marginalia-mobile-sheet-backdrop');
	}

	async refresh(): Promise<void> {
		if (!this.isSheetOpen) return;

		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			this.currentFile = null;
			this.comments = [];
			this.anchors = new Map();
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
		this.render();
	}

	private render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('marginalia-mobile-sheet-content');

		const header = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-header'});
		header.createDiv({cls: 'marginalia-mobile-sheet-handle'});

		const titleRow = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-title-row'});
		const titleWrap = titleRow.createDiv({cls: 'marginalia-mobile-sheet-title-wrap'});
		titleWrap.createEl('h3', {
			text: this.visibleCommentIds ? 'Comments on this line' : 'Comments',
			cls: 'marginalia-mobile-sheet-title',
		});
		if (this.currentFile) {
			titleWrap.createDiv({
				text: this.currentFile.basename,
				cls: 'marginalia-mobile-sheet-subtitle',
			});
		}

		const closeBtn = titleRow.createEl('button', {
			cls: 'marginalia-mobile-sheet-close clickable-icon',
			attr: {'aria-label': 'Close comments'},
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', () => this.close());

		const body = this.contentEl.createDiv({cls: 'marginalia-mobile-sheet-body'});
		const list = new CommentThreadList({
			plugin: this.plugin,
			host: this.plugin,
			container: body,
			currentFile: this.currentFile,
			comments: this.comments,
			anchors: this.anchors,
			filter: this.filter,
			showToolbar: !this.visibleCommentIds,
			visibleCommentIds: this.visibleCommentIds,
			emptyText: this.visibleCommentIds ? 'No comments found for this location.' : 'No comments yet.',
			onFilterChange: (filter) => {
				this.filter = filter;
				this.render();
			},
			onAfterChange: () => {
				void this.refresh();
			},
		});
		list.render();
	}

	private clearLayout(): void {
		this.modalEl.style.removeProperty('--marginalia-sheet-left');
		this.modalEl.style.removeProperty('--marginalia-sheet-width');
		this.modalEl.style.removeProperty('--marginalia-sheet-max-height');
		this.modalEl.style.removeProperty('--marginalia-sheet-top-limit');
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
		const viewportHeight = window.innerHeight;
		const sideMargin = 8;
		const bottomMargin = 8;
		const minWidth = 280;
		const minimumHeight = 240;

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

			const maxAllowedLeft = viewportWidth - sideMargin - width;
			left = Math.min(left, Math.max(sideMargin, maxAllowedLeft));
		}

		const safeBottom = this.getSafeAreaInsetBottom();
		const maxHeight = Math.max(minimumHeight, Math.floor(viewportHeight - topLimit - safeBottom - bottomMargin));

		return {left, width, topLimit, maxHeight};
	}

	private getSafeAreaInsetBottom(): number {
		return Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0'
		) || 0;
	}

	private updateLayout(): void {
		const layout = this.computeMobileSheetLayout();
		this.modalEl.style.setProperty('--marginalia-sheet-left', `${layout.left}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-width', `${layout.width}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-top-limit', `${layout.topLimit}px`);
		this.modalEl.style.setProperty('--marginalia-sheet-max-height', `${layout.maxHeight}px`);
	}
}