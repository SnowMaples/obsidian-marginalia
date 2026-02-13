/**
 * Obsidian Marginalia Plugin - Main Entry
 * 
 * 核心功能:
 * 1. 批注创建 - PC右键菜单，移动端浮动菜单
 * 2. 实时高亮 - 立即在文档中显示高亮
 * 3. 批注查看 - 双击弹出悬浮卡片
 * 4. 批注编辑 - 悬浮卡片内直接编辑，失焦自动保存
 * 5. 批注删除 - 悬浮卡片和侧边栏均可删除
 * 6. 右侧边栏 - 自动显示当前文章批注列表
 * 7. 双向跳转 - 正文与批注文件双向导航
 * 8. 可配置 - 支持自定义设置
 * 9. 移动端支持 - 完整的移动端适配
 */
import {
  Plugin,
  TFile,
  Menu,
  Modal,
  Setting,
  PluginSettingTab,
  WorkspaceLeaf,
  Platform,
  MarkdownView,
  Vault,
  debounce,
  MarkdownPostProcessorContext,
} from "obsidian";
import { Annotation, createAnnotation, updateAnnotation } from "./models/Annotation";
import { MarginaliaSettings, DEFAULT_SETTINGS } from "./settings";
import {
  loadAnnotations,
  saveAnnotations,
  addAnnotation,
  updateAnnotation as updateAnnotationFile,
  deleteAnnotation,
  getAnnotationFile,
  getAnnotationFilePath,
} from "./utils/fileUtils";
import {
  getPositionFromDOMSelection,
  scrollToAnnotation,
} from "./utils/locationUtils";
import {
  processHighlights,
  removeHighlight,
  updateHighlightColor,
  injectHighlightIntoElement,
  MARGINALIA_HIGHLIGHT_CLASS,
  MARGINALIA_HIGHLIGHT_ACTIVE_CLASS,
  activateHighlight,
  getHighlightElement,
} from "./processors/AnnotationHighlighter";
import {
  AnnotationSidebarView,
  VIEW_TYPE_ANNOTATION_SIDEBAR,
} from "./views/AnnotationSidebarView";

/**
 * 主插件类
 */
export default class MarginaliaPlugin extends Plugin {
  settings!: MarginaliaSettings;
  sidebarView: AnnotationSidebarView | null = null;
  activeFile: TFile | null = null;
  private annotationCache: Map<string, Annotation[]> = new Map();
  private floatingCard: HTMLElement | null = null;
  private contextMenu: HTMLElement | null = null;
  private mobileSelectionMenu: HTMLElement | null = null;
  private currentEditAnnotationId: string | null = null;

  async onload(): Promise<void> {
    console.log("加载 Obsidian 批注插件");

    // 加载设置
    await this.loadSettings();

    // 注册侧边栏视图
    this.registerView(
      VIEW_TYPE_ANNOTATION_SIDEBAR,
      (leaf) =>
        new AnnotationSidebarView(
          leaf,
          this.app.vault,
          this.settings,
          this.handleAnnotationClick.bind(this),
          this.handleAnnotationEdit.bind(this),
          this.handleAnnotationDelete.bind(this),
          this.handleGotoSource.bind(this)
        )
    );

    // 注册功能区图标
    this.addRibbonIcon("highlighter", "切换批注侧边栏", () => {
      this.toggleSidebar();
    });

    // 注册命令
    this.addCommand({
      id: "create-annotation",
      name: "创建批注",
      editorCallback: (editor, view) => {
        this.createAnnotationFromEditor(view.file, editor);
      },
    });

    this.addCommand({
      id: "toggle-annotation-sidebar",
      name: "切换批注侧边栏",
      callback: () => this.toggleSidebar(),
    });

    // 注册 Markdown 后处理器用于高亮
    this.registerMarkdownPostProcessor(
      this.highlightPostProcessor.bind(this)
    );

    // 注册事件
    this.registerActiveLeafChange();
    this.registerContextMenu();
    this.registerClickHandlers();
    this.registerMobileHandlers();

    // 注册设置页
    this.addSettingTab(new MarginaliaSettingTab(this.app, this));

    // 如果启用了自动显示，初始化侧边栏
    if (this.settings.autoShowSidebar) {
      this.initSidebar();
    }
  }

