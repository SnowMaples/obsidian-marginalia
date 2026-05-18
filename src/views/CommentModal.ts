import {Modal, type App} from 'obsidian';
import {t} from '../i18n';

export class CommentModal extends Modal {
	private onSave: (body: string) => void;
	private initialBody: string;
	private modalTitle: string | undefined;
	private textareaEl: HTMLTextAreaElement;

	constructor(app: App, onSave: (body: string) => void, existingBody?: string, title?: string) {
		super(app);
		this.onSave = onSave;
		this.initialBody = existingBody ?? '';
		this.modalTitle = title;
	}

	onOpen(): void {
		const {contentEl} = this;
		contentEl.addClass('marginalia-modal');

		contentEl.createEl('h3', {
			text: this.modalTitle ?? (this.initialBody ? t.modal.editComment : t.modal.addComment),
		});

		this.textareaEl = contentEl.createEl('textarea', {
			cls: 'marginalia-modal-textarea',
			attr: {placeholder: t.modal.placeholder},
		});
		this.textareaEl.value = this.initialBody;

		const buttonRow = contentEl.createDiv({cls: 'marginalia-modal-buttons'});

		const saveBtn = buttonRow.createEl('button', {
			text: t.modal.save,
			cls: 'mod-cta',
		});
		saveBtn.addEventListener('click', () => this.save());

		const cancelBtn = buttonRow.createEl('button', {text: t.modal.cancel});
		cancelBtn.addEventListener('click', () => this.close());

		const hintEl = contentEl.createDiv({cls: 'marginalia-modal-hint'});
		hintEl.textContent = t.modal.hint;

		// Mod+Enter to save
		this.scope.register(['Mod'], 'Enter', () => {
			this.save();
			return false;
		});

		// Focus textarea after modal opens
		setTimeout(() => this.textareaEl.focus(), 50);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private save(): void {
		const body = this.textareaEl.value.trim();
		if (body) {
			this.onSave(body);
		}
		this.close();
	}
}
