import {normalizePath, type App} from 'obsidian';
import type {CommentStore} from '../storage/CommentStore';
import type {CommentThread, NoteComment, ReplyComment} from '../types';
import {getPanelData} from '../comment/threading';
import {displayAnchorStatus, displayResolution, previewT} from '../i18n';

interface PreviewNote {
	id: string;
	title: string;
	path: string;
	tags: string[];
	topicKeys: string[];
	commentCount: number;
	noteCommentCount: number;
	anchoredCommentCount: number;
	replyCount: number;
	updatedAt: string;
	searchText: string;
	noteComments: NoteComment[];
	threads: CommentThread[];
}

interface ElectronShell {
	openPath?: (path: string) => Promise<string>;
}

interface ElectronModule {
	shell?: ElectronShell;
}

interface WindowWithRequire extends Window {
	require?: (module: string) => unknown;
}

interface AdapterWithFullPath {
	getFullPath(path: string): string;
}

type PreviewFileOpener = (filePath: string) => Promise<void>;

export class BrowserCommentPreview {
	private app: App;
	private store: CommentStore;
	private previewRootPath: string;
	private openFile: PreviewFileOpener;

	constructor(app: App, store: CommentStore, previewRootPath: string, openFile: PreviewFileOpener = openInDefaultBrowser) {
		this.app = app;
		this.store = store;
		this.previewRootPath = previewRootPath;
		this.openFile = openFile;
	}

	async open(): Promise<void> {
		const notes = await this.loadPreviewNotes();
		const html = this.renderHtml(notes);
		const filePath = await this.writePreviewFile(html);
		await this.openFile(filePath);
	}

	private async loadPreviewNotes(): Promise<PreviewNote[]> {
		const notes: PreviewNote[] = [];
		const notePaths = this.store.getTrackedNotePaths().sort((a, b) => a.localeCompare(b));

		for (const notePath of notePaths) {
			const comments = await this.store.getComments(notePath);
			if (comments.length === 0) continue;

			const metadata = getPreviewMetadata(this.app, notePath);
			const panelData = getPanelData(comments);
			const stats = computePreviewStats(
				notePath,
				metadata.title,
				metadata.tags,
				panelData.noteComments,
				panelData.threads,
			);
			notes.push({
				id: `note-${notes.length}`,
				title: metadata.title,
				path: notePath,
				tags: metadata.tags,
				topicKeys: metadata.topicKeys,
				commentCount: comments.length,
				noteCommentCount: panelData.noteComments.length,
				anchoredCommentCount: panelData.threads.length,
				replyCount: stats.replyCount,
				updatedAt: stats.updatedAt,
				searchText: stats.searchText,
				noteComments: panelData.noteComments,
				threads: panelData.threads,
			});
		}

		return notes.sort((a, b) => getTimeValue(b.updatedAt) - getTimeValue(a.updatedAt));
	}

	private renderHtml(notes: PreviewNote[]): string {
		const generatedAt = new Date().toLocaleString();
		const totalComments = notes.reduce((sum, note) => sum + note.commentCount, 0);
		const firstNoteId = notes[0]?.id ?? '';

		return `<!doctype html>
<html lang="${previewT.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(previewT.title)}</title>
<style>
${PREVIEW_CSS}
</style>
</head>
<body>
<header class="preview-header">
	<div>
		<h1>${escapeHtml(previewT.title)}</h1>
		<p>${escapeHtml(previewT.generatedSummary(generatedAt, notes.length, totalComments))}</p>
	</div>
</header>
${notes.length === 0 ? renderEmptyState() : renderPreviewShell(notes)}
<script>
${renderPreviewScript(firstNoteId)}
</script>
</body>
</html>`;
	}

	private async writePreviewFile(html: string): Promise<string> {
		const dir = normalizePath(`${this.previewRootPath}/.marginalia-preview`);
		if (!(await this.app.vault.adapter.exists(dir))) await this.app.vault.adapter.mkdir(dir);
		const vaultPath = normalizePath(`${dir}/comment-preview.html`);
		await this.app.vault.adapter.write(vaultPath, html);

		const adapter = this.app.vault.adapter as unknown as Partial<AdapterWithFullPath>;
		if (typeof adapter.getFullPath !== 'function') {
			throw new Error('The active Vault adapter does not expose a desktop file path.');
		}
		return adapter.getFullPath(vaultPath);
	}
}

