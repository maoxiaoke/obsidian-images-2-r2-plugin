import {ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf, requestUrl, setIcon, setTooltip} from 'obsidian';
import ImagesR2Plugin from './main';

export const VIEW_TYPE_R2 = 'r2-uploader';

type ItemStatus = 'idle' | 'uploading' | 'done' | 'failed';

interface ImageItem {
	fullMatch: string;   // ![[image.png]]
	imagePath: string;   // image.png
	fileName: string;    // resolved filename
	file: TFile | null;
	status: ItemStatus;
	line: number;        // 0-based line number in the source file
	error?: string;
}

interface RemoteImageItem {
	fullMatch: string;   // ![alt](url)
	altText: string;
	url: string;
	fileName: string;    // derived from URL
	isR2: boolean;       // hosted on the configured R2 bucket
	status: ItemStatus;
	line: number;
	error?: string;
}

export class R2UploaderView extends ItemView {
	plugin: ImagesR2Plugin;
	private items: ImageItem[] = [];
	private remoteItems: RemoteImageItem[] = [];
	private currentFilePath: string | null = null;
	private refreshTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ImagesR2Plugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() { return VIEW_TYPE_R2; }
	getDisplayText() { return 'Images → R2'; }
	getIcon() { return 'aperture'; }

	async onOpen() {
		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				this.refreshForFile(file);
			})
		);
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				if (this.items.some(i => i.status === 'uploading') ||
					this.remoteItems.some(i => i.status === 'uploading')) return;
				if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
				this.refreshTimer = window.setTimeout(() => this.refreshFromEditor(), 800);
			})
		);
		await this.refresh();
	}

	async onClose() {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.contentEl.empty();
	}

	async refresh() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (markdownView?.file) {
			const content = markdownView.editor.getValue();
			this.buildItems(markdownView.file, content);
			this.render(markdownView.file);
			return;
		}
		await this.refreshCurrentFile();
	}

	private async refreshCurrentFile() {
		if (!this.currentFilePath) {
			this.render(null);
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(this.currentFilePath);
		if (!(file instanceof TFile)) {
			this.currentFilePath = null;
			this.render(null);
			return;
		}
		const content = await this.app.vault.cachedRead(file);
		this.buildItems(file, content);
		this.render(file);
	}

	private refreshFromEditor() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.file) return;
		const content = markdownView.editor.getValue();
		this.buildItems(markdownView.file, content);
		this.render(markdownView.file);
	}

	private async refreshForFile(file: TFile | null) {
		if (!file || file.extension !== 'md') {
			this.currentFilePath = null;
			this.items = [];
			this.remoteItems = [];
			this.render(null);
			return;
		}
		const content = await this.app.vault.cachedRead(file);
		this.buildItems(file, content);
		this.render(file);
	}

	private buildItems(file: TFile, content: string) {
		const fileChanged = file.path !== this.currentFilePath;
		this.currentFilePath = file.path;

		// ── Local images: ![[image.ext]] ────────────────────
		const localRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|tiff|tif))\]\]/gi;
		const seenLocal = new Set<string>();
		const localMatches = [...content.matchAll(localRegex)].filter(m => {
			if (seenLocal.has(m[0])) return false;
			seenLocal.add(m[0]);
			return true;
		});

		const existingLocalMap = fileChanged
			? new Map<string, ImageItem>()
			: new Map(this.items.map(i => [i.fullMatch, i]));

		this.items = localMatches.map(m => {
			const line = content.substring(0, m.index ?? 0).split('\n').length - 1;
			const existing = existingLocalMap.get(m[0]);
			if (existing) return {...existing, line};
			const imagePath = m[1] ?? '';
			const resolvedFile = this.plugin.resolveImageFile(imagePath, file);
			return {
				fullMatch: m[0],
				imagePath,
				fileName: resolvedFile?.name ?? imagePath,
				file: resolvedFile,
				status: 'idle' as ItemStatus,
				line,
			};
		});

		// ── Remote images: ![alt](https://...) ──────────────
		const remoteRegex = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi;
		const seenRemote = new Set<string>();
		const remoteMatches = [...content.matchAll(remoteRegex)].filter(m => {
			if (seenRemote.has(m[0])) return false;
			seenRemote.add(m[0]);
			return true;
		});

		const existingRemoteMap = fileChanged
			? new Map<string, RemoteImageItem>()
			: new Map(this.remoteItems.map(i => [i.fullMatch, i]));

		this.remoteItems = remoteMatches.map(m => {
			const line = content.substring(0, m.index ?? 0).split('\n').length - 1;
			const existing = existingRemoteMap.get(m[0]);
			if (existing) return {...existing, line};
			const altText = m[1] ?? '';
			const url = m[2] ?? '';
			return {
				fullMatch: m[0],
				altText,
				url,
				fileName: this.fileNameFromUrl(url),
				isR2: this.isR2Url(url),
				status: 'idle' as ItemStatus,
				line,
			};
		});
	}

	private isR2Url(url: string): boolean {
		const {customDomain} = this.plugin.settings;
		if (customDomain && url.startsWith(customDomain)) return true;
		return /https?:\/\/[^/]+\.r2\.dev\//i.test(url);
	}

	private fileNameFromUrl(url: string): string {
		try {
			const pathname = new URL(url).pathname;
			const rawName = pathname.split('/').pop() ?? '';
			const name = decodeURIComponent(rawName).replace(/[<>:"/\\|?*]/g, '_');
			if (!name || !name.includes('.')) return 'image.jpg';
			return name;
		} catch {
			return 'image.jpg';
		}
	}

	private resolveDownloadFolder(activeFile: TFile): string {
		// 1. Plugin setting takes priority
		const custom = this.plugin.settings.downloadFolder;
		if (custom) return custom;

		// 2. Fall back to Obsidian's attachment folder setting
		// attachmentFolderPath values:
		//   ''  or '.'  → same folder as the current file
		//   './sub'     → subfolder relative to current file
		//   'abs/path'  → absolute path from vault root
		const cfg = (this.app.vault as any).getConfig('attachmentFolderPath') as string ?? '';
		if (!cfg || cfg === '.' || cfg === './') {
			return activeFile.parent?.path ?? '';
		}
		if (cfg.startsWith('./')) {
			const base = activeFile.parent?.path ?? '';
			const sub = cfg.slice(2);
			return base ? `${base}/${sub}` : sub;
		}
		return cfg;
	}

	private async ensureFolder(folderPath: string) {
		if (!folderPath) return;
		const parts = folderPath.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				try { await this.app.vault.createFolder(current); } catch { /* already exists */ }
			}
		}
	}

	private async uniquePath(path: string): Promise<string> {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const lastDot = path.lastIndexOf('.');
		const base = lastDot >= 0 ? path.slice(0, lastDot) : path;
		const ext = lastDot >= 0 ? path.slice(lastDot) : '';
		const uid = crypto.randomUUID().slice(0, 8);
		return `${base}-${uid}${ext}`;
	}

	private render(activeFile: TFile | null) {
		const el = this.contentEl;
		el.empty();

		// Toolbar
		const navHeader = el.createDiv('nav-header');
		const navButtons = navHeader.createDiv('nav-buttons-container');

		const uploadAllBtn = navButtons.createDiv({cls: 'clickable-icon nav-action-button'});
		setIcon(uploadAllBtn, 'upload');
		setTooltip(uploadAllBtn, 'Upload all local');

		const downloadAllBtn = navButtons.createDiv({cls: 'clickable-icon nav-action-button'});
		setIcon(downloadAllBtn, 'download');
		setTooltip(downloadAllBtn, 'Download all remote');

		const refreshBtn = navButtons.createDiv({cls: 'clickable-icon nav-action-button'});
		setIcon(refreshBtn, 'refresh-cw');
		setTooltip(refreshBtn, 'Refresh');
		refreshBtn.addEventListener('click', () => this.refresh());

		if (!activeFile) {
			uploadAllBtn.addClass('is-disabled');
			downloadAllBtn.addClass('is-disabled');
			const empty = el.createDiv('r2-empty');
			setIcon(empty.createSpan('r2-empty-icon'), 'image');
			empty.createSpan({cls: 'r2-empty-text', text: 'Open a markdown file to see images.'});
			return;
		}

		const pendingLocal = this.items.filter(i => i.status === 'idle' || i.status === 'failed');
		if (pendingLocal.length === 0) uploadAllBtn.addClass('is-disabled');
		else uploadAllBtn.addEventListener('click', () => this.uploadAll(activeFile));

		const pendingRemote = this.remoteItems.filter(i => i.status === 'idle' || i.status === 'failed');
		if (pendingRemote.length === 0) downloadAllBtn.addClass('is-disabled');
		else downloadAllBtn.addEventListener('click', () => this.downloadAll(activeFile));

		const navContainer = el.createDiv('nav-files-container');

		// Local images section — always visible
		navContainer.createDiv('nav-folder-title')
			.createDiv({cls: 'nav-folder-title-content', text: 'Local images'});
		if (this.items.length === 0) {
			const empty = navContainer.createDiv('r2-empty');
			setIcon(empty.createSpan('r2-empty-icon'), 'image-off');
			empty.createSpan({cls: 'r2-empty-text', text: 'No local images found.'});
		} else {
			for (const item of this.items) {
				this.renderRow(navContainer, item, activeFile);
			}
		}

		// Remote images section — always visible, split into R2 / External
		navContainer.createDiv('nav-folder-title')
			.createDiv({cls: 'nav-folder-title-content', text: 'Remote images'});
		if (this.remoteItems.length === 0) {
			const empty = navContainer.createDiv('r2-empty');
			setIcon(empty.createSpan('r2-empty-icon'), 'image-off');
			empty.createSpan({cls: 'r2-empty-text', text: 'No remote images found.'});
		} else {
			for (const item of this.remoteItems) {
				this.renderRemoteRow(navContainer, item, activeFile);
			}
		}
	}

	private renderRow(parent: HTMLElement, item: ImageItem, activeFile: TFile) {
		const navFile = parent.createDiv('tree-item nav-file');
		const row = navFile.createDiv({cls: `tree-item-self is-clickable nav-file-title r2-row-${item.status}`});

		row.createDiv({
			cls: 'tree-item-inner nav-file-title-content' + (item.file ? '' : ' r2-name-missing'),
			text: item.fileName,
		});

		row.addEventListener('click', () => this.revealLine(activeFile, item.line));

		const tools = row.createDiv('r2-tools');

		if (item.status === 'idle') {
			const btn = tools.createDiv({cls: 'clickable-icon' + (item.file ? '' : ' is-disabled')});
			setIcon(btn, 'upload');
			setTooltip(btn, 'Upload');
			if (item.file) btn.addEventListener('click', (e) => { e.stopPropagation(); this.uploadItem(item, activeFile); });
		} else if (item.status === 'uploading') {
			const spinner = tools.createDiv('r2-spinning');
			setIcon(spinner, 'loader');
		} else if (item.status === 'done') {
			const badge = tools.createDiv('r2-status-icon r2-status-done');
			setIcon(badge, 'check');
		} else if (item.status === 'failed') {
			const badge = tools.createDiv('r2-status-icon r2-status-failed');
			setIcon(badge, 'alert-circle');
			const btn = tools.createDiv('clickable-icon');
			setIcon(btn, 'rotate-ccw');
			setTooltip(btn, 'Retry');
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.uploadItem(item, activeFile); });
		}

		if (item.error) {
			navFile.createDiv({cls: 'r2-row-error', text: item.error});
		}
	}

	private renderRemoteRow(parent: HTMLElement, item: RemoteImageItem, activeFile: TFile) {
		const navFile = parent.createDiv('tree-item nav-file');
		const row = navFile.createDiv({cls: `tree-item-self is-clickable nav-file-title r2-row-${item.status}`});

		row.createDiv({cls: 'tree-item-inner nav-file-title-content', text: item.fileName});
		row.createSpan({cls: `r2-origin-badge ${item.isR2 ? 'r2-origin-r2' : 'r2-origin-ext'}`, text: item.isR2 ? 'R2' : 'Ext'});

		row.addEventListener('click', () => this.revealLine(activeFile, item.line));

		const tools = row.createDiv('r2-tools');

		if (item.status === 'idle') {
			const btn = tools.createDiv('clickable-icon');
			setIcon(btn, 'download');
			setTooltip(btn, 'Download to vault');
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.downloadItem(item, activeFile); });
		} else if (item.status === 'uploading') {
			const spinner = tools.createDiv('r2-spinning');
			setIcon(spinner, 'loader');
		} else if (item.status === 'done') {
			const badge = tools.createDiv('r2-status-icon r2-status-done');
			setIcon(badge, 'check');
		} else if (item.status === 'failed') {
			const badge = tools.createDiv('r2-status-icon r2-status-failed');
			setIcon(badge, 'alert-circle');
			const btn = tools.createDiv('clickable-icon');
			setIcon(btn, 'rotate-ccw');
			setTooltip(btn, 'Retry');
			btn.addEventListener('click', (e) => { e.stopPropagation(); this.downloadItem(item, activeFile); });
		}

		if (item.error) {
			navFile.createDiv({cls: 'r2-row-error', text: item.error});
		}
	}

	private revealLine(file: TFile, line: number) {
		const editorView = this.findEditorForFile(file);
		if (!editorView) return;
		this.app.workspace.setActiveLeaf(editorView.leaf, {focus: true});
		editorView.editor.setCursor({line, ch: 0});
		editorView.editor.scrollIntoView({from: {line, ch: 0}, to: {line, ch: 0}}, true);
	}

	private findEditorForFile(file: TFile): MarkdownView | null {
		let target: MarkdownView | null = null;
		this.app.workspace.iterateAllLeaves(leaf => {
			if (!target && leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
				target = leaf.view;
			}
		});
		return target;
	}

	// ── Local image upload ────────────────────────────────
	private async doUpload(item: ImageItem, activeFile: TFile, baseUrl: string) {
		item.status = 'uploading';
		item.error = undefined;

		const result = await this.plugin.uploadImageFile(item.file!, baseUrl);

		if (result.success) {
			item.status = 'done';
			const editorView = this.findEditorForFile(activeFile);
			if (editorView) {
				const editor = editorView.editor;
				const current = editor.getValue();
				const updated = current.split(item.fullMatch).join(`![${item.fileName}](${result.publicUrl})`);
				if (updated !== current) editor.setValue(updated);
			}
			const {customDomain} = this.plugin.settings;
			this.plugin.records.addUpload({
				fileName: item.fileName,
				localPath: item.file!.path,
				publicUrl: result.publicUrl,
				customUrl: customDomain ? `${customDomain}/${encodeURIComponent(item.fileName)}` : '',
				notePath: activeFile.path,
				noteFileName: activeFile.name,
			});
			window.setTimeout(() => {
				if (this.currentFilePath !== activeFile.path) return;
				this.items = this.items.filter(i => i !== item);
				new Notice(`Uploaded: ${item.fileName}`);
				this.render(activeFile);
			}, 1000);
		} else {
			item.status = 'failed';
			item.error = result.error;
		}
	}

	private async uploadItem(item: ImageItem, activeFile: TFile) {
		if (!item.file) return;
		const baseUrl = await this.plugin.resolveBaseUrl();
		if (!baseUrl) {
			new Notice('Images → R2: No public URL. Enable managed domain or set a Custom Domain in settings.');
			return;
		}
		await this.doUpload(item, activeFile, baseUrl);
		this.render(activeFile);
	}

	private async uploadAll(activeFile: TFile) {
		const baseUrl = await this.plugin.resolveBaseUrl();
		if (!baseUrl) {
			new Notice('Images → R2: No public URL. Enable managed domain or set a Custom Domain in settings.');
			return;
		}
		const pending = this.items.filter(i => (i.status === 'idle' || i.status === 'failed') && i.file);
		for (const item of pending) {
			await this.doUpload(item, activeFile, baseUrl);
			this.render(activeFile);
		}
	}

	// ── Remote image download ─────────────────────────────
	private async doDownload(item: RemoteImageItem, activeFile: TFile) {
		item.status = 'uploading';
		item.error = undefined;

		try {
			const response = await requestUrl({url: item.url, method: 'GET', throw: false});
			if (response.status < 200 || response.status >= 300) {
				item.status = 'failed';
				item.error = `HTTP ${response.status}`;
				return;
			}

			const folder = this.resolveDownloadFolder(activeFile);
			await this.ensureFolder(folder);
			const basePath = folder ? `${folder}/${item.fileName}` : item.fileName;
			const savePath = await this.uniquePath(basePath);

			await this.app.vault.createBinary(savePath, response.arrayBuffer);

			const savedFile = this.app.vault.getAbstractFileByPath(savePath);
			if (!(savedFile instanceof TFile)) throw new Error('File not saved');

			const editorView = this.findEditorForFile(activeFile);
			if (editorView) {
				const editor = editorView.editor;
				const current = editor.getValue();
				const updated = current.split(item.fullMatch).join(`![[${savedFile.name}]]`);
				if (updated !== current) editor.setValue(updated);
			}

			item.status = 'done';
			this.plugin.records.addDownload({
				fileName: savedFile.name,
				localPath: savedFile.path,
				remoteUrl: item.url,
				notePath: activeFile.path,
				noteFileName: activeFile.name,
			});

			window.setTimeout(() => {
				if (this.currentFilePath !== activeFile.path) return;
				this.remoteItems = this.remoteItems.filter(i => i !== item);
				new Notice(`Downloaded: ${item.fileName}`);
				this.render(activeFile);
			}, 1000);

		} catch (err) {
			item.status = 'failed';
			item.error = (err as Error).message;
		}
	}

	private async downloadItem(item: RemoteImageItem, activeFile: TFile) {
		await this.doDownload(item, activeFile);
		this.render(activeFile);
	}

	private async downloadAll(activeFile: TFile) {
		const pending = this.remoteItems.filter(i => i.status === 'idle' || i.status === 'failed');
		for (const item of pending) {
			await this.doDownload(item, activeFile);
			this.render(activeFile);
		}
	}
}
