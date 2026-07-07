import {App, Notice, normalizePath, PluginSettingTab, Setting} from 'obsidian';
import {t} from './i18n';
import type MarginaliaPlugin from './main';

export type StoragePreset = 'plugin' | 'vault' | 'custom';

export interface MarginaliaSettings {
	storagePreset: StoragePreset;
	customStoragePath: string;
	commentSortOrder: 'position' | 'created';
	showGutterIcons: boolean;
	fuzzyMatchThreshold: number;
	orphanHandling: 'keep' | 'delete';
}

type LegacyMarginaliaSettings = Partial<MarginaliaSettings> & {
	storageLocation?: string;
};

export const DEFAULT_SETTINGS: MarginaliaSettings = {
	storagePreset: 'plugin',
	customStoragePath: '.marginalia',
	commentSortOrder: 'position',
	showGutterIcons: true,
	fuzzyMatchThreshold: 0.3,
	orphanHandling: 'keep',
};

export function validateCustomStoragePath(input: string): string | null {
	const trimmed = input.trim().replace(/\\/g, '/');
	if (!trimmed) return null;
	if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return null;

	const normalized = normalizePath(trimmed);
	if (!normalized || normalized === '.' || normalized === '..') return null;
	if (normalized.startsWith('../') || normalized.includes('/../')) return null;

	return normalized;
}

export function resolveStorageBasePath(settings: MarginaliaSettings, manifestDir?: string): string {
	if (settings.storagePreset === 'vault') {
		return '.marginalia';
	}
	if (settings.storagePreset === 'custom') {
		return validateCustomStoragePath(settings.customStoragePath) ?? DEFAULT_SETTINGS.customStoragePath;
	}
	return normalizePath(`${manifestDir ?? ''}/comments`);
}

export function normalizeSettings(
	raw: LegacyMarginaliaSettings | null | undefined,
	manifestDir?: string,
): MarginaliaSettings {
	let normalizedPreset: StoragePreset = DEFAULT_SETTINGS.storagePreset;
	let customPathCandidate = raw?.customStoragePath ?? DEFAULT_SETTINGS.customStoragePath;

	if (raw?.storagePreset === 'plugin' || raw?.storagePreset === 'vault' || raw?.storagePreset === 'custom') {
		normalizedPreset = raw.storagePreset;
	} else if (raw?.storageLocation === 'vault') {
		normalizedPreset = 'vault';
	} else if (raw?.storageLocation === 'plugin') {
		normalizedPreset = 'plugin';
	} else if (typeof raw?.storageLocation === 'string') {
		const legacyPath = validateCustomStoragePath(raw.storageLocation);
		const pluginPath = normalizePath(`${manifestDir ?? ''}/comments`);
		if (legacyPath === '.marginalia') {
			normalizedPreset = 'vault';
		} else if (legacyPath && legacyPath === pluginPath) {
			normalizedPreset = 'plugin';
		} else if (legacyPath) {
			normalizedPreset = 'custom';
			customPathCandidate = legacyPath;
		}
	}

	const normalizedCustomPath = validateCustomStoragePath(customPathCandidate) ?? DEFAULT_SETTINGS.customStoragePath;

	return {
		storagePreset: normalizedPreset,
		customStoragePath: normalizedCustomPath,
		commentSortOrder: raw?.commentSortOrder === 'created' ? 'created' : DEFAULT_SETTINGS.commentSortOrder,
		showGutterIcons: raw?.showGutterIcons ?? DEFAULT_SETTINGS.showGutterIcons,
		fuzzyMatchThreshold: typeof raw?.fuzzyMatchThreshold === 'number'
			? raw.fuzzyMatchThreshold
			: DEFAULT_SETTINGS.fuzzyMatchThreshold,
		orphanHandling: raw?.orphanHandling === 'delete' ? 'delete' : DEFAULT_SETTINGS.orphanHandling,
	};
}

export class MarginaliaSettingTab extends PluginSettingTab {
	plugin: MarginaliaPlugin;

