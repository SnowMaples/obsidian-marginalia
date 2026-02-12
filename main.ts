import {
	Plugin,
	PluginSettingTab,
	Setting,
	App,
	Editor,
	MarkdownView,
	Menu,
	Modal,
	TFile,
	TFolder,
	Notice,
	WorkspaceLeaf,
	ItemView,
	MarkdownRenderer
} from 'obsidian';
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';

// 常量定义
const ANNOTATION_PREVIEW_VIEW_TYPE = 'annotation-preview-view';

// 用于强制刷新高亮的 StateEffect
const annotationsUpdatedEffect = StateEffect.define<void>();

// 批注数据接口
interface Annotation {
	id: string;
	sourceFile: string;
	startOffset: number;
	endOffset: number;
	selectedText: string;
	content: string;
	createdAt: number;
	updatedAt: number;
}

// 插件设置接口
interface AnnotationPluginSettings {
	annotationFolder: string;
	showAnnotationPreview: boolean;
	previewPosition: 'left' | 'right';
	highlightColor: string;
}

// 默认设置
const DEFAULT_SETTINGS: AnnotationPluginSettings = {
	annotationFolder: 'Annotations',
	showAnnotationPreview: true,
	previewPosition: 'right',
	highlightColor: '#ffeb3b'
};

export default class AnnotationPlugin extends Plugin {
	settings: AnnotationPluginSettings;
	annotations: Map<string, Annotation[]> = new Map();
	highlightPlugin: ViewPlugin<any> | null = null;
	activeTooltip: HTMLElement | null = null;
	isMobile: boolean = false;
	touchStartTime: number = 0;
	touchStartPos: { x: number; y: number } = { x: 0, y: 0 };

