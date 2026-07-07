import {normalizePath, type Vault} from 'obsidian';
import type {CommentData, CommentFile, PathIndexData} from '../types';

export interface PathIndexRepairResult {
	restored: number;
	removed: number;
	invalid: number;
	conflicts: number;
	backupPath?: string;
}

export interface PathIndexLoadResult {
	status: 'ok' | 'rebuilt';
	repair?: PathIndexRepairResult;
}

interface RebuildCandidate {
	notePath: string;
	fileName: string;
	updatedAt: number;
}

export class PathIndex {
	private data: PathIndexData;
	private basePath: string;
	private vault: Vault;

	constructor(vault: Vault, basePath: string) {
		this.vault = vault;
		this.basePath = basePath;
		this.data = {version: 1, mappings: {}};
	}

	async load(): Promise<PathIndexLoadResult> {
		const indexPath = this.getIndexPath();
		if (await this.vault.adapter.exists(indexPath)) {
			try {
				this.data = parsePathIndexData(JSON.parse(await this.vault.adapter.read(indexPath)) as unknown);
				return {status: 'ok'};
			} catch {
				const backupPath = await this.backupCorruptIndex(indexPath);
				const repair = await this.rebuildFromCommentFiles();
				repair.backupPath = backupPath;
				return {status: 'rebuilt', repair};
			}
		}

		const repair = await this.rebuildFromCommentFiles();
		return repair.restored > 0 || repair.invalid > 0 || repair.conflicts > 0
			? {status: 'rebuilt', repair}
			: {status: 'ok'};
	}

	async save(): Promise<void> {
		await this.safeWriteIndex();
	}

	getCommentFileName(notePath: string): string | undefined {
		return this.findMappingEntry(notePath)?.[1];
	}

	getOrCreateCommentFileName(notePath: string): string {
		const existing = this.getCommentFileName(notePath);
		if (existing) return existing;

		const normalizedNotePath = normalizePath(notePath);
		const fileName = createCommentFileName(normalizedNotePath);
		this.data.mappings[normalizedNotePath] = fileName;
		return fileName;
	}

	getCommentFilePath(notePath: string): string {
		return normalizePath(`${this.basePath}/${this.getOrCreateCommentFileName(notePath)}`);
	}

	async renamePath(oldPath: string, newPath: string): Promise<void> {
		const entry = this.findMappingEntry(oldPath);
		if (!entry) return;

		delete this.data.mappings[entry[0]];
		this.data.mappings[normalizePath(newPath)] = entry[1];
		await this.save();
	}

	async deletePath(notePath: string): Promise<string | undefined> {
		const entry = this.findMappingEntry(notePath);
		if (!entry) return undefined;

		delete this.data.mappings[entry[0]];
		await this.save();
		return entry[1];
	}

	getNotePathForFileName(fileName: string): string | undefined {
		for (const [notePath, mappedFileName] of Object.entries(this.data.mappings)) {
			if (mappedFileName === fileName) return notePath;
		}
		return undefined;
	}

	getNotePaths(): string[] {
		return Object.keys(this.data.mappings);
	}

	async rebuildFromCommentFiles(): Promise<PathIndexRepairResult> {
		await this.ensureBasePath();
		const previous = this.data.mappings;
		const candidates = new Map<string, RebuildCandidate>();
		let invalid = 0;
		let conflicts = 0;
		let listed: {files: string[]; folders: string[]};

		try {
			listed = await this.vault.adapter.list(this.basePath);
		} catch {
			this.data = {version: 1, mappings: {}};
			await this.save();
			return {restored: 0, removed: Object.keys(previous).length, invalid: 0, conflicts: 0};
		}

		for (const filePath of listed.files) {
			const fileName = filePath.substring(this.basePath.length + 1);
			if (!isCommentDataFile(fileName)) continue;

			const parsed = await this.readCommentFile(filePath);
			if (!parsed) {
				invalid++;
				continue;
			}

			const candidate: RebuildCandidate = {
				notePath: normalizePath(parsed.sourceFile),
				fileName,
				updatedAt: getCommentFileUpdatedAt(parsed),
			};
			const existing = candidates.get(candidate.notePath);
			if (existing) {
				conflicts++;
				if (candidate.updatedAt > existing.updatedAt) candidates.set(candidate.notePath, candidate);
			} else {
				candidates.set(candidate.notePath, candidate);
			}
		}

		const mappings: Record<string, string> = {};
		for (const candidate of candidates.values()) mappings[candidate.notePath] = candidate.fileName;

		this.data = {version: 1, mappings};
		await this.save();
		return {
			restored: Object.keys(mappings).length,
			removed: countRemovedMappings(previous, mappings),
			invalid,
			conflicts,
		};
	}

