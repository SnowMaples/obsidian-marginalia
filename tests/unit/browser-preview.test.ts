import {describe, expect, it} from 'vitest';
import {BrowserCommentPreview} from '../../src/preview/BrowserCommentPreview';
import {CommentStore} from '../../src/storage/CommentStore';
import {MemoryVault} from '../helpers/MemoryVault';

describe('browser comment preview', () => {
	it('writes an escaped, searchable preview inside the Vault and opens its full path', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as never, '.marginalia');
		await store.initialize();
		await store.addNoteComment('notes/<unsafe>.md', '<script>alert(1)</script>');
		await store.flushAll();
		let openedPath = '';
		const preview = new BrowserCommentPreview(
			{vault} as never,
			store,
			'.config/plugins/marginalia',
			async path => { openedPath = path; },
		);

		await preview.open();

		const previewPath = '.config/plugins/marginalia/.marginalia-preview/comment-preview.html';
		const html = await vault.adapter.read(previewPath);
		expect(openedPath).toBe(`/vault/${previewPath}`);
		expect(html).toContain('id="preview-search"');
		expect(html).toContain('&lt;unsafe&gt;');
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>alert(1)</script>');
	});

	it('uses frontmatter titles and merged tag fields for topic navigation', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as never, '.marginalia');
		await store.initialize();
		await store.addNoteComment('notes/original.md', 'Frontmatter note');
		await store.addNoteComment('notes/untitled.md', 'Fallback note');
		await store.flushAll();
		const metadataByPath: Record<string, {frontmatter?: Record<string, unknown>}> = {
			'notes/original.md': {
				frontmatter: {
					title: '  Front <Title>  ',
					tag: '#Research',
					tags: ['research', ' #AI ', '', 42],
				},
			},
			'notes/untitled.md': {frontmatter: {title: '   ', tag: []}},
		};
		const preview = new BrowserCommentPreview(
			{
				vault,
				metadataCache: {getCache: (path: string) => metadataByPath[path] ?? null},
			} as never,
			store,
			'.config/plugins/marginalia',
			async () => undefined,
		);

		await preview.open();

		const html = await vault.adapter.read(
			'.config/plugins/marginalia/.marginalia-preview/comment-preview.html',
		);
		expect(html).toContain('Front &lt;Title&gt;');
		expect(html).toContain('data-title="Front &lt;Title&gt;"');
		expect(html).toContain('data-topics="[&quot;research&quot;,&quot;ai&quot;]"');
		expect(html).toContain('data-search="notes/original.md front &lt;title&gt; research ai frontmatter note"');
		expect(html).toContain('class="topic-chip');
		expect(html).toContain('data-topic="research"');
		expect(html).toContain('data-topic="ai"');
		expect(html).toContain('data-topic="__untagged"');
		expect(html).toContain('>untitled<');
		expect(html).not.toContain('>42<');
	});

	it('replaces status filters with topic controls while retaining useful sorting', async () => {
		const vault = new MemoryVault();
		const store = new CommentStore(vault as never, '.marginalia');
		await store.initialize();
		await store.addNoteComment('notes/topic.md', 'Topic note');
		await store.flushAll();
		const preview = new BrowserCommentPreview(
			{
				vault,
				metadataCache: {getCache: () => ({frontmatter: {title: 'Topic note', tag: 'Design'}})},
			} as never,
			store,
			'.config/plugins/marginalia',
			async () => undefined,
		);

		await preview.open();

		const html = await vault.adapter.read(
			'.config/plugins/marginalia/.marginalia-preview/comment-preview.html',
		);
		expect(html).toContain('class="topic-filter"');
		expect(html).toContain('value="title"');
		expect(html).toContain('value="path"');
		expect(html).toContain('value="comments"');
		expect(html).not.toContain('data-filter="open"');
		expect(html).not.toContain('data-filter="resolved"');
		expect(html).not.toContain('data-filter="orphaned"');
		expect(html).not.toContain('data-filter="replies"');
		expect(html).not.toContain('value="open"');
		expect(html).toContain('class="note-topics"');
		expect(html).toContain('class="content-frame"');
	});
});
