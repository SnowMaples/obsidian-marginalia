/**
 * Location utilities for precise text positioning and navigation
 */
import { AnnotationPosition } from "../models/Annotation";

/**
 * Get the position information from an editor selection
 */
export function getPositionFromSelection(
  filePath: string,
  editor: any
): AnnotationPosition | null {
  const cursor = editor.getCursor("from");
  const offset = editor.posToOffset(cursor);
  const lineNumber = cursor.line;
  
  return {
    file_path: filePath,
    offset,
    line_number: lineNumber,
  };
}

/**
 * Get position from a DOM selection in the preview mode
 */
export function getPositionFromDOMSelection(
  filePath: string,
  selection: Selection
): AnnotationPosition | null {
  if (!selection.rangeCount) return null;
  
  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  
  // Try to find line number from DOM
  let lineNumber = 0;
  let element: Element | null = container.nodeType === Node.TEXT_NODE 
    ? container.parentElement 
    : container as Element;
  
  // Look for data-line attribute or similar indicators
  while (element) {
    const lineAttr = element.getAttribute("data-line");
    if (lineAttr) {
      lineNumber = parseInt(lineAttr, 10);
      break;
    }
    element = element.parentElement;
  }
  
  // Calculate approximate offset
  let offset = 0;
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT
  );
  
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node === container || node.contains(container)) {
      offset += range.startOffset;
      break;
    }
    offset += node.textContent?.length || 0;
  }
  
  return {
    file_path: filePath,
    offset,
    line_number: lineNumber,
  };
}

/**
 * Scroll to and highlight the annotated text in the document
 */
export function scrollToAnnotation(
  annotationId: string,
  container: HTMLElement
): boolean {
  const element = container.querySelector(`[data-annotation-id="${annotationId}"]`);
  if (!element) return false;
  
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("marginalia-highlight-active");
  
  // Remove active class after animation
  setTimeout(() => {
    element.classList.remove("marginalia-highlight-active");
  }, 2000);
  
  return true;
}

/**
 * Create an Obsidian URL for opening a file at a specific position
 */
export function createObsidianUrl(filePath: string, line?: number): string {
  const encodedPath = encodeURIComponent(filePath);
  if (line !== undefined && line > 0) {
    return `obsidian://open?file=${encodedPath}&line=${line}`;
  }
  return `obsidian://open?file=${encodedPath}`;
}

/**
 * Find the text element containing the annotated text
 */
export function findAnnotatedText(
  text: string,
  container: HTMLElement
): HTMLElement | null {
  // Try to find by exact text match
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT
  );
  
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node.textContent?.includes(text)) {
      return node.parentElement;
    }
  }
  
  return null;
}

/**
 * Get the paragraph index for fallback positioning
 */
export function getParagraphIndex(element: HTMLElement, container: HTMLElement): number {
  const paragraphs = container.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, blockquote");
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].contains(element)) {
      return i;
    }
  }
  return -1;
}

/**
 * Check if an element is visible in the viewport
 */
export function isElementInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