	async onload() {
		console.log('加载批注插件');

		// 检测是否为移动端
		this.isMobile = this.detectMobile();
		if (this.isMobile) {
			console.log('检测到移动端设备');
			document.body.classList.add('annotation-mobile');
		}

		// 加载设置
		await this.loadSettings();

		// 注册高亮插件（必须在加载批注数据之前）
		this.registerHighlightPlugin();

		// 添加设置面板
		this.addSettingTab(new AnnotationSettingTab(this.app, this));

		// 等待 vault 准备好后再加载批注数据
		this.app.workspace.onLayoutReady(async () => {
			console.log('Workspace layout ready, 开始加载批注数据');
			await this.loadAnnotations();
			this.refreshHighlights();

			// 如果有打开的文件，更新批注面板（移动端不自动开启）
			const activeFile = this.getActiveFile();
			if (activeFile && !this.isMobile) {
				this.updateAnnotationPanel();
			}
		});

		// 注册右键菜单事件（PC端）
		this.registerEvent(
			this.app.workspace.on('editor-menu', this.handleEditorMenu.bind(this))
		);

		// 注册编辑器变化事件
		this.registerEvent(
			this.app.workspace.on('editor-change', this.handleEditorChange.bind(this))
		);

		// 注册文件打开事件，用于更新高亮和自动显示批注面板
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					// 延迟执行，确保编辑器已准备好
					setTimeout(() => {
						this.refreshHighlights();
						// 自动更新右侧批注面板（移动端不自动开启）
						if (!this.isMobile) {
							this.updateAnnotationPanel();
						}
					}, 100);
				}
			})
		);

		// 根据设备类型注册不同的事件
		if (this.isMobile) {
			// 移动端：注册触摸事件
			this.registerMobileEvents();
		} else {
			// PC端：注册鼠标点击事件
			this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
				this.handleEditorClick(evt);
			});

			// 注册双击事件（用于显示悬浮提示）
			this.registerDomEvent(document, 'dblclick', (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				if (target.classList.contains('annotation-highlight') ||
					target.closest('.annotation-highlight')) {
					evt.preventDefault();
					evt.stopPropagation();

					const highlightEl = target.classList.contains('annotation-highlight')
						? target
						: target.closest('.annotation-highlight') as HTMLElement;
					const annotationId = highlightEl.getAttribute('data-annotation-id');
					if (annotationId) {
						this.showAnnotationTooltip(highlightEl, annotationId);
					}
				}
			});

			// 点击其他地方关闭悬浮提示
			this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				// 如果点击的不是 tooltip 内部，则关闭
				if (!target.closest('.annotation-tooltip') && this.activeTooltip) {
					this.hideAnnotationTooltip();
				}
			});

			// 注册 Ctrl 键监听（用于鼠标样式变化）
			this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
				if (evt.ctrlKey || evt.metaKey) {
					document.body.classList.add('ctrl-pressed');
				}
			});

			this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
				if (!evt.ctrlKey && !evt.metaKey) {
					document.body.classList.remove('ctrl-pressed');
				}
			});
		}
		
		// 添加命令
		this.addCommand({
			id: 'add-annotation',
			name: '添加批注',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.addAnnotation(editor, view);
			}
		});
		
		this.addCommand({
			id: 'toggle-annotation-preview',
			name: '切换批注预览面板',
			callback: () => {
				this.toggleAnnotationPreview();
			}
		});
		
		this.addCommand({
			id: 'toggle-annotation-sidebar',
			name: '切换侧边批注显示',
			callback: () => {
				this.toggleAnnotationSidebar();
			}
		});
		
		// 添加样式
		this.addStyles();
		
		// 注册预览面板视图
		this.registerView(
			ANNOTATION_PREVIEW_VIEW_TYPE,
			(leaf) => new AnnotationPreviewView(leaf, this)
		);
		
		// 注册功能区图标（右侧功能区）
		this.addRibbonIcon('quote-glyph', '批注', (evt: MouseEvent) => {
			// 点击功能区图标切换批注面板
			this.toggleAnnotationPreview();
		});
		
		// 如果设置中开启了预览面板，延迟后自动打开
		if (this.settings.showAnnotationPreview) {
			// 等待工作区准备好
			this.app.workspace.onLayoutReady(() => {
				this.activateAnnotationPreview();
			});
		}
	}

	onunload() {
		console.log('卸载批注插件');
		this.removeStyles();
	}

	// 处理编辑器右键菜单
	handleEditorMenu(menu: Menu, editor: Editor, view: MarkdownView) {
		const selection = editor.getSelection();
		if (selection && selection.trim().length > 0) {
			menu.addItem((item) => {
				item
					.setTitle('添加批注')
					.setIcon('quote-glyph')
					.onClick(() => {
						this.addAnnotation(editor, view);
					});
			});
		}
	}

	// 处理编辑器变化
	handleEditorChange(editor: Editor, view: MarkdownView) {
		// 这里可以更新高亮显示
		this.updateHighlights(view);
	}

	// 添加批注
	async addAnnotation(editor: Editor, view: MarkdownView) {
		const selection = editor.getSelection();
		if (!selection || selection.trim().length === 0) {
			new Notice('请先选择要批注的文字');
			return;
		}

		const from = editor.getCursor('from');
		const to = editor.getCursor('to');
		const startOffset = editor.posToOffset(from);
		const endOffset = editor.posToOffset(to);
		const sourceFile = view.file?.path;

		if (!sourceFile) {
			new Notice('无法获取当前文件路径');
			return;
		}

		// 先关闭任何可能打开的 tooltip，避免焦点冲突
		this.hideAnnotationTooltip();

		// 短暂延迟确保 tooltip 完全关闭，再打开 Modal
		setTimeout(() => {
			// 打开批注编辑弹窗
			new AnnotationModal(this.app, selection, async (content: string) => {
				const annotation: Annotation = {
					id: this.generateId(),
					sourceFile: sourceFile,
					startOffset: startOffset,
					endOffset: endOffset,
					selectedText: selection,
					content: content,
					createdAt: Date.now(),
					updatedAt: Date.now()
				};

				await this.saveAnnotation(annotation);
				
				// 使用延迟确保 DOM 更新后再刷新高亮
				setTimeout(() => {
					this.forceRefreshHighlights();
				}, 50);
				
				// 更新侧边栏
				await this.updateAnnotationPanel();
				
				new Notice('批注已保存');
			}).open();
		}, 50);
	}

	// 保存批注
	async saveAnnotation(annotation: Annotation) {
		// 确保批注文件夹存在
		await this.ensureAnnotationFolder();

		// 获取或创建批注文件
		const annotationFilePath = this.getAnnotationFilePath(annotation.sourceFile);
		let existingAnnotations: Annotation[] = [];
		let fileExists = false;

		try {
			const file = this.app.vault.getAbstractFileByPath(annotationFilePath);
			if (file instanceof TFile) {
				// 验证文件是否真的存在（未被删除）
				try {
					const content = await this.app.vault.read(file);
					// 即使文件内容为空或解析失败，也视为文件存在
					existingAnnotations = this.parseAnnotationFile(content) || [];
					fileExists = true;
				} catch (readError) {
					// 文件可能已被删除但缓存未更新
					fileExists = false;
					existingAnnotations = [];
				}
			}
		} catch (e) {
			// 文件不存在，将创建新文件
			fileExists = false;
		}

		// 添加新批注
		existingAnnotations.push(annotation);

		// 保存文件
		const fileContent = this.formatAnnotationFile(existingAnnotations, annotation.sourceFile);

		try {
			if (fileExists) {
				// 文件存在，使用 modify
				const file = this.app.vault.getAbstractFileByPath(annotationFilePath);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, fileContent);
				} else {
					// 文件突然不存在了，创建新文件
					await this.app.vault.create(annotationFilePath, fileContent);
				}
			} else {
				// 文件不存在，创建新文件
				await this.app.vault.create(annotationFilePath, fileContent);
			}
		} catch (writeError) {
			console.error('保存批注文件失败:', writeError);
			throw new Error('保存批注失败: ' + (writeError as Error).message);
		}

		// 更新内存中的批注列表
		this.annotations.set(annotation.sourceFile, existingAnnotations);
	}

	// 加载批注
	async loadAnnotations() {
		// 先清空现有的批注数据，确保重新加载时数据是最新的
		this.annotations.clear();
		
		const folder = this.app.vault.getAbstractFileByPath(this.settings.annotationFolder);
		if (folder instanceof TFolder) {
			for (const file of folder.children) {
				if (file instanceof TFile && file.extension === 'md') {
					try {
						const content = await this.app.vault.read(file);
						const annotations = this.parseAnnotationFile(content);
						if (annotations.length > 0) {
							const sourceFile = annotations[0].sourceFile;
							this.annotations.set(sourceFile, annotations);
						}
					} catch (e) {
						console.error('加载批注文件失败:', file.path, e);
					}
				}
			}
		}
	}

	// 解析批注文件
	parseAnnotationFile(content: string): Annotation[] {
		const annotations: Annotation[] = [];
		const lines = content.split('\n');
		let currentAnnotation: Partial<Annotation> = {};
		let inFrontMatter = false;
		let contentLines: string[] = [];
		let foundFirstAnnotation = false; // 标记是否找到了第一个批注

		for (const line of lines) {
			if (line === '---') {
				if (!inFrontMatter) {
					inFrontMatter = true;
					if (Object.keys(currentAnnotation).length > 0) {
						// 保存之前的批注
						currentAnnotation.content = contentLines.join('\n').trim();
						annotations.push(currentAnnotation as Annotation);
						currentAnnotation = {};
						contentLines = [];
					}
				} else {
					inFrontMatter = false;
					// 标记已找到第一个批注的开始
					foundFirstAnnotation = true;
				}
				continue;
			}

			if (inFrontMatter) {
				const match = line.match(/^(.+?):\s*(.+)$/);
				if (match) {
					const key = match[1].trim();
					const value = match[2].trim();
					switch (key) {
						case 'id':
							currentAnnotation.id = value;
							break;
						case 'sourceFile':
							currentAnnotation.sourceFile = value;
							break;
						case 'startOffset':
							currentAnnotation.startOffset = parseInt(value);
							break;
						case 'endOffset':
							currentAnnotation.endOffset = parseInt(value);
							break;
						case 'selectedText':
							currentAnnotation.selectedText = value;
							break;
						case 'createdAt':
							currentAnnotation.createdAt = parseInt(value);
							break;
						case 'updatedAt':
							currentAnnotation.updatedAt = parseInt(value);
							break;
					}
				}
			} else if (line.trim() !== '' && foundFirstAnnotation) {
				// 只有在找到第一个批注后，才开始收集内容
				contentLines.push(line);
			}
		}

		// 处理最后一个批注
		if (Object.keys(currentAnnotation).length > 0) {
			currentAnnotation.content = contentLines.join('\n').trim();
			annotations.push(currentAnnotation as Annotation);
		}

		return annotations;
	}
	
	// 更新批注内容
	async updateAnnotation(annotation: Annotation): Promise<void> {
		const annotationFilePath = this.getAnnotationFilePath(annotation.sourceFile);
		const file = this.app.vault.getAbstractFileByPath(annotationFilePath);
		
		if (!(file instanceof TFile)) {
			throw new Error('批注文件不存在');
		}
		
		// 读取现有批注
		const content = await this.app.vault.read(file);
		const annotations = this.parseAnnotationFile(content);
		
		// 找到并更新对应的批注
		const index = annotations.findIndex(a => a.id === annotation.id);
		if (index === -1) {
			throw new Error('批注不存在');
		}
		
		// 更新时间戳
		annotation.updatedAt = Date.now();
		annotations[index] = annotation;
		
		// 保存文件
		const fileContent = this.formatAnnotationFile(annotations, annotation.sourceFile);
		await this.app.vault.modify(file, fileContent);
		
		// 更新内存中的批注列表
		this.annotations.set(annotation.sourceFile, annotations);
	}
	
	// 删除批注
	async deleteAnnotation(annotationId: string, sourceFile: string): Promise<void> {
		const annotationFilePath = this.getAnnotationFilePath(sourceFile);
		const file = this.app.vault.getAbstractFileByPath(annotationFilePath);

		if (!(file instanceof TFile)) {
			throw new Error('批注文件不存在');
		}

		// 读取现有批注
		const content = await this.app.vault.read(file);
		let annotations = this.parseAnnotationFile(content);

		// 过滤掉要删除的批注
		annotations = annotations.filter(a => a.id !== annotationId);

		// 保存更新后的文件（即使为空也保留文件，避免后续添加批注时出现问题）
		const fileContent = this.formatAnnotationFile(annotations, sourceFile);
		await this.app.vault.modify(file, fileContent);
		
		// 更新内存中的批注列表
		if (annotations.length === 0) {
			this.annotations.delete(sourceFile);
		} else {
			this.annotations.set(sourceFile, annotations);
		}
	}

	// 格式化批注文件
	formatAnnotationFile(annotations: Annotation[], sourceFile: string): string {
		let content = `# 批注: ${sourceFile}\n\n`;
		content += `> 源文件: [[${sourceFile}]]\n\n`;
		// 移除开头的 ---，避免解析问题

		for (const annotation of annotations) {
			content += `---\n`;
			content += `id: ${annotation.id}\n`;
			content += `sourceFile: ${annotation.sourceFile}\n`;
			content += `startOffset: ${annotation.startOffset}\n`;
			content += `endOffset: ${annotation.endOffset}\n`;
			content += `selectedText: ${annotation.selectedText.replace(/\n/g, ' ')}\n`;
			content += `createdAt: ${annotation.createdAt}\n`;
			content += `updatedAt: ${annotation.updatedAt}\n`;
			content += `---\n\n`;
			content += `${annotation.content}\n\n`;
		}

		return content;
	}

	// 获取批注文件路径
	getAnnotationFilePath(sourceFile: string): string {
		// 获取文件名（不含扩展名）
		const lastSlash = sourceFile.lastIndexOf('/');
		const lastBackslash = sourceFile.lastIndexOf('\\');
		const separator = Math.max(lastSlash, lastBackslash);
		
		let fileName = sourceFile;
		if (separator >= 0) {
			fileName = sourceFile.substring(separator + 1);
		}
		
		// 去除扩展名
		const lastDot = fileName.lastIndexOf('.');
		if (lastDot > 0) {
			fileName = fileName.substring(0, lastDot);
		}
		
		return `${this.settings.annotationFolder}/${fileName}-annotation.md`;
	}

	// 确保批注文件夹存在
	async ensureAnnotationFolder() {
		try {
			const folder = this.app.vault.getAbstractFileByPath(this.settings.annotationFolder);
			if (!folder) {
				await this.app.vault.createFolder(this.settings.annotationFolder);
			}
		} catch (error) {
			// 如果文件夹已存在，忽略错误
			if (!(error as Error).message?.includes('already exists')) {
				throw error;
			}
		}
	}

	// 注册高亮插件
	registerHighlightPlugin() {
		const plugin = this;

		// 创建一个 StateField 来追踪批注更新
		const annotationsField = StateField.define<number>({
			create() {
				return 0;
			},
			update(value, tr) {
				for (const effect of tr.effects) {
					if (effect.is(annotationsUpdatedEffect)) {
						return value + 1;
					}
				}
				return value;
			}
		});

		this.highlightPlugin = ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				lastUpdateCount: number = 0;

				constructor(view: EditorView) {
					this.decorations = plugin.buildDecorations(view);
				}

				update(update: ViewUpdate) {
					const currentCount = update.state.field(annotationsField);
					// 当文档变化、视口变化或批注数据更新时重新构建装饰器
					if (update.docChanged || update.viewportChanged || currentCount !== this.lastUpdateCount) {
						this.decorations = plugin.buildDecorations(update.view);
						this.lastUpdateCount = currentCount;
					}
				}
			},
			{
				decorations: (v) => v.decorations,
			}
		);

		this.registerEditorExtension([annotationsField, this.highlightPlugin]);
	}
	
	// 构建装饰器
	buildDecorations(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const activeFile = this.getActiveFile();
		
		if (!activeFile) {
			return builder.finish();
		}
		
		const annotations = this.annotations.get(activeFile) || [];
		
		for (const annotation of annotations) {
			// 检查批注范围是否在视口内
			if (annotation.startOffset < view.state.doc.length && 
			    annotation.endOffset <= view.state.doc.length) {
				const from = annotation.startOffset;
				const to = annotation.endOffset;
				
				const decoration = Decoration.mark({
					class: 'annotation-highlight',
					attributes: {
						'data-annotation-id': annotation.id
					}
				});
				
				builder.add(from, to, decoration);
			}
		}
		
		return builder.finish();
	}
	
	// 获取当前活动文件路径
	getActiveFile(): string | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		return activeView?.file?.path || null;
	}
	
	// 刷新高亮
	refreshHighlights() {
		// 获取所有 MarkdownView 并更新高亮
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			if (view && view.editor) {
				this.updateHighlights(view);
			}
		}
		
		// 如果没有找到 leaves，尝试获取当前激活的视图
		if (leaves.length === 0) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.editor) {
				this.updateHighlights(activeView);
			}
		}
	}
	
	// 更新高亮显示
	updateHighlights(view: MarkdownView) {
		const file = view.file;
		if (!file) return;

		const annotations = this.annotations.get(file.path) || [];
		
		// 触发编辑器重绘以应用新的装饰器
		const editorView = (view.editor as any).cm as EditorView;
		if (editorView) {
			// 强制重新构建装饰器
			editorView.dispatch({
				effects: []  // 空效果也会触发重新渲染
			});
		}
	}
	
	// 强制完全刷新所有高亮（用于新增/编辑批注后）
	forceRefreshHighlights() {
		// 获取所有 MarkdownView 并更新高亮
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		
		for (const leaf of leaves) {
			const view = leaf.view as MarkdownView;
			if (view && view.file && view.editor) {
				const editorView = (view.editor as any).cm as EditorView;
				if (editorView) {
					// 使用 StateEffect 触发重新构建装饰器
					editorView.dispatch({
						effects: annotationsUpdatedEffect.of()
					});
				}
			}
		}

		// 如果没有找到 leaves，尝试获取当前激活的视图
		if (leaves.length === 0) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.editor) {
				const editorView = (activeView.editor as any).cm as EditorView;
				if (editorView) {
					editorView.dispatch({
						effects: annotationsUpdatedEffect.of()
					});
				}
			}
		}
	}
	
	// 高亮正文中指定的批注
	highlightAnnotationInEditor(annotationId: string) {
		// 移除之前的高亮
		document.querySelectorAll('.annotation-highlight-active').forEach(el => {
			el.classList.remove('annotation-highlight-active');
		});
		
		// 添加高亮到指定批注
		document.querySelectorAll(`.annotation-highlight[data-annotation-id="${annotationId}"]`).forEach(el => {
			el.classList.add('annotation-highlight-active');
		});
	}

	// 处理编辑器点击事件
	handleEditorClick(evt: MouseEvent) {
		const target = evt.target as HTMLElement;
		
		// 检查是否点击了高亮元素
		if (target.classList.contains('annotation-highlight') || 
		    target.closest('.annotation-highlight')) {
			evt.preventDefault();
			evt.stopPropagation();
			
			const highlightEl = target.classList.contains('annotation-highlight') 
				? target 
				: target.closest('.annotation-highlight') as HTMLElement;
			
			const annotationId = highlightEl.getAttribute('data-annotation-id');
			if (!annotationId) return;
			
			// 检测是否按住了 Ctrl 键
			if (evt.ctrlKey || evt.metaKey) {
				// Ctrl+点击：跳转到批注文件对应批注位置
				this.openAnnotationFileAtAnnotation(annotationId);
			} else {
				// 普通点击：定位到右侧功能栏的对应批注记录
				this.highlightAnnotationInSidebar(annotationId);
			}
		} else if (this.activeTooltip) {
			// 点击其他地方时关闭悬浮提示
			this.hideAnnotationTooltip();
		}
	}
	
	// 高亮右侧功能栏的对应批注记录
	highlightAnnotationInSidebar(annotationId: string) {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(ANNOTATION_PREVIEW_VIEW_TYPE);
		
		if (leaves.length === 0) {
			// 如果右侧功能栏未打开，自动打开
			this.activateAnnotationPreview();
			// 延迟后再次尝试高亮
			setTimeout(() => {
				this.highlightAnnotationInSidebar(annotationId);
			}, 300);
			return;
		}
		
		// 在右侧功能栏中高亮对应记录
		for (const leaf of leaves) {
			const view = leaf.view as AnnotationPreviewView;
			if (view && view.contentEl) {
				// 移除所有高亮
				view.contentEl.querySelectorAll('.annotation-sidebar-item').forEach(el => {
					el.classList.remove('active');
				});
				
				// 高亮对应记录
				const item = view.contentEl.querySelector(`[data-annotation-id="${annotationId}"]`);
				if (item) {
					item.classList.add('active');
					item.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			}
		}
	}
	
	// 打开批注文件并定位到具体批注位置（Ctrl+点击使用）
	async openAnnotationFileAtAnnotation(annotationId: string) {
		const activeFile = this.getActiveFile();
		if (!activeFile) return;
		
		const annotationFilePath = this.getAnnotationFilePath(activeFile);
		const annotationFile = this.app.vault.getAbstractFileByPath(annotationFilePath);
		
		if (annotationFile instanceof TFile) {
			// 读取批注文件内容，找到对应批注的位置
			const content = await this.app.vault.read(annotationFile);
			const regex = new RegExp(`^id:\\s*${annotationId}$`, 'm');
			const match = content.match(regex);
			
			if (match && match.index !== undefined) {
				// 计算行号
				const linesBefore = content.substring(0, match.index).split('\n').length;
				
				// 打开批注文件
				await this.app.workspace.openLinkText(annotationFilePath, '', false);
				
				// 定位到对应行
				setTimeout(() => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView && activeView.editor) {
						const pos = { line: linesBefore - 1, ch: 0 };
						activeView.editor.setCursor(pos);
						activeView.editor.scrollIntoView({ from: pos, to: pos }, true);
					}
				}, 200);
			} else {
				// 如果找不到，只打开文件
				await this.app.workspace.openLinkText(annotationFilePath, '', false);
			}
		} else {
			new Notice('批注文件不存在');
		}
	}
	
	// 显示批注悬浮提示（双击显示，支持滚动和编辑）
	showAnnotationTooltip(element: HTMLElement, annotationId: string) {
		// 先关闭已有的提示
		this.hideAnnotationTooltip();
		
		// 查找批注
		const activeFile = this.getActiveFile();
		if (!activeFile) return;
		
		const annotations = this.annotations.get(activeFile) || [];
		const annotation = annotations.find(a => a.id === annotationId);
		
		if (!annotation) return;
		
		// 创建悬浮提示
		const tooltip = document.createElement('div');
		tooltip.className = 'annotation-tooltip';
		tooltip.setAttribute('data-annotation-id', annotationId);
		
		// 关闭按钮（右上角）
		const closeBtn = tooltip.createEl('button', {
			cls: 'annotation-tooltip-close',
			text: '×'
		});
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.hideAnnotationTooltip();
		});
		
		// 批注内容（可滚动）
		const contentContainer = tooltip.createEl('div', {
			cls: 'annotation-tooltip-content-container'
		});

		const contentEl = contentContainer.createEl('div', {
			cls: 'annotation-tooltip-content markdown-rendered'
		});

		// 使用 MarkdownRenderer 渲染批注内容
		MarkdownRenderer.render(
			this.app,
			annotation.content,
			contentEl,
			annotation.sourceFile,
			this
		).then(() => {
			// 渲染完成后，为图片添加悬停预览功能
			this.setupImageHoverPreview(contentEl);
		});
		
		// 底部栏（时间和按钮组）
		const footerEl = tooltip.createEl('div', {
			cls: 'annotation-tooltip-footer'
		});
		
		// 时间信息（左下角）
		const date = new Date(annotation.createdAt);
		const dateStr = `${date.getFullYear().toString().slice(-2)}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
		footerEl.createEl('span', {
			cls: 'annotation-tooltip-date',
			text: dateStr
		});
		
		// 按钮组（右下角）
		const btnGroup = footerEl.createEl('div', {
			cls: 'annotation-tooltip-btn-group'
		});
		
		// 编辑按钮（图标）
		const editBtn = btnGroup.createEl('button', {
			cls: 'annotation-tooltip-btn',
			attr: { 'aria-label': '编辑批注' }
		});
		editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			// 在当前 tooltip 中进行行内编辑
			this.enableInlineEdit(tooltip, annotation, contentEl, contentContainer);
		});
		
		// 删除按钮（图标）
		const deleteBtn = btnGroup.createEl('button', {
			cls: 'annotation-tooltip-btn annotation-tooltip-btn-delete',
			attr: { 'aria-label': '删除批注' }
		});
		deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
		deleteBtn.addEventListener('click', async (e) => {
			e.stopPropagation();
			
			// 先完全清理 tooltip，避免焦点问题
			if (this.activeTooltip) {
				const tooltipToRemove = this.activeTooltip;
				this.activeTooltip = null;
				tooltipToRemove.remove();
			}
			
			try {
				// 调用删除方法（已经更新了 this.annotations）
				await this.deleteAnnotation(annotation.id, annotation.sourceFile);
				
				// 刷新侧边栏
				this.updateAnnotationPanel();
				
				// 强制刷新高亮（让 Codemirror 重新渲染）
				this.forceRefreshHighlights();
				
				new Notice('批注已删除');
			} catch (error) {
				console.error('删除批注失败:', error);
				new Notice('删除批注失败');
			}
		});
		
		// 定位
		if (this.isMobile) {
			// 移动端：居中显示在屏幕底部
			tooltip.style.position = 'fixed';
			tooltip.style.left = '50%';
			tooltip.style.transform = 'translateX(-50%)';
			tooltip.style.bottom = '20px';
			tooltip.style.top = 'auto';
			tooltip.style.maxWidth = '90vw';
			tooltip.style.width = '90vw';
			tooltip.style.maxHeight = '60vh';
		} else {
			// PC端：根据元素位置定位
			const rect = element.getBoundingClientRect();
			tooltip.style.left = `${rect.left}px`;
			tooltip.style.top = `${rect.bottom + 5}px`;

			// 检查是否超出屏幕右侧
			if (rect.left + 300 > window.innerWidth) {
				tooltip.style.left = `${window.innerWidth - 320}px`;
			}

			// 检查是否超出屏幕底部
			if (rect.bottom + 250 > window.innerHeight) {
				tooltip.style.top = `${rect.top - 260}px`;
			}
		}

		document.body.appendChild(tooltip);
		this.activeTooltip = tooltip;
	}
	
	// 隐藏批注悬浮提示
	hideAnnotationTooltip() {
		if (this.activeTooltip) {
			this.activeTooltip.remove();
			this.activeTooltip = null;
		}
	}

	// 启用行内编辑模式
	enableInlineEdit(tooltip: HTMLElement, annotation: Annotation, contentEl: HTMLElement, contentContainer: HTMLElement) {
		// 保存原始内容用于取消操作
		const originalContent = annotation.content;
		let isEditing = true;

		// 清空内容容器
		contentContainer.empty();

		// 创建文本编辑区域
		const textarea = contentContainer.createEl('textarea', {
			cls: 'annotation-inline-editor'
		});
		textarea.value = originalContent;
		textarea.style.cssText = `
			width: 100%;
			min-height: 100px;
			max-height: 200px;
			resize: vertical;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			padding: 8px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: 14px;
			line-height: 1.5;
		`;

		// 聚焦文本框，但不全选（方便调整光标位置）
		textarea.focus();
		// 将光标移到末尾
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);

		// 阻止编辑区域内的点击事件冒泡（防止关闭tooltip）
		const stopPropagation = (e: Event) => {
			e.stopPropagation();
		};
		textarea.addEventListener('click', stopPropagation);
		textarea.addEventListener('mousedown', stopPropagation);
		textarea.addEventListener('mouseup', stopPropagation);
		contentContainer.addEventListener('click', stopPropagation);

		// 取消编辑（恢复原始内容）
		const cancelEdit = () => {
			if (!isEditing) return;
			isEditing = false;

			// 移除事件监听
			textarea.removeEventListener('click', stopPropagation);
			textarea.removeEventListener('mousedown', stopPropagation);
			textarea.removeEventListener('mouseup', stopPropagation);
			contentContainer.removeEventListener('click', stopPropagation);

			// 重新渲染原始内容
			contentContainer.empty();
			const newContentEl = contentContainer.createEl('div', {
				cls: 'annotation-tooltip-content markdown-rendered'
			});
			MarkdownRenderer.render(
				this.app,
				originalContent,
				newContentEl,
				annotation.sourceFile,
				this
			).then(() => {
				this.setupImageHoverPreview(newContentEl);
			});
		};

		// 保存编辑
		const saveEdit = async () => {
			if (!isEditing) return;
			isEditing = false;

			// 移除事件监听
			textarea.removeEventListener('click', stopPropagation);
			textarea.removeEventListener('mousedown', stopPropagation);
			textarea.removeEventListener('mouseup', stopPropagation);
			contentContainer.removeEventListener('click', stopPropagation);

			const newContent = textarea.value.trim();
			if (!newContent) {
				// 内容为空则取消编辑
				cancelEdit();
				return;
			}

			annotation.content = newContent;
			await this.updateAnnotation(annotation);

			// 重新渲染更新后的内容
			contentContainer.empty();
			const newContentEl = contentContainer.createEl('div', {
				cls: 'annotation-tooltip-content markdown-rendered'
			});
			MarkdownRenderer.render(
				this.app,
				newContent,
				newContentEl,
				annotation.sourceFile,
				this
			).then(() => {
				this.setupImageHoverPreview(newContentEl);
			});

			// 刷新侧边栏
			this.updateAnnotationPanel();
			// 刷新高亮
			this.forceRefreshHighlights();
		};

		// 失焦时自动保存
		textarea.addEventListener('blur', () => {
			// 延迟保存，避免在点击其他元素时立即保存导致问题
			setTimeout(() => {
				if (isEditing) {
					saveEdit();
				}
			}, 200);
		});

		// 键盘快捷键
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancelEdit();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				saveEdit();
			}
		});
	}

	// 设置图片悬停预览功能
	setupImageHoverPreview(container: HTMLElement) {
		const images = container.querySelectorAll('img');
		images.forEach(img => {
			// 隐藏图片，只显示占位符链接
			img.style.display = 'none';

			// 创建图片链接元素
			const imgLink = document.createElement('span');
			imgLink.className = 'annotation-image-link';
			imgLink.textContent = '🖼️ 图片';
			imgLink.style.cursor = 'pointer';
			imgLink.style.color = 'var(--text-accent)';
			imgLink.style.textDecoration = 'underline';
			imgLink.style.margin = '0 4px';

			// 创建预览小窗
			let previewEl: HTMLElement | null = null;

			imgLink.addEventListener('mouseenter', (e) => {
				if (previewEl) return;

				previewEl = document.createElement('div');
				previewEl.className = 'annotation-image-preview';
				previewEl.style.cssText = `
					position: fixed;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 8px;
					z-index: 10000;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
					max-width: 300px;
					max-height: 200px;
					overflow: hidden;
				`;

				const previewImg = document.createElement('img');
				previewImg.src = img.src;
				previewImg.style.cssText = `
					max-width: 100%;
					max-height: 180px;
					object-fit: contain;
					border-radius: 4px;
				`;

				previewEl.appendChild(previewImg);

				// 定位预览窗口
				const rect = imgLink.getBoundingClientRect();
				previewEl.style.left = `${rect.left}px`;
				previewEl.style.top = `${rect.bottom + 5}px`;

				// 检查是否超出屏幕
				if (rect.left + 300 > window.innerWidth) {
					previewEl.style.left = `${window.innerWidth - 320}px`;
				}
				if (rect.bottom + 200 > window.innerHeight) {
					previewEl.style.top = `${rect.top - 210}px`;
				}

				document.body.appendChild(previewEl);
			});

			imgLink.addEventListener('mouseleave', () => {
				if (previewEl) {
					previewEl.remove();
					previewEl = null;
				}
			});

			// 替换图片为链接
			img.parentNode?.insertBefore(imgLink, img);
		});
	}

	// 检测是否为移动端设备
	detectMobile(): boolean {
		// 检测触摸设备
		const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		// 检测屏幕宽度
		const isSmallScreen = window.innerWidth <= 768;
		// 检测移动端 User Agent
		const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
		const isMobileUA = mobileRegex.test(navigator.userAgent);

		return (isTouchDevice && isSmallScreen) || isMobileUA;
	}

	// 注册移动端事件
	registerMobileEvents() {
		// 双击显示批注详情（移动端主要交互方式）
		this.registerDomEvent(document, 'touchend', (evt: TouchEvent) => {
			const touch = evt.changedTouches[0];
			const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;

			if (target && (target.classList.contains('annotation-highlight') ||
				target.closest('.annotation-highlight'))) {
				const now = Date.now();
				const timeDiff = now - this.touchStartTime;

				// 双击检测（300ms 内的两次点击）
				if (timeDiff < 300) {
					evt.preventDefault();
					evt.stopPropagation();

					const highlightEl = target.classList.contains('annotation-highlight')
						? target
						: target.closest('.annotation-highlight') as HTMLElement;
					const annotationId = highlightEl.getAttribute('data-annotation-id');
					if (annotationId) {
						this.showAnnotationTooltip(highlightEl, annotationId);
					}
				}

				this.touchStartTime = now;
			}
		});

		// 记录触摸开始时间和位置
		this.registerDomEvent(document, 'touchstart', (evt: TouchEvent) => {
			const touch = evt.touches[0];
			this.touchStartPos = { x: touch.clientX, y: touch.clientY };
		});

		// 长按显示批注（作为双击的替代方案）
		let longPressTimer: number | null = null;
		this.registerDomEvent(document, 'touchstart', (evt: TouchEvent) => {
			const touch = evt.touches[0];
			const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;

			if (target && (target.classList.contains('annotation-highlight') ||
				target.closest('.annotation-highlight'))) {
				longPressTimer = window.setTimeout(() => {
					const highlightEl = target.classList.contains('annotation-highlight')
						? target
						: target.closest('.annotation-highlight') as HTMLElement;
					const annotationId = highlightEl.getAttribute('data-annotation-id');
					if (annotationId) {
						this.showAnnotationTooltip(highlightEl, annotationId);
					}
				}, 500); // 500ms 长按
			}
		});

		this.registerDomEvent(document, 'touchend', () => {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
		});

		this.registerDomEvent(document, 'touchmove', () => {
			if (longPressTimer) {
				clearTimeout(longPressTimer);
				longPressTimer = null;
			}
		});

		// 点击其他地方关闭悬浮提示
		this.registerDomEvent(document, 'touchstart', (evt: TouchEvent) => {
			const touch = evt.touches[0];
			const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;
			if (this.activeTooltip && !target?.closest('.annotation-tooltip')) {
				this.hideAnnotationTooltip();
			}
		});
	}

	// 切换批注预览面板（功能区样式）
	async toggleAnnotationPreview() {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(ANNOTATION_PREVIEW_VIEW_TYPE);
		
		if (existing.length > 0) {
			// 如果已存在，则关闭
			workspace.detachLeavesOfType(ANNOTATION_PREVIEW_VIEW_TYPE);
		} else {
			// 否则在右侧功能区打开
			await this.activateAnnotationPreview();
		}
	}
	
	// 激活批注预览面板 - 在右侧功能区显示
	async activateAnnotationPreview() {
		const { workspace } = this.app;
		
		// 检查是否已存在
		const existing = workspace.getLeavesOfType(ANNOTATION_PREVIEW_VIEW_TYPE);
		if (existing.length > 0) {
			// 如果已存在，更新内容即可
			for (const leaf of existing) {
				const view = leaf.view as AnnotationPreviewView;
				if (view && view.updatePreview) {
					view.currentFile = this.getActiveFile();
					view.updatePreview();
				}
			}
			return;
		}
		
		// 在右侧边栏创建或获取叶子节点
		const leaf = workspace.getRightLeaf(false);
		
		if (!leaf) {
			console.error('无法获取右侧边栏');
			return;
		}
		
		await leaf.setViewState({
			type: ANNOTATION_PREVIEW_VIEW_TYPE,
			active: false, // 不激活，保持当前焦点在编辑器
		});
	}
	
	// 更新批注面板（自动显示）- 避免重复创建
	async updateAnnotationPanel() {
		// 移动端不自动开启侧边栏
		if (this.isMobile) {
			return;
		}

		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(ANNOTATION_PREVIEW_VIEW_TYPE);

		// 如果面板已存在，只更新内容，不重新创建
		if (existing.length > 0) {
			// 通知所有面板更新
			for (const leaf of existing) {
				const view = leaf.view as AnnotationPreviewView;
				if (view && view.updatePreview) {
					view.currentFile = this.getActiveFile();
					view.updatePreview();
				}
			}
		} else if (this.settings.showAnnotationPreview) {
			// 如果面板不存在且设置为自动显示，则创建
			await this.activateAnnotationPreview();
		}
	}
	
	// 切换侧边批注显示（Word式）
	async toggleAnnotationSidebar() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('请先打开一个文件');
			return;
		}
		
		// 检查是否已存在侧边批注面板
		const container = activeView.containerEl;
		let sidebar = container.querySelector('.annotation-word-sidebar') as HTMLElement;
		
		if (sidebar) {
			// 关闭侧边批注
			sidebar.remove();
			container.classList.remove('has-annotation-sidebar');
		} else {
			// 创建侧边批注面板
			await this.createAnnotationSidebar(activeView);
		}
	}
	
	// 创建 Word 式侧边批注面板
	async createAnnotationSidebar(view: MarkdownView) {
		const container = view.containerEl;
		const contentEl = container.querySelector('.view-content') as HTMLElement;
		
		if (!contentEl) return;
		
		// 添加样式类
		container.classList.add('has-annotation-sidebar');
		
		// 创建侧边批注容器
		const sidebar = document.createElement('div');
		sidebar.className = 'annotation-word-sidebar';
		
		// 标题
		const header = sidebar.createEl('div', {
			cls: 'annotation-word-sidebar-header',
			text: '批注'
		});
		
		// 关闭按钮
		const closeBtn = header.createEl('button', {
			cls: 'annotation-word-sidebar-close',
			text: '×'
		});
		closeBtn.addEventListener('click', () => {
			sidebar.remove();
			container.classList.remove('has-annotation-sidebar');
		});
		
		// 内容区域
		const content = sidebar.createEl('div', {
			cls: 'annotation-word-sidebar-content'
		});
		
		// 获取当前文件的批注
		const file = view.file;
		if (file) {
			const annotations = this.annotations.get(file.path) || [];
			
			if (annotations.length === 0) {
				content.createEl('div', {
					cls: 'annotation-word-sidebar-empty',
					text: '暂无批注'
				});
			} else {
				// 按位置排序
				const sortedAnnotations = [...annotations].sort((a, b) => a.startOffset - b.startOffset);
				
				for (const annotation of sortedAnnotations) {
					const item = content.createEl('div', {
						cls: 'annotation-word-sidebar-item',
						attr: { 'data-annotation-id': annotation.id }
					});
					
					// 选中文字预览
					const selectedText = annotation.selectedText.length > 40
						? annotation.selectedText.substring(0, 40) + '...'
						: annotation.selectedText;
						
					item.createEl('div', {
						cls: 'annotation-word-sidebar-selected',
						text: `"${selectedText}"`
					});
					
					// 批注内容
					item.createEl('div', {
						cls: 'annotation-word-sidebar-text',
						text: annotation.content
					});
					
					// 点击跳转到对应位置
					item.addEventListener('click', () => {
						const pos = view.editor.offsetToPos(annotation.startOffset);
						view.editor.setCursor(pos);
						view.editor.scrollIntoView({ from: pos, to: pos }, true);
						
						// 高亮当前项
						content.querySelectorAll('.annotation-word-sidebar-item').forEach(el => {
							el.classList.remove('active');
						});
						item.classList.add('active');
					});
				}
			}
		}
		
		// 插入到容器中
		contentEl.appendChild(sidebar);
	}

	// 生成唯一ID
	generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}

	// 添加样式
	addStyles() {
		const style = document.createElement('style');
		style.id = 'annotation-plugin-styles';
		style.textContent = `
			.annotation-highlight {
				background-color: var(--annotation-highlight-color, #ffeb3b);
				border-radius: 2px;
				padding: 0 2px;
				cursor: pointer;
			}
			.annotation-highlight:hover {
				background-color: var(--annotation-highlight-hover-color, #fdd835);
			}
			
			/* 移动端适配样式 */
			.annotation-mobile .annotation-highlight {
				cursor: default;
			}
			
			/* 移动端 tooltip 样式优化 */
			.annotation-mobile .annotation-tooltip {
				position: fixed;
				left: 50% !important;
				transform: translateX(-50%);
				max-width: 90vw;
				width: 90vw;
				max-height: 60vh;
			}
			
			/* 移动端行内编辑器优化 */
			.annotation-mobile .annotation-inline-editor {
				font-size: 16px !important; /* 防止 iOS 缩放 */
				min-height: 120px;
			}
			
			/* 移动端侧边栏隐藏 */
			.annotation-mobile .annotation-word-sidebar {
				display: none !important;
			}
			
			/* 触摸反馈 */
			.annotation-mobile .annotation-highlight:active {
				background-color: var(--annotation-highlight-hover-color, #fdd835);
				opacity: 0.8;
			}
			
			/* 移动端操作按钮优化 */
			.annotation-mobile .annotation-tooltip-btn {
				min-width: 44px;
				min-height: 44px;
				font-size: 16px;
			}
			
			/* 移动端按钮容器优化 */
			.annotation-mobile .annotation-inline-edit-buttons,
			.annotation-mobile .annotation-sidebar-inline-edit-buttons {
				padding: 8px 0;
			}
			
			.annotation-mobile .annotation-inline-btn,
			.annotation-mobile .annotation-sidebar-inline-btn {
				min-height: 36px;
				min-width: 60px;
				font-size: 14px;
			}
		`;
		document.head.appendChild(style);
	}

	// 移除样式
	removeStyles() {
		const style = document.getElementById('annotation-plugin-styles');
		if (style) {
			style.remove();
		}
	}

	// 加载设置
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// 保存设置
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// 批注编辑弹窗
class AnnotationModal extends Modal {
	selectedText: string;
	onSubmit: (content: string) => void;
	content: string = '';

	constructor(app: App, selectedText: string, onSubmit: (content: string) => void) {
		super(app);
		this.selectedText = selectedText;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.createEl('h2', { text: '添加批注' });
		
		// 显示选中的原文
		contentEl.createEl('p', { 
			text: '选中内容:',
			cls: 'annotation-selected-label'
		});
		
		const quoteEl = contentEl.createEl('blockquote', {
			text: this.selectedText.length > 100 
				? this.selectedText.substring(0, 100) + '...' 
				: this.selectedText,
			cls: 'annotation-selected-text'
		});
		
		// 批注内容输入框
		contentEl.createEl('p', { 
			text: '批注内容:',
			cls: 'annotation-content-label'
		});
		
		const textarea = contentEl.createEl('textarea', {
			cls: 'annotation-textarea'
		});
		textarea.rows = 5;
		textarea.style.width = '100%';
		textarea.style.marginTop = '10px';
		textarea.placeholder = '在此输入您的批注内容...';
		
		textarea.addEventListener('input', (e) => {
			this.content = (e.target as HTMLTextAreaElement).value;
		});

		// 确保文本框可以正常输入
		textarea.style.cssText = `
			width: 100%;
			min-height: 100px;
			resize: vertical;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			padding: 10px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: 14px;
			line-height: 1.5;
		`;

		// 按钮容器
		const buttonContainer = contentEl.createEl('div', {
			cls: 'annotation-button-container'
		});
		buttonContainer.style.marginTop = '20px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.justifyContent = 'flex-end';

		// 取消按钮
		const cancelButton = buttonContainer.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		// 保存按钮
		const saveButton = buttonContainer.createEl('button', {
			text: '保存',
			cls: 'mod-cta'
		});
		saveButton.addEventListener('click', () => {
			if (this.content.trim()) {
				this.onSubmit(this.content);
				this.close();
			} else {
				new Notice('请输入批注内容');
			}
		});

		// 使用 requestAnimationFrame 和 setTimeout 确保 Modal 完全渲染后再聚焦
		requestAnimationFrame(() => {
			setTimeout(() => {
				textarea.focus();
				// 确保光标在文本末尾
				textarea.setSelectionRange(textarea.value.length, textarea.value.length);
			}, 150);
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 批注预览视图 - 类似出链列表的功能区视图
class AnnotationPreviewView extends ItemView {
	plugin: AnnotationPlugin;
	contentEl: HTMLElement;
	currentFile: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AnnotationPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.navigation = false; // 禁止导航历史
	}

	getViewType(): string {
		return ANNOTATION_PREVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '批注';
	}

	getIcon(): string {
		return 'quote-glyph';
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('annotation-right-sidebar-view');
		
		// 创建顶部标题栏（类似出链列表）
		const header = container.createEl('div', {
			cls: 'annotation-sidebar-header'
		});
		
		// 当前文件名称
		header.createEl('div', {
			cls: 'annotation-sidebar-title',
			text: '批注'
		});
		
		// 数量统计
		header.createEl('div', {
			cls: 'annotation-sidebar-count',
			text: '0 个批注'
		});
		
		// 创建内容容器
		this.contentEl = container.createEl('div', {
			cls: 'annotation-sidebar-content'
		});
		
		// 监听文件切换，自动更新
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				this.currentFile = file?.path || null;
				this.updatePreview();
			})
		);
		
		// 监听编辑器变化（批注添加/删除时更新）
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				// 延迟更新以避免频繁刷新
				setTimeout(() => {
					this.updatePreview();
				}, 500);
			})
		);
		
		// 初始渲染
		const activeFile = this.plugin.getActiveFile();
		this.currentFile = activeFile;
		this.updatePreview();
	}

	updatePreview() {
		// 清空内容
		this.contentEl.empty();
		
		// 更新标题栏
		const container = this.containerEl.children[1];
		const countEl = container.querySelector('.annotation-sidebar-count') as HTMLElement;
		
		if (!this.currentFile) {
			if (countEl) countEl.textContent = '0 个批注';
			this.contentEl.createEl('div', {
				cls: 'annotation-sidebar-empty',
				text: '请先打开一个文件'
			});
			return;
		}
		
		const annotations = this.plugin.annotations.get(this.currentFile) || [];
		
		// 更新数量
		if (countEl) {
			countEl.textContent = `${annotations.length} 个批注`;
		}
		
		if (annotations.length === 0) {
			this.contentEl.createEl('div', {
				cls: 'annotation-sidebar-empty',
				text: '当前文件没有批注'
			});
			return;
		}
		
		// 按位置排序批注
		const sortedAnnotations = [...annotations].sort((a, b) => a.startOffset - b.startOffset);
		
		// 渲染批注列表
		for (const annotation of sortedAnnotations) {
			const item = this.contentEl.createEl('div', {
				cls: 'annotation-sidebar-item',
				attr: { 'data-annotation-id': annotation.id }
			});
			
			// 选中文字（引文样式）
			const selectedText = annotation.selectedText.length > 60
				? annotation.selectedText.substring(0, 60) + '...'
				: annotation.selectedText;
				
			item.createEl('div', {
				cls: 'annotation-sidebar-quote',
				text: `"${selectedText}"`
			});
			
			// 批注内容（自适应高度，支持Markdown）
			const commentEl = item.createEl('div', {
				cls: 'annotation-sidebar-comment markdown-rendered'
			});

			// 使用 MarkdownRenderer 渲染批注内容
			MarkdownRenderer.render(
				this.app,
				annotation.content,
				commentEl,
				annotation.sourceFile,
				this.plugin
			).then(() => {
				// 渲染完成后，为图片添加悬停预览功能
				this.setupImageHoverPreview(commentEl);
			});
			
			// 操作按钮区域
			const actions = item.createEl('div', {
				cls: 'annotation-sidebar-actions'
			});
			
			// 编辑按钮
			const editBtn = actions.createEl('button', {
				cls: 'annotation-sidebar-btn',
				attr: { 'aria-label': '编辑批注' }
			});
			editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
			editBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				// 在当前位置启用行内编辑
				this.enableSidebarInlineEdit(annotation, commentEl, item);
			});
			
			// 打开批注文件按钮
			const fileBtn = actions.createEl('button', {
				cls: 'annotation-sidebar-btn',
				attr: { 'aria-label': '打开批注文件' }
			});
			fileBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
			fileBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openAnnotationFile(annotation.id);
			});
			
			// 删除按钮
			const deleteBtn = actions.createEl('button', {
				cls: 'annotation-sidebar-btn annotation-sidebar-btn-delete',
				attr: { 'aria-label': '删除批注' }
			});
			deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.deleteAnnotation(annotation);
			});
			
			// 日期时间（左下角，默认隐藏，鼠标悬停显示）格式：26-02-12 11:51
			const date = new Date(annotation.createdAt);
			const dateStr = `${date.getFullYear().toString().slice(-2)}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
			const dateEl = item.createEl('div', {
				cls: 'annotation-sidebar-date',
				text: dateStr
			});
			
			// 点击整个项跳转到原文
			item.addEventListener('click', () => {
				this.jumpToAnnotation(annotation);
			});
		}
	}

	jumpToAnnotation(annotation: Annotation) {
		const file = this.app.vault.getAbstractFileByPath(annotation.sourceFile);
		if (file instanceof TFile) {
			// 高亮当前项
			this.contentEl.querySelectorAll('.annotation-sidebar-item').forEach(el => {
				el.classList.remove('active');
			});
			const item = this.contentEl.querySelector(`[data-annotation-id="${annotation.id}"]`);
			if (item) item.classList.add('active');
			
			// 打开文件并跳转
			this.app.workspace.openLinkText(annotation.sourceFile, '', false, {
				active: true
			}).then(() => {
				setTimeout(() => {
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView && activeView.editor) {
						const pos = activeView.editor.offsetToPos(annotation.startOffset);
						activeView.editor.setCursor(pos);
						activeView.editor.scrollIntoView({ from: pos, to: pos }, true);
						
						// 高亮正文中对应的批注
						this.plugin.highlightAnnotationInEditor(annotation.id);
					}
				}, 100);
			});
		}
	}
	
	async openAnnotationFile(annotationId: string) {
		if (!this.currentFile) return;
		
		const annotationFilePath = this.plugin.getAnnotationFilePath(this.currentFile);
		const annotationFile = this.app.vault.getAbstractFileByPath(annotationFilePath);
		
		if (annotationFile instanceof TFile) {
			await this.app.workspace.openLinkText(annotationFilePath, '', false);
			
			setTimeout(() => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView || !activeView.editor) return;
				
				const content = activeView.editor.getValue();
				const regex = new RegExp(`^id:\s*${annotationId}$`, 'm');
				const match = content.match(regex);
				
				if (match && match.index !== undefined) {
					const pos = activeView.editor.offsetToPos(match.index);
					activeView.editor.setCursor(pos);
					activeView.editor.scrollIntoView({ from: pos, to: pos }, true);
				}
			}, 200);
		}
	}
	
	// 启用侧边栏行内编辑
	enableSidebarInlineEdit(annotation: Annotation, commentEl: HTMLElement, item: HTMLElement) {
		// 保存原始内容
		const originalContent = annotation.content;
		let isEditing = true;

		// 清空内容区域
		commentEl.empty();
		commentEl.classList.remove('markdown-rendered');
		commentEl.classList.add('annotation-inline-edit-container');

		// 创建文本编辑区域
		const textarea = commentEl.createEl('textarea', {
			cls: 'annotation-sidebar-inline-editor'
		});
		textarea.value = originalContent;
		textarea.style.cssText = `
			width: 100%;
			min-height: 80px;
			max-height: 150px;
			resize: vertical;
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			padding: 6px;
			background: var(--background-primary);
			color: var(--text-normal);
			font-size: 13px;
			line-height: 1.4;
		`;

		// 聚焦文本框，将光标移到末尾
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);

		// 阻止编辑区域内的点击和选择事件冒泡（防止触发其他操作）
		const stopPropagation = (e: Event) => {
			e.stopPropagation();
		};
		textarea.addEventListener('click', stopPropagation);
		textarea.addEventListener('mousedown', stopPropagation);
		textarea.addEventListener('mouseup', stopPropagation);
		textarea.addEventListener('selectstart', stopPropagation);
		commentEl.addEventListener('click', stopPropagation);

		// 取消编辑
		const cancelEdit = () => {
			if (!isEditing) return;
			isEditing = false;

			// 移除事件监听
			textarea.removeEventListener('click', stopPropagation);
			textarea.removeEventListener('mousedown', stopPropagation);
			textarea.removeEventListener('mouseup', stopPropagation);
			textarea.removeEventListener('selectstart', stopPropagation);
			commentEl.removeEventListener('click', stopPropagation);

			commentEl.empty();
			commentEl.classList.remove('annotation-inline-edit-container');
			commentEl.classList.add('markdown-rendered');

			// 重新渲染原始内容
			MarkdownRenderer.render(
				this.app,
				originalContent,
				commentEl,
				annotation.sourceFile,
				this.plugin
			).then(() => {
				this.setupImageHoverPreview(commentEl);
			});
		};

		// 保存编辑
		const saveEdit = async () => {
			if (!isEditing) return;
			isEditing = false;

			// 移除事件监听
			textarea.removeEventListener('click', stopPropagation);
			textarea.removeEventListener('mousedown', stopPropagation);
			textarea.removeEventListener('mouseup', stopPropagation);
			textarea.removeEventListener('selectstart', stopPropagation);
			commentEl.removeEventListener('click', stopPropagation);

			const newContent = textarea.value.trim();
			if (!newContent) {
				// 内容为空则取消编辑
				cancelEdit();
				return;
			}

			annotation.content = newContent;
			await this.plugin.updateAnnotation(annotation);

			commentEl.empty();
			commentEl.classList.remove('annotation-inline-edit-container');
			commentEl.classList.add('markdown-rendered');

			// 重新渲染更新后的内容
			MarkdownRenderer.render(
				this.app,
				newContent,
				commentEl,
				annotation.sourceFile,
				this.plugin
			).then(() => {
				this.setupImageHoverPreview(commentEl);
			});

			// 刷新高亮
			this.plugin.forceRefreshHighlights();
		};

		// 失焦时自动保存
		textarea.addEventListener('blur', () => {
			// 延迟保存，避免在点击其他元素时立即保存导致问题
			setTimeout(() => {
				if (isEditing) {
					saveEdit();
				}
			}, 200);
		});

		// 键盘快捷键
		textarea.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				cancelEdit();
			} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				saveEdit();
			}
		});
	}
	
	async editAnnotation(annotation: Annotation) {
		new AnnotationEditModal(this.app, annotation, async (newContent: string) => {
			annotation.content = newContent;
			await this.plugin.updateAnnotation(annotation);
			
			// 刷新显示
			this.updatePreview();
			
			// 强制刷新高亮
			setTimeout(() => {
				this.plugin.forceRefreshHighlights();
			}, 50);
			
			new Notice('批注已更新');
		}).open();
	}
	
	async deleteAnnotation(annotation: Annotation) {
		// 确认对话框
		const confirmDelete = confirm('确定要删除这条批注吗？');
		if (!confirmDelete) return;
		
		try {
			// 删除批注（已经更新了 this.plugin.annotations）
			await this.plugin.deleteAnnotation(annotation.id, annotation.sourceFile);
			
			// 刷新右侧边栏
			this.updatePreview();
			
			// 强制刷新高亮（让 Codemirror 重新渲染所有高亮）
			this.plugin.forceRefreshHighlights();
			
			new Notice('批注已删除');
		} catch (error) {
			console.error('删除批注失败:', error);
			new Notice('删除批注失败');
		}
	}

	// 设置图片悬停预览功能
	setupImageHoverPreview(container: HTMLElement) {
		const images = container.querySelectorAll('img');
		images.forEach(img => {
			// 隐藏图片，只显示占位符链接
			img.style.display = 'none';

			// 创建图片链接元素
			const imgLink = document.createElement('span');
			imgLink.className = 'annotation-image-link';
			imgLink.textContent = '🖼️ 图片';
			imgLink.style.cursor = 'pointer';
			imgLink.style.color = 'var(--text-accent)';
			imgLink.style.textDecoration = 'underline';
			imgLink.style.margin = '0 4px';

			// 创建预览小窗
			let previewEl: HTMLElement | null = null;

			imgLink.addEventListener('mouseenter', (e) => {
				if (previewEl) return;

				previewEl = document.createElement('div');
				previewEl.className = 'annotation-image-preview';
				previewEl.style.cssText = `
					position: fixed;
					background: var(--background-primary);
					border: 1px solid var(--background-modifier-border);
					border-radius: 6px;
					padding: 8px;
					z-index: 10000;
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
					max-width: 300px;
					max-height: 200px;
					overflow: hidden;
				`;

				const previewImg = document.createElement('img');
				previewImg.src = img.src;
				previewImg.style.cssText = `
					max-width: 100%;
					max-height: 180px;
					object-fit: contain;
					border-radius: 4px;
				`;

				previewEl.appendChild(previewImg);

				// 定位预览窗口
				const rect = imgLink.getBoundingClientRect();
				previewEl.style.left = `${rect.left}px`;
				previewEl.style.top = `${rect.bottom + 5}px`;

				// 检查是否超出屏幕
				if (rect.left + 300 > window.innerWidth) {
					previewEl.style.left = `${window.innerWidth - 320}px`;
				}
				if (rect.bottom + 200 > window.innerHeight) {
					previewEl.style.top = `${rect.top - 210}px`;
				}

				document.body.appendChild(previewEl);
			});

			imgLink.addEventListener('mouseleave', () => {
				if (previewEl) {
					previewEl.remove();
					previewEl = null;
				}
			});

			// 替换图片为链接
			img.parentNode?.insertBefore(imgLink, img);
		});
	}

	async onClose() {
		// 清理工作
	}
}

