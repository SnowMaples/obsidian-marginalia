import {Modal, Platform, type App} from 'obsidian';
import {t} from '../i18n';

const DESKTOP_MODAL_VIEWPORT_MARGIN = 8;

interface ModalDragOffset {
	x: number;
	y: number;
}

interface ModalDragRect {
	bottom: number;
	height: number;
	left: number;
	right: number;
	top: number;
	width: number;
}

interface ModalDragViewport {
	height: number;
	margin?: number;
	width: number;
}

export function computeDraggableModalOffset(input: {
	modalRect: ModalDragRect;
	pointerDelta: ModalDragOffset;
	startOffset: ModalDragOffset;
	viewport: ModalDragViewport;
}): ModalDragOffset {
	const margin = input.viewport.margin ?? DESKTOP_MODAL_VIEWPORT_MARGIN;
	const targetLeft = input.modalRect.left + input.pointerDelta.x;
	const targetTop = input.modalRect.top + input.pointerDelta.y;
	const clampedLeft = clampModalPosition(targetLeft, input.modalRect.width, input.viewport.width, margin);
	const clampedTop = clampModalPosition(targetTop, input.modalRect.height, input.viewport.height, margin);

	return {
		x: input.startOffset.x + clampedLeft - input.modalRect.left,
		y: input.startOffset.y + clampedTop - input.modalRect.top,
	};
}

export function clampDraggableModalOffset(input: {
	currentOffset: ModalDragOffset;
	modalRect: ModalDragRect;
	viewport: ModalDragViewport;
}): ModalDragOffset {
	const margin = input.viewport.margin ?? DESKTOP_MODAL_VIEWPORT_MARGIN;
	const clampedLeft = clampModalPosition(input.modalRect.left, input.modalRect.width, input.viewport.width, margin);
	const clampedTop = clampModalPosition(input.modalRect.top, input.modalRect.height, input.viewport.height, margin);

	return {
		x: input.currentOffset.x + clampedLeft - input.modalRect.left,
		y: input.currentOffset.y + clampedTop - input.modalRect.top,
	};
}

function clampModalPosition(position: number, size: number, viewportSize: number, margin: number): number {
	const maxPosition = Math.max(margin, viewportSize - size - margin);
	return Math.min(Math.max(position, margin), maxPosition);
}

