export class MemoryVault {
	adapter = new MemoryAdapter();
}

export class MemoryAdapter {
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
		if (content == null) throw new Error(`File not found: ${normalized}`);
		return content;
	}

	async write(path: string, content: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		this.ensureParentFolder(normalized);
		this.files.set(normalized, content);
	}

	async remove(path: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		if (!this.files.delete(normalized)) throw new Error(`File not found: ${normalized}`);
	}

	async copy(source: string, destination: string): Promise<void> {
		await this.write(destination, await this.read(source));
	}

	async rmdir(path: string): Promise<void> {
		const normalized = normalizeTestPath(path);
		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(`${normalized}/`)) throw new Error(`Folder is not empty: ${normalized}`);
		}
		this.folders.delete(normalized);
	}

	async list(path: string): Promise<{files: string[]; folders: string[]}> {
		const normalized = normalizeTestPath(path);
		const prefix = normalized ? `${normalized}/` : '';
		return {
			files: [...this.files.keys()].filter(filePath => filePath.startsWith(prefix)),
			folders: [...this.folders].filter(folderPath => folderPath && folderPath.startsWith(prefix) && folderPath !== normalized),
		};
	}

	getFullPath(path: string): string {
		return `/vault/${normalizeTestPath(path)}`;
	}

	private ensureParentFolder(path: string): void {
		const slash = path.lastIndexOf('/');
		if (slash > 0) this.folders.add(path.slice(0, slash));
	}
}

function normalizeTestPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}
