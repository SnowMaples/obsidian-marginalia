import {type App} from 'obsidian';
import {mkdir, writeFile} from 'fs/promises';
import {join} from 'path';
import {tmpdir} from 'os';
import {pathToFileURL} from 'url';
import type {CommentStore} from '../storage/CommentStore';
import type {CommentThread, NoteComment, ReplyComment} from '../types';
import {getRootResolution} from '../types';
import {getPanelData} from '../comment/threading';
import {displayAnchorStatus, displayResolution, t} from '../i18n';

interface PreviewNote {
	id: string;
	title: string;
	path: string;
	commentCount: number;
	noteCommentCount: number;
	anchoredCommentCount: number;
	openCount: number;
	resolvedCount: number;
	orphanedCount: number;
	replyCount: number;
	updatedAt: string;
	searchText: string;
	noteComments: NoteComment[];
	threads: CommentThread[];
}

interface ElectronShell {
	openPath?: (path: string) => Promise<string>;
	openExternal?: (url: string) => Promise<void>;
}

interface ElectronModule {
	shell?: ElectronShell;
}

interface WindowWithRequire extends Window {
	require?: (module: string) => unknown;
}

export class BrowserCommentPreview {
	private app: App;
	private store: CommentStore;

	constructor(app: App, store: CommentStore) {
		this.app = app;
		this.store = store;
	}

	async open(): Promise<void> {
		const notes = await this.loadPreviewNotes();
		const html = this.renderHtml(notes);
		const filePath = await this.writePreviewFile(html);
		await openInDefaultBrowser(filePath);
	}

