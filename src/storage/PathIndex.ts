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
				const raw = await this.vault.adapter.read(indexPath);
				const parsed = JSON.parse(raw) as unknown;
				this.data = parsePathIndexData(parsed);
				return {status: 'ok'};
			} catch {
				const backupPath = await this.backupCorruptIndex(indexPath);
				const repair = await this.rebuildFromCommentFiles();
				repair.backupPath = backupPath;
				return {status: 'rebuilt', repair};
			}
		}

		const repair = await this.rebuildFromCommentFiles();
		if (repair.restored > 0 || repair.invalid > 0 || repair.conflicts > 0) {
			return {status: 'rebuilt', repair};
		}
		return {status: 'ok'};
	}

	async save(): Promise<void> {
		await this.safeWriteIndex();
	}

	getCommentFileName(notePath: string): string | undefined {
		return this.data.mappings[notePath];
	}

	getOrCreateCommentFileName(notePath: string): string {
		const existing = this.data.mappings[notePath];
		if (existing) return existing;

		const fileName = createCommentFileName(notePath);
		this.data.mappings[notePath] = fileName;
		return fileName;
	}

	getCommentFilePath(notePath: string): string {
		const fileName = this.getOrCreateCommentFileName(notePath);
		return normalizePath(`${this.basePath}/${fileName}`);
	}

	async renamePath(oldPath: string, newPath: string): Promise<void> {
		const fileName = this.data.mappings[oldPath];
		if (!fileName) return;

		delete this.data.mappings[oldPath];
		this.data.mappings[newPath] = fileName;
		await this.save();
	}

	async deletePath(notePath: string): Promise<string | undefined> {
		const fileName = this.data.mappings[notePath];
		if (!fileName) return undefined;

		delete this.data.mappings[notePath];
		await this.save();
		return fileName;
	}

	getNotePathForFileName(fileName: string): string | undefined {
		for (const [notePath, fn] of Object.entries(this.data.mappings)) {
			if (fn === fileName) return notePath;
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

		let listed: { files: string[]; folders: string[] };
		try {
			listed = await this.vault.adapter.list(this.basePath);
		} catch {
			this.data = {version: 1, mappings: {}};
			await this.save();
			return {
				restored: 0,
				removed: Object.keys(previous).length,
				invalid: 0,
				conflicts: 0,
			};
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
				notePath: parsed.sourceFile,
				fileName,
				updatedAt: getCommentFileUpdatedAt(parsed),
			};
			const existing = candidates.get(candidate.notePath);
			if (existing) {
				conflicts++;
				if (candidate.updatedAt > existing.updatedAt) {
					candidates.set(candidate.notePath, candidate);
				}
			} else {
				candidates.set(candidate.notePath, candidate);
			}
		}

		const mappings: Record<string, string> = {};
		for (const candidate of candidates.values()) {
			mappings[candidate.notePath] = candidate.fileName;
		}

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
		const raw = JSON.stringify(this.data);

		await this.vault.adapter.write(tempPath, raw);
		const verified = this.vault.adapter.read(tempPath);
		parsePathIndexData(JSON.parse(await verified) as unknown);
		await this.vault.adapter.write(indexPath, raw);
		try {
			await this.vault.adapter.remove(tempPath);
		} catch {
			// Best effort cleanup only.
		}
	}

	private async backupCorruptIndex(indexPath: string): Promise<string | undefined> {
		const backupPath = normalizePath(`${this.basePath}/_index.corrupt.${formatTimestampForFile(new Date())}.json`);
		try {
			await this.vault.adapter.copy(indexPath, backupPath);
			return backupPath;
		} catch {
			return undefined;
		}
	}

	private async readCommentFile(filePath: string): Promise<CommentFile | null> {
		try {
			const raw = await this.vault.adapter.read(filePath);
			const parsed = JSON.parse(raw) as unknown;
			return parseCommentFile(parsed);
		} catch {
			return null;
		}
	}

	private async ensureBasePath(): Promise<void> {
		if (!(await this.vault.adapter.exists(this.basePath))) {
			await this.vault.adapter.mkdir(this.basePath);
		}
	}
}

function parsePathIndexData(value: unknown): PathIndexData {
	if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['mappings'])) {
		throw new Error('Invalid path index data');
	}

	const mappings: Record<string, string> = {};
	for (const [notePath, fileName] of Object.entries(value['mappings'])) {
		if (typeof fileName !== 'string') {
			throw new Error('Invalid path index mapping');
		}
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
	) {
		return null;
	}

	return {
		version: 1,
		sourceFile: value['sourceFile'],
		comments: value['comments'] as CommentData[],
	};
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
	let removed = 0;
	for (const [notePath, fileName] of Object.entries(previous)) {
		if (next[notePath] !== fileName) removed++;
	}
	return removed;
}

function formatTimestampForFile(date: Date): string {
	return date.toISOString().replace(/[:.]/g, '-');
}

export function createCommentFileName(notePath: string): string {
	return `${encodeURIComponent(notePath)}.json`;
}
