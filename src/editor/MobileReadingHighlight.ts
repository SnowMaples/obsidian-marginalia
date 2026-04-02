import {MarkdownView} from 'obsidian';
import type {MarkdownPostProcessorContext} from 'obsidian';
import type MarginaliaPlugin from '../main';
import {isRootComment, getRootResolution, isAnchoredComment} from '../types';
import type {ResolvedAnchor} from '../types';
import {MobileCommentPopup} from './MobileCommentPopup';

export class MobileReadingHighlight {
	private plugin: MarginaliaPlugin;

	constructor(plugin: MarginaliaPlugin) {
		this.plugin = plugin;
	}

	processSection(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		if (!this.plugin.settings.enableMobileAnnotations) return;

		const info = ctx.getSectionInfo(el);
		if (!info) return;

		const cachedFilePath = this.plugin.getCachedFilePath();
		if (!cachedFilePath || ctx.sourcePath !== cachedFilePath) return;

		const anchors = this.plugin.getCachedAnchors();
		const comments = this.plugin.getCachedComments();
		if (anchors.size === 0) return;

		const resolutionMap = new Map<string, 'open' | 'resolved'>();
		for (const c of comments) {
			if (isRootComment(c)) {
				resolutionMap.set(c.id, getRootResolution(c));
			}
		}

		const relevantAnchors: Array<{
			commentId: string;
			anchor: ResolvedAnchor;
			resolved: boolean;
		}> = [];

		for (const [commentId, anchor] of anchors) {
			if (anchor.line >= info.lineStart && anchor.line <= info.lineEnd) {
				relevantAnchors.push({
					commentId,
					anchor,
					resolved: resolutionMap.get(commentId) === 'resolved',
				});
			}
		}

		if (relevantAnchors.length === 0) return;

		this.highlightTextInElement(el, relevantAnchors);
	}

	refreshActiveView(): void {
		if (!this.plugin.settings.enableMobileAnnotations) return;

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView || mdView.getMode() !== 'preview') return;

		const previewEl = mdView.previewMode.containerEl;

		const existing = Array.from(previewEl.querySelectorAll('.marginalia-mobile-annotation'));
		for (const span of existing) {
			const parent = span.parentNode;
			if (parent) {
				while (span.firstChild) {
					parent.insertBefore(span.firstChild, span);
				}
				span.remove();
			}
		}

		const sections = Array.from(previewEl.querySelectorAll<HTMLElement>('[data-marginalia-line-start]'));
		for (const section of sections) {
			const lineStart = parseInt(section.dataset['marginaliaLineStart'] ?? '', 10);
			const lineEnd = parseInt(section.dataset['marginaliaLineEnd'] ?? '', 10);
			if (isNaN(lineStart) || isNaN(lineEnd)) continue;

			const anchors = this.plugin.getCachedAnchors();
			const comments = this.plugin.getCachedComments();
			if (anchors.size === 0) continue;

			const resolutionMap = new Map<string, 'open' | 'resolved'>();
			for (const c of comments) {
				if (isRootComment(c)) {
					resolutionMap.set(c.id, getRootResolution(c));
				}
			}

			const relevantAnchors: Array<{
				commentId: string;
				anchor: ResolvedAnchor;
				resolved: boolean;
			}> = [];

			for (const [commentId, anchor] of anchors) {
				if (anchor.line >= lineStart && anchor.line <= lineEnd) {
					relevantAnchors.push({
						commentId,
						anchor,
						resolved: resolutionMap.get(commentId) === 'resolved',
					});
				}
			}

			if (relevantAnchors.length === 0) continue;

			this.highlightTextInElement(section, relevantAnchors);
		}
	}

	private highlightTextInElement(
		container: HTMLElement,
		anchors: Array<{commentId: string; anchor: ResolvedAnchor; resolved: boolean}>
	): void {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
		const textNodes: Text[] = [];
		let node: Node | null;

		while ((node = walker.nextNode())) {
			if (node.nodeType !== Node.TEXT_NODE) continue;
			if (node.parentElement?.closest('.marginalia-mobile-annotation')) continue;
			textNodes.push(node as Text);
		}

		for (const textNode of textNodes) {
			const text = textNode.textContent;
			if (!text || text.trim().length === 0) continue;

			const matches: Array<{offset: number; length: number; commentId: string; resolved: boolean}> = [];

			for (const {commentId, resolved} of anchors) {
				const exactText = this.getExactText(commentId);
				if (!exactText) continue;

				let idx = text.indexOf(exactText);
				while (idx !== -1) {
					matches.push({offset: idx, length: exactText.length, commentId, resolved});
					idx = text.indexOf(exactText, idx + 1);
				}
			}

			if (matches.length === 0) continue;

			matches.sort((a, b) => a.offset - b.offset);

			const fragment = document.createDocumentFragment();
			let lastIndex = 0;

			for (const match of matches) {
				if (match.offset > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.offset)));
				}

				const span = document.createElement('span');
				span.className = `marginalia-mobile-annotation${match.resolved ? ' marginalia-mobile-annotation-resolved' : ''}`;
				span.setAttribute('data-comment-ids', match.commentId);
				span.textContent = text.substring(match.offset, match.offset + match.length);

				span.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					MobileCommentPopup.show(this.plugin, [match.commentId]);
				});

				fragment.appendChild(span);
				lastIndex = match.offset + match.length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}

			if (textNode.parentNode) {
				textNode.parentNode.replaceChild(fragment, textNode);
			}
		}
	}

	private getExactText(commentId: string): string | null {
		const comments = this.plugin.getCachedComments();
		const comment = comments.find(c => c.id === commentId);
		if (!comment || !isAnchoredComment(comment)) return null;
		return comment.target.exact;
	}
}
