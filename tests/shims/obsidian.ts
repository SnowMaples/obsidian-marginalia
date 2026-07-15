export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function getLanguage(): string {
	return 'en';
}

export const Platform = {
	isMobile: false,
};

export class App {}

export class Component {
	load(): void {}
	unload(): void {}
}

export class MarkdownView {}

export class Modal {
	app: App;
	modalEl: HTMLElement;
	contentEl: HTMLElement;

	constructor(app: App) {
		this.app = app;
		this.modalEl = {} as HTMLElement;
		this.contentEl = {} as HTMLElement;
	}

	open(): void {}
	close(): void {}
}

export class Notice {
	constructor(_message: string) {}
}

export class TFile {
	path: string;
	extension: string;
	basename: string;

	constructor(path: string) {
		this.path = path;
		this.extension = path.split('.').pop() ?? '';
		this.basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path;
	}
}

export const MarkdownRenderer = {
	render: async () => undefined,
};

export function setIcon(_element: HTMLElement, _icon: string): void {}

export class PluginSettingTab {
	constructor(_app: App, _plugin: unknown) {}
}

export class Setting {
	constructor(_container: HTMLElement) {}
}
