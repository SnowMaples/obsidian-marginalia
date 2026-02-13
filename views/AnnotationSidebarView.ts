/**
 * AnnotationSidebarView - 右侧批注边栏面板
 * 显示带 Markdown 渲染的批注卡片
 */
import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  Vault,
  Component,
  MarkdownRenderer,
  Menu,
  Platform,
} from "obsidian";
import { Annotation } from "../models/Annotation";
import { MarginaliaSettings } from "../settings";
import { loadAnnotations, getAnnotationFile } from "../utils/fileUtils";
import { MARGINALIA_HIGHLIGHT_CLASS } from "../processors/AnnotationHighlighter";

export const VIEW_TYPE_ANNOTATION_SIDEBAR = "annotation-sidebar";

/**
 * 批注侧边栏视图
 */
export class AnnotationSidebarView extends ItemView {
  private currentFile: TFile | null = null;
  private annotations: Annotation[] = [];
  private settings: MarginaliaSettings;
  private vault: Vault;
  private onAnnotationClick: (annotation: Annotation) => void | Promise<void>;
  private onAnnotationEdit: (annotation: Annotation, content: string) => void;
  private onAnnotationDelete: (annotationId: string) => void;
  private onGotoSource: (annotation: Annotation) => void | Promise<void>;
  private editingAnnotationId: string | null = null;
  private isEditMode: boolean = false;

  constructor(
    leaf: WorkspaceLeaf,
    vault: Vault,
    settings: MarginaliaSettings,
    onAnnotationClick: (annotation: Annotation) => void | Promise<void>,
    onAnnotationEdit: (annotation: Annotation, content: string) => void,
    onAnnotationDelete: (annotationId: string) => void,
    onGotoSource: (annotation: Annotation) => void | Promise<void>
  ) {
    super(leaf);
    this.vault = vault;
    this.settings = settings;
    this.onAnnotationClick = onAnnotationClick;
    this.onAnnotationEdit = onAnnotationEdit;
    this.onAnnotationDelete = onAnnotationDelete;
    this.onGotoSource = onGotoSource;
  }

  getViewType(): string {
    return VIEW_TYPE_ANNOTATION_SIDEBAR;
  }

  getDisplayText(): string {
    return "批注";
  }

  getIcon(): string {
    return "highlighter";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("marginalia-sidebar");
    await this.render();
  }

  async onClose(): Promise<void> {
    // 清理工作
  }

  /**
   * 设置当前文件并刷新视图
   */
  async setFile(file: TFile | null): Promise<void> {
    this.currentFile = file;
    if (file) {
      this.annotations = await loadAnnotations(this.vault, file, this.settings.annotationFolder);
    } else {
      this.annotations = [];
    }
    await this.render();
  }

  /**
   * 获取当前批注
   */
  getAnnotations(): Annotation[] {
    return this.annotations;
  }

  /**
   * 刷新视图
   */
  async refresh(): Promise<void> {
    if (this.currentFile) {
      this.annotations = await loadAnnotations(
        this.vault,
        this.currentFile,
        this.settings.annotationFolder
      );
      await this.render();
    }
  }

  /**
   * 设置编辑模式状态
   */
  setEditMode(isEditMode: boolean): void {
    this.isEditMode = isEditMode;
    this.render();
  }

  /**
   * 更新设置
   */
  updateSettings(settings: MarginaliaSettings): void {
    this.settings = settings;
    this.refresh();
  }

  /**
   * 渲染侧边栏内容
   */
  private async render(): Promise<void> {
    const content = this.containerEl.querySelector(".view-content");
    if (!content) return;
    
    content.empty();
    
    // 头部
    const header = content.createDiv("marginalia-sidebar-header");
    header.createEl("h3", { text: "批注列表" });
    
    // 批注数量
    header.createSpan({
      text: `${this.annotations.length} 条批注`,
      cls: "marginalia-sidebar-count"
    });
    
    // 批注容器
    const container = content.createDiv("marginalia-sidebar-container");
    
    // 编辑模式下显示占位内容
    if (this.isEditMode) {
      const editModePlaceholder = container.createDiv("marginalia-edit-mode-placeholder");
      editModePlaceholder.createEl("p", { 
        text: "📝 编辑模式不展示批注内容",
        cls: "marginalia-edit-mode-text"
      });
      editModePlaceholder.createEl("p", {
        text: "切换到预览模式查看批注",
        cls: "marginalia-edit-mode-hint"
      });
      return;
    }
    
    if (this.annotations.length === 0) {
      const emptyState = container.createDiv("marginalia-empty-state");
      emptyState.createEl("p", { text: "暂无批注" });
      emptyState.createEl("p", {
        text: Platform.isMobile ? "选中文本添加批注" : "选中文本后右键添加批注",
        cls: "marginalia-empty-hint"
      });
      return;
    }
    
    // 按在正文中的位置排序（offset 越小越靠前）
    const sortedAnnotations = [...this.annotations].sort(
      (a, b) => (a.position?.offset || 0) - (b.position?.offset || 0)
    );
    
    for (const annotation of sortedAnnotations) {
      await this.createAnnotationCard(container, annotation);
    }
  }

