import {getLanguage} from 'obsidian';

type TranslationValue = string | ((params: Record<string, string | number>) => string);

const STRINGS = {
	en: {
		settingsStorageName: 'Storage path',
		settingsStorageDesc: 'Where comment data is stored. After changing, use the migrate button to move existing data. Without migration, a plugin reload is needed and previous comments will not be visible.',
		settingsStorageOptionPlugin: 'Plugin folder (comments/)',
		settingsStorageOptionVault: 'Vault root (.marginalia/)',
		settingsStorageOptionCustom: 'Custom vault path',
		settingsCustomPathName: 'Custom data path',
		settingsCustomPathDesc: 'Relative path inside the vault. Absolute paths and paths outside the vault are not allowed.',
		settingsCustomPathPlaceholder: '.marginalia/custom',
		settingsMigrateTooltip: 'Migrate comment data to the selected path',
		noticeStorageCurrent: 'Comment data is already in the selected location.',
		noticeInvalidCustomPath: 'Please enter a valid relative path inside the vault.',
		noticeNoDataToMigrate: 'No comment data to migrate.',
		noticeMigrated: ({count}) => `Migrated ${count} file(s) successfully.`,
		noticeMigrationFailed: ({error}) => `Migration failed: ${error}`,
		settingsSortName: 'Comment sort order',
		settingsSortDesc: 'How comments are sorted in the comment list.',
		settingsSortPosition: 'Position in file',
		settingsSortCreated: 'Creation date',
		settingsGutterName: 'Show gutter icons',
		settingsGutterDesc: 'Display comment icons in the editor gutter.',
		settingsFuzzyName: 'Fuzzy match threshold',
		settingsFuzzyDesc: 'Maximum edit distance ratio (0.0-1.0) for fuzzy anchor matching. Lower values are stricter.',
		settingsOrphanName: 'Orphaned comment handling',
		settingsOrphanDesc: 'What to do when a comment can no longer find its target text.',
		settingsOrphanKeep: 'Keep and notify',
		settingsOrphanDelete: 'Delete automatically',
	},
	zh: {
		settingsStorageName: '数据路径',
		settingsStorageDesc: '用于保存评论数据的位置。修改后可使用迁移按钮移动现有数据；如果不迁移，需要重载插件后旧评论才会按新路径显示。',
		settingsStorageOptionPlugin: '插件目录（comments/）',
		settingsStorageOptionVault: '仓库根目录（.marginalia/）',
		settingsStorageOptionCustom: '自定义仓库路径',
		settingsCustomPathName: '自定义数据路径',
		settingsCustomPathDesc: '仅支持仓库内相对路径，不允许绝对路径或跳出仓库的路径。',
		settingsCustomPathPlaceholder: '.marginalia/custom',
		settingsMigrateTooltip: '将评论数据迁移到当前选择的路径',
		noticeStorageCurrent: '评论数据已经位于当前选择的路径。',
		noticeInvalidCustomPath: '请输入仓库内有效的相对路径。',
		noticeNoDataToMigrate: '没有可迁移的评论数据。',
		noticeMigrated: ({count}) => `成功迁移 ${count} 个文件。`,
		noticeMigrationFailed: ({error}) => `迁移失败：${error}`,
		settingsSortName: '评论排序方式',
		settingsSortDesc: '控制评论列表中的排序方式。',
		settingsSortPosition: '按文中位置',
		settingsSortCreated: '按创建时间',
		settingsGutterName: '显示段前图标',
		settingsGutterDesc: '在编辑器段前显示评论图标。',
		settingsFuzzyName: '模糊匹配阈值',
		settingsFuzzyDesc: '用于锚点模糊匹配的最大编辑距离比例（0.0-1.0），值越低越严格。',
		settingsOrphanName: '失效评论处理方式',
		settingsOrphanDesc: '当评论无法再定位到原始文本时的处理方式。',
		settingsOrphanKeep: '保留并提醒',
		settingsOrphanDelete: '自动删除',
	},
} satisfies Record<string, Record<string, TranslationValue>>;

export type TranslationKey = keyof typeof STRINGS.en;

export function isChineseLanguage(): boolean {
	return getLanguage().toLowerCase().startsWith('zh');
}

export function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
	const locale = isChineseLanguage() ? 'zh' : 'en';
	const value = STRINGS[locale][key] ?? STRINGS.en[key];
	return typeof value === 'function' ? value(params) : value;
}