function renderPreviewShell(notes: PreviewNote[]): string {
	const topics = collectTopics(notes);
	const hasUntaggedNotes = notes.some(note => note.tags.length === 0);
	return `<main class="preview-shell">
	<section class="preview-controls" aria-label="${escapeAttr(previewT.controlsLabel)}">
		<div class="control-primary">
			<label class="search-box">
				<span>${escapeHtml(previewT.searchLabel)}</span>
				<input id="preview-search" type="search" placeholder="${escapeAttr(previewT.searchPlaceholder)}" autocomplete="off">
			</label>
			<label class="sort-box">
				<span>${escapeHtml(previewT.sortLabel)}</span>
				<select id="preview-sort">
					<option value="updated">${escapeHtml(previewT.sort.updated)}</option>
					<option value="title">${escapeHtml(previewT.sort.title)}</option>
					<option value="path">${escapeHtml(previewT.sort.path)}</option>
					<option value="comments">${escapeHtml(previewT.sort.comments)}</option>
				</select>
			</label>
			<div class="result-count" id="result-count"></div>
		</div>
		<div class="topic-filter" role="group" aria-label="${escapeAttr(previewT.topicsLabel)}">
			<span class="topic-filter-label">${escapeHtml(previewT.topicsLabel)}</span>
			<div class="topic-chips">
				${renderTopicButton('__all', previewT.allTopics, true)}
				${hasUntaggedNotes ? renderTopicButton('__untagged', previewT.untagged, false) : ''}
				${topics.map(topic => renderTopicButton(topic.key, topic.label, false)).join('\n')}
			</div>
		</div>
	</section>
	<section class="mobile-note-picker">
		<button id="mobile-note-toggle" type="button" aria-expanded="false">${escapeHtml(previewT.selectNote)}</button>
	</section>
	<section class="preview-body">
		<nav class="note-list" aria-label="${escapeAttr(previewT.annotatedNotesLabel)}">
		${notes.map((note, idx) => renderNoteTab(note, idx === 0)).join('\n')}
		</nav>
		<section class="comment-content"><div class="content-frame">
		${notes.map((note, idx) => renderNotePanel(note, idx === 0)).join('\n')}
		<div class="empty-state no-results" id="no-results" hidden>
			<h2>${escapeHtml(previewT.noMatchingTitle)}</h2>
			<p>${escapeHtml(previewT.noMatchingDesc)}</p>
			<button id="clear-search" type="button">${escapeHtml(previewT.clearSearch)}</button>
		</div>
		</div></section>
	</section>
</main>`;
}

function renderNoteTab(note: PreviewNote, active: boolean): string {
	return `<button class="note-tab${active ? ' is-active' : ''}" type="button" data-note-target="${escapeAttr(note.id)}" data-search="${escapeAttr(note.searchText)}" data-path="${escapeAttr(note.path)}" data-title="${escapeAttr(note.title)}" data-topics="${escapeAttr(JSON.stringify(note.topicKeys))}" data-updated="${escapeAttr(note.updatedAt)}" data-comments="${note.commentCount}">
	<span class="note-title">${escapeHtml(note.title)}</span>
	<span class="note-path">${escapeHtml(note.path)}</span>
	<span class="note-count">${note.commentCount}</span>
	${renderNoteTopics(note.tags)}
</button>`;
}

function renderNotePanel(note: PreviewNote, active: boolean): string {
	return `<article class="note-panel${active ? ' is-active' : ''}" id="${escapeAttr(note.id)}">
	<div class="note-panel-header">
		<h2>${escapeHtml(note.title)}</h2>
		<p>${escapeHtml(note.path)}</p>
		${renderNoteTopics(note.tags)}
		<div class="note-summary">
			${renderStatBadge('note', note.noteCommentCount)}
			${renderStatBadge('anchored', note.anchoredCommentCount)}
			${renderStatBadge('replies', note.replyCount)}
		</div>
	</div>
	${note.noteComments.length > 0 ? `<section class="comment-section">
		<h3>${escapeHtml(previewT.sections.noteComments)}</h3>
		${note.noteComments.map(renderNoteComment).join('\n')}
	</section>` : ''}
	${note.threads.length > 0 ? `<section class="comment-section">
		<h3>${escapeHtml(previewT.sections.anchoredComments)}</h3>
		${note.threads.map(renderThread).join('\n')}
	</section>` : ''}
</article>`;
}

