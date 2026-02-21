import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import ImagesR2Plugin from "./main";
import {RECORDS_PATH} from "./records";

export interface ImagesR2Settings {
	accountId: string;
	r2Token: string;
	bucketName: string;
	customDomain: string;
	downloadFolder: string;
}

export const DEFAULT_SETTINGS: ImagesR2Settings = {
	accountId: '',
	r2Token: '',
	bucketName: '',
	customDomain: '',
	downloadFolder: '',
}

export class ImagesR2SettingTab extends PluginSettingTab {
	plugin: ImagesR2Plugin;

	constructor(app: App, plugin: ImagesR2Plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Images → R2 Settings'});

		new Setting(containerEl)
			.setName('Account ID')
			.setDesc('Your Cloudflare Account ID')
			.addText(text => text
				.setPlaceholder('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
				.setValue(this.plugin.settings.accountId)
				.onChange(async (value) => {
					this.plugin.settings.accountId = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('R2 API Token')
			.setDesc('Cloudflare R2 API Token (requires Workers R2 Storage: Edit permission)')
			.addText(text => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Your R2 API token')
					.setValue(this.plugin.settings.r2Token)
					.onChange(async (value) => {
						this.plugin.settings.r2Token = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Bucket Name')
			.setDesc('The R2 bucket to upload images to')
			.addText(text => text
				.setPlaceholder('my-images-bucket')
				.setValue(this.plugin.settings.bucketName)
				.onChange(async (value) => {
					this.plugin.settings.bucketName = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Custom Domain')
			.setDesc('Optional. Base URL for public image access (e.g., https://cdn.example.com). If left empty, the bucket\'s R2 managed public domain will be used automatically.')
			.addText(text => text
				.setPlaceholder('https://cdn.example.com')
				.setValue(this.plugin.settings.customDomain)
				.onChange(async (value) => {
					this.plugin.settings.customDomain = value.trim().replace(/\/$/, '');
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h2', {text: 'Records'});

		new Setting(containerEl)
			.setName('Records file')
			.setDesc(`Upload and download history: ${RECORDS_PATH}`)
			.addButton(btn => btn
				.setButtonText('Copy path')
				.onClick(async () => {
					const adapter = this.app.vault.adapter as any;
					const abs = adapter.getBasePath
						? `${adapter.getBasePath()}/${RECORDS_PATH}`
						: RECORDS_PATH;
					await navigator.clipboard.writeText(abs);
					new Notice('Path copied to clipboard');
				}))
			.addButton(btn => btn
				.setButtonText('Open')
				.setCta()
				.onClick(async () => {
					const exists = await this.app.vault.adapter.exists(RECORDS_PATH);
					if (!exists) {
						new Notice('No records file yet — make an upload or download first.');
						return;
					}
					(this.app as any).openWithDefaultApp(RECORDS_PATH);
				}));

		containerEl.createEl('h2', {text: 'Download'});

		new Setting(containerEl)
			.setName('Download folder')
			.setDesc('Folder to save downloaded remote images (path relative to vault root, e.g. assets/images). Leave empty to use Obsidian\'s default attachment folder.')
			.addText(text => text
				.setPlaceholder('assets/images')
				.setValue(this.plugin.settings.downloadFolder)
				.onChange(async (value) => {
					this.plugin.settings.downloadFolder = value.trim().replace(/\/$/, '');
					await this.plugin.saveSettings();
				}));
	}
}