  onunload(): void {
    console.log("卸载 Obsidian 批注插件");
    this.closeFloatingCard();
    this.closeContextMenu();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.sidebarView?.updateSettings(this.settings);
  }

  /**
   * 注册活动标签页变更事件
   */
  private registerActiveLeafChange(): void {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", async (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          const file = leaf.view.file;
          if (file && file.extension === "md") {
            this.activeFile = file;
            await this.updateSidebarForFile(file);
            await this.refreshHighlightsForActiveFile();
          }
        }
      })
    );
    
    // 监听布局变化（包括切换预览/编辑模式）
    this.registerEvent(
      this.app.workspace.on("layout-change", async () => {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView && markdownView.file) {
          console.log("[Marginalia] Layout changed, mode:", markdownView.getMode());
          this.activeFile = markdownView.file;
          
          if (markdownView.getMode() === 'source') {
            // 切换到编辑模式，侧边栏显示占位内容
            console.log("[Marginalia] Switched to edit mode");
            if (this.sidebarView) {
              (this.sidebarView as AnnotationSidebarView).setEditMode(true);
            } else if (this.settings.autoShowSidebar) {
              await this.initSidebar();
              await this.updateSidebarForFile(this.activeFile);
              if (this.sidebarView) {
                (this.sidebarView as AnnotationSidebarView).setEditMode(true);
              }
            }
          } else if (markdownView.getMode() === 'preview') {
            // 切换到预览模式，侧边栏显示批注内容
            console.log("[Marginalia] Switched to preview mode, showing annotations");
            if (this.sidebarView) {
              const sidebar = this.sidebarView as AnnotationSidebarView;
              sidebar.setEditMode(false);
              await sidebar.refresh();
            } else if (this.settings.autoShowSidebar) {
              await this.initSidebar();
              await this.updateSidebarForFile(this.activeFile);
              if (this.sidebarView) {
                (this.sidebarView as AnnotationSidebarView).setEditMode(false);
              }
            }
            // 刷新高亮
            setTimeout(async () => {
              await this.refreshHighlightsForActiveFile();
              markdownView.previewMode?.rerender(true);
            }, 100);
          }
        }
      })
    );
  }

  /**
   * 注册右键菜单（PC端）
   */
  private registerContextMenu(): void {
    if (Platform.isMobile) return;

    // 编辑器模式右键菜单 - 只在预览模式显示批注按钮
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, view) => {
        // 检查当前是否是预览模式
        if (!(view instanceof MarkdownView)) return;
        if (view.getMode() !== 'preview') return; // 编辑模式下不显示批注按钮
        
        const selectedText = editor.getSelection();
        if (!selectedText || selectedText.trim().length === 0) return;

        menu.addItem((item) => {
          item
            .setTitle("🖊 添加批注")
            .setIcon("highlighter")
            .onClick(() => {
              this.createAnnotationFromEditor(view.file, editor);
            });
        });
      })
    );

    // 预览模式右键菜单
    this.registerDomEvent(document, "contextmenu", (evt: MouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) return;

      const target = evt.target as HTMLElement;
      const container = target.closest(".markdown-preview-view");
      if (!container) return;

      // 检查是否点击在高亮上
      const highlight = target.closest(`.${MARGINALIA_HIGHLIGHT_CLASS}`);
      if (highlight) return; // 如果点击在高亮上，不显示添加菜单

      evt.preventDefault();
      this.showContextMenu(evt.clientX, evt.clientY, selection.toString(), container as HTMLElement);
    });
  }

  /**
   * 注册点击事件处理器
   */
  private registerClickHandlers(): void {
    // 双击高亮文字查看批注（只在预览模式）
    this.registerDomEvent(document, "dblclick", (evt: MouseEvent) => {
      // 检查当前是否是预览模式
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!markdownView || markdownView.getMode() !== 'preview') return;
      
      const target = evt.target as HTMLElement;
      const highlight = target.closest(`.${MARGINALIA_HIGHLIGHT_CLASS}`) as HTMLElement;
      
      if (highlight) {
        const annotationId = highlight.dataset.annotationId;
        if (annotationId && this.activeFile) {
          evt.preventDefault();
          evt.stopPropagation();
          this.showFloatingCard(annotationId, highlight);
        }
      }
    });

    // 单击高亮文字 - 联动到侧边栏（只在预览模式）
    this.registerDomEvent(document, "click", async (evt: MouseEvent) => {
      // 检查当前是否是预览模式
      const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!markdownView || markdownView.getMode() !== 'preview') return;
      
      const target = evt.target as HTMLElement;
      const highlight = target.closest(`.${MARGINALIA_HIGHLIGHT_CLASS}`) as HTMLElement;
      
      if (highlight) {
        const annotationId = highlight.dataset.annotationId;
        if (annotationId && this.activeFile) {
          console.log(`[Marginalia] Clicked highlight: ${annotationId}`);
          // 高亮侧边栏对应卡片
          this.sidebarView?.highlightAnnotationCard(annotationId);
          // 激活当前高亮
          await this.activateHighlightInDocument(annotationId);
        }
      }
    });

    // Ctrl+点击跳转到批注文件
    this.registerDomEvent(document, "click", (evt: MouseEvent) => {
      if (!evt.ctrlKey && !evt.metaKey) return;

      const target = evt.target as HTMLElement;
      const highlight = target.closest(`.${MARGINALIA_HIGHLIGHT_CLASS}`) as HTMLElement;
      
      if (highlight) {
        const annotationId = highlight.dataset.annotationId;
        if (annotationId && this.activeFile) {
          evt.preventDefault();
          evt.stopPropagation();
          const annotations = this.annotationCache.get(this.activeFile.path) || [];
          const annotation = annotations.find((a) => a.annotation_id === annotationId);
          if (annotation) {
            this.handleGotoAnnotationFile(annotation);
          }
        }
      }
    });
  }

  /**
   * 注册移动端特定处理器
   */
  private registerMobileHandlers(): void {
    if (!Platform.isMobile || !this.settings.mobileEnabled) return;

    // 选择文字显示批注菜单
    this.registerDomEvent(document, "selectionchange", debounce(() => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
        this.closeMobileSelectionMenu();
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      this.showMobileSelectionMenu(
        rect.left + rect.width / 2,
        rect.top - 50,
        selection.toString()
      );
    }, 300));

    // 滚动时隐藏菜单
    this.registerDomEvent(document, "scroll", () => {
      this.closeMobileSelectionMenu();
    });
  }

  /**
   * 初始化侧边栏
   */
  private async initSidebar(): Promise<void> {
    const { workspace } = this.app;
    
    // 检查侧边栏是否已存在
    const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_ANNOTATION_SIDEBAR)[0];
    if (existingLeaf) return;

    // 在右侧面板创建侧边栏
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) return;
    await rightLeaf.setViewState({
      type: VIEW_TYPE_ANNOTATION_SIDEBAR,
      active: false,
    });

    // 获取视图实例
    const leaf = workspace.getLeavesOfType(VIEW_TYPE_ANNOTATION_SIDEBAR)[0];
    if (leaf) {
      this.sidebarView = leaf.view as AnnotationSidebarView;
      if (this.activeFile) {
        await this.sidebarView.setFile(this.activeFile);
      }
    }
  }

  /**
   * 切换侧边栏显示
   */
  private async toggleSidebar(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ANNOTATION_SIDEBAR);

    if (leaves.length > 0) {
      // 关闭侧边栏
      leaves.forEach((leaf) => leaf.detach());
      this.sidebarView = null;
    } else {
      // 打开侧边栏
      await this.initSidebar();
    }
  }

  /**
   * 隐藏侧边栏
   */
  private hideSidebar(): void {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ANNOTATION_SIDEBAR);
    
    if (leaves.length > 0) {
      leaves.forEach((leaf) => leaf.detach());
      this.sidebarView = null;
    }
  }

  /**
   * 更新侧边栏文件
   */
  private async updateSidebarForFile(file: TFile): Promise<void> {
    if (!this.sidebarView) {
      if (this.settings.autoShowSidebar) {
        await this.initSidebar();
      }
      return;
    }

    await this.sidebarView.setFile(file);
  }

  /**
   * 刷新当前活动文件的高亮缓存
   */
  private async refreshHighlightsForActiveFile(): Promise<void> {
    if (!this.activeFile) return;

    const annotations = await loadAnnotations(
      this.app.vault,
      this.activeFile,
      this.settings.annotationFolder
    );
    this.annotationCache.set(this.activeFile.path, annotations);
  }

  /**
   * Markdown 后处理器 - 注入高亮
   */
  private highlightPostProcessor(
    element: HTMLElement,
    context: MarkdownPostProcessorContext
  ): void {
    const sourcePath = context.sourcePath;
    const annotations = this.annotationCache.get(sourcePath);
    
    if (annotations && annotations.length > 0) {
      processHighlights(element, annotations, this.settings.highlightColor);
    }
  }

  /**
   * 从编辑器选区创建批注
   */
  private async createAnnotationFromEditor(file: TFile | null, editor: any): Promise<void> {
    if (!file) return;

    const selectedText = editor.getSelection();
    if (!selectedText || selectedText.trim().length === 0) {
      return;
    }

    const cursor = editor.getCursor("from");
    const offset = editor.posToOffset(cursor);
    const lineNumber = cursor.line;

    const position = {
      file_path: file.path,
      offset,
      line_number: lineNumber,
    };

    this.showAnnotationModal(file, selectedText, position);
  }

  /**
   * 显示上下文菜单
   */
  private showContextMenu(x: number, y: number, selectedText: string, container: HTMLElement): void {
    this.closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "marginalia-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const item = menu.createDiv("marginalia-context-menu-item");
    item.createSpan({ cls: "marginalia-context-menu-item-icon", text: "🖊" });
    item.createSpan({ text: "添加批注" });
    
    item.onclick = () => {
      this.closeContextMenu();
      const position = getPositionFromDOMSelection(this.activeFile!.path, window.getSelection()!);
      if (position) {
        this.showAnnotationModal(this.activeFile!, selectedText, position);
      }
    };

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // 点击外部关闭菜单
    setTimeout(() => {
      const closeHandler = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
          this.closeContextMenu();
          document.removeEventListener("click", closeHandler);
        }
      };
      document.addEventListener("click", closeHandler);
    }, 100);
  }

  /**
   * 关闭上下文菜单
   */
  private closeContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  /**
   * 显示移动端选择菜单
   */
  private showMobileSelectionMenu(x: number, y: number, selectedText: string): void {
    this.closeMobileSelectionMenu();

    const menu = document.createElement("div");
    menu.className = "marginalia-context-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    menu.style.top = `${Math.max(y, 10)}px`;

    const item = menu.createDiv("marginalia-context-menu-item");
    item.createSpan({ cls: "marginalia-context-menu-item-icon", text: "🖊" });
    item.createSpan({ text: "批注" });
    
    item.onclick = () => {
      this.closeMobileSelectionMenu();
      const selection = window.getSelection();
      if (selection) {
        const position = getPositionFromDOMSelection(this.activeFile!.path, selection);
        if (position) {
          this.showAnnotationModal(this.activeFile!, selectedText, position);
        }
      }
    };

    document.body.appendChild(menu);
    this.mobileSelectionMenu = menu;
  }

  /**
   * 关闭移动端选择菜单
   */
  private closeMobileSelectionMenu(): void {
    if (this.mobileSelectionMenu) {
      this.mobileSelectionMenu.remove();
      this.mobileSelectionMenu = null;
    }
  }

  /**
   * 显示批注输入弹窗
   */
  private showAnnotationModal(
    file: TFile,
    selectedText: string,
    position: any
  ): void {
    new AnnotationInputModal(
      this.app,
      selectedText,
      async (content: string) => {
        const annotation = createAnnotation(selectedText, position, content);
        await addAnnotation(this.app.vault, file, this.settings.annotationFolder, annotation);
        
        // 更新缓存
        const annotations = this.annotationCache.get(file.path) || [];
        annotations.push(annotation);
        this.annotationCache.set(file.path, annotations);
        
        // 立即在当前视图中注入高亮
        this.injectHighlightImmediate(annotation);
        
        // 更新侧边栏
        this.sidebarView?.refresh();
      }
    ).open();
  }

  /**
   * 立即注入高亮到当前视图
   * 关键修复：不依赖重新渲染，直接操作DOM
   */
  private injectHighlightImmediate(annotation: Annotation): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      console.log("[Marginalia] No markdown view found");
      return;
    }

    console.log("[Marginalia] Injecting highlight into markdown view");
    console.log("[Marginalia] View mode:", markdownView.getMode());

    // 检查当前是否是预览模式
    const currentMode = markdownView.getMode();
    if (currentMode !== 'preview') {
      console.log("[Marginalia] Not in preview mode, skipping immediate highlight injection");
      console.log("[Marginalia] Highlights will appear when switching to preview mode");
      return;
    }

    // 尝试多种可能的容器选择器
    const possibleSelectors = [
      ".markdown-preview-view",
      ".markdown-reading-view", 
      ".view-content",
      ".markdown-rendered",
      ".markdown-preview-section"
    ];
    
    let injected = false;
    
    // 首先尝试 previewMode 容器
    if (markdownView.previewMode?.containerEl) {
      console.log("[Marginalia] Trying previewMode container");
      injectHighlightIntoElement(
        markdownView.previewMode.containerEl,
        annotation,
        this.settings.highlightColor
      );
      injected = true;
    }
    
    // 然后尝试其他选择器
    for (const selector of possibleSelectors) {
      const containers = markdownView.containerEl.querySelectorAll(selector);
      containers.forEach((container) => {
        if (container instanceof HTMLElement && container.textContent?.includes(annotation.selected_text)) {
          console.log(`[Marginalia] Trying container: ${selector}`);
          injectHighlightIntoElement(
            container,
            annotation,
            this.settings.highlightColor
          );
          injected = true;
        }
      });
    }
    
    if (!injected) {
      console.warn("[Marginalia] Could not find suitable container for highlight injection");
    }
  }

  /**
   * 在文档中激活高亮（带脉冲效果）
   */
  private async activateHighlightInDocument(annotationId: string): Promise<void> {
    console.log(`[Marginalia] Activating highlight in document: ${annotationId}`);
    
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      console.warn("[Marginalia] No markdown view found for activation");
      return;
    }

    // 检查是否在预览模式
    if (markdownView.getMode() !== 'preview') {
      console.warn("[Marginalia] Not in preview mode, cannot activate highlight");
      return;
    }

    // 等待一下确保DOM稳定
    await new Promise(resolve => setTimeout(resolve, 50));

    // 尝试多种可能的容器
    const containers: HTMLElement[] = [];
    
    if (markdownView.previewMode?.containerEl) {
      containers.push(markdownView.previewMode.containerEl);
    }
    
    const possibleSelectors = [
      ".markdown-preview-view",
      ".markdown-reading-view", 
      ".view-content",
      ".markdown-rendered"
    ];
    
    for (const selector of possibleSelectors) {
      const el = markdownView.containerEl.querySelector(selector);
      if (el instanceof HTMLElement) {
        containers.push(el);
      }
    }
    
    // 在所有可能的容器中尝试激活高亮
    for (const container of containers) {
      const highlight = container.querySelector(`[data-annotation-id="${annotationId}"].${MARGINALIA_HIGHLIGHT_CLASS}`) as HTMLElement;
      if (highlight) {
        console.log("[Marginalia] Found highlight in container, activating and scrolling");
        // 移除其他高亮
        container.querySelectorAll(`.${MARGINALIA_HIGHLIGHT_ACTIVE_CLASS}`).forEach(el => el.classList.remove(MARGINALIA_HIGHLIGHT_ACTIVE_CLASS));
        // 激活当前高亮
        highlight.classList.add(MARGINALIA_HIGHLIGHT_ACTIVE_CLASS);
        // 滚动到视野
        highlight.scrollIntoView({ behavior: "smooth", block: "center" });
        console.log("[Marginalia] Successfully scrolled to highlight");
        return;
      }
    }
    
    console.warn(`[Marginalia] Highlight element not found in any container: ${annotationId}`);
  }

  /**
   * 显示悬浮卡片
   */
  private async showFloatingCard(annotationId: string, highlightElement: HTMLElement): Promise<void> {
    if (!this.activeFile) return;

    const annotations = this.annotationCache.get(this.activeFile.path) || [];
    const annotation = annotations.find((a) => a.annotation_id === annotationId);
    if (!annotation) return;

    this.closeFloatingCard();
    this.currentEditAnnotationId = annotationId;

    const card = document.createElement("div");
    card.className = "marginalia-floating-card";
    
    // 定位到高亮附近
    const rect = highlightElement.getBoundingClientRect();
    const cardWidth = 400;
    const cardHeight = 400;
    
    let left = rect.left + rect.width / 2 - cardWidth / 2;
    let top = rect.bottom + 10;
    
    // 保持在视口内
    left = Math.max(10, Math.min(left, window.innerWidth - cardWidth - 10));
    if (top + cardHeight > window.innerHeight) {
      top = rect.top - cardHeight - 10;
    }
    
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    // 头部
    const header = card.createDiv("marginalia-floating-card-header");
    header.createEl("h4", { text: "批注" });
    const closeBtn = header.createEl("button", { cls: "marginalia-floating-card-close" });
    closeBtn.textContent = "×";
    closeBtn.onclick = () => this.closeFloatingCard();

    // 源文本
    const sourceEl = card.createDiv("marginalia-floating-card-source");
    sourceEl.createEl("blockquote", { text: annotation.selected_text });

    // 内容（可编辑）
    const contentEl = card.createDiv("marginalia-floating-card-content");
    const textarea = contentEl.createEl("textarea");
    textarea.value = annotation.content;
    textarea.placeholder = "输入批注内容...";
    
    // 失焦自动保存
    textarea.onblur = async () => {
      const newContent = textarea.value;
      if (newContent !== annotation.content) {
        const updatedAnnotation = updateAnnotation(annotation, newContent);
        await updateAnnotationFile(
          this.app.vault,
          this.activeFile!,
          this.settings.annotationFolder,
          updatedAnnotation
        );
        
        // 更新缓存
        const index = annotations.findIndex((a) => a.annotation_id === annotationId);
        if (index !== -1) {
          annotations[index] = updatedAnnotation;
        }
        
        // 更新侧边栏
        this.sidebarView?.refresh();
      }
    };

    // 底部操作按钮
    const footer = card.createDiv("marginalia-floating-card-footer");
    
    const deleteBtn = footer.createEl("button", {
      cls: "marginalia-btn marginalia-btn-danger marginalia-btn-icon",
      attr: { title: "删除批注" }
    });
    deleteBtn.innerHTML = "🗑️";
    deleteBtn.onclick = () => {
      this.closeFloatingCard();
      this.handleAnnotationDelete(annotationId);
    };

    document.body.appendChild(card);
    this.floatingCard = card;
    textarea.focus();

    // 高亮对应的侧边栏卡片
    this.sidebarView?.highlightAnnotationCard(annotationId);

    // 点击外部关闭
    setTimeout(() => {
      const closeHandler = (e: MouseEvent) => {
        if (!card.contains(e.target as Node)) {
          this.closeFloatingCard();
          document.removeEventListener("click", closeHandler);
        }
      };
      document.addEventListener("click", closeHandler);
    }, 100);
  }

  /**
   * 关闭悬浮卡片
   */
  private closeFloatingCard(): void {
    if (this.floatingCard) {
      this.floatingCard.remove();
      this.floatingCard = null;
      this.currentEditAnnotationId = null;
    }
  }

  /**
   * 处理侧边栏批注卡片点击
   */
  private async handleAnnotationClick(annotation: Annotation): Promise<void> {
    console.log(`[Marginalia] Sidebar card clicked: ${annotation.annotation_id}`);
    
    // 检查当前是否是预览模式
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView) {
      console.warn("[Marginalia] No markdown view found");
      return;
    }
    
    // 检查当前模式
    if (markdownView.getMode() !== 'preview') {
      console.warn("[Marginalia] Not in preview mode, cannot activate highlight");
      return;
    }
    
    // 激活正文高亮
    await this.activateHighlightInDocument(annotation.annotation_id);
  }

  /**
   * 处理批注编辑（来自侧边栏）
   */
  private async handleAnnotationEdit(annotation: Annotation, content: string): Promise<void> {
    if (!this.activeFile) return;

    const updatedAnnotation = updateAnnotation(annotation, content);
    await updateAnnotationFile(
      this.app.vault,
      this.activeFile,
      this.settings.annotationFolder,
      updatedAnnotation
    );

    // 更新缓存
    const annotations = this.annotationCache.get(this.activeFile.path) || [];
    const index = annotations.findIndex((a) => a.annotation_id === annotation.annotation_id);
    if (index !== -1) {
      annotations[index] = updatedAnnotation;
    }
  }

  /**
   * 处理批注删除
   */
  private async handleAnnotationDelete(annotationId: string): Promise<void> {
    if (!this.activeFile) return;

    await deleteAnnotation(
      this.app.vault,
      this.activeFile,
      this.settings.annotationFolder,
      annotationId
    );

    // 更新缓存
    const annotations = this.annotationCache.get(this.activeFile.path) || [];
    const filtered = annotations.filter((a) => a.annotation_id !== annotationId);
    this.annotationCache.set(this.activeFile.path, filtered);

    // 立即从DOM中移除高亮（局部刷新）
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView && markdownView.getMode() === 'preview') {
      // 尝试多种可能的容器
      const possibleSelectors = [
        ".markdown-preview-view",
        ".markdown-reading-view", 
        ".view-content",
        ".markdown-rendered"
      ];
      
      for (const selector of possibleSelectors) {
        const containers = markdownView.containerEl.querySelectorAll(selector);
        containers.forEach((container) => {
          if (container instanceof HTMLElement) {
            const highlight = container.querySelector(`[data-annotation-id="${annotationId}"]`);
            if (highlight && highlight.parentNode) {
              const parent = highlight.parentNode;
              while (highlight.firstChild) {
                parent.insertBefore(highlight.firstChild, highlight);
              }
              parent.removeChild(highlight);
              parent.normalize();
              console.log(`[Marginalia] Removed highlight ${annotationId} from ${selector}`);
            }
          }
        });
      }
    }

    // 更新侧边栏
    await this.sidebarView?.refresh();
  }

  /**
   * 处理跳转到源文本
   */
  private async handleGotoSource(annotation: Annotation): Promise<void> {
    await this.activateHighlightInDocument(annotation.annotation_id);
  }

  /**
   * 处理跳转到批注文件
   */
  private async handleGotoAnnotationFile(annotation: Annotation): Promise<void> {
    if (!this.activeFile) return;

    const annotationFile = getAnnotationFile(
      this.app.vault,
      this.activeFile,
      this.settings.annotationFolder
    );

    if (annotationFile) {
      await this.app.workspace.openLinkText(
        annotationFile.path,
        "",
        false
      );
    }
  }
}