function renderTopicButton(key: string, label: string, active: boolean): string {
	return `<button class="topic-chip${active ? ' is-active' : ''}" type="button" data-topic="${escapeAttr(key)}">${escapeHtml(label)}</button>`;
}

function renderNoteTopics(tags: string[]): string {
	if (tags.length === 0) return `<span class="note-topics"><span class="note-topic is-untagged">${escapeHtml(previewT.untagged)}</span></span>`;
	return `<span class="note-topics">${tags.map(tag => `<span class="note-topic">${escapeHtml(tag)}</span>`).join('')}</span>`;
}

function renderStatBadge(label: string, count: number): string {
	return `<span class="stat-badge" data-count="${count}">${count} ${escapeHtml(getPreviewBadgeLabel(label))}</span>`;
}

function getPreviewBadgeLabel(label: string): string {
	const labels: Record<string, string> = previewT.badges;
	return labels[label] ?? label;
}

function renderNoteComment(comment: NoteComment): string {
	return `<article class="comment-card note-comment">
	<div class="comment-meta">
		<span>${escapeHtml(previewT.sections.noteComments)}</span>
		<span>${escapeHtml(displayResolution(comment))}</span>
		<span>${escapeHtml(formatTimestamp(comment.createdAt))}</span>
	</div>
	<pre class="comment-body">${escapeHtml(comment.body)}</pre>
</article>`;
}

function renderThread(thread: CommentThread): string {
	const root = thread.root;
	return `<article class="comment-card anchored-comment ${root.status === 'orphaned' ? 'is-orphaned' : ''}">
	<blockquote>${escapeHtml(root.target.exact)}</blockquote>
	<div class="comment-meta">
		<span>${escapeHtml(displayResolution(root))}</span>
		<span>${escapeHtml(displayAnchorStatus(root))}</span>
		<span>${escapeHtml(formatTimestamp(root.createdAt))}</span>
	</div>
	<pre class="comment-body">${escapeHtml(root.body)}</pre>
	${thread.replies.length > 0 ? `<div class="reply-list">
		<h4>${escapeHtml(previewT.sections.replies)}</h4>
		${thread.replies.map(renderReply).join('\n')}
	</div>` : ''}
</article>`;
}

function renderReply(reply: ReplyComment): string {
	return `<article class="reply-card">
	<div class="comment-meta">
		<span>${escapeHtml(formatTimestamp(reply.createdAt))}</span>
		<span>${escapeHtml(reply.id)}</span>
	</div>
	<pre class="comment-body">${escapeHtml(reply.body)}</pre>
</article>`;
}

function renderEmptyState(): string {
	return `<main class="empty-state">
	<h2>${escapeHtml(previewT.noCommentsTitle)}</h2>
	<p>${escapeHtml(previewT.noCommentsDesc)}</p>
</main>`;
}

