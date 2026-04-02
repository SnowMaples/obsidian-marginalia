import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import {
	StateField,
	StateEffect,
	type Extension,
} from '@codemirror/state';
import type MarginaliaPlugin from '../main';
import {MobileCommentPopup} from './MobileCommentPopup';

interface MobileAnnotationInfo {
	from: number;
	to: number;
	commentIds: string[];
	allResolved: boolean;
	isOrphaned: boolean;
}

export const updateMobileAnnotations = StateEffect.define<MobileAnnotationInfo[]>();

function buildDecorations(
	infos: MobileAnnotationInfo[],
	doc: { length: number; sliceString: (from: number, to: number) => string }
): DecorationSet {
	const ranges: {from: number; to: number; value: Decoration}[] = [];

	for (const info of infos) {
		const safeFrom = Math.max(0, Math.min(info.from, doc.length));
		const safeTo = Math.max(safeFrom, Math.min(info.to, doc.length));
		if (safeFrom >= safeTo) continue;

		const text = doc.sliceString(safeFrom, safeTo);
		const cls = info.isOrphaned
			? 'marginalia-mobile-annotation marginalia-mobile-annotation-orphaned'
			: info.allResolved
				? 'marginalia-mobile-annotation marginalia-mobile-annotation-resolved'
				: 'marginalia-mobile-annotation';

		const mark = Decoration.mark({
			class: cls,
			attributes: {
				'data-comment-ids': info.commentIds.join(','),
			},
		});

		ranges.push({
			from: safeFrom,
			to: safeTo,
			value: mark,
		});
	}

	return Decoration.set(ranges, true);
}

export function createMobileAnnotationExtension(plugin: MarginaliaPlugin): Extension {
	const annotationField = StateField.define<MobileAnnotationInfo[]>({
		create(): MobileAnnotationInfo[] {
			return [];
		},
		update(value: MobileAnnotationInfo[], tr): MobileAnnotationInfo[] {
			for (const effect of tr.effects) {
				if (effect.is(updateMobileAnnotations)) {
					return effect.value;
				}
			}
			return value;
		},
	});

	const decorationField = StateField.define<DecorationSet>({
		create(): DecorationSet {
			return Decoration.none;
		},
		update(value: DecorationSet, tr): DecorationSet {
			for (const effect of tr.effects) {
				if (effect.is(updateMobileAnnotations)) {
					return buildDecorations(effect.value, tr.state.doc);
				}
			}
			if (tr.docChanged) {
				return value.map(tr.changes);
			}
			return value;
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	const clickPlugin = ViewPlugin.fromClass(
		class {
			update(_update: ViewUpdate) {}
		},
		{
			eventHandlers: {
				click: (event: MouseEvent, view: EditorView) => {
					const target = event.target as HTMLElement | null;
					if (!target) return;

					const annotation = target.closest('.marginalia-mobile-annotation');
					if (!annotation) return;

					const commentIdsStr = annotation.getAttribute('data-comment-ids');
					if (!commentIdsStr) return;

					event.preventDefault();
					event.stopPropagation();

					const commentIds = commentIdsStr.split(',').filter(Boolean);
					if (commentIds.length > 0) {
						MobileCommentPopup.show(plugin, commentIds);
					}
				},
			},
		},
	);

	return [annotationField, decorationField, clickPlugin];
}