export class CommentModal extends Modal {
	private onSave: (body: string) => void;
	private initialBody: string;
	private modalTitle: string | undefined;
	private textareaEl!: HTMLTextAreaElement;
	private isMobileLayout = false;
	private visualViewport: VisualViewport | null = null;
	private readonly viewportHandler: () => void;
	private desktopDragHandleEl: HTMLElement | null = null;
	private desktopDragOffset: ModalDragOffset = {x: 0, y: 0};
	private desktopDragState: {
		pointerId: number;
		startPointerX: number;
		startPointerY: number;
		startOffset: ModalDragOffset;
		startRect: ModalDragRect;
	} | null = null;
	private readonly desktopDragStartHandler = (evt: PointerEvent): void => {
		this.startDesktopDrag(evt);
	};
	private readonly desktopDragMoveHandler = (evt: PointerEvent): void => {
		this.moveDesktopDrag(evt);
	};
	private readonly desktopDragEndHandler = (evt: PointerEvent): void => {
		this.endDesktopDrag(evt);
	};
	private readonly desktopResizeHandler = (): void => {
		this.clampDesktopModalToViewport();
	};

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
		const titleEl = layoutEl.createEl('h3', {
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
		} else {
			this.bindDesktopDragHandlers(titleEl);
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
		this.teardownDesktopDragHandlers();
		this.teardownMobileViewportHandlers();
		this.modalEl.style.removeProperty('--marginalia-mobile-editor-keyboard-offset');
		this.modalEl.style.removeProperty('--marginalia-mobile-editor-max-height');
		this.modalEl.style.removeProperty('translate');
		this.modalEl.removeClass('marginalia-comment-modal-mobile');
		this.modalEl.removeClass('is-dragging');
		this.contentEl.empty();
	}

	private bindDesktopDragHandlers(handleEl: HTMLElement): void {
		this.desktopDragHandleEl = handleEl;
		handleEl.addClass('marginalia-modal-drag-handle');
		handleEl.addEventListener('pointerdown', this.desktopDragStartHandler);
		window.addEventListener('resize', this.desktopResizeHandler, {passive: true});
	}

	private teardownDesktopDragHandlers(): void {
		if (this.desktopDragHandleEl) {
			this.desktopDragHandleEl.removeEventListener('pointerdown', this.desktopDragStartHandler);
			this.desktopDragHandleEl.removeClass('marginalia-modal-drag-handle');
			this.desktopDragHandleEl = null;
		}
		window.removeEventListener('pointermove', this.desktopDragMoveHandler);
		window.removeEventListener('pointerup', this.desktopDragEndHandler);
		window.removeEventListener('pointercancel', this.desktopDragEndHandler);
		window.removeEventListener('resize', this.desktopResizeHandler);
		this.desktopDragState = null;
		this.desktopDragOffset = {x: 0, y: 0};
	}

	private startDesktopDrag(evt: PointerEvent): void {
		if (this.isMobileLayout || evt.button !== 0) return;

		evt.preventDefault();
		this.desktopDragState = {
			pointerId: evt.pointerId,
			startPointerX: evt.clientX,
			startPointerY: evt.clientY,
			startOffset: {...this.desktopDragOffset},
			startRect: this.getModalDragRect(),
		};
		this.modalEl.addClass('is-dragging');
		this.desktopDragHandleEl?.setPointerCapture(evt.pointerId);
		window.addEventListener('pointermove', this.desktopDragMoveHandler);
		window.addEventListener('pointerup', this.desktopDragEndHandler);
		window.addEventListener('pointercancel', this.desktopDragEndHandler);
	}

	private moveDesktopDrag(evt: PointerEvent): void {
		if (!this.desktopDragState || evt.pointerId !== this.desktopDragState.pointerId) return;

		evt.preventDefault();
		this.desktopDragOffset = computeDraggableModalOffset({
			modalRect: this.desktopDragState.startRect,
			pointerDelta: {
				x: evt.clientX - this.desktopDragState.startPointerX,
				y: evt.clientY - this.desktopDragState.startPointerY,
			},
			startOffset: this.desktopDragState.startOffset,
			viewport: this.getViewportSize(),
		});
		this.applyDesktopModalOffset();
	}

	private endDesktopDrag(evt: PointerEvent): void {
		if (!this.desktopDragState || evt.pointerId !== this.desktopDragState.pointerId) return;

		if (this.desktopDragHandleEl?.hasPointerCapture(evt.pointerId)) {
			this.desktopDragHandleEl.releasePointerCapture(evt.pointerId);
		}
		this.desktopDragState = null;
		this.modalEl.removeClass('is-dragging');
		window.removeEventListener('pointermove', this.desktopDragMoveHandler);
		window.removeEventListener('pointerup', this.desktopDragEndHandler);
		window.removeEventListener('pointercancel', this.desktopDragEndHandler);
	}

	private clampDesktopModalToViewport(): void {
		if (this.isMobileLayout) return;

		this.desktopDragOffset = clampDraggableModalOffset({
			currentOffset: this.desktopDragOffset,
			modalRect: this.getModalDragRect(),
			viewport: this.getViewportSize(),
		});
		this.applyDesktopModalOffset();
	}

	private applyDesktopModalOffset(): void {
		this.modalEl.style.setProperty('translate', `${Math.round(this.desktopDragOffset.x)}px ${Math.round(this.desktopDragOffset.y)}px`);
	}

	private getModalDragRect(): ModalDragRect {
		const rect = this.modalEl.getBoundingClientRect();
		return {
			bottom: rect.bottom,
			height: rect.height,
			left: rect.left,
			right: rect.right,
			top: rect.top,
			width: rect.width,
		};
	}

	private getViewportSize(): ModalDragViewport {
		return {
			height: window.innerHeight,
			width: window.innerWidth,
		};
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