function renderPreviewScript(firstNoteId: string): string {
	const resultCountTemplate = previewT.resultCount('__VISIBLE__', '__TOTAL__');
	return `
const tabs = Array.from(document.querySelectorAll('.note-tab'));
const panels = Array.from(document.querySelectorAll('.note-panel'));
const searchInput = document.getElementById('preview-search');
const sortSelect = document.getElementById('preview-sort');
const topicButtons = Array.from(document.querySelectorAll('.topic-chip'));
const resultCount = document.getElementById('result-count');
const noResults = document.getElementById('no-results');
const clearSearch = document.getElementById('clear-search');
const noteList = document.querySelector('.note-list');
const commentContent = document.querySelector('.comment-content');
const mobileToggle = document.getElementById('mobile-note-toggle');
let currentTopic = '__all';
let currentNoteId = ${JSON.stringify(firstNoteId)};

function selectNote(id) {
	currentNoteId = id;
	for (const tab of tabs) {
		tab.classList.toggle('is-active', tab.dataset.noteTarget === id);
	}
	for (const panel of panels) {
		panel.classList.toggle('is-active', panel.id === id);
	}
	if (commentContent) {
		commentContent.scrollTop = 0;
		window.scrollTo({ top: 0, behavior: 'instant' });
	}
	if (mobileToggle) {
		const selected = tabs.find(tab => tab.dataset.noteTarget === id);
		mobileToggle.textContent = selected ? selected.querySelector('.note-title').textContent : ${JSON.stringify(previewT.selectNote)};
		mobileToggle.setAttribute('aria-expanded', 'false');
	}
	if (noteList) {
		noteList.classList.remove('is-open');
	}
}

function getTabTopics(tab) {
	try {
		const topics = JSON.parse(tab.dataset.topics || '[]');
		return Array.isArray(topics) ? topics : [];
	} catch {
		return [];
	}
}

function noteMatchesTopic(tab) {
	if (currentTopic === '__all') return true;
	const topics = getTabTopics(tab);
	if (currentTopic === '__untagged') return topics.length === 0;
	return topics.includes(currentTopic);
}

function noteMatchesSearch(tab, query) {
	return !query || tab.dataset.search.includes(query);
}

function sortVisibleTabs() {
	if (!noteList || !sortSelect) return;
	const sorted = [...tabs].sort((a, b) => {
		const mode = sortSelect.value;
		if (mode === 'title') return a.dataset.title.localeCompare(b.dataset.title);
		if (mode === 'path') return a.dataset.path.localeCompare(b.dataset.path);
		if (mode === 'comments') return Number(b.dataset.comments) - Number(a.dataset.comments);
		return new Date(b.dataset.updated).getTime() - new Date(a.dataset.updated).getTime();
	});
	for (const tab of sorted) {
		noteList.appendChild(tab);
	}
}

function applyControls() {
	const query = searchInput ? searchInput.value.trim().toLocaleLowerCase() : '';
	let visible = [];
	sortVisibleTabs();
	for (const tab of tabs) {
		const show = noteMatchesTopic(tab) && noteMatchesSearch(tab, query);
		tab.hidden = !show;
		if (show) visible.push(tab);
	}

	const visibleIds = new Set(visible.map(tab => tab.dataset.noteTarget));
	for (const panel of panels) {
		panel.hidden = !visibleIds.has(panel.id);
	}

	if (resultCount) {
		resultCount.textContent = ${JSON.stringify(resultCountTemplate)}
			.replace('__VISIBLE__', String(visible.length))
			.replace('__TOTAL__', String(tabs.length));
	}
	if (noResults) {
		noResults.hidden = visible.length !== 0;
	}

	if (visible.length === 0) {
		for (const panel of panels) panel.classList.remove('is-active');
		for (const tab of tabs) tab.classList.remove('is-active');
		return;
	}

	if (!visibleIds.has(currentNoteId)) {
		selectNote(visible[0].dataset.noteTarget);
	} else {
		selectNote(currentNoteId);
	}
}

for (const tab of tabs) {
	tab.addEventListener('click', () => selectNote(tab.dataset.noteTarget));
}

for (const button of topicButtons) {
	button.addEventListener('click', () => {
		currentTopic = button.dataset.topic;
		for (const btn of topicButtons) {
			btn.classList.toggle('is-active', btn === button);
		}
		applyControls();
	});
}

if (searchInput) {
	searchInput.addEventListener('input', applyControls);
}

if (sortSelect) {
	sortSelect.addEventListener('change', applyControls);
}

if (clearSearch) {
	clearSearch.addEventListener('click', () => {
		if (searchInput) searchInput.value = '';
		currentTopic = '__all';
		for (const btn of topicButtons) {
			btn.classList.toggle('is-active', btn.dataset.topic === '__all');
		}
		applyControls();
	});
}

if (mobileToggle && noteList) {
	mobileToggle.addEventListener('click', () => {
		const open = !noteList.classList.contains('is-open');
		noteList.classList.toggle('is-open', open);
		mobileToggle.setAttribute('aria-expanded', String(open));
	});
}

applyControls();
`;
}

function computePreviewStats(
	notePath: string,
	title: string,
	tags: string[],
	noteComments: NoteComment[],
	threads: CommentThread[],
): {
	replyCount: number;
	updatedAt: string;
	searchText: string;
} {
	let replyCount = 0;
	let updatedAt = '';
	const searchParts = [notePath, title, ...tags];

	for (const comment of noteComments) {
		updatedAt = maxTimestamp(updatedAt, comment.updatedAt);
		searchParts.push(comment.body);
	}

	for (const thread of threads) {
		const root = thread.root;
		replyCount += thread.replies.length;
		updatedAt = maxTimestamp(updatedAt, root.updatedAt);
		searchParts.push(root.target.exact, root.body);

		for (const reply of thread.replies) {
			updatedAt = maxTimestamp(updatedAt, reply.updatedAt);
			searchParts.push(reply.body);
		}
	}

	return {
		replyCount,
		updatedAt,
		searchText: searchParts.join(' ').toLocaleLowerCase(),
	};
}

