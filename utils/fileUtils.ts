/**
 * File utilities for managing annotation files
 */
import { TFile, TFolder, Vault, normalizePath } from "obsidian";
import { Annotation, parseAnnotations, serializeAnnotations } from "../models/Annotation";

/**
 * Get the annotation file path for a given source file
 * Format: {annotationFolder}/{sourceFileName}-annotation.md
 */
export function getAnnotationFilePath(sourceFile: TFile, annotationFolder: string): string {
  const baseName = sourceFile.basename;
  return normalizePath(`${annotationFolder}/${baseName}-annotation.md`);
}

/**
 * Ensure the annotation folder exists
 */
export async function ensureAnnotationFolder(vault: Vault, folderPath: string): Promise<TFolder> {
  const normalizedPath = normalizePath(folderPath);
  
  const existingFolder = vault.getAbstractFileByPath(normalizedPath);
  if (existingFolder instanceof TFolder) {
    return existingFolder;
  }
  
  await vault.createFolder(normalizedPath);
  const createdFolder = vault.getAbstractFileByPath(normalizedPath);
  if (createdFolder instanceof TFolder) {
    return createdFolder;
  }
  
  throw new Error(`Failed to create annotation folder: ${normalizedPath}`);
}

/**
 * Load annotations from the annotation file for a source file
 */
export async function loadAnnotations(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string
): Promise<Annotation[]> {
  const annotationPath = getAnnotationFilePath(sourceFile, annotationFolder);
  const file = vault.getAbstractFileByPath(annotationPath);
  
  if (!(file instanceof TFile)) {
    return [];
  }
  
  try {
    const content = await vault.read(file);
    return parseAnnotations(content);
  } catch (error) {
    console.error("Failed to load annotations:", error);
    return [];
  }
}

/**
 * Save annotations to the annotation file for a source file
 * Automatically deletes the file if no annotations remain
 */
export async function saveAnnotations(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string,
  annotations: Annotation[]
): Promise<void> {
  const annotationPath = getAnnotationFilePath(sourceFile, annotationFolder);
  
  if (annotations.length === 0) {
    // Delete the annotation file if no annotations
    const existingFile = vault.getAbstractFileByPath(annotationPath);
    if (existingFile instanceof TFile) {
      await vault.delete(existingFile);
    }
    return;
  }
  
  // Ensure folder exists
  await ensureAnnotationFolder(vault, annotationFolder);
  
  const content = serializeAnnotations(annotations);
  const existingFile = vault.getAbstractFileByPath(annotationPath);
  
  if (existingFile instanceof TFile) {
    await vault.modify(existingFile, content);
  } else {
    await vault.create(annotationPath, content);
  }
}

/**
 * Add a single annotation to the annotation file
 */
export async function addAnnotation(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string,
  annotation: Annotation
): Promise<void> {
  const annotations = await loadAnnotations(vault, sourceFile, annotationFolder);
  annotations.push(annotation);
  await saveAnnotations(vault, sourceFile, annotationFolder, annotations);
}

/**
 * Update a single annotation in the annotation file
 */
export async function updateAnnotation(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string,
  annotation: Annotation
): Promise<void> {
  const annotations = await loadAnnotations(vault, sourceFile, annotationFolder);
  const index = annotations.findIndex((a) => a.annotation_id === annotation.annotation_id);
  
  if (index !== -1) {
    annotations[index] = annotation;
    await saveAnnotations(vault, sourceFile, annotationFolder, annotations);
  }
}

/**
 * Delete a single annotation from the annotation file
 */
export async function deleteAnnotation(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string,
  annotationId: string
): Promise<void> {
  const annotations = await loadAnnotations(vault, sourceFile, annotationFolder);
  const filtered = annotations.filter((a) => a.annotation_id !== annotationId);
  await saveAnnotations(vault, sourceFile, annotationFolder, filtered);
}

/**
 * Get the annotation file for a source file
 */
export function getAnnotationFile(
  vault: Vault,
  sourceFile: TFile,
  annotationFolder: string
): TFile | null {
  const annotationPath = getAnnotationFilePath(sourceFile, annotationFolder);
  const file = vault.getAbstractFileByPath(annotationPath);
  return file instanceof TFile ? file : null;
}
