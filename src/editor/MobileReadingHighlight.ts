import {MarkdownView} from 'obsidian';
import type {MarkdownPostProcessorContext} from 'obsidian';
import type MarginaliaPlugin from '../main';
import {isRootComment, getRootResolution} from '../types';
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

		this.applyHighlights(el, info.lineStart, info.lineEnd, anchors, resolutionMap);
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
			const resolutionMap = new Map<string, 'open' | 'resolved'>();
			for (const c of comments) {
				if (isRootComment(c)) {
					resolutionMap.set(c.id, getRootResolution(c));
				}
			}

			this.applyHighlights(section, lineStart, lineEnd, anchors, resolutionMap);
		}
	}

	private applyHighlights(
		el: HTMLElement,
		lineStart: number,
		lineEnd: number,
		anchors: Map<string, ResolvedAnchor>,
		resolutionMap: Map<string, 'open' | 'resolved'>
	): void {
		const relevantAnchors: Array<{commentId: string; anchor: ResolvedAnchor; resolved: boolean}> = [];

		for (const [commentId, anchor] of anchors) {
			if (anchor.line >= lineStart && anchor.line <= lineEnd) {
				relevantAnchors.push({
					commentId,
					anchor,
					resolved: resolutionMap.get(commentId) === 'resolved',
				});
			}
		}

		if (relevantAnchors.length === 0) return;

		this.highlightTextNodes(el, relevantAnchors, lineStart);
	}

	private highlightTextNodes(
		container: HTMLElement,
		anchors: Array<{commentId: string; anchor: ResolvedAnchor; resolved: boolean}>,
		sectionLineStart: number
	): void {
		const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
		let node: Node | null;

		while ((node = walker.nextNode())) {
			if (!node.parentElement || node.parentElement.closest('.marginalia-mobile-annotation')) continue;

			const text = node.textContent;
			if (!text || text.trim().length === 0) continue;

			const matchingAnchors = this.findMatchingAnchors(anchors, text, node, sectionLineStart);
			if (matchingAnchors.length === 0) continue;

			const fragment = document.createDocumentFragment();
			let lastIndex = 0;

			const sorted = matchingAnchors.sort((a, b) => a.textOffset - b.textOffset);

			for (const match of sorted) {
				if (match.textOffset > lastIndex) {
					fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.textOffset)));
				}

				const span = document.createElement('span');
				span.className = `marginalia-mobile-annotation${match.resolved ? ' marginalia-mobile-annotation-resolved' : ''}`;
				span.setAttribute('data-comment-ids', match.commentIds.join(','));
				span.textContent = match.matchedText;

				span.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					MobileCommentPopup.show(this.plugin, match.commentIds, span);
				});

				fragment.appendChild(span);
				lastIndex = match.textOffset + match.matchedText.length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
			}

			if (node.parentNode) {
				node.parentNode.replaceChild(fragment, node);
			}
		}
	}

	private findMatchingAnchors(
		anchors: Array<{commentId: string; anchor: ResolvedAnchor; resolved: boolean}>,
		text: string,
		node: Node,
		sectionLineStart: number
	): Array<{textOffset: number; matchedText: string; commentIds: string[]; resolved: boolean}> {
		const results: Array<{textOffset: number; matchedText: string; commentIds: string[]; resolved: boolean}> = [];

		for (const {commentId, resolved} of anchors) {
			const exactText = this.getExactText(commentId);
			if (!exactText) continue;

			const idx = text.indexOf(exactText);
			if (idx !== -1) {
				results.push({
					textOffset: idx,
					matchedText: exactText,
					commentIds: [commentId],
					resolved,
				});
			} else {
				const shortText = exactText.length > 50 ? exactText.substring(0, 50) : exactText;
				const shortIdx = text.indexOf(shortText);
				if (shortIdx !== -1) {
					results.push({
						textOffset: shortIdx,
						matchedText: shortText,
						commentIds: [commentId],
						resolved,
					});
				}
			}
		}

		return results;
	}

	private getExactText(commentId: string): string | null {
		const comments = this.plugin.getCachedComments();
		const comment = comments.find(c => c.id === commentId);
		if (!comment || !('target' in comment)) return null;
		return (comment as {target: {exact: string}}).target.exact;
	}
}