// 批注编辑弹窗（用于编辑现有批注）
class AnnotationEditModal extends Modal {
	annotation: Annotation;
	onSubmit: (content: string) => void;
	content: string;

	constructor(app: App, annotation: Annotation, onSubmit: (content: string) => void) {
		super(app);
		this.annotation = annotation;
		this.onSubmit = onSubmit;
		this.content = annotation.content;
	}

	onOpen() {
		const { contentEl } = this;
		
		contentEl.createEl('h2', { text: '编辑批注' });
		
		// 显示选中的原文
		contentEl.createEl('p', { 
			text: '选中内容:',
			cls: 'annotation-selected-label'
		});
		
		const quoteEl = contentEl.createEl('blockquote', {
			text: this.annotation.selectedText.length > 100 
				? this.annotation.selectedText.substring(0, 100) + '...' 
				: this.annotation.selectedText,
			cls: 'annotation-selected-text'
		});
		
		// 批注内容输入框
		contentEl.createEl('p', { 
			text: '批注内容:',
			cls: 'annotation-content-label'
		});
		
		const textarea = contentEl.createEl('textarea', {
			cls: 'annotation-textarea'
		});
		textarea.rows = 5;
		textarea.style.width = '100%';
		textarea.style.marginTop = '10px';
		textarea.placeholder = '在此输入您的批注内容...';
		textarea.value = this.content;
		
		textarea.addEventListener('input', (e) => {
			this.content = (e.target as HTMLTextAreaElement).value;
		});
		
		// 按钮容器
		const buttonContainer = contentEl.createEl('div', {
			cls: 'annotation-button-container'
		});
		buttonContainer.style.marginTop = '20px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.justifyContent = 'flex-end';
		
		// 取消按钮
		const cancelButton = buttonContainer.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});
		
		// 保存按钮
		const saveButton = buttonContainer.createEl('button', { 
			text: '保存',
			cls: 'mod-cta'
		});
		saveButton.addEventListener('click', () => {
			if (this.content.trim()) {
				this.onSubmit(this.content);
				this.close();
			} else {
				new Notice('请输入批注内容');
			}
		});
		
		// 聚焦到文本框并选中所有内容
		textarea.focus();
		textarea.select();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 设置面板
