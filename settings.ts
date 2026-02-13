/**
 * Plugin settings interface and default values
 */
export interface MarginaliaSettings {
  /** Folder path for storing annotation files */
  annotationFolder: string;
  /** Auto show sidebar when opening annotated files */
  autoShowSidebar: boolean;
  /** Highlight color (CSS color value) */
  highlightColor: string;
  /** Enable mobile features */
  mobileEnabled: boolean;
}

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: MarginaliaSettings = {
  annotationFolder: "_annotations",
  autoShowSidebar: true,
  highlightColor: "rgba(255, 255, 0, 0.3)",
  mobileEnabled: true,
};