	async compact(): Promise<PathIndexRepairResult> {
		return this.rebuildFromCommentFiles();
	}

	private findMappingEntry(notePath: string): [string, string] | undefined {
		const direct = this.data.mappings[notePath];
		if (direct) return [notePath, direct];

		const normalizedNotePath = normalizePath(notePath);
		const normalized = this.data.mappings[normalizedNotePath];
		if (normalized) return [normalizedNotePath, normalized];

		const exactNormalized = Object.entries(this.data.mappings).find(([sourcePath]) =>
			normalizePath(sourcePath).toLowerCase() === normalizedNotePath.toLowerCase()
		);
		if (exactNormalized) return exactNormalized;

		const noteBasename = this.getBasename(normalizedNotePath).toLowerCase();
		const basenameMatches = Object.entries(this.data.mappings).filter(([sourcePath]) =>
			this.getBasename(sourcePath).toLowerCase() === noteBasename
		);
		return basenameMatches.length === 1 ? basenameMatches[0] : undefined;
	}

	private getBasename(path: string): string {
		const fileName = normalizePath(path).split('/').pop() ?? path;
		return fileName.replace(/\.md$/i, '');
	}

	private getIndexPath(): string {
		return normalizePath(`${this.basePath}/_index.json`);
	}

	private getTempIndexPath(): string {
		return normalizePath(`${this.basePath}/_index.tmp.json`);
	}

	private async safeWriteIndex(): Promise<void> {
		await this.ensureBasePath();
		const indexPath = this.getIndexPath();
		const tempPath = this.getTempIndexPath();
		const raw = JSON.stringify(this.data, null, 2);

		await this.vault.adapter.write(tempPath, raw);
		parsePathIndexData(JSON.parse(await this.vault.adapter.read(tempPath)) as unknown);
		await this.vault.adapter.write(indexPath, raw);
		try {
			await this.vault.adapter.remove(tempPath);
		} catch {
			// Best-effort cleanup only.
		}
	}

	private async backupCorruptIndex(indexPath: string): Promise<string | undefined> {
		const backupPath = normalizePath(
			`${this.basePath}/_index.corrupt.${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
		);
		try {
			await this.vault.adapter.copy(indexPath, backupPath);
			return backupPath;
		} catch {
			return undefined;
		}
	}

	private async readCommentFile(filePath: string): Promise<CommentFile | null> {
		try {
			return parseCommentFile(JSON.parse(await this.vault.adapter.read(filePath)) as unknown);
		} catch {
			return null;
		}
	}

	private async ensureBasePath(): Promise<void> {
		if (!(await this.vault.adapter.exists(this.basePath))) await this.vault.adapter.mkdir(this.basePath);
	}
}

function parsePathIndexData(value: unknown): PathIndexData {
	if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['mappings'])) {
		throw new Error('Invalid path index data');
	}

	const mappings: Record<string, string> = {};
	for (const [notePath, fileName] of Object.entries(value['mappings'])) {
		if (typeof fileName !== 'string') throw new Error('Invalid path index mapping');
		mappings[notePath] = fileName;
	}
	return {version: 1, mappings};
}

function parseCommentFile(value: unknown): CommentFile | null {
	if (
		!isRecord(value) ||
		value['version'] !== 1 ||
		typeof value['sourceFile'] !== 'string' ||
		value['sourceFile'].length === 0 ||
		!Array.isArray(value['comments'])
	) return null;

	return {version: 1, sourceFile: value['sourceFile'], comments: value['comments'] as CommentData[]};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommentDataFile(fileName: string): boolean {
	return fileName.endsWith('.json') && !fileName.startsWith('_index');
}

function getCommentFileUpdatedAt(file: CommentFile): number {
	let latest = 0;
	for (const comment of file.comments) {
		latest = Math.max(latest, getTimeValue(comment.createdAt), getTimeValue(comment.updatedAt));
	}
	return latest;
}

function getTimeValue(value: string): number {
	const time = new Date(value).getTime();
	return Number.isNaN(time) ? 0 : time;
}

function countRemovedMappings(previous: Record<string, string>, next: Record<string, string>): number {
	return Object.entries(previous).filter(([notePath, fileName]) => next[notePath] !== fileName).length;
}

export function createCommentFileName(notePath: string): string {
	return `${encodeURIComponent(normalizePath(notePath))}.json`;
}
