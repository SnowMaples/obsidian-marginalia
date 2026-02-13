/**
 * Annotation data model
 * Represents a single annotation with metadata and content
 */
export interface Annotation {
  annotation_id: string;
  selected_text: string;
  position: AnnotationPosition;
  created: string;
  updated: string;
  content: string;
}

/**
 * Position information for precise location in the document
 */
export interface AnnotationPosition {
  file_path: string;
  offset: number;
  line_number: number;
  block_id?: string;
  paragraph_index?: number;
}

/**
 * Create a new annotation with current timestamp
 */
export function createAnnotation(
  selectedText: string,
  position: AnnotationPosition,
  content: string = ""
): Annotation {
  const now = new Date().toISOString();
  return {
    annotation_id: generateId(),
    selected_text: selectedText,
    position,
    created: now,
    updated: now,
    content,
  };
}

/**
 * Update an existing annotation's content and timestamp
 */
export function updateAnnotation(annotation: Annotation, content: string): Annotation {
  return {
    ...annotation,
    content,
    updated: new Date().toISOString(),
  };
}

/**
 * Generate a unique ID for annotations
 */
function generateId(): string {
  return `anno_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse annotation content from markdown file text
 * Supports both YAML frontmatter and separator formats
 */
export function parseAnnotations(content: string): Annotation[] {
  const annotations: Annotation[] = [];
  
  // Try YAML frontmatter format first
  const yamlRegex = /---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*?)(?=\n---|$)/g;
  let match;
  while ((match = yamlRegex.exec(content)) !== null) {
    try {
      const yamlContent = match[1];
      const markdownContent = match[2].trim();
      
      const annotation = parseYamlFrontmatter(yamlContent, markdownContent);
      if (annotation) {
        annotations.push(annotation);
      }
    } catch (e) {
      console.error("Failed to parse annotation:", e);
    }
  }
  
  // If no YAML annotations found, try separator format
  if (annotations.length === 0) {
    const separatorRegex = /<!-- ANNOTATION_START ([\s\S]*?) -->\s*\n([\s\S]*?)(?=\n<!-- ANNOTATION_END|$)/g;
    while ((match = separatorRegex.exec(content)) !== null) {
      try {
        const metadata = JSON.parse(match[1]);
        const markdownContent = match[2].trim();
        
        annotations.push({
          annotation_id: metadata.annotation_id,
          selected_text: metadata.selected_text,
          position: metadata.position,
          created: metadata.created,
          updated: metadata.updated,
          content: markdownContent,
        });
      } catch (e) {
        console.error("Failed to parse annotation with separator:", e);
      }
    }
  }
  
  return annotations;
}

/**
 * Parse YAML frontmatter to annotation object
 */
function parseYamlFrontmatter(yaml: string, content: string): Annotation | null {
  const lines = yaml.split("\n");
  const metadata: Record<string, any> = {};
  
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      
      if (key === "position") {
        try {
          metadata[key] = JSON.parse(value);
        } catch {
          metadata[key] = {};
        }
      } else {
        metadata[key] = value;
      }
    }
  }
  
  if (!metadata.annotation_id) return null;
  
  return {
    annotation_id: metadata.annotation_id,
    selected_text: metadata.selected_text || "",
    position: metadata.position || {},
    created: metadata.created || new Date().toISOString(),
    updated: metadata.updated || new Date().toISOString(),
    content: content,
  };
}

/**
 * Serialize annotations to markdown content
 * Uses YAML frontmatter format for each annotation
 */
export function serializeAnnotations(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";
  
  return annotations
    .map((anno) => {
      return `---
annotation_id: ${anno.annotation_id}
selected_text: ${escapeYaml(anno.selected_text)}
position: ${JSON.stringify(anno.position)}
created: ${anno.created}
updated: ${anno.updated}
---

${anno.content}
`;
    })
    .join("\n---\n\n");
}

/**
 * Escape special characters in YAML strings
 */
function escapeYaml(str: string): string {
  if (str.includes(":") || str.includes("#") || str.includes("\n") || str.includes("\"")) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}

/**
 * Find annotation by ID
 */
export function findAnnotationById(annotations: Annotation[], id: string): Annotation | undefined {
  return annotations.find((a) => a.annotation_id === id);
}

/**
 * Remove annotation by ID
 */
export function removeAnnotationById(annotations: Annotation[], id: string): Annotation[] {
  return annotations.filter((a) => a.annotation_id !== id);
}
