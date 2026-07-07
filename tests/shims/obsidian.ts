export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function getLanguage(): string {
	return 'en';
}

export class App {}

export class Notice {
	constructor(_message: string) {}
}

export class PluginSettingTab {
	constructor(_app: App, _plugin: unknown) {}
}

export class Setting {
	constructor(_container: HTMLElement) {}
}
