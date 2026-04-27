import {normalizePath, type Vault} from 'obsidian';
import type {PathIndexData} from '../types';

export class PathIndex {
	private data: PathIndexData;
	private basePath: string;
	private vault: Vault;

	constructor(vault: Vault, basePath: string) {
		this.vault = vault;
		this.basePath = basePath;
		this.data = {version: 1, mappings: {}};
	}

	async load(): Promise<void> {
		const indexPath = this.getIndexPath();
		if (await this.vault.adapter.exists(indexPath)) {
			try {
				const raw = await this.vault.adapter.read(indexPath);
				this.data = JSON.parse(raw) as PathIndexData;
			} catch {
				this.data = {version: 1, mappings: {}};
			}
		}
	}

	async save(): Promise<void> {
		await this.vault.adapter.write(this.getIndexPath(), JSON.stringify(this.data, null, 2));
	}

	getCommentFileName(notePath: string): string | undefined {
		const direct = this.data.mappings[notePath];
		if (direct) return direct;

		const normalizedNotePath = normalizePath(notePath);
		const normalized = this.data.mappings[normalizedNotePath];
		if (normalized) return normalized;

		const exactNormalized = Object.entries(this.data.mappings).find(([sourcePath]) =>
			normalizePath(sourcePath).toLowerCase() === normalizedNotePath.toLowerCase()
		);
		if (exactNormalized) return exactNormalized[1];

		const noteBasename = this.getBasename(normalizedNotePath).toLowerCase();
		const basenameMatches = Object.entries(this.data.mappings).filter(([sourcePath]) =>
			this.getBasename(sourcePath).toLowerCase() === noteBasename
		);
		return basenameMatches.length === 1 ? basenameMatches[0]![1] : undefined;
	}

	getOrCreateCommentFileName(notePath: string): string {
		const existing = this.getCommentFileName(notePath);
		if (existing) return existing;

		const normalizedNotePath = normalizePath(notePath);
		const fileName = normalizedNotePath.replace(/\//g, '__') + '.json';
		this.data.mappings[normalizedNotePath] = fileName;
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

	private getBasename(path: string): string {
		const normalized = normalizePath(path);
		const fileName = normalized.split('/').pop() ?? normalized;
		return fileName.replace(/\.md$/i, '');
	}

	private getIndexPath(): string {
		return normalizePath(`${this.basePath}/_index.json`);
	}
}
