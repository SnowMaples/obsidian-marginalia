import {describe, expect, it} from 'vitest';
import {CommentStore} from '../../src/storage/CommentStore';
import {PathIndex} from '../../src/storage/PathIndex';
import {MemoryVault} from '../helpers/MemoryVault';

function commentFile(sourceFile: string, body: string, updatedAt: string): string {
	return JSON.stringify({
		version: 1,
		sourceFile,
		comments: [{
			kind: 'note',
			id: body,
			body,
			resolution: 'open',
			createdAt: updatedAt,
			updatedAt,
		}],
	});
}

describe('storage repair and cleanup', () => {
	it('backs up a corrupt index and rebuilds mappings from valid sidecars', async () => {
		const vault = new MemoryVault();
		await vault.adapter.mkdir('.marginalia');
		await vault.adapter.write('.marginalia/_index.json', '{broken');
		await vault.adapter.write(
			'.marginalia/legacy__note.md.json',
			commentFile('legacy/note.md', 'valid', '2026-01-01T00:00:00.000Z'),
		);
		await vault.adapter.write('.marginalia/invalid.json', '{also broken');

		const index = new PathIndex(vault as never, '.marginalia');
		const result = await index.load();

		expect(result).toMatchObject({
			status: 'rebuilt',
			repair: {restored: 1, invalid: 1, conflicts: 0},
		});
		expect(index.getCommentFileName('legacy/note.md')).toBe('legacy__note.md.json');
		const files = (await vault.adapter.list('.marginalia')).files;
		expect(files.some(path => path.includes('_index.corrupt.'))).toBe(true);
	});

	it('keeps legacy mappings readable while using collision-free names for new notes', async () => {
		const vault = new MemoryVault();
		await vault.adapter.mkdir('.marginalia');
		await vault.adapter.write('.marginalia/_index.json', JSON.stringify({
			version: 1,
			mappings: {'Folder/Note.md': 'Folder__Note.md.json'},
		}));
		const index = new PathIndex(vault as never, '.marginalia');
		await index.load();

		expect(index.getCommentFileName('folder/note.md')).toBe('Folder__Note.md.json');
		expect(index.getOrCreateCommentFileName('new/path.md')).toBe('new%2Fpath.md.json');
	});

	it('removes the sidecar and mapping after deleting the final comment', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as never, '.marginalia');
		await store.initialize();
		const comment = await store.addNoteComment('note.md', 'only comment');
		await store.flushAll();
		const fileName = store.pathIndex.getCommentFileName('note.md')!;

		await store.deleteComment('note.md', comment.id);

		expect(store.pathIndex.getCommentFileName('note.md')).toBeUndefined();
		expect(await vault.adapter.exists(`.marginalia/${fileName}`)).toBe(false);
	});

	it('updates sourceFile when an uncached note is renamed', async () => {
		const vault = new MemoryVault();
		const writer = new CommentStore(vault as never, '.marginalia');
		await writer.initialize();
		await writer.addNoteComment('old.md', 'rename me');
		await writer.flushAll();
		const fileName = writer.pathIndex.getCommentFileName('old.md')!;

		const reader = new CommentStore(vault as never, '.marginalia');
		await reader.initialize();
		await reader.handleRename('old.md', 'new.md');
		await reader.flushAll();

		const stored = JSON.parse(await vault.adapter.read(`.marginalia/${fileName}`)) as {sourceFile: string};
		expect(stored.sourceFile).toBe('new.md');
		expect(await reader.getComments('new.md')).toHaveLength(1);
	});
});