function maxTimestamp(a: string, b: string): string {
	if (!a) return b;
	return getTimeValue(a) >= getTimeValue(b) ? a : b;
}

function getTimeValue(value: string): number {
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}

async function openInDefaultBrowser(filePath: string): Promise<void> {
	const electron = getElectronModule();
	const shell = electron?.shell;

	if (shell?.openPath) {
		const error = await shell.openPath(filePath);
		if (error) throw new Error(error);
		return;
	}

	throw new Error('Electron shell.openPath is unavailable.');
}

function getElectronModule(): ElectronModule | null {
	const requireFn = (window as WindowWithRequire).require;
	if (!requireFn) return null;

	const electron = requireFn('electron') as ElectronModule;
	return electron;
}

function getPreviewMetadata(app: App, notePath: string): {title: string; tags: string[]; topicKeys: string[]} {
	const frontmatter = app.metadataCache?.getCache(notePath)?.frontmatter;
	const rawTitle = isRecord(frontmatter) ? frontmatter['title'] : undefined;
	const title = typeof rawTitle === 'string' && rawTitle.trim()
		? rawTitle.trim()
		: getNoteTitle(notePath);
	const tags = isRecord(frontmatter)
		? normalizeTags(frontmatter['tag'], frontmatter['tags'])
		: [];
	return {title, tags, topicKeys: tags.map(normalizeTopicKey)};
}

function normalizeTags(...values: unknown[]): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const entries = Array.isArray(value) ? value : [value];
		for (const entry of entries) {
			if (typeof entry !== 'string') continue;
			const tag = entry.trim().replace(/^#+/, '').trim();
			if (!tag) continue;
			const key = normalizeTopicKey(tag);
			if (seen.has(key)) continue;
			seen.add(key);
			tags.push(tag);
		}
	}
	return tags;
}

function normalizeTopicKey(tag: string): string {
	return tag.toLocaleLowerCase();
}

