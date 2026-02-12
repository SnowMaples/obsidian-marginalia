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
	ItemView
} from 'obsidian';
import { 
	Decoration, 
	DecorationSet, 
	EditorView, 
	ViewPlugin, 
	ViewUpdate,
	WidgetType
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// 常量定义
const ANNOTATION_PREVIEW_VIEW_TYPE = 'annotation-preview-view';

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

	async onload() {
		console.log('加载批注插件');
		
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
			
			// 如果有打开的文件，更新批注面板
			const activeFile = this.getActiveFile();
			if (activeFile) {
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
						// 自动更新右侧批注面板
						this.updateAnnotationPanel();
					}, 100);
				}
			})
		);
		
		// 注册编辑器点击事件
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
	}

	// 保存批注
	async saveAnnotation(annotation: Annotation) {
		// 确保批注文件夹存在
		await this.ensureAnnotationFolder();
		
		// 获取或创建批注文件
		const annotationFilePath = this.getAnnotationFilePath(annotation.sourceFile);
		let existingAnnotations: Annotation[] = [];
		
		try {
			const file = this.app.vault.getAbstractFileByPath(annotationFilePath);
			if (file instanceof TFile) {
				const content = await this.app.vault.read(file);
				existingAnnotations = this.parseAnnotationFile(content);
			}
		} catch (e) {
			// 文件不存在，将创建新文件
		}

		// 添加新批注
		existingAnnotations.push(annotation);
		
		// 保存文件
		const fileContent = this.formatAnnotationFile(existingAnnotations, annotation.sourceFile);
		const file = this.app.vault.getAbstractFileByPath(annotationFilePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, fileContent);
		} else {
			await this.app.vault.create(annotationFilePath, fileContent);
		}

		// 更新内存中的批注列表
		this.annotations.set(annotation.sourceFile, existingAnnotations);
	}

	// 加载批注
	async loadAnnotations() {
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
		
		if (annotations.length === 0) {
			// 如果没有批注了，删除整个文件
			await this.app.vault.delete(file);
		} else {
			// 保存更新后的文件
			const fileContent = this.formatAnnotationFile(annotations, sourceFile);
			await this.app.vault.modify(file, fileContent);
		}
		
		// 更新内存中的批注列表
		this.annotations.set(sourceFile, annotations);
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
		const folder = this.app.vault.getAbstractFileByPath(this.settings.annotationFolder);
		if (!folder) {
			await this.app.vault.createFolder(this.settings.annotationFolder);
		}
	}

	// 注册高亮插件
	registerHighlightPlugin() {
		const plugin = this;
		
		this.highlightPlugin = ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;
				
				constructor(view: EditorView) {
					this.decorations = plugin.buildDecorations(view);
				}
				
				update(update: ViewUpdate) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = plugin.buildDecorations(update.view);
					}
				}
			},
			{
				decorations: (v) => v.decorations,
			}
		);
		
		this.registerEditorExtension(this.highlightPlugin);
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
		console.log('更新高亮:', file.path, annotations.length, '个批注');
		
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
					// 触发强制重绘
					editorView.dispatch({ effects: [] });
				}
			}
		}
		
		// 如果没有找到 leaves，尝试获取当前激活的视图
		if (leaves.length === 0) {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.editor) {
				const editorView = (activeView.editor as any).cm as EditorView;
				if (editorView) {
					editorView.dispatch({ effects: [] });
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
			cls: 'annotation-tooltip-content',
			text: annotation.content
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
			this.hideAnnotationTooltip();
			// 打开编辑弹窗
			new AnnotationEditModal(this.app, annotation, async (newContent: string) => {
				annotation.content = newContent;
				await this.updateAnnotation(annotation);
				// 刷新侧边栏
				this.updateAnnotationPanel();
				// 刷新高亮
				this.forceRefreshHighlights();
				new Notice('批注已更新');
			}).open();
		});
		
		// 删除按钮（图标）
		const deleteBtn = btnGroup.createEl('button', {
			cls: 'annotation-tooltip-btn annotation-tooltip-btn-delete',
			attr: { 'aria-label': '删除批注' }
		});
		deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.hideAnnotationTooltip();
			// 调用删除方法
			const plugin = this;
			plugin.deleteAnnotation(annotation.id, annotation.sourceFile).then(() => {
				// 移除正文中的高亮效果
				document.querySelectorAll(`.annotation-highlight[data-annotation-id="${annotation.id}"]`).forEach((el) => {
					el.classList.remove('annotation-highlight');
					el.removeAttribute('data-annotation-id');
				});
				// 刷新侧边栏
				plugin.updateAnnotationPanel();
				// 刷新高亮
				plugin.forceRefreshHighlights();
				new Notice('批注已删除');
			}).catch((error: Error) => {
				console.error('删除批注失败:', error);
				new Notice('删除批注失败');
			});
		});
		
		// 定位
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
		
		// 聚焦到文本框
		textarea.focus();
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
			
			// 批注内容（自适应高度）
			const commentEl = item.createEl('div', {
				cls: 'annotation-sidebar-comment',
				text: annotation.content
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
				this.editAnnotation(annotation);
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
				const regex = new RegExp(`^id:\\s*${annotationId}$`, 'm');
				const match = content.match(regex);
				
				if (match && match.index !== undefined) {
					const pos = activeView.editor.offsetToPos(match.index);
					activeView.editor.setCursor(pos);
					activeView.editor.scrollIntoView({ from: pos, to: pos }, true);
				}
			}, 200);
		}
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
			// 删除批注
			await this.plugin.deleteAnnotation(annotation.id, annotation.sourceFile);
			
			// 移除正文中的高亮效果
			document.querySelectorAll(`.annotation-highlight[data-annotation-id="${annotation.id}"]`).forEach((el) => {
				el.classList.remove('annotation-highlight');
				el.removeAttribute('data-annotation-id');
			});
			
			// 刷新右侧边栏
			this.updatePreview();
			
			// 强制刷新高亮
			this.plugin.forceRefreshHighlights();
			
			new Notice('批注已删除');
		} catch (error) {
			console.error('删除批注失败:', error);
			new Notice('删除批注失败');
		}
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
		new Setting(containerEl)
			.setName('批注文件夹')
			.setDesc('批注文件将保存在此文件夹中')
			.addText(text => text
				.setPlaceholder('Annotations')
				.setValue(this.plugin.settings.annotationFolder)
				.onChange(async (value) => {
					this.plugin.settings.annotationFolder = value || 'Annotations';
					await this.plugin.saveSettings();
				}));

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
