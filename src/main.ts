import {MarkdownView, Menu, Plugin, TAbstractFile, TFile, requestUrl} from 'obsidian';
import {DEFAULT_SETTINGS, ImagesR2Settings, ImagesR2SettingTab} from './settings';
import {R2UploaderView, VIEW_TYPE_R2} from './view';
import {RecordsManager} from './records';

const MIME_TYPES: Record<string, string> = {
	'png': 'image/png',
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'gif': 'image/gif',
	'webp': 'image/webp',
	'svg': 'image/svg+xml',
	'bmp': 'image/bmp',
	'ico': 'image/x-icon',
	'tiff': 'image/tiff',
	'tif': 'image/tiff',
};

export default class ImagesR2Plugin extends Plugin {
	settings: ImagesR2Settings;
	records: RecordsManager;

	async onload() {
		await this.loadSettings();
		this.records = new RecordsManager(this.app);

		this.registerView(VIEW_TYPE_R2, (leaf) => new R2UploaderView(leaf, this));

		this.addRibbonIcon('aperture', 'Images → R2', () => this.activateView());

		// Restore the panel if it was open in the previous session, or open it for the first time
		this.app.workspace.onLayoutReady(() => this.activateView());

		// File menu (··· on note tab / file explorer)
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
				if (!(file instanceof TFile) || file.extension !== 'md') return;
				menu.addItem((item) => {
					item.setTitle('Upload images to R2').setIcon('upload').onClick(() => this.activateView());
				});
			})
		);

		// Editor right-click context menu
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu) => {
				menu.addItem((item) => {
					item.setTitle('Upload images to R2').setIcon('upload').onClick(() => this.activateView());
				});
			})
		);

		this.addCommand({
			id: 'open-r2-uploader',
			name: 'Open R2 uploader panel',
			callback: () => this.activateView(),
		});

		this.addSettingTab(new ImagesR2SettingTab(this.app, this));
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_R2);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImagesR2Settings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_R2);
		if (existing.length && existing[0]) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({type: VIEW_TYPE_R2, active: true});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private async fetchManagedDomain(accountId: string, r2Token: string, bucketName: string): Promise<string | null> {
		try {
			const response = await requestUrl({
				url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/domains/managed`,
				method: 'GET',
				headers: {'Authorization': `Bearer ${r2Token}`},
				throw: false,
			});
			if (response.status !== 200) return null;
			const domain = response.json?.result?.domain as string | undefined;
			return domain ? `https://${domain}` : null;
		} catch {
			return null;
		}
	}

	async resolveBaseUrl(): Promise<string | null> {
		const {accountId, r2Token, bucketName, customDomain} = this.settings;
		if (customDomain) return customDomain;
		if (!accountId || !r2Token || !bucketName) return null;
		return this.fetchManagedDomain(accountId, r2Token, bucketName);
	}

	resolveImageFile(imagePath: string, activeFile: TFile): TFile | null {
		const resolved = this.app.metadataCache.getFirstLinkpathDest(imagePath, activeFile.path);
		if (resolved instanceof TFile) return resolved;
		const fileName = imagePath.split('/').pop() ?? imagePath;
		return this.app.vault.getFiles().find((f: TFile) => f.name === fileName) ?? null;
	}

	async uploadImageFile(imageFile: TFile, baseUrl: string): Promise<{success: true; publicUrl: string} | {success: false; error: string}> {
		const {accountId, r2Token, bucketName} = this.settings;
		if (!accountId || !r2Token || !bucketName) {
			return {success: false, error: 'Missing configuration'};
		}

		try {
			const fileBuffer = await this.app.vault.readBinary(imageFile);
			const mimeType = MIME_TYPES[imageFile.extension.toLowerCase()] ?? 'application/octet-stream';
			const fileName = imageFile.name;

			let response;
			try {
				response = await requestUrl({
					url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${encodeURIComponent(fileName)}`,
					method: 'PUT',
					headers: {
						'Authorization': `Bearer ${r2Token}`,
						'Content-Type': mimeType,
					},
					body: fileBuffer,
					throw: false,
				});
			} catch (networkErr) {
				return {success: false, error: (networkErr as Error).message};
			}

			if (response.status !== 200) {
				let errMsg = `HTTP ${response.status}`;
				try { errMsg = response.json?.errors?.[0]?.message ?? errMsg; } catch { /* not JSON */ }
				return {success: false, error: errMsg};
			}

			let data;
			try { data = response.json; } catch {
				return {success: false, error: 'Invalid response'};
			}

			if (!data?.success) {
				return {success: false, error: data?.errors?.[0]?.message ?? 'Unknown error'};
			}

			return {success: true, publicUrl: `${baseUrl}/${encodeURIComponent(fileName)}`};
		} catch (err) {
			return {success: false, error: (err as Error).message};
		}
	}

	// Keep for the command palette upload-all shortcut
	async uploadAllInCurrentFile() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView?.file) return;
		await this.activateView();
	}
}
