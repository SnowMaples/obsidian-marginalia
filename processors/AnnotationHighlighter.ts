/**
 * AnnotationHighlighter - Markdown Post Processor
 * Injects highlight spans into the document for all annotations
 * Uses MutationObserver for stable highlighting
 */
import { Annotation } from "../models/Annotation";

export const MARGINALIA_HIGHLIGHT_CLASS = "marginalia-highlight";
export const MARGINALIA_HIGHLIGHT_ACTIVE_CLASS = "marginalia-highlight-active";

/**
 * Process the markdown preview element and inject highlights
 */
export function processHighlights(
  element: HTMLElement,
  annotations: Annotation[],
  highlightColor: string
): void {
  if (annotations.length === 0) return;
  
  // Process each annotation
  for (const annotation of annotations) {
    try {
      highlightText(element, annotation, highlightColor);
    } catch (error) {
      console.error(`[Marginalia] Failed to highlight annotation ${annotation.annotation_id}:`, error);
    }
  }
}

/**
 * Highlight the annotated text in the element
 * Uses a text walker to find and wrap the target text
 */
function highlightText(
  container: HTMLElement,
  annotation: Annotation,
  highlightColor: string
): void {
  const targetText = annotation.selected_text;
  if (!targetText || targetText.trim().length === 0) return;
  
  // 检查是否已存在该高亮
  const existingHighlight = getHighlightElement(container, annotation.annotation_id);
  if (existingHighlight) return;
  
  // Use TreeWalker to find text nodes - 不使用 filter 回调，手动过滤
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  const nodesToHighlight: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const textNode = node as Text;
    // Skip nodes that are already inside highlights or code blocks
    const parent = textNode.parentElement;
    if (
      parent?.classList?.contains(MARGINALIA_HIGHLIGHT_CLASS) ||
      parent?.closest("code, pre, .code-block")
    ) {
      continue;
    }
    // Only accept nodes that contain the target text
    if (textNode.textContent?.includes(targetText)) {
      nodesToHighlight.push(textNode);
    }
  }
  
  // Process found nodes
  for (const textNode of nodesToHighlight) {
    const text = textNode.textContent || "";
    const index = text.indexOf(targetText);
    
    if (index !== -1) {
      wrapTextWithHighlight(textNode, index, targetText.length, annotation, highlightColor);
      // Only highlight the first occurrence to avoid duplicates
      break;
    }
  }
}

/**
 * Wrap the target text with a highlight span
 */
function wrapTextWithHighlight(
  textNode: Text,
  startIndex: number,
  length: number,
  annotation: Annotation,
  highlightColor: string
): void {
  const parent = textNode.parentNode;
  if (!parent) return;
  
  const text = textNode.textContent || "";
  const beforeText = text.substring(0, startIndex);
  const highlightedText = text.substring(startIndex, startIndex + length);
  const afterText = text.substring(startIndex + length);
  
  // Create highlight span
  const highlightSpan = document.createElement("span");
  highlightSpan.className = MARGINALIA_HIGHLIGHT_CLASS;
  highlightSpan.dataset.annotationId = annotation.annotation_id;
  highlightSpan.style.backgroundColor = highlightColor;
  highlightSpan.textContent = highlightedText;
  
  // Insert nodes
  if (beforeText) {
    parent.insertBefore(document.createTextNode(beforeText), textNode);
  }
  parent.insertBefore(highlightSpan, textNode);
  if (afterText) {
    parent.insertBefore(document.createTextNode(afterText), textNode);
  }
  
  // Remove original text node
  parent.removeChild(textNode);
  
  console.log(`[Marginalia] Highlighted text: "${highlightedText.substring(0, 30)}..."`);
}

/**
 * Remove highlight from the document
 */
export function removeHighlight(element: HTMLElement, annotationId: string): void {
  const highlights = element.querySelectorAll(
    `[data-annotation-id="${annotationId}"].${MARGINALIA_HIGHLIGHT_CLASS}`
  );
  
  for (const highlight of Array.from(highlights)) {
    const parent = highlight.parentNode;
    if (!parent) continue;
    
    // Move all child nodes (text) before the highlight
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    
    // Remove the highlight span
    parent.removeChild(highlight);
    
    // Normalize to merge adjacent text nodes
    parent.normalize();
  }
}

/**
 * Update highlight color for all highlights
 */
export function updateHighlightColor(element: HTMLElement, color: string): void {
  const highlights = element.querySelectorAll(`.${MARGINALIA_HIGHLIGHT_CLASS}`);
  for (const highlight of Array.from(highlights)) {
    (highlight as HTMLElement).style.backgroundColor = color;
  }
}

/**
 * Get the highlight element for an annotation
 */
export function getHighlightElement(
  container: HTMLElement,
  annotationId: string
): HTMLElement | null {
  return container.querySelector(
    `[data-annotation-id="${annotationId}"].${MARGINALIA_HIGHLIGHT_CLASS}`
  ) as HTMLElement | null;
}

/**
 * Activate a highlight (add active class and scroll into view)
 */
