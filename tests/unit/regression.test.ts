import {describe, expect, it} from 'vitest';
import {resolveAnchor} from '../../src/anchoring/TextQuoteSelector';
import {CommentStore} from '../../src/storage/CommentStore';
import {createCommentFileName} from '../../src/storage/PathIndex';

class MemoryVault {
	adapter = new MemoryAdapter();
}

class MemoryAdapter {
	private files = new Map<string, string>();
	private folders = new Set<string>(['']);

	async exists(path: string): Promise<boolean> {
		const normalized = normalizeTestPath(path);
		return this.files.has(normalized) || this.folders.has(normalized);
	}

	async mkdir(path: string): Promise<void> {
		this.folders.add(normalizeTestPath(path));
	}

	async read(path: string): Promise<string> {
		const normalized = normalizeTestPath(path);
		const content = this.files.get(normalized);
		if (content == null) {
			throw new Error(`File not found: ${normalized}`);
		}
		return content;
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		this.ensureParentFolder(normalized);
		this.files.set(normalized, content);
	}

	async remove(path: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		if (!this.files.delete(normalized)) {
			throw new Error(`File not found: ${normalized}`);
		}
	}

	async copy(source: string, destination: string): Promise<void> {
		await this.write(destination, await this.read(source));
	}

	async rmdir(path: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(`${normalized}/`)) {
				throw new Error(`Folder is not empty: ${normalized}`);
			}
		}
		this.folders.delete(normalized);
	}

	async list(path: string): Promise<{files: string[]; folders: string[]}> {
		const normalized = normalizeTestPath(path);
		const prefix = normalized ? `${normalized}/` : '';
		const files: string[] = [];
		const folders: string[] = [];

		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(prefix)) {
				files.push(filePath);
			}
		}

		for (const folderPath of this.folders) {
			if (folderPath && folderPath.startsWith(prefix) && folderPath !== normalized) {
				folders.push(folderPath);
			}
		}

		return {files, folders};
	}

	private ensureParentFolder(path: string): void {
		const slash = path.lastIndexOf('/');
		if (slash > 0) {
			this.folders.add(path.slice(0, slash));
		}
	}
}

function normalizeTestPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

describe('regressions', () => {
	it('comment sidecar filenames do not collide for slash and double underscore paths', () => {
		expect(createCommentFileName('a/b.md')).not.toBe(createCommentFileName('a__b.md'));
		expect(createCommentFileName('a/b.md')).toBe('a%2Fb.md.json');
		expect(createCommentFileName('a__b.md')).toBe('a__b.md.json');
	});

	it('delete with keep policy preserves index mapping and sidecar file', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as unknown as ConstructorParameters<typeof CommentStore>[0], '.marginalia');
		await store.initialize();

		await store.addNoteComment('notes/deleted.md', 'keep this');
		await store.flushAll();

		const trackedBefore = store.getTrackedNotePaths();
		expect(trackedBefore).toEqual(['notes/deleted.md']);
		const sidecarPath = '.marginalia/notes%2Fdeleted.md.json';
		expect(await vault.adapter.exists(sidecarPath)).toBe(true);

		await store.handleDelete('notes/deleted.md', false);

		expect(store.getTrackedNotePaths()).toEqual(['notes/deleted.md']);
		expect(await vault.adapter.exists(sidecarPath)).toBe(true);
		expect((await store.getComments('notes/deleted.md')).length).toBe(1);
	});

	it('stage 1 anchor resolution chooses the local match with matching context', () => {
		const docText = [
			'first same',
			'context one',
			'second same',
			'context two',
		].join('\n');

		const anchor = resolveAnchor({
			exact: 'same',
			prefix: 'second ',
			suffix: '\ncontext two',
			lineHint: 2,
		}, docText, 0.3);

		expect(anchor).toBeTruthy();
		expect(anchor?.line).toBe(2);
		expect(docText.slice(anchor!.from, anchor!.to)).toBe('same');
	});
});
