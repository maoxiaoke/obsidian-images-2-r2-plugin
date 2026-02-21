import {App} from 'obsidian';

export const RECORDS_PATH = '.obsidian/images-r2-records.json';

export interface UploadRecord {
	type: 'upload';
	fileName: string;      // image filename
	localPath: string;     // vault path of the local image
	publicUrl: string;     // R2 managed public URL
	customUrl: string;     // custom domain URL (empty if not configured)
	notePath: string;      // vault path of the note being edited
	noteFileName: string;  // filename of the note
	at: string;            // ISO 8601 timestamp
}

export interface DownloadRecord {
	type: 'download';
	fileName: string;      // saved filename
	localPath: string;     // vault path where the image was saved
	remoteUrl: string;     // original remote URL
	notePath: string;
	noteFileName: string;
	at: string;
}

export type ImageRecord = UploadRecord | DownloadRecord;

export class RecordsManager {
	private app: App;
	private records: ImageRecord[] | null = null;

	constructor(app: App) {
		this.app = app;
	}

	private async load(): Promise<ImageRecord[]> {
		if (this.records !== null) return this.records;
		try {
			const raw = await this.app.vault.adapter.read(RECORDS_PATH);
			this.records = JSON.parse(raw) as ImageRecord[];
		} catch {
			this.records = [];
		}
		return this.records;
	}

	private async save() {
		await this.app.vault.adapter.write(
			RECORDS_PATH,
			JSON.stringify(this.records, null, '\t'),
		);
	}

	async addUpload(record: Omit<UploadRecord, 'type' | 'at'>) {
		const records = await this.load();
		records.push({type: 'upload', at: new Date().toISOString(), ...record});
		await this.save();
	}

	async addDownload(record: Omit<DownloadRecord, 'type' | 'at'>) {
		const records = await this.load();
		records.push({type: 'download', at: new Date().toISOString(), ...record});
		await this.save();
	}
}