function collectTopics(notes: PreviewNote[]): Array<{key: string; label: string}> {
	const topics = new Map<string, string>();
	for (const note of notes) {
		for (let idx = 0; idx < note.topicKeys.length; idx++) {
			const key = note.topicKeys[idx];
			const label = note.tags[idx];
			if (key && label && !topics.has(key)) topics.set(key, label);
		}
	}
	return [...topics.entries()]
		.map(([key, label]) => ({key, label}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNoteTitle(notePath: string): string {
	const fileName = notePath.split('/').pop() ?? notePath;
	return fileName.replace(/\.md$/i, '');
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
	return escapeHtml(value);
}

const PREVIEW_CSS = `
:root {
	color-scheme: light dark;
	--bg: #f7f6f3;
	--panel: #ffffff;
	--panel-soft: #f0efeb;
	--text: #24211d;
	--muted: #706a61;
	--border: #ded9d0;
	--accent: #4f6f52;
	--accent-soft: #e1eadf;
	--warning: #9c5a2c;
	--shadow: 0 12px 28px rgba(34, 29, 22, 0.08);
	font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

@media (prefers-color-scheme: dark) {
	:root {
		--bg: #1f1e1b;
		--panel: #292824;
		--panel-soft: #24231f;
		--text: #eee9df;
		--muted: #aaa296;
		--border: #403d36;
		--accent: #9eb68f;
		--accent-soft: #303a2d;
		--warning: #d69b69;
		--shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
	}
}

* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: var(--bg);
	color: var(--text);
	font-size: 15px;
	line-height: 1.65;
}

.preview-header {
	padding: 28px clamp(18px, 4vw, 56px) 22px;
	border-bottom: 1px solid var(--border);
	background: var(--panel);
}

.preview-header > div {
	width: min(1420px, 100%);
	margin: 0 auto;
}

.preview-header h1 {
	margin: 0;
	font-size: clamp(24px, 3vw, 34px);
	line-height: 1.15;
	letter-spacing: -0.02em;
}

.preview-header p,
.note-panel-header p,
.empty-state p {
	margin: 4px 0 0;
	color: var(--muted);
}

.preview-shell {
	display: grid;
	grid-template-rows: auto auto minmax(0, 1fr);
	gap: 20px;
	width: min(1480px, 100%);
	margin: 0 auto;
	padding: 22px clamp(16px, 3vw, 36px) 36px;
	min-height: calc(100vh - 104px);
}

.preview-controls {
	position: sticky;
	top: 0;
	z-index: 10;
	display: grid;
	gap: 14px;
	padding: 16px 18px;
	background: var(--panel);
	background: color-mix(in srgb, var(--panel) 94%, transparent);
	border: 1px solid var(--border);
	border-radius: 14px;
	box-shadow: var(--shadow);
	backdrop-filter: blur(12px);
}

.control-primary {
	display: grid;
	grid-template-columns: minmax(300px, 1fr) minmax(170px, 220px) auto;
	gap: 12px;
	align-items: end;
}

.search-box,
.sort-box {
	display: grid;
	gap: 4px;
	color: var(--muted);
	font-size: 12px;
	font-weight: 650;
}

.search-box input,
.sort-box select {
	min-height: 42px;
	width: 100%;
	padding: 9px 12px;
	color: var(--text);
	background: var(--panel-soft);
	border: 1px solid var(--border);
	border-radius: 10px;
	font: inherit;
}

.topic-filter {
	display: grid;
	gap: 7px;
	min-width: 0;
}

.topic-filter-label {
	color: var(--muted);
	font-size: 12px;
	font-weight: 650;
}

.topic-chips {
	display: flex;
	flex-wrap: nowrap;
	gap: 7px;
	padding-bottom: 3px;
	overflow-x: auto;
	scrollbar-width: thin;
}

.topic-chip {
	flex: 0 0 auto;
}

.topic-chip,
#clear-search,
#mobile-note-toggle {
	min-height: 34px;
	padding: 6px 11px;
	color: var(--text);
	background: var(--panel-soft);
	border: 1px solid var(--border);
	border-radius: 999px;
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.topic-chip:hover,
.topic-chip.is-active,
#clear-search:hover,
#mobile-note-toggle:hover {
	background: var(--accent-soft);
	border-color: var(--accent);
}

.topic-chip.is-active {
	color: var(--accent);
	font-weight: 700;
}

.result-count {
	align-self: center;
	color: var(--muted);
	font-size: 12px;
	white-space: nowrap;
}

.mobile-note-picker {
	display: none;
}

.preview-body {
	display: grid;
	grid-template-columns: minmax(240px, 310px) minmax(0, 1fr);
	gap: clamp(18px, 3vw, 36px);
	align-items: start;
	min-height: 0;
}

.note-list {
	position: sticky;
	top: 164px;
	display: flex;
	flex-direction: column;
	gap: 9px;
	min-width: 0;
	max-height: calc(100vh - 186px);
	padding-right: 4px;
	overflow: auto;
}

.note-tab {
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 4px 10px;
	width: 100%;
	padding: 12px 13px;
	text-align: left;
	color: var(--text);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 12px;
	box-shadow: none;
	cursor: pointer;
	transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
}

.note-tab:hover {
	border-color: var(--accent);
	transform: translateY(-1px);
}

.note-tab.is-active {
	background: var(--accent-soft);
	border-color: var(--accent);
}

.note-tab.is-active::before {
	position: absolute;
	top: 10px;
	bottom: 10px;
	left: -1px;
	width: 3px;
	border-radius: 0 3px 3px 0;
	background: var(--accent);
	content: '';
}

.note-title {
	grid-column: 1;
	grid-row: 1;
	font-size: 14px;
	font-weight: 720;
	line-height: 1.35;
	overflow-wrap: anywhere;
}

.note-path {
	grid-column: 1 / -1;
	color: var(--muted);
	font-size: 12px;
	overflow-wrap: anywhere;
}

.note-count {
	grid-column: 2;
	grid-row: 1;
	justify-self: end;
	align-self: start;
	min-width: 24px;
	padding: 1px 6px;
	text-align: center;
	border-radius: 999px;
	color: var(--panel);
	background: var(--accent);
	font-size: 12px;
}

.note-topics {
	grid-column: 1 / -1;
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
	margin-top: 3px;
}

.note-topic {
	padding: 2px 7px;
	border-radius: 999px;
	background: var(--accent-soft);
	color: var(--accent);
	font-size: 11px;
	font-weight: 650;
}

.note-topic.is-untagged {
	background: var(--panel-soft);
	color: var(--muted);
}

.note-summary {
	grid-column: 1 / -1;
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 4px;
}

.stat-badge {
	padding: 1px 6px;
	border-radius: 999px;
	background: var(--panel-soft);
	color: var(--muted);
	font-size: 11px;
}

.stat-badge[data-count="0"] {
	display: none;
}

.comment-content {
	min-width: 0;
}

.content-frame {
	width: min(920px, 100%);
	margin: 0 auto;
}

.note-panel {
	display: none;
}

.note-panel.is-active {
	display: block;
}

.note-panel-header,
.empty-state {
	margin-bottom: 20px;
	padding: clamp(18px, 3vw, 28px);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 16px;
	box-shadow: var(--shadow);
}

.note-panel-header h2,
.empty-state h2 {
	margin: 0;
	font-size: clamp(24px, 3vw, 34px);
	line-height: 1.2;
	letter-spacing: -0.025em;
	overflow-wrap: anywhere;
}

.note-panel-header .note-topics {
	margin-top: 12px;
}

.comment-section {
	margin-bottom: 24px;
}

.comment-section h3 {
	margin: 0 0 10px;
	color: var(--muted);
	font-size: 13px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.comment-card,
.reply-card {
	margin-bottom: 12px;
	padding: clamp(14px, 2vw, 20px);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 14px;
	box-shadow: var(--shadow);
}

.comment-card.is-orphaned {
	border-left: 4px solid var(--warning);
}

blockquote {
	margin: 0 0 14px;
	padding: 11px 14px;
	color: var(--muted);
	background: var(--panel-soft);
	border-left: 3px solid var(--accent);
	border-radius: 0 10px 10px 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.comment-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-bottom: 8px;
	color: var(--muted);
	font-size: 12px;
}

.comment-meta span {
	padding: 1px 6px;
	border-radius: 999px;
	background: var(--panel-soft);
}

.comment-body {
	margin: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font: inherit;
	font-size: 15px;
	line-height: 1.72;
}

.reply-list {
	margin-top: 10px;
	padding-left: 14px;
	border-left: 2px solid var(--border);
}

.reply-list h4 {
	margin: 0 0 8px;
	color: var(--muted);
	font-size: 13px;
}

.reply-card {
	box-shadow: none;
	background: var(--panel-soft);
}

.empty-state {
	margin: 16px;
}

.no-results[hidden] {
	display: none;
}

@media (max-width: 980px) {
	.preview-body {
		grid-template-columns: minmax(220px, 270px) minmax(0, 1fr);
		gap: 18px;
	}

	.control-primary {
		grid-template-columns: minmax(240px, 1fr) minmax(150px, 190px) auto;
	}
}

@media (max-width: 760px) {
	.preview-shell {
		display: block;
		padding: 10px;
		min-height: auto;
	}

	.preview-header {
		padding: 14px 12px 10px;
	}

	.preview-header h1 {
		font-size: 18px;
	}

	.preview-controls {
		position: sticky;
		top: 0;
		margin-bottom: 10px;
		padding: 12px;
		border-radius: 12px;
	}

	.control-primary {
		display: grid;
		grid-template-columns: 1fr;
	}

	.topic-chips {
		flex-wrap: nowrap;
		padding-bottom: 3px;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.topic-chip {
		flex: 0 0 auto;
	}

	.result-count {
		white-space: normal;
	}

	.mobile-note-picker {
		display: block;
		margin-bottom: 10px;
	}

	#mobile-note-toggle {
		width: 100%;
		text-align: left;
	}

	.preview-body {
		display: block;
	}

	.note-list {
		position: static;
		display: none;
		max-height: 42vh;
		margin-bottom: 10px;
		overflow: auto;
	}

	.note-list.is-open {
		display: flex;
	}

	.comment-content {
		overflow: visible;
	}

	.content-frame {
		width: 100%;
	}

	.note-panel-header,
	.comment-card,
	.reply-card {
		box-shadow: none;
	}

	blockquote,
	.comment-body,
	.note-path {
		overflow-wrap: anywhere;
	}
}
`;