	private async loadPreviewNotes(): Promise<PreviewNote[]> {
		const notes: PreviewNote[] = [];
		const notePaths = this.store.getTrackedNotePaths().sort((a, b) => a.localeCompare(b));

		for (const notePath of notePaths) {
			const comments = await this.store.getComments(notePath);
			if (comments.length === 0) continue;

			const panelData = getPanelData(comments);
			const stats = computePreviewStats(notePath, panelData.noteComments, panelData.threads);
			notes.push({
				id: `note-${notes.length}`,
				title: getNoteTitle(notePath),
				path: notePath,
				commentCount: comments.length,
				noteCommentCount: panelData.noteComments.length,
				anchoredCommentCount: panelData.threads.length,
				openCount: stats.openCount,
				resolvedCount: stats.resolvedCount,
				orphanedCount: stats.orphanedCount,
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
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t.preview.title)}</title>
<style>
${PREVIEW_CSS}
</style>
</head>
<body>
<header class="preview-header">
	<div>
		<h1>${escapeHtml(t.preview.title)}</h1>
		<p>${escapeHtml(t.preview.generatedSummary(generatedAt, notes.length, totalComments))}</p>
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
		const dir = join(tmpdir(), 'obsidian-marginalia');
		await mkdir(dir, {recursive: true});
		const filePath = join(dir, 'comment-preview.html');
		await writeFile(filePath, html, 'utf8');
		return filePath;
	}
}

function renderPreviewShell(notes: PreviewNote[]): string {
	return `<main class="preview-shell">
	<section class="preview-controls" aria-label="${escapeAttr(t.preview.controlsLabel)}">
		<label class="search-box">
			<span>${escapeHtml(t.preview.searchLabel)}</span>
			<input id="preview-search" type="search" placeholder="${escapeAttr(t.preview.searchPlaceholder)}" autocomplete="off">
		</label>
		<div class="control-row" role="group" aria-label="${escapeAttr(t.preview.statusFiltersLabel)}">
			<button class="filter-btn is-active" type="button" data-filter="all">${escapeHtml(t.preview.filters.all)}</button>
			<button class="filter-btn" type="button" data-filter="open">${escapeHtml(t.preview.filters.open)}</button>
			<button class="filter-btn" type="button" data-filter="resolved">${escapeHtml(t.preview.filters.resolved)}</button>
			<button class="filter-btn" type="button" data-filter="orphaned">${escapeHtml(t.preview.filters.orphaned)}</button>
			<button class="filter-btn" type="button" data-filter="replies">${escapeHtml(t.preview.filters.replies)}</button>
		</div>
		<label class="sort-box">
			<span>${escapeHtml(t.preview.sortLabel)}</span>
			<select id="preview-sort">
				<option value="updated">${escapeHtml(t.preview.sort.updated)}</option>
				<option value="path">${escapeHtml(t.preview.sort.path)}</option>
				<option value="comments">${escapeHtml(t.preview.sort.comments)}</option>
				<option value="open">${escapeHtml(t.preview.sort.open)}</option>
			</select>
		</label>
		<div class="result-count" id="result-count"></div>
	</section>
	<section class="mobile-note-picker">
		<button id="mobile-note-toggle" type="button" aria-expanded="false">${escapeHtml(t.preview.selectNote)}</button>
	</section>
	<section class="preview-body">
		<nav class="note-list" aria-label="${escapeAttr(t.preview.annotatedNotesLabel)}">
		${notes.map((note, idx) => renderNoteTab(note, idx === 0)).join('\n')}
		</nav>
		<section class="comment-content">
		${notes.map((note, idx) => renderNotePanel(note, idx === 0)).join('\n')}
		<div class="empty-state no-results" id="no-results" hidden>
			<h2>${escapeHtml(t.preview.noMatchingTitle)}</h2>
			<p>${escapeHtml(t.preview.noMatchingDesc)}</p>
			<button id="clear-search" type="button">${escapeHtml(t.preview.clearSearch)}</button>
		</div>
		</section>
	</section>
</main>`;
}

function renderNoteTab(note: PreviewNote, active: boolean): string {
	return `<button class="note-tab${active ? ' is-active' : ''}" type="button" data-note-target="${escapeAttr(note.id)}" data-search="${escapeAttr(note.searchText)}" data-path="${escapeAttr(note.path)}" data-title="${escapeAttr(note.title)}" data-updated="${escapeAttr(note.updatedAt)}" data-comments="${note.commentCount}" data-open="${note.openCount}" data-resolved="${note.resolvedCount}" data-orphaned="${note.orphanedCount}" data-replies="${note.replyCount}">
	<span class="note-title">${escapeHtml(note.title)}</span>
	<span class="note-path">${escapeHtml(note.path)}</span>
	<span class="note-count">${note.commentCount}</span>
	<span class="note-stats">
		${renderStatBadge('open', note.openCount)}
		${renderStatBadge('orphaned', note.orphanedCount)}
		${renderStatBadge('replies', note.replyCount)}
	</span>
</button>`;
}

function renderNotePanel(note: PreviewNote, active: boolean): string {
	return `<article class="note-panel${active ? ' is-active' : ''}" id="${escapeAttr(note.id)}">
	<div class="note-panel-header">
		<h2>${escapeHtml(note.title)}</h2>
		<p>${escapeHtml(note.path)}</p>
		<div class="note-summary">
			${renderStatBadge('note', note.noteCommentCount)}
			${renderStatBadge('anchored', note.anchoredCommentCount)}
			${renderStatBadge('open', note.openCount)}
			${renderStatBadge('resolved', note.resolvedCount)}
			${renderStatBadge('orphaned', note.orphanedCount)}
			${renderStatBadge('replies', note.replyCount)}
		</div>
	</div>
	${note.noteComments.length > 0 ? `<section class="comment-section">
		<h3>${escapeHtml(t.preview.sections.noteComments)}</h3>
		${note.noteComments.map(renderNoteComment).join('\n')}
	</section>` : ''}
	${note.threads.length > 0 ? `<section class="comment-section">
		<h3>${escapeHtml(t.preview.sections.anchoredComments)}</h3>
		${note.threads.map(renderThread).join('\n')}
	</section>` : ''}
</article>`;
}

function renderStatBadge(label: string, count: number): string {
	return `<span class="stat-badge" data-count="${count}">${count} ${escapeHtml(getPreviewBadgeLabel(label))}</span>`;
}

function getPreviewBadgeLabel(label: string): string {
	const labels: Record<string, string> = t.preview.badges;
	return labels[label] ?? label;
}

function renderNoteComment(comment: NoteComment): string {
	return `<article class="comment-card note-comment">
	<div class="comment-meta">
		<span>${escapeHtml(t.preview.sections.noteComments)}</span>
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
		<h4>${escapeHtml(t.preview.sections.replies)}</h4>
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
	<h2>${escapeHtml(t.preview.noCommentsTitle)}</h2>
	<p>${escapeHtml(t.preview.noCommentsDesc)}</p>
</main>`;
}

function renderPreviewScript(firstNoteId: string): string {
	const resultCountTemplate = t.preview.resultCount('__VISIBLE__', '__TOTAL__');
	return `
const tabs = Array.from(document.querySelectorAll('.note-tab'));
const panels = Array.from(document.querySelectorAll('.note-panel'));
const searchInput = document.getElementById('preview-search');
const sortSelect = document.getElementById('preview-sort');
const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
const resultCount = document.getElementById('result-count');
const noResults = document.getElementById('no-results');
const clearSearch = document.getElementById('clear-search');
const noteList = document.querySelector('.note-list');
const commentContent = document.querySelector('.comment-content');
const mobileToggle = document.getElementById('mobile-note-toggle');
let currentFilter = 'all';
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
		mobileToggle.textContent = selected ? selected.querySelector('.note-title').textContent : ${JSON.stringify(t.preview.selectNote)};
		mobileToggle.setAttribute('aria-expanded', 'false');
	}
	if (noteList) {
		noteList.classList.remove('is-open');
	}
}

function noteMatchesFilter(tab) {
	if (currentFilter === 'open') return Number(tab.dataset.open) > 0;
	if (currentFilter === 'resolved') return Number(tab.dataset.resolved) > 0;
	if (currentFilter === 'orphaned') return Number(tab.dataset.orphaned) > 0;
	if (currentFilter === 'replies') return Number(tab.dataset.replies) > 0;
	return true;
}

function noteMatchesSearch(tab, query) {
	return !query || tab.dataset.search.includes(query);
}

function sortVisibleTabs() {
	if (!noteList || !sortSelect) return;
	const sorted = [...tabs].sort((a, b) => {
		const mode = sortSelect.value;
		if (mode === 'path') return a.dataset.path.localeCompare(b.dataset.path);
		if (mode === 'comments') return Number(b.dataset.comments) - Number(a.dataset.comments);
		if (mode === 'open') return Number(b.dataset.open) - Number(a.dataset.open);
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
		const show = noteMatchesFilter(tab) && noteMatchesSearch(tab, query);
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

for (const button of filterButtons) {
	button.addEventListener('click', () => {
		currentFilter = button.dataset.filter;
		for (const btn of filterButtons) {
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
		currentFilter = 'all';
		for (const btn of filterButtons) {
			btn.classList.toggle('is-active', btn.dataset.filter === 'all');
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

function computePreviewStats(notePath: string, noteComments: NoteComment[], threads: CommentThread[]): {
	openCount: number;
	resolvedCount: number;
	orphanedCount: number;
	replyCount: number;
	updatedAt: string;
	searchText: string;
} {
	let openCount = 0;
	let resolvedCount = 0;
	let orphanedCount = 0;
	let replyCount = 0;
	let updatedAt = '';
	const searchParts = [notePath, getNoteTitle(notePath)];

	for (const comment of noteComments) {
		if (getRootResolution(comment) === 'open') openCount++;
		else resolvedCount++;
		updatedAt = maxTimestamp(updatedAt, comment.updatedAt);
		searchParts.push(comment.body);
	}

	for (const thread of threads) {
		const root = thread.root;
		if (getRootResolution(root) === 'open') openCount++;
		else resolvedCount++;
		if (root.status === 'orphaned') orphanedCount++;
		replyCount += thread.replies.length;
		updatedAt = maxTimestamp(updatedAt, root.updatedAt);
		searchParts.push(root.target.exact, root.body);

		for (const reply of thread.replies) {
			updatedAt = maxTimestamp(updatedAt, reply.updatedAt);
			searchParts.push(reply.body);
		}
	}

	return {
		openCount,
		resolvedCount,
		orphanedCount,
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
	const fileUrl = pathToFileURL(filePath).toString();
	const electron = getElectronModule();
	const shell = electron?.shell;

	if (shell?.openExternal) {
		await shell.openExternal(fileUrl);
		return;
	}

	if (shell?.openPath) {
		const error = await shell.openPath(filePath);
		if (error) throw new Error(error);
		return;
	}

	window.open(fileUrl, '_blank', 'noopener');
}

function getElectronModule(): ElectronModule | null {
	const requireFn = (window as WindowWithRequire).require;
	if (!requireFn) return null;

	const electron = requireFn('electron') as ElectronModule;
	return electron;
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
	font-size: 14px;
	line-height: 1.5;
}

.preview-header {
	padding: 20px 24px 12px;
	border-bottom: 1px solid var(--border);
	background: var(--panel);
}

.preview-header h1 {
	margin: 0;
	font-size: 22px;
	letter-spacing: 0;
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
	gap: 16px;
	padding: 16px;
	min-height: calc(100vh - 78px);
}

.preview-controls {
	position: sticky;
	top: 0;
	z-index: 10;
	display: grid;
	grid-template-columns: minmax(260px, 1fr) auto minmax(170px, auto) auto;
	gap: 10px;
	align-items: end;
	padding: 12px;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: var(--shadow);
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
	min-height: 40px;
	width: 100%;
	padding: 8px 10px;
	color: var(--text);
	background: var(--panel-soft);
	border: 1px solid var(--border);
	border-radius: 8px;
	font: inherit;
}

.control-row {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.filter-btn,
#clear-search,
#mobile-note-toggle {
	min-height: 40px;
	padding: 8px 10px;
	color: var(--text);
	background: var(--panel-soft);
	border: 1px solid var(--border);
	border-radius: 8px;
	font: inherit;
	cursor: pointer;
}

.filter-btn.is-active,
#clear-search:hover,
#mobile-note-toggle:hover {
	background: var(--accent-soft);
	border-color: var(--accent);
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
	grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
	gap: 16px;
	min-height: 0;
}

.note-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
	max-height: calc(100vh - 180px);
	overflow: auto;
}

.note-tab {
	position: relative;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 2px 8px;
	width: 100%;
	padding: 10px;
	text-align: left;
	color: var(--text);
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: none;
	cursor: pointer;
}

.note-tab:hover,
.note-tab.is-active {
	background: var(--accent-soft);
	border-color: var(--accent);
}

.note-title {
	font-weight: 650;
	overflow-wrap: anywhere;
}

.note-path {
	grid-column: 1 / -1;
	color: var(--muted);
	font-size: 12px;
	overflow-wrap: anywhere;
}

.note-count {
	align-self: start;
	min-width: 24px;
	padding: 1px 6px;
	text-align: center;
	border-radius: 999px;
	color: var(--panel);
	background: var(--accent);
	font-size: 12px;
}

.note-stats,
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
	overflow: auto;
}

.note-panel {
	display: none;
}

.note-panel.is-active {
	display: block;
}

.note-panel-header,
.empty-state {
	margin-bottom: 12px;
	padding: 14px;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: var(--shadow);
}

.note-panel-header h2,
.empty-state h2 {
	margin: 0;
	font-size: 20px;
	letter-spacing: 0;
	overflow-wrap: anywhere;
}

.comment-section {
	margin-bottom: 16px;
}

.comment-section h3 {
	margin: 0 0 8px;
	color: var(--muted);
	font-size: 13px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.comment-card,
.reply-card {
	margin-bottom: 10px;
	padding: 12px;
	background: var(--panel);
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: var(--shadow);
}

.comment-card.is-orphaned {
	border-left: 4px solid var(--warning);
}

blockquote {
	margin: 0 0 10px;
	padding: 8px 10px;
	color: var(--muted);
	background: var(--panel-soft);
	border-left: 3px solid var(--accent);
	border-radius: 6px;
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
		grid-template-columns: 1fr;
		position: sticky;
		top: 0;
		margin-bottom: 10px;
		padding: 10px;
	}

	.control-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
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