class AnnotationSettingTab extends PluginSettingTab {
	plugin: AnnotationPlugin;

	constructor(app: App, plugin: AnnotationPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: '批注插件设置' });

		// 批注文件夹设置
		const folderSetting = new Setting(containerEl)
			.setName('批注文件夹')
			.setDesc('批注文件将保存在此文件夹中');
		
		// 添加文本输入框
		let folderInput: HTMLInputElement;
		folderSetting.addText(text => {
			text
				.setPlaceholder('Annotations')
				.setValue(this.plugin.settings.annotationFolder)
				.onChange(async (value) => {
					let trimmedValue = value.trim();
					
					// 验证并清理路径
					if (trimmedValue) {
						// 移除开头的 "/" 或 "\\"
						trimmedValue = trimmedValue.replace(/^[\/\\]+/, '');
						// 移除结尾的 "/" 或 "\\"
						trimmedValue = trimmedValue.replace(/[\/\\]+$/, '');
					}
					
					if (trimmedValue) {
						const oldFolder = this.plugin.settings.annotationFolder;
						this.plugin.settings.annotationFolder = trimmedValue;
						await this.plugin.saveSettings();
						
						// 如果路径发生变化，重新加载批注
						if (oldFolder !== trimmedValue) {
							await this.plugin.loadAnnotations();
							this.plugin.forceRefreshHighlights();
							new Notice(`批注文件夹已更改为: ${trimmedValue}`);
						}
					}
				});
			folderInput = text.inputEl;
			return text;
		});
		
		// 添加文件夹选择按钮
		folderSetting.addButton(button => {
			button
				.setButtonText('选择文件夹')
				.setTooltip('浏览并选择批注文件夹')
				.onClick(async () => {
					// 创建文件夹选择模态框
					new FolderSuggestModal(this.app, async (folder) => {
						const folderPath = folder.path === '/' ? '' : folder.path;
						this.plugin.settings.annotationFolder = folderPath || 'Annotations';
						await this.plugin.saveSettings();
						// 更新输入框显示
						if (folderInput) {
							folderInput.value = this.plugin.settings.annotationFolder;
						}
						// 重新加载批注数据
						await this.plugin.loadAnnotations();
						this.plugin.forceRefreshHighlights();
						new Notice(`批注文件夹已设置为: ${this.plugin.settings.annotationFolder}`);
					}).open();
				});
			return button;
		});

		// 高亮颜色设置
		new Setting(containerEl)
			.setName('高亮颜色')
			.setDesc('批注文字的高亮颜色')
			.addColorPicker(color => color
				.setValue(this.plugin.settings.highlightColor)
				.onChange(async (value) => {
					this.plugin.settings.highlightColor = value;
					await this.plugin.saveSettings();
				}));

		// 显示预览面板
		new Setting(containerEl)
			.setName('显示批注预览')
			.setDesc('在侧边栏显示批注预览面板')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showAnnotationPreview)
				.onChange(async (value) => {
					this.plugin.settings.showAnnotationPreview = value;
					await this.plugin.saveSettings();
				}));

		// 预览面板位置（现在固定在右侧功能区）
		new Setting(containerEl)
			.setName('预览面板位置')
			.setDesc('批注预览面板固定在右侧功能区')
			.addDropdown(dropdown => dropdown
				.addOption('right', '右侧功能区')
				.setValue('right')
				.setDisabled(true));
	}
}