/**
 * 批注输入弹窗
 */
class AnnotationInputModal extends Modal {
  private selectedText: string;
  private onSubmit: (content: string) => void;
  private content = "";

  constructor(app: any, selectedText: string, onSubmit: (content: string) => void) {
    super(app);
    this.selectedText = selectedText;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("marginalia-input-modal-compact");

    // 紧凑标题
    const header = contentEl.createDiv("marginalia-input-modal-header");
    header.createEl("h4", { text: "添加批注" });

    // 显示选中的文本（紧凑版）
    const sourceEl = contentEl.createDiv("marginalia-input-modal-source-compact");
    sourceEl.createEl("p", { text: this.selectedText });

    // 内容输入
    const textarea = contentEl.createEl("textarea");
    textarea.className = "marginalia-input-modal-textarea";
    textarea.placeholder = "输入批注内容...";
    textarea.value = this.content;
    textarea.oninput = () => {
      this.content = textarea.value;
    };

    // 操作按钮（紧凑版）
    const actionsEl = contentEl.createDiv("marginalia-input-modal-actions-compact");

    const cancelBtn = actionsEl.createEl("button", {
      cls: "marginalia-btn-compact marginalia-btn-secondary",
      text: "取消",
    });
    cancelBtn.onclick = () => this.close();

    const saveBtn = actionsEl.createEl("button", {
      cls: "marginalia-btn-compact",
      text: "保存",
    });
    saveBtn.onclick = () => {
      this.onSubmit(this.content);
      this.close();
    };

    // 聚焦输入框
    setTimeout(() => textarea.focus(), 100);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 插件设置页
 */
class MarginaliaSettingTab extends PluginSettingTab {
  plugin: MarginaliaPlugin;

  constructor(app: any, plugin: MarginaliaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian 批注插件设置" });

    // 批注文件夹设置
    new Setting(containerEl)
      .setName("批注文件夹")
      .setDesc("批注文件存储的文件夹位置")
      .addText((text) =>
        text
          .setPlaceholder("_annotations")
          .setValue(this.plugin.settings.annotationFolder)
          .onChange(async (value) => {
            this.plugin.settings.annotationFolder = value || "_annotations";
            await this.plugin.saveSettings();
          })
      );

    // 自动显示侧边栏设置
    new Setting(containerEl)
      .setName("自动显示侧边栏")
      .setDesc("打开有批注的文件时自动显示批注侧边栏")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoShowSidebar)
          .onChange(async (value) => {
            this.plugin.settings.autoShowSidebar = value;
            await this.plugin.saveSettings();
          })
      );

    // 高亮颜色设置
    new Setting(containerEl)
      .setName("高亮颜色")
      .setDesc("正文中高亮文本的背景颜色")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.highlightColor)
          .onChange(async (value) => {
            this.plugin.settings.highlightColor = value;
            await this.plugin.saveSettings();
            this.refreshHighlights();
          })
      );

    // 移动端启用设置
    new Setting(containerEl)
      .setName("在移动端启用")
      .setDesc("在移动设备上启用批注功能")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mobileEnabled)
          .onChange(async (value) => {
            this.plugin.settings.mobileEnabled = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private refreshHighlights(): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView) {
      const preview = markdownView.previewMode?.containerEl;
      if (preview) {
        updateHighlightColor(preview, this.plugin.settings.highlightColor);
      }
    }
  }
}
