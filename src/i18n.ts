import {getLanguage} from 'obsidian';
import type {AnchoredComment, RootComment} from './types';
import {getRootResolution} from './types';
import type {PathIndexRepairResult} from './storage/PathIndex';

type TranslationParams = Record<string, string | number>;
type TranslationValue = string | ((params: TranslationParams) => string);

const STRINGS = {
	en: {
		settingsStorageName: 'Storage path',
		settingsStorageDesc: 'Where comment data is stored. After changing it, use migrate to move existing data.',
		settingsStorageOptionPlugin: 'Plugin folder (comments/)',
		settingsStorageOptionVault: 'Vault root (.marginalia/)',
		settingsStorageOptionCustom: 'Custom Vault path',
		settingsCustomPathName: 'Custom data path',
		settingsCustomPathDesc: 'Vault-relative path. Absolute paths and paths outside the Vault are not allowed.',
		settingsCustomPathPlaceholder: '.marginalia/custom',
		settingsMigrateTooltip: 'Migrate comment data to the selected path',
		noticeStorageCurrent: 'Comment data is already in the selected location.',
		noticeInvalidCustomPath: 'Enter a valid relative path inside the Vault.',
		noticeNoDataToMigrate: 'No comment data to migrate.',
		noticeMigrated: ({count}) => `Migrated ${count} file(s) successfully.`,
		noticeMigrationFailed: ({error}) => `Migration failed: ${error}`,
		settingsRepairName: 'Repair comment index',
		settingsRepairDesc: 'Rebuild _index.json from existing comment files without changing notes or comments.',
		settingsRepairButton: 'Repair',
		settingsSortName: 'Comment sort order',
		settingsSortDesc: 'How comments are sorted in the comment list.',
		settingsSortPosition: 'Position in file',
		settingsSortCreated: 'Creation date',
		settingsGutterName: 'Show gutter icons',
		settingsGutterDesc: 'Display comment icons in the editor gutter.',
		settingsFuzzyName: 'Fuzzy match threshold',
		settingsFuzzyDesc: 'Maximum edit distance ratio (0.0-1.0). Lower values are stricter.',
		settingsOrphanName: 'Orphaned comment handling',
		settingsOrphanDesc: 'What to do when a comment can no longer find its target text.',
		settingsOrphanKeep: 'Keep and notify',
		settingsOrphanDelete: 'Delete automatically',
		commandAddComment: 'Add comment to selection',
		commandOpenPanel: 'Open comment panel',
		commandNextComment: 'Go to next comment',
		commandPreviousComment: 'Go to previous comment',
		commandAddNoteComment: 'Add note comment',
		menuAddComment: 'Add comment',
		menuAddNoteComment: 'Add note comment',
		panelTitle: 'Comments',
		panelOpenMarkdown: 'Open a Markdown file to see comments.',
		panelNoComments: 'No comments yet.',
		panelNoteComments: 'Note comments',
		panelAnchoredComments: 'Anchored comments',
		filterAll: 'All',
		filterOpen: 'Open',
		filterResolved: 'Resolved',
		filterActive: 'Active',
		filterOrphaned: 'Orphaned',
		filterMore: 'More filters',
		actionPreviewAll: 'Preview all comments',
		actionAddNote: 'Add note comment',
		actionResolve: 'Resolve',
		actionUnresolve: 'Unresolve',
		actionReply: ({count}) => `Reply (${count})`,
		actionEditComment: 'Edit comment',
		actionDeleteComment: 'Delete comment',
		actionEditReply: 'Edit reply',
		actionDeleteReply: 'Delete reply',
		labelNote: 'Note',
		labelLinkedComment: 'Linked comment',
		labelResolvedSuffix: ' (resolved)',
		labelOrphanedSuffix: ' (orphaned)',
		labelReplyCount: ({count}) => `${count} ${Number(count) === 1 ? 'reply' : 'replies'}`,
		modalAddComment: 'Add comment',
		modalEditComment: 'Edit comment',
		modalAddNoteComment: 'Add note comment',
		modalAddReply: 'Add reply',
		modalPlaceholder: 'Write your comment (Markdown supported)...',
		modalSave: 'Save',
		modalCancel: 'Cancel',
		modalDone: 'Done',
		modalHint: 'Ctrl/Cmd+Enter to save, Esc to cancel',
		popoverResolvedSuffix: ' (resolved)',
		popoverViewInPanel: 'Click to view in panel',
		gutterCommentCount: ({count}) => `${count} ${Number(count) === 1 ? 'comment' : 'comments'}`,
		mobileClose: 'Close comments',
		mobileTitleComment: 'Comment', mobileTitleComments: 'Comments', mobileNoFocusedComment: 'No comment found for this location.',
		mobileJumpToSource: 'Jump to original text',
		mobileEmptyComment: 'Comment cannot be empty.',
		mobileCommentNotFound: 'Comment not found.',
		mobileSourceUnavailable: 'Original text is not available.',
		mobileJumpFailed: 'Unable to jump to original text.',
		statusSaving: 'Saving...', statusTapOutside: 'Tap outside to save', statusEditing: 'Editing', noticeSaveFailed: ({error}) => `Failed to save comment: ${error}`,
		noticePreviewFailed: ({error}) => `Could not open comment preview: ${error}`,
		noticePreviewDesktopOnly: 'Comment preview is available on desktop only.',
		noticeIndexRebuilt: ({details}) => `Comment index rebuilt: ${details}`,
		noticeIndexRepaired: ({details}) => `Comment index repaired: ${details}`,
		noticeIndexRepairFailed: ({error}) => `Comment index repair failed: ${error}`,
		indexRepairDetails: ({restored, removed, invalid, conflicts}) => `${restored} restored, ${removed} removed, ${invalid} invalid, ${conflicts} conflicts.`,
		indexRepairBackup: ({path}) => `Backup: ${path}`,
		previewTitle: 'Marginalia comment preview',
		previewGeneratedSummary: ({generatedAt, noteCount, commentCount}) => `Generated ${generatedAt}. ${noteCount} note(s), ${commentCount} comment(s).`,
		previewControlsLabel: 'Comment preview controls',
		previewSearchLabel: 'Search comments',
		previewSearchPlaceholder: 'Search title, topic, path, quote, comment, or reply...',
		previewTopicsLabel: 'Topics',
		previewAllTopics: 'All topics',
		previewUntagged: 'Uncategorized',
		previewSortLabel: 'Sort',
		previewSelectNote: 'Select note',
		previewAnnotatedNotesLabel: 'Annotated notes',
		previewNoMatchingTitle: 'No matching comments',
		previewNoMatchingDesc: 'Clear the search or choose another filter.',
		previewClearSearch: 'Clear search',
		previewNoCommentsTitle: 'No comments found',
		previewNoCommentsDesc: 'Marginalia found no tracked comment files in the current index.',
		previewResultCount: ({visible, total}) => `${visible} / ${total} notes`,
		previewRecentlyUpdated: 'Recently updated',
		previewSortTitle: 'Title',
		previewSortPath: 'Path',
		previewSortComments: 'Most comments',
		previewReplies: 'Replies',
	},
	zh: {
		settingsStorageName: '数据路径', settingsStorageDesc: '用于保存批注数据的位置。修改后请使用迁移按钮移动现有数据。',
		settingsStorageOptionPlugin: '插件目录（comments/）', settingsStorageOptionVault: '仓库根目录（.marginalia/）', settingsStorageOptionCustom: '自定义仓库路径',
		settingsCustomPathName: '自定义数据路径', settingsCustomPathDesc: '仅支持仓库内相对路径，不允许绝对路径或跳出仓库。', settingsCustomPathPlaceholder: '.marginalia/custom',
		settingsMigrateTooltip: '将批注数据迁移到当前选择的路径', noticeStorageCurrent: '批注数据已经位于当前选择的路径。', noticeInvalidCustomPath: '请输入仓库内有效的相对路径。',
		noticeNoDataToMigrate: '没有可迁移的批注数据。', noticeMigrated: ({count}) => `成功迁移 ${count} 个文件。`, noticeMigrationFailed: ({error}) => `迁移失败：${error}`,
		settingsRepairName: '修复批注索引', settingsRepairDesc: '基于现有批注文件重建 _index.json，不修改原文或批注内容。', settingsRepairButton: '修复',
		settingsSortName: '批注排序方式', settingsSortDesc: '控制批注列表中的排序方式。', settingsSortPosition: '按文中位置', settingsSortCreated: '按创建时间',
		settingsGutterName: '显示段前图标', settingsGutterDesc: '在编辑器段前显示批注图标。', settingsFuzzyName: '模糊匹配阈值', settingsFuzzyDesc: '锚点模糊匹配允许的最大编辑距离比例，值越低越严格。',
		settingsOrphanName: '失效批注处理方式', settingsOrphanDesc: '当批注无法再定位到原始文本时的处理方式。', settingsOrphanKeep: '保留并提醒', settingsOrphanDelete: '自动删除',
		commandAddComment: '添加选中文本批注', commandOpenPanel: '打开批注面板', commandNextComment: '跳转到下一条批注', commandPreviousComment: '跳转到上一条批注', commandAddNoteComment: '添加文档批注',
		menuAddComment: '添加批注', menuAddNoteComment: '添加文档批注', panelTitle: '批注', panelOpenMarkdown: '打开 Markdown 文件后查看批注。', panelNoComments: '暂无批注。', panelNoteComments: '文档批注', panelAnchoredComments: '原文批注',
		filterAll: '全部', filterOpen: '未解决', filterResolved: '已解决', filterActive: '已定位', filterOrphaned: '孤立', filterMore: '更多筛选',
		actionPreviewAll: '预览全部批注', actionAddNote: '添加文档批注', actionResolve: '标记为已解决', actionUnresolve: '重新打开', actionReply: ({count}) => `回复（${count}）`, actionEditComment: '编辑批注', actionDeleteComment: '删除批注', actionEditReply: '编辑回复', actionDeleteReply: '删除回复',
		labelNote: '文档', labelLinkedComment: '原文批注', labelResolvedSuffix: '（已解决）', labelOrphanedSuffix: '（孤立）', labelReplyCount: ({count}) => `${count} 条回复`,
		modalAddComment: '添加批注', modalEditComment: '编辑批注', modalAddNoteComment: '添加文档批注', modalAddReply: '添加回复', modalPlaceholder: '输入批注内容（支持 Markdown）...', modalSave: '保存', modalCancel: '取消', modalDone: '完成', modalHint: 'Ctrl/Cmd+Enter 保存，Esc 取消',
		popoverResolvedSuffix: '（已解决）', popoverViewInPanel: '点击在批注面板中查看', gutterCommentCount: ({count}) => `${count} 条批注`,
		mobileClose: '关闭批注', mobileTitleComment: '批注', mobileTitleComments: '批注', mobileNoFocusedComment: '当前位置没有批注。', mobileJumpToSource: '跳转到原文', mobileEmptyComment: '批注内容不能为空。', mobileCommentNotFound: '未找到批注。', mobileSourceUnavailable: '原文不可用。', mobileJumpFailed: '无法跳转到原文。',
		statusSaving: '保存中...', statusTapOutside: '点击外部保存', statusEditing: '编辑中', noticeSaveFailed: ({error}) => `批注保存失败：${error}`,
		noticePreviewFailed: ({error}) => `批注预览打开失败：${error}`, noticePreviewDesktopOnly: '批注预览仅支持桌面端。', noticeIndexRebuilt: ({details}) => `批注索引已重建：${details}`, noticeIndexRepaired: ({details}) => `批注索引已修复：${details}`, noticeIndexRepairFailed: ({error}) => `批注索引修复失败：${error}`, indexRepairDetails: ({restored, removed, invalid, conflicts}) => `恢复 ${restored}，移除 ${removed}，无效 ${invalid}，冲突 ${conflicts}。`, indexRepairBackup: ({path}) => `备份：${path}`,
		previewTitle: 'Marginalia 批注预览', previewGeneratedSummary: ({generatedAt, noteCount, commentCount}) => `生成时间：${generatedAt}。共 ${noteCount} 篇文章，${commentCount} 条批注。`, previewControlsLabel: '批注预览控制', previewSearchLabel: '搜索批注', previewSearchPlaceholder: '搜索标题、主题、路径、原文、批注、回复...', previewTopicsLabel: '主题', previewAllTopics: '全部主题', previewUntagged: '未分类', previewSortLabel: '排序', previewSelectNote: '选择文章', previewAnnotatedNotesLabel: '被批注文章', previewNoMatchingTitle: '没有匹配的批注', previewNoMatchingDesc: '清空搜索或选择其他筛选条件。', previewClearSearch: '清空搜索', previewNoCommentsTitle: '未找到批注', previewNoCommentsDesc: '当前索引中没有已跟踪的批注文件。', previewResultCount: ({visible, total}) => `${visible} / ${total} 篇文章`, previewRecentlyUpdated: '最近更新', previewSortTitle: '按标题', previewSortPath: '按路径', previewSortComments: '批注最多', previewReplies: '回复',
	},
} satisfies Record<'en' | 'zh', Record<string, TranslationValue>>;

