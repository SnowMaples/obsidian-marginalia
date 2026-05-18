import {App, Notice, normalizePath, PluginSettingTab, Setting} from "obsidian";
import type MarginaliaPlugin from "./main";
import {t} from "./i18n";

export interface MarginaliaSettings {
	storageLocation: string;
	commentSortOrder: 'position' | 'created';
	showGutterIcons: boolean;
	fuzzyMatchThreshold: number;
	orphanHandling: 'keep' | 'delete';
}

export const DEFAULT_SETTINGS: MarginaliaSettings = {
	storageLocation: '.marginalia',
	commentSortOrder: 'position',
	showGutterIcons: true,
	fuzzyMatchThreshold: 0.3,
	orphanHandling: 'keep',
};

export class MarginaliaSettingTab extends PluginSettingTab {
	plugin: MarginaliaPlugin;

	constructor(app: App, plugin: MarginaliaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t.settings.storageLocation.name)
			.setDesc(t.settings.storageLocation.desc)
			.addText(text => text
				.setPlaceholder(normalizePath(`${this.plugin.manifest.dir ?? ''}/comments`))
				.setValue(this.plugin.settings.storageLocation)
				.onChange(async (value) => {
					this.plugin.settings.storageLocation = value;
					await this.plugin.saveSettings();
				}))
			.addExtraButton(button => {
				button
					.setIcon('folder')
					.setTooltip(t.settings.storageLocation.pluginFolder)
					.onClick(async () => {
						const path = normalizePath(`${this.plugin.manifest.dir ?? ''}/comments`);
						this.plugin.settings.storageLocation = path;
						await this.plugin.saveSettings();
						this.display();
					});
			})
			.addExtraButton(button => {
				button
					.setIcon('hard-drive')
					.setTooltip(t.settings.storageLocation.vaultRoot)
					.onClick(async () => {
						const path = normalizePath('.marginalia');
						this.plugin.settings.storageLocation = path;
						await this.plugin.saveSettings();
						this.display();
					});
			})
			.addExtraButton(button => {
				button
					.setIcon('refresh-cw')
					.setTooltip(t.settings.storageLocation.migrate)
					.onClick(async () => {
						const newBasePath = normalizePath(this.plugin.settings.storageLocation);

						if (!newBasePath) {
							new Notice(t.settings.storageLocation.emptyPath);
							return;
						}

						if (newBasePath === this.plugin.store.currentBasePath) {
							new Notice(t.settings.storageLocation.alreadySelected);
							return;
						}

						button.setDisabled(true);
						button.extraSettingsEl.addClass('marginalia-spin');

						try {
							const count = await this.plugin.store.migrateData(newBasePath);
							if (count === 0) {
								new Notice(t.settings.storageLocation.noData);
							} else {
								new Notice(t.settings.storageLocation.migrated(count));
							}
							this.plugin.refreshPanel();
							this.plugin.updateGutterEffects();
						} catch (e) {
							new Notice(t.settings.storageLocation.failed(e instanceof Error ? e.message : String(e)));
						} finally {
							button.setDisabled(false);
							button.extraSettingsEl.removeClass('marginalia-spin');
						}
					});
			});

		new Setting(containerEl)
			.setName(t.settings.repairIndex.name)
			.setDesc(t.settings.repairIndex.desc)
			.addButton(button => {
				button
					.setButtonText(t.settings.repairIndex.button)
					.onClick(async () => {
						button.setDisabled(true);
						try {
							await this.plugin.repairCommentIndex();
						} finally {
							button.setDisabled(false);
						}
					});
			});

		new Setting(containerEl)
			.setName(t.settings.sortOrder.name)
			.setDesc(t.settings.sortOrder.desc)
			.addDropdown(dropdown => dropdown
				.addOption('position', t.settings.sortOrder.position)
				.addOption('created', t.settings.sortOrder.created)
				.setValue(this.plugin.settings.commentSortOrder)
				.onChange(async (value) => {
					this.plugin.settings.commentSortOrder = value as 'position' | 'created';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t.settings.showGutterIcons.name)
			.setDesc(t.settings.showGutterIcons.desc)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showGutterIcons)
				.onChange(async (value) => {
					this.plugin.settings.showGutterIcons = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t.settings.fuzzyMatchThreshold.name)
			.setDesc(t.settings.fuzzyMatchThreshold.desc)
			.addSlider(slider => slider
				.setLimits(0.1, 0.5, 0.05)
				.setValue(this.plugin.settings.fuzzyMatchThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.fuzzyMatchThreshold = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t.settings.orphanHandling.name)
			.setDesc(t.settings.orphanHandling.desc)
			.addDropdown(dropdown => dropdown
				.addOption('keep', t.settings.orphanHandling.keep)
				.addOption('delete', t.settings.orphanHandling.delete)
				.setValue(this.plugin.settings.orphanHandling)
				.onChange(async (value) => {
					this.plugin.settings.orphanHandling = value as 'keep' | 'delete';
					await this.plugin.saveSettings();
				}));
	}
}