export function activateHighlight(container: HTMLElement, annotationId: string): void {
  console.log(`[Marginalia] Activating highlight: ${annotationId}`);
  
  // Deactivate all other highlights first
  container
    .querySelectorAll(`.${MARGINALIA_HIGHLIGHT_ACTIVE_CLASS}`)
    .forEach((el) => el.classList.remove(MARGINALIA_HIGHLIGHT_ACTIVE_CLASS));
  
  // Activate target highlight
  const highlight = getHighlightElement(container, annotationId);
  if (highlight) {
    highlight.classList.add(MARGINALIA_HIGHLIGHT_ACTIVE_CLASS);
    highlight.scrollIntoView({ behavior: "smooth", block: "center" });
    console.log(`[Marginalia] Highlight activated and scrolled into view`);
  } else {
    console.warn(`[Marginalia] Highlight element not found for: ${annotationId}`);
  }
}

/**
 * Deactivate all highlights
 */
export function deactivateAllHighlights(container: HTMLElement): void {
  container
    .querySelectorAll(`.${MARGINALIA_HIGHLIGHT_ACTIVE_CLASS}`)
    .forEach((el) => el.classList.remove(MARGINALIA_HIGHLIGHT_ACTIVE_CLASS));
}

/**
 * 立即注入单个高亮到元素中
 * 关键修复：添加批注后立即高亮，不依赖重新渲染
 */
export function injectHighlightIntoElement(
  container: HTMLElement,
  annotation: Annotation,
  highlightColor: string
): void {
  console.log(`[Marginalia] Injecting highlight for: ${annotation.annotation_id}`);
  console.log(`[Marginalia] Target text: "${annotation.selected_text}"`);
  console.log(`[Marginalia] Container className:`, container.className);
  console.log(`[Marginalia] Container innerHTML (first 200 chars):`, container.innerHTML?.substring(0, 200));
  
  // 检查是否已存在该高亮
  const existingHighlight = getHighlightElement(container, annotation.annotation_id);
  if (existingHighlight) {
    console.log(`[Marginalia] Highlight already exists, skipping`);
    return;
  }

  let targetText = annotation.selected_text;
  if (!targetText || targetText.trim().length === 0) {
    console.warn(`[Marginalia] Empty target text, skipping`);
    return;
  }

  // 使用 TreeWalker 查找文本节点 - 不使用 filter 回调
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );

  // 收集所有文本节点用于调试
  const allTextNodes: Text[] = [];
  const nodesToHighlight: Text[] = [];
  let node: Node | null;
  
  while ((node = walker.nextNode()) !== null) {
    const textNode = node as Text;
    allTextNodes.push(textNode);
    
    // 跳过已在高亮内或代码块中的节点
    const parent = textNode.parentElement;
    if (
      parent?.classList?.contains(MARGINALIA_HIGHLIGHT_CLASS) ||
      parent?.closest("code, pre, .code-block")
    ) {
      continue;
    }
    
    // 检查文本内容（去除空白后比较）
    const nodeText = textNode.textContent || "";
    if (nodeText.includes(targetText)) {
      nodesToHighlight.push(textNode);
    }
  }

  console.log(`[Marginalia] Total text nodes: ${allTextNodes.length}`);
  console.log(`[Marginalia] Matching text nodes: ${nodesToHighlight.length}`);
  
  // 打印所有文本节点内容（用于调试）
  if (nodesToHighlight.length === 0) {
    console.log(`[Marginalia] All text node contents:`);
    allTextNodes.forEach((n, i) => {
      const text = n.textContent?.trim();
      if (text) {
        console.log(`  [${i}] "${text.substring(0, 50)}"`);
      }
    });
  }

  // 处理找到的节点
  let injected = false;
  for (const textNode of nodesToHighlight) {
    const text = textNode.textContent || "";
    const index = text.indexOf(targetText);

    if (index !== -1) {
      wrapTextWithHighlight(textNode, index, targetText.length, annotation, highlightColor);
      injected = true;
      console.log(`[Marginalia] Successfully injected highlight at index ${index}`);
      break;
    }
  }
  
  if (!injected) {
    console.warn(`[Marginalia] Failed to inject highlight - text not found in container`);
    
    // 尝试模糊匹配（去除空白字符）
    const normalizedTarget = targetText.replace(/\s+/g, '');
    if (normalizedTarget.length > 0) {
      console.log(`[Marginalia] Trying normalized match...`);
      walker.currentNode = container;
      let retryNode: Node | null;
      while ((retryNode = walker.nextNode()) !== null) {
        const textNode = retryNode as Text;
        const nodeText = (textNode.textContent || "").replace(/\s+/g, '');
        if (nodeText.includes(normalizedTarget)) {
          console.log(`[Marginalia] Found normalized match!`);
          // 找到原始文本位置
          const originalText = textNode.textContent || "";
          const originalIndex = originalText.indexOf(targetText.trim());
          if (originalIndex >= 0) {
            wrapTextWithHighlight(textNode, originalIndex, targetText.length, annotation, highlightColor);
            injected = true;
            break;
          }
        }
      }
    }
  }
}
