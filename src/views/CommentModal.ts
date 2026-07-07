import {Modal, Platform, type App} from 'obsidian';
import {t} from '../i18n';

export class CommentModal extends Modal {
	private onSave: (body: string) => void;
	private initialBody: string;
	private modalTitle: string | undefined;
	private textareaEl!: HTMLTextAreaElement;
	private isMobileLayout = false;
	private visualViewport: VisualViewport | null = null;
	private readonly viewportHandler: () => void;

	constructor(app: App, onSave: (body: string) => void, existingBody?: string, title?: string) {
		super(app);
		this.onSave = onSave;
		this.initialBody = existingBody ?? '';
		this.modalTitle = title;
		this.viewportHandler = () => {
			this.updateMobileViewportLayout();
		};
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('marginalia-modal');
		this.modalEl.addClass('marginalia-comment-modal');

		this.isMobileLayout = Platform.isMobile;
		this.modalEl.toggleClass('marginalia-comment-modal-mobile', this.isMobileLayout);

		const layoutEl = contentEl.createDiv({cls: 'marginalia-modal-layout'});
		layoutEl.createEl('h3', {
			text: this.modalTitle ?? (this.initialBody ? t('modalEditComment') : t('modalAddComment')),
			cls: 'marginalia-modal-title',
		});

		const bodyEl = layoutEl.createDiv({cls: 'marginalia-modal-body'});
		this.textareaEl = bodyEl.createEl('textarea', {
			cls: 'marginalia-modal-textarea',
			attr: {placeholder: t('modalPlaceholder')},
		});
		this.textareaEl.value = this.initialBody;
		this.textareaEl.addEventListener('focus', () => {
			if (this.isMobileLayout) {
				this.updateMobileViewportLayout();
				requestAnimationFrame(() => {
					this.textareaEl.scrollIntoView({block: 'nearest'});
				});
			}
		});

		const hintEl = bodyEl.createDiv({cls: 'marginalia-modal-hint'});
		hintEl.textContent = t('modalHint');

		const footerEl = layoutEl.createDiv({cls: 'marginalia-modal-footer'});
		const buttonRow = footerEl.createDiv({cls: 'marginalia-modal-buttons'});

		const cancelBtn = buttonRow.createEl('button', {text: t('modalCancel')});
		cancelBtn.addEventListener('click', () => this.close());

		const saveBtn = buttonRow.createEl('button', {
			text: t('modalSave'),
			cls: 'mod-cta',
		});
		saveBtn.addEventListener('click', () => this.save());

		this.scope.register(['Mod'], 'Enter', () => {
			this.save();
			return false;
		});

		if (this.isMobileLayout) {
			this.bindMobileViewportHandlers();
		}

		setTimeout(() => {
			this.textareaEl.focus();
			if (this.isMobileLayout) {
				this.updateMobileViewportLayout();
				this.textareaEl.scrollIntoView({block: 'nearest'});
			}
		}, 50);
	}

	onClose(): void {
		this.teardownMobileViewportHandlers();
		this.modalEl.style.removeProperty('--marginalia-mobile-editor-keyboard-offset');
		this.modalEl.style.removeProperty('--marginalia-mobile-editor-max-height');
		this.modalEl.removeClass('marginalia-comment-modal-mobile');
		this.contentEl.empty();
	}

	private bindMobileViewportHandlers(): void {
		this.visualViewport = window.visualViewport;
		if (this.visualViewport) {
			this.visualViewport.addEventListener('resize', this.viewportHandler);
			this.visualViewport.addEventListener('scroll', this.viewportHandler);
		} else {
			window.addEventListener('resize', this.viewportHandler, {passive: true});
		}
		this.updateMobileViewportLayout();
	}

	private teardownMobileViewportHandlers(): void {
		if (this.visualViewport) {
			this.visualViewport.removeEventListener('resize', this.viewportHandler);
			this.visualViewport.removeEventListener('scroll', this.viewportHandler);
			this.visualViewport = null;
		} else {
			window.removeEventListener('resize', this.viewportHandler);
		}
	}

	private updateMobileViewportLayout(): void {
		if (!this.isMobileLayout) return;

		const viewport = this.visualViewport;
		let viewportHeight = window.innerHeight;
		let keyboardOffset = 0;

		if (viewport) {
			viewportHeight = Math.round(viewport.height);
			keyboardOffset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
		}

		const maxHeight = Math.max(280, viewportHeight - 24);
		this.modalEl.style.setProperty('--marginalia-mobile-editor-keyboard-offset', `${keyboardOffset}px`);
		this.modalEl.style.setProperty('--marginalia-mobile-editor-max-height', `${maxHeight}px`);
	}

	private save(): void {
		const body = this.textareaEl.value.trim();
		if (body) {
			this.onSave(body);
		}
		this.close();
	}
}
