import type {AnchoredComment, RootComment} from './types';
import {getRootResolution} from './types';

type RepairResult = {
	restored: number;
	removed: number;
	invalid: number;
	conflicts: number;
	backupPath?: string;
};

export const t = {
	commands: {
		addComment: '添加选中文本批注',
		openPanel: '打开批注面板',
		nextComment: '跳转到下一条批注',
		previousComment: '跳转到上一条批注',
		addNoteComment: '添加文档批注',
	},
	menu: {
		addComment: '添加批注',
		addNoteComment: '添加文档批注',
	},
	settings: {
		storageLocation: {
			name: '批注存储位置',
			desc: '批注数据保存的位置。可以输入自定义路径，也可以选择预设路径。',
			pluginFolder: '插件目录（comments/）',
			vaultRoot: '仓库根目录（.marginalia/）',
			migrate: '将批注数据迁移到当前填写的位置',
			emptyPath: '请先填写批注存储位置。',
			alreadySelected: '批注数据已经位于当前选择的位置。',
			noData: '没有可迁移的批注数据。',
			migrated: (count: number) => `已成功迁移 ${count} 个文件。`,
			failed: (message: string) => `迁移失败：${message}`,
		},
		repairIndex: {
			name: '修复批注索引',
			desc: '基于现有批注文件重建 _index.json。此操作不会修改原文或批注内容。',
			button: '修复',
		},
		sortOrder: {
			name: '批注排序方式',
			desc: '侧边栏中批注的排序方式。',
			position: '按原文位置',
			created: '按创建时间',
		},
		showGutterIcons: {
			name: '显示行号批注图标',
			desc: '在编辑器行号区域显示批注图标。',
		},
		fuzzyMatchThreshold: {
			name: '模糊匹配阈值',
			desc: '锚点模糊匹配允许的最大编辑距离比例（0.0-1.0）。数值越低匹配越严格。',
		},
		orphanHandling: {
			name: '孤立批注处理',
			desc: '当批注无法再定位到目标原文时的处理方式。',
			keep: '保留并提示',
			delete: '自动删除',
		},
	},
	panel: {
		title: '批注',
		openMarkdownFile: '打开 Markdown 文件后查看批注。',
		noComments: '暂无批注。',
		noteComments: '文档批注',
		anchoredComments: '原文批注',
		filters: {
			all: '全部',
			open: '未解决',
			resolved: '已解决',
			active: '已定位',
			orphaned: '孤立',
			more: '更多筛选',
		},
		actions: {
			previewAll: '预览全部批注',
			addNoteComment: '添加文档批注',
			resolve: '标记为已解决',
			unresolve: '重新打开',
			reply: (count: number) => `回复（${count}）`,
			editComment: '编辑批注',
			deleteComment: '删除批注',
			editReply: '编辑回复',
			deleteReply: '删除回复',
		},
		labels: {
			note: '文档',
			resolvedBadge: '（已解决）',
			orphanedBadge: '（孤立）',
		},
	},
	modal: {
		addComment: '添加批注',
		editComment: '编辑批注',
		addNoteComment: '添加文档批注',
		addReply: '添加回复',
		placeholder: '输入批注内容（支持 Markdown）...',
		save: '保存',
		cancel: '取消',
		hint: 'Ctrl/Cmd+Enter 保存，Esc 取消',
	},
	popover: {
		resolvedSuffix: '（已解决）',
		replyCount: (count: number) => `${count} 条回复`,
		viewInPanel: '点击在批注面板中查看',
	},
	preview: {
		title: 'Marginalia 批注预览',
		generatedSummary: (generatedAt: string, noteCount: number, commentCount: number) =>
			`生成时间：${generatedAt}。共 ${noteCount} 篇文章，${commentCount} 条批注。`,
		controlsLabel: '批注预览控制',
		searchLabel: '搜索批注',
		searchPlaceholder: '搜索标题、路径、原文、批注、回复...',
		statusFiltersLabel: '状态筛选',
		filters: {
			all: '全部',
			open: '未解决',
			resolved: '已解决',
			orphaned: '孤立',
			replies: '有回复',
		},
		sortLabel: '排序',
		sort: {
			updated: '最近更新',
			path: '按路径',
			comments: '批注最多',
			open: '未解决最多',
		},
		selectNote: '选择文章',
		annotatedNotesLabel: '被批注文章',
		noMatchingTitle: '没有匹配的批注',
		noMatchingDesc: '清空搜索或选择其他筛选条件。',
		clearSearch: '清空搜索',
		noCommentsTitle: '未找到批注',
		noCommentsDesc: 'Marginalia 未在当前索引中找到已跟踪的批注文件。',
		resultCount: (visible: number | string, total: number | string) => `${visible} / ${total} 篇文章`,
		sections: {
			noteComments: '文档批注',
			anchoredComments: '原文批注',
			replies: '回复',
		},
		badges: {
			note: '文档',
			anchored: '原文',
			open: '未解决',
			resolved: '已解决',
			orphaned: '孤立',
			replies: '回复',
		},
	},
	notices: {
		previewFailed: (message: string) => `批注预览打开失败：${message}`,
		indexRebuilt: (result: RepairResult) => formatIndexRepairNotice('批注索引已重建', result),
		indexRepaired: (result: RepairResult) => formatIndexRepairNotice('批注索引已修复', result),
		indexRepairFailed: (message: string) => `批注索引修复失败：${message}`,
	},
};

export function displayResolution(comment: RootComment): string {
	return getRootResolution(comment) === 'resolved' ? t.preview.badges.resolved : t.preview.badges.open;
}

export function displayAnchorStatus(comment: AnchoredComment): string {
	return comment.status === 'orphaned' ? t.preview.badges.orphaned : t.panel.filters.active;
}

function formatIndexRepairNotice(prefix: string, result: RepairResult): string {
	const backup = result.backupPath ? ` 备份：${result.backupPath}。` : '';
	return `${prefix}：恢复 ${result.restored}，移除 ${result.removed}，无效 ${result.invalid}，冲突 ${result.conflicts}。${backup}`;
}