	constructor(app: App, plugin: MarginaliaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		let customPathInput: HTMLInputElement | null = null;
		const updateCustomPathState = () => {
			if (!customPathInput) return;
			const isCustom = this.plugin.settings.storagePreset === 'custom';
			customPathInput.disabled = !isCustom;
			if (!isCustom) {
				customPathInput.classList.remove('marginalia-input-invalid');
			}
		};

		new Setting(containerEl)
			.setName(t('settingsStorageName'))
			.setDesc(t('settingsStorageDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('plugin', t('settingsStorageOptionPlugin'))
				.addOption('vault', t('settingsStorageOptionVault'))
				.addOption('custom', t('settingsStorageOptionCustom'))
				.setValue(this.plugin.settings.storagePreset)
				.onChange(async (value) => {
					this.plugin.settings.storagePreset = value as StoragePreset;
					await this.plugin.saveSettings();
					updateCustomPathState();
				}))
			.addExtraButton(button => {
				button
					.setIcon('refresh-cw')
					.setTooltip(t('settingsMigrateTooltip'))
					.onClick(async () => {
						if (this.plugin.settings.storagePreset === 'custom'
							&& !validateCustomStoragePath(this.plugin.settings.customStoragePath)) {
							new Notice(t('noticeInvalidCustomPath'));
							return;
						}

						const newBasePath = resolveStorageBasePath(this.plugin.settings, this.plugin.manifest.dir);
						if (newBasePath === this.plugin.store.currentBasePath) {
							new Notice(t('noticeStorageCurrent'));
							return;
						}

						button.setDisabled(true);
						button.extraSettingsEl.addClass('marginalia-spin');

						try {
							const count = await this.plugin.store.migrateData(newBasePath);
							if (count === 0) {
								new Notice(t('noticeNoDataToMigrate'));
							} else {
								new Notice(t('noticeMigrated', {count}));
							}
							this.plugin.refreshPanel();
							this.plugin.updateGutterEffects();
						} catch (e) {
							new Notice(t('noticeMigrationFailed', {
								error: e instanceof Error ? e.message : String(e),
							}));
						} finally {
							button.setDisabled(false);
							button.extraSettingsEl.removeClass('marginalia-spin');
						}
					});
			});

		new Setting(containerEl)
			.setName(t('settingsCustomPathName'))
			.setDesc(t('settingsCustomPathDesc'))
			.addText(text => {
				text
					.setPlaceholder(t('settingsCustomPathPlaceholder'))
					.setValue(this.plugin.settings.customStoragePath);

				customPathInput = text.inputEl;
				updateCustomPathState();

				text.onChange((value) => {
					const normalized = validateCustomStoragePath(value);
					text.inputEl.classList.toggle('marginalia-input-invalid', value.trim().length > 0 && !normalized);
					if (normalized) {
						this.plugin.settings.customStoragePath = normalized;
						void this.plugin.saveSettings();
					}
				});

				text.inputEl.addEventListener('blur', () => {
					const normalized = validateCustomStoragePath(text.inputEl.value);
					if (!normalized) {
						text.setValue(this.plugin.settings.customStoragePath);
						text.inputEl.classList.remove('marginalia-input-invalid');
						if (text.inputEl.value.trim().length > 0 || this.plugin.settings.storagePreset === 'custom') {
							new Notice(t('noticeInvalidCustomPath'));
						}
						return;
					}

					if (normalized !== text.inputEl.value) {
						text.setValue(normalized);
					}
				});
			});

		new Setting(containerEl)
			.setName(t('settingsRepairName'))
			.setDesc(t('settingsRepairDesc'))
			.addButton(button => button
				.setButtonText(t('settingsRepairButton'))
				.onClick(async () => {
					button.setDisabled(true);
					try {
						await this.plugin.repairCommentIndex();
					} finally {
						button.setDisabled(false);
					}
				}));

		new Setting(containerEl)
			.setName(t('settingsSortName'))
			.setDesc(t('settingsSortDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('position', t('settingsSortPosition'))
				.addOption('created', t('settingsSortCreated'))
				.setValue(this.plugin.settings.commentSortOrder)
				.onChange(async (value) => {
					this.plugin.settings.commentSortOrder = value as 'position' | 'created';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settingsGutterName'))
			.setDesc(t('settingsGutterDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGutterIcons)
				.onChange(async (value) => {
					this.plugin.settings.showGutterIcons = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settingsFuzzyName'))
			.setDesc(t('settingsFuzzyDesc'))
			.addSlider(slider => slider
				.setLimits(0.1, 0.5, 0.05)
				.setValue(this.plugin.settings.fuzzyMatchThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.fuzzyMatchThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t('settingsOrphanName'))
			.setDesc(t('settingsOrphanDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('keep', t('settingsOrphanKeep'))
				.addOption('delete', t('settingsOrphanDelete'))
				.setValue(this.plugin.settings.orphanHandling)
				.onChange(async (value) => {
					this.plugin.settings.orphanHandling = value as 'keep' | 'delete';
					await this.plugin.saveSettings();
				}));
	}
}