export type TranslationKey = keyof typeof STRINGS.en;

export function isChineseLanguage(): boolean {
	return getLanguage().toLowerCase().startsWith('zh');
}

export function t(key: TranslationKey, params: TranslationParams = {}): string {
	const locale = isChineseLanguage() ? 'zh' : 'en';
	const value = STRINGS[locale][key] ?? STRINGS.en[key];
	return typeof value === 'function' ? value(params) : value;
}

export function displayResolution(comment: RootComment): string {
	return getRootResolution(comment) === 'resolved' ? t('filterResolved') : t('filterOpen');
}

export function displayAnchorStatus(comment: AnchoredComment): string {
	return comment.status === 'orphaned' ? t('filterOrphaned') : t('filterActive');
}

export function formatIndexRepairResult(result: PathIndexRepairResult): string {
	const details = t('indexRepairDetails', {
		restored: result.restored,
		removed: result.removed,
		invalid: result.invalid,
		conflicts: result.conflicts,
	});
	return result.backupPath ? `${details} ${t('indexRepairBackup', {path: result.backupPath})}` : details;
}

export const previewT = {
	language: isChineseLanguage() ? 'zh-CN' : 'en',
	title: t('previewTitle'),
	generatedSummary: (generatedAt: string, noteCount: number, commentCount: number) => t('previewGeneratedSummary', {generatedAt, noteCount, commentCount}),
	controlsLabel: t('previewControlsLabel'), searchLabel: t('previewSearchLabel'), searchPlaceholder: t('previewSearchPlaceholder'), topicsLabel: t('previewTopicsLabel'), allTopics: t('previewAllTopics'), untagged: t('previewUntagged'),
	sortLabel: t('previewSortLabel'), sort: {updated: t('previewRecentlyUpdated'), title: t('previewSortTitle'), path: t('previewSortPath'), comments: t('previewSortComments')},
	selectNote: t('previewSelectNote'), annotatedNotesLabel: t('previewAnnotatedNotesLabel'), noMatchingTitle: t('previewNoMatchingTitle'), noMatchingDesc: t('previewNoMatchingDesc'), clearSearch: t('previewClearSearch'), noCommentsTitle: t('previewNoCommentsTitle'), noCommentsDesc: t('previewNoCommentsDesc'),
	resultCount: (visible: number | string, total: number | string) => t('previewResultCount', {visible, total}),
	sections: {noteComments: t('panelNoteComments'), anchoredComments: t('panelAnchoredComments'), replies: t('previewReplies')},
	badges: {note: t('labelNote'), anchored: t('labelLinkedComment'), open: t('filterOpen'), resolved: t('filterResolved'), orphaned: t('filterOrphaned'), replies: t('previewReplies')},
};
