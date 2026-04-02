import {
	Decoration,
	EditorView,
	type DecorationSet,
} from '@codemirror/view';
import {
	StateField,
	StateEffect,
	type Extension,
} from '@codemirror/state';
import type MarginaliaPlugin from '../main';
import type {ResolvedAnchor} from '../types';

interface MobileAnnotationInfo {
	from: number;
	to: number;
	commentIds: string[];
	allResolved: boolean;
	isOrphaned: boolean;
}

export const updateMobileAnnotations = StateEffect.define<MobileAnnotationInfo[]>();

function buildDecorations(
	plugin: MarginaliaPlugin,
	infos: MobileAnnotationInfo[],
	doc: { length: number }
): DecorationSet {
	const ranges: {from: number; to: number; value: Decoration}[] = [];

	for (const info of infos) {
		const safeFrom = Math.max(0, Math.min(info.from, doc.length));
		const safeTo = Math.max(safeFrom, Math.min(info.to, doc.length));
		if (safeFrom >= safeTo) continue;

		const mark = Decoration.mark({
			class: info.isOrphaned
				? 'marginalia-mobile-annotation marginalia-mobile-annotation-orphaned'
				: info.allResolved
					? 'marginalia-mobile-annotation marginalia-mobile-annotation-resolved'
					: 'marginalia-mobile-annotation',
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
					return buildDecorations(plugin, effect.value, tr.state.doc);
				}
			}
			if (tr.docChanged) {
				return value.map(tr.changes);
			}
			return value;
		},
		provide: (f) => EditorView.decorations.from(f),
	});

	return [annotationField, decorationField];
}

export function buildMobileAnnotationInfos(
	anchors: Map<string, ResolvedAnchor>,
): MobileAnnotationInfo[] {
	const infos: MobileAnnotationInfo[] = [];

	for (const [commentId, anchor] of anchors) {
		infos.push({
			from: anchor.from,
			to: anchor.to,
			commentIds: [commentId],
			allResolved: false,
			isOrphaned: false,
		});
	}

	return infos;
}
