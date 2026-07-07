import {describe, expect, it} from 'vitest';
import {resolveAnchor} from '../../src/anchoring/TextQuoteSelector';
import {CommentStore} from '../../src/storage/CommentStore';
import {PathIndex} from '../../src/storage/PathIndex';
import {MemoryVault} from '../helpers/MemoryVault';

describe('develop regressions', () => {
	it('creates distinct sidecar filenames for slash and double-underscore paths', () => {
		const vault = new MemoryVault();
		const slashIndex = new PathIndex(vault as never, '.marginalia');
		const underscoreIndex = new PathIndex(vault as never, '.marginalia');

		expect(slashIndex.getOrCreateCommentFileName('a/b.md'))
			.not.toBe(underscoreIndex.getOrCreateCommentFileName('a__b.md'));
	});

	it('keeps the index mapping and sidecar when note deletion policy is keep', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as never, '.marginalia');
		await store.initialize();
		await store.addNoteComment('notes/deleted.md', 'keep this');
		await store.flushAll();

		const fileName = store.pathIndex.getCommentFileName('notes/deleted.md');
		expect(fileName).toBeTruthy();
		await store.handleDelete('notes/deleted.md', false);

		expect(store.pathIndex.getCommentFileName('notes/deleted.md')).toBe(fileName);
		expect(await vault.adapter.exists(`.marginalia/${fileName}`)).toBe(true);
		expect(await store.getComments('notes/deleted.md')).toHaveLength(1);
	});

	it('chooses the nearby exact anchor with matching context', () => {
		const docText = ['first same', 'context one', 'second same', 'context two'].join('\n');
		const anchor = resolveAnchor({
			exact: 'same',
			prefix: 'second ',
			suffix: '\ncontext two',
			lineHint: 2,
		}, docText, 0.3);

		expect(anchor?.line).toBe(2);
		expect(docText.slice(anchor!.from, anchor!.to)).toBe('same');
	});
});