  /**
   * 创建单个批注卡片
   */
  private async createAnnotationCard(
    container: HTMLElement,
    annotation: Annotation
  ): Promise<void> {
    const card = container.createDiv("marginalia-annotation-card");
    card.dataset.annotationId = annotation.annotation_id;
    
    // 源文本（截断）
    const sourceTextEl = card.createDiv("marginalia-card-source");
    sourceTextEl.createEl("blockquote", {
      text: annotation.selected_text.length > 150
        ? annotation.selected_text.substring(0, 150) + "..."
        : annotation.selected_text
    });
    
    // 批注内容
    const contentEl = card.createDiv("marginalia-card-content markdown-rendered");
    if (this.editingAnnotationId === annotation.annotation_id) {
      // 编辑模式
      const textarea = contentEl.createEl("textarea");
      textarea.value = annotation.content;
      textarea.className = "marginalia-card-edit-textarea";
      textarea.placeholder = "输入批注内容...";
      
      // 失焦保存
      textarea.onblur = async () => {
        const newContent = textarea.value;
        if (newContent !== annotation.content) {
          await this.onAnnotationEdit(annotation, newContent);
          // 更新本地数据
          annotation.content = newContent;
          annotation.updated = new Date().toISOString();
        }
        this.editingAnnotationId = null;
        // 重新渲染该卡片
        await this.render();
      };
      
      // 自动聚焦
      setTimeout(() => textarea.focus(), 100);
    } else {
      // 显示模式
      if (annotation.content) {
        await MarkdownRenderer.render(
          this.app,
          annotation.content,
          contentEl,
          "",
          this
        );
      } else {
        contentEl.createEl("em", {
          text: "暂无内容",
          cls: "marginalia-empty-content"
        });
      }
    }
    
    // 底部区域：时间和操作按钮
    const footerEl = card.createDiv("marginalia-card-footer");
    
    // 元数据（创建时间）- 左下角
    const metaEl = footerEl.createDiv("marginalia-card-meta");
    const date = new Date(annotation.created);
    // 格式化为 yy-MM-dd HH:mm
    const yy = date.getFullYear().toString().slice(-2);
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const HH = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    metaEl.createSpan({
      text: `${yy}-${MM}-${dd} ${HH}:${mm}`,
      cls: "marginalia-card-time"
    });
    
    // 操作按钮 - 右下角
    const actionsEl = footerEl.createDiv("marginalia-card-actions");
    
    // 编辑按钮
    const editBtn = actionsEl.createEl("button", {
      cls: "marginalia-btn marginalia-btn-small",
      attr: { title: "编辑批注" }
    });
    editBtn.innerHTML = "✏️";
    editBtn.onclick = (e) => {
      e.stopPropagation();
      this.editingAnnotationId = annotation.annotation_id;
      this.render();
    };
    
    // 删除按钮
    const deleteBtn = actionsEl.createEl("button", {
      cls: "marginalia-btn marginalia-btn-small marginalia-btn-danger",
      attr: { title: "删除批注" }
    });
    deleteBtn.innerHTML = "🗑️";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.onAnnotationDelete(annotation.annotation_id);
    };
    
    // 卡片点击事件（跳转到正文对应位置）
    card.addEventListener("click", async (e) => {
      // 如果点击的是编辑区域或按钮，不触发跳转
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.closest("button")) {
        return;
      }
      
      // 先高亮当前卡片
      this.highlightAnnotationCard(annotation.annotation_id);
      
      // 再触发点击回调
      await this.onAnnotationClick(annotation);
    });
  }

  /**
   * 高亮指定批注卡片
   */
  highlightAnnotationCard(annotationId: string): void {
    // 移除所有卡片的高亮
    this.containerEl
      .querySelectorAll(".marginalia-annotation-card.active")
      .forEach((el) => el.classList.remove("active"));
    
    // 高亮目标卡片
    const card = this.containerEl.querySelector(
      `.marginalia-annotation-card[data-annotation-id="${annotationId}"]`
    );
    if (card) {
      card.classList.add("active");
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}