// 文件夹选择模态框
class FolderSuggestModal extends Modal {
	private onChoose: (folder: TFolder) => void;
	private folders: TFolder[] = [];

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
	}

	onOpen() {
		const { contentEl, titleEl } = this;
		titleEl.setText('选择批注文件夹');

		// 获取所有文件夹
		this.folders = this.getAllFolders();

		// 搜索输入框
		const searchContainer = contentEl.createDiv('folder-search-container');
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: '搜索文件夹...',
			cls: 'folder-search-input'
		});
		searchInput.style.width = '100%';
		searchInput.style.marginBottom = '10px';
		searchInput.style.padding = '5px';

		// 文件夹列表容器
		const listContainer = contentEl.createDiv('folder-list-container');
		listContainer.style.maxHeight = '300px';
		listContainer.style.overflow = 'auto';

		// 渲染文件夹列表
		const renderFolders = (filter: string = '') => {
			listContainer.empty();
			
			// 添加 "创建新文件夹" 选项
			const createNewItem = listContainer.createDiv('folder-list-item');
			createNewItem.style.padding = '8px';
			createNewItem.style.cursor = 'pointer';
			createNewItem.style.borderBottom = '1px solid var(--background-modifier-border)';
			createNewItem.style.fontWeight = 'bold';
			createNewItem.style.color = 'var(--text-accent)';
			createNewItem.textContent = filter ? `创建新文件夹 "${filter}"` : '+ 创建新文件夹';
			createNewItem.addEventListener('click', async () => {
				const folderName = filter || 'Annotations';
				try {
					const newFolder = await this.app.vault.createFolder(folderName);
					this.onChoose(newFolder);
					this.close();
				} catch (error) {
					new Notice('创建文件夹失败，可能已存在');
				}
			});
			createNewItem.addEventListener('mouseover', () => {
				createNewItem.style.backgroundColor = 'var(--background-modifier-hover)';
			});
			createNewItem.addEventListener('mouseout', () => {
				createNewItem.style.backgroundColor = '';
			});

			// 过滤并排序文件夹
			const filteredFolders = this.folders
				.filter(folder => folder.path.toLowerCase().includes(filter.toLowerCase()))
				.sort((a, b) => a.path.localeCompare(b.path));

			for (const folder of filteredFolders) {
				const item = listContainer.createDiv('folder-list-item');
				item.style.padding = '8px';
				item.style.cursor = 'pointer';
				item.style.borderBottom = '1px solid var(--background-modifier-border)';
				
				// 文件夹图标和名称
				const folderName = folder.path === '/' ? '根目录 (/)' : folder.path;
				item.textContent = folderName;
				
				item.addEventListener('click', () => {
					this.onChoose(folder);
					this.close();
				});
				
				item.addEventListener('mouseover', () => {
					item.style.backgroundColor = 'var(--background-modifier-hover)';
				});
				
				item.addEventListener('mouseout', () => {
					item.style.backgroundColor = '';
				});
			}

			if (filteredFolders.length === 0 && !filter) {
				const emptyMsg = listContainer.createDiv('folder-list-empty');
				emptyMsg.textContent = '没有找到文件夹';
				emptyMsg.style.padding = '20px';
				emptyMsg.style.textAlign = 'center';
				emptyMsg.style.color = 'var(--text-muted)';
			}
		};

		// 初始渲染
		renderFolders();

		// 搜索过滤
		searchInput.addEventListener('input', (e) => {
			renderFolders((e.target as HTMLInputElement).value);
		});

		// 聚焦搜索框
		searchInput.focus();

		// 取消按钮
		const buttonContainer = contentEl.createDiv('modal-button-container');
		buttonContainer.style.marginTop = '15px';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.gap = '10px';

		const cancelButton = buttonContainer.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});
	}

	private getAllFolders(): TFolder[] {
		const folders: TFolder[] = [];
		const root = this.app.vault.getRoot();
		folders.push(root);
		
		const traverse = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					folders.push(child);
					traverse(child);
				}
			}
		};
		
		traverse(root);
		return folders;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
