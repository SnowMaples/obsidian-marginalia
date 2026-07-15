/* eslint-disable import/no-nodejs-modules */
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MobileCommentSheet} from '../../src/views/MobileCommentSheet';

describe('mobile comment sheet layout', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sizes the sheet from the visual viewport instead of the layout viewport', () => {
		const sheet = createSheetHarness();
		stubMobileWindow();

		const layout = sheet.computeMobileSheetLayout();

		expect(layout.width).toBe(366);
		expect(layout.topLimit).toBe(56);
		expect(layout.maxHeight).toBe(352);
	});

	it('keeps phone-width sheets full width instead of applying tablet constraints', () => {
		const sheet = createSheetHarness();
		stubMobileWindow({innerWidth: 390, innerHeight: 800, viewportHeight: 800});

		const layout = sheet.computeMobileSheetLayout();

		expect(layout.left).toBe(12);
		expect(layout.width).toBe(366);
		expect(layout.centerX).toBe(195);
	});

	it('centers tablet-width sheets inside the editor content column', () => {
		const sheet = createSheetHarness(createMarkdownViewRect({
			containerTop: 0,
			contentLeft: 388,
			contentTop: 140,
			contentWidth: 1316,
			headerBottom: 112,
		}));
		stubMobileWindow({innerWidth: 1728, innerHeight: 1080, viewportHeight: 1080});

		const layout = sheet.computeMobileSheetLayout();

		expect(layout.width).toBe(860);
		expect(layout.left).toBe(616);
		expect(layout.centerX).toBe(1046);
	});

	it('writes keyboard-safe viewport variables and clears them on close', () => {
		const sheet = createSheetHarness();
		stubMobileWindow();

		sheet.updateLayout();

		expect(sheet.styleValues.get('--marginalia-sheet-keyboard-offset')).toBe('300px');
		expect(sheet.styleValues.get('--marginalia-sheet-viewport-height')).toBe('500px');
		expect(sheet.styleValues.get('--marginalia-sheet-max-height')).toBe('352px');
		expect(sheet.styleValues.get('--marginalia-sheet-center-x')).toBe('195px');

		sheet.clearLayout();

		expect(sheet.removedProperties).toContain('--marginalia-sheet-keyboard-offset');
		expect(sheet.removedProperties).toContain('--marginalia-sheet-viewport-height');
		expect(sheet.removedProperties).toContain('--marginalia-sheet-center-x');
	});
});

describe('mobile comment sheet CSS', () => {
	it('keeps the mobile card surface as a single override layer with safe touch and overflow rules', () => {
		const css = readFileSync('styles.css', 'utf8');

		expect(css.match(/\.is-mobile \.marginalia-mobile-sheet \{/g)).toHaveLength(1);
		expect(css).toContain('var(--marginalia-sheet-keyboard-offset, 0px)');
		expect(css).toContain('@media (min-width: 768px)');
		expect(css).toContain('--marginalia-tablet-sheet-max-width');
		expect(css).toContain('var(--marginalia-sheet-center-x, 50%)');
		expect(css).toMatch(/@media \(min-width: 768px\)[\s\S]*\.marginalia-mobile-sheet-add \{[\s\S]*width: 44px;[\s\S]*height: 44px;[\s\S]*min-height: 44px;/);
		expect(css).toContain('.is-mobile .marginalia-mobile-card-body pre');
		expect(css).toContain('overflow-wrap: anywhere');
		expect(css).toContain('min-width: 44px');
	});
});

interface SheetHarness {
	computeMobileSheetLayout: () => {centerX: number; left: number; maxHeight: number; topLimit: number; width: number};
	updateLayout: () => void;
	clearLayout: () => void;
	styleValues: Map<string, string>;
	removedProperties: string[];
}

function createSheetHarness(markdownView: unknown = null): SheetHarness {
	const styleValues = new Map<string, string>();
	const removedProperties: string[] = [];
	const sheet = Object.create(MobileCommentSheet.prototype) as SheetHarness & {
		modalEl: {style: {setProperty: (name: string, value: string) => void; removeProperty: (name: string) => void}};
		plugin: {
			app: {
				workspace: {
					getActiveViewOfType: () => unknown;
				};
			};
		};
	};
	sheet.styleValues = styleValues;
	sheet.removedProperties = removedProperties;
	sheet.modalEl = {
		style: {
			setProperty: (name: string, value: string) => {
				styleValues.set(name, value);
			},
			removeProperty: (name: string) => {
				removedProperties.push(name);
				styleValues.delete(name);
			},
		},
	};
	sheet.plugin = {
		app: {
			workspace: {
				getActiveViewOfType: () => markdownView,
			},
		},
	};
	return sheet;
}

function createMarkdownViewRect(options: {
	containerTop: number;
	contentLeft: number;
	contentTop: number;
	contentWidth: number;
	headerBottom: number;
}): unknown {
	return {
		containerEl: {
			getBoundingClientRect: () => ({top: options.containerTop}),
			querySelector: () => ({
				getBoundingClientRect: () => ({bottom: options.headerBottom}),
			}),
		},
		contentEl: {
			getBoundingClientRect: () => ({
				left: options.contentLeft,
				top: options.contentTop,
				width: options.contentWidth,
			}),
		},
	};
}

function stubMobileWindow(options: {innerHeight?: number; innerWidth?: number; viewportHeight?: number; viewportOffsetTop?: number} = {}): void {
	const innerHeight = options.innerHeight ?? 800;
	const viewportHeight = options.viewportHeight ?? 500;
	vi.stubGlobal('window', {
		innerWidth: options.innerWidth ?? 390,
		innerHeight,
		visualViewport: {height: viewportHeight, offsetTop: options.viewportOffsetTop ?? 0},
	});
	vi.stubGlobal('document', {documentElement: {}});
	vi.stubGlobal('getComputedStyle', () => ({
		getPropertyValue: () => '',
	}));
}
