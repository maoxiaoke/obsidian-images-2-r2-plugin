# Images → R2

An Obsidian plugin for managing images between your vault and Cloudflare R2.

## What it does

**Local images** — finds `![[image.ext]]` wiki-links in the current note, uploads them to R2, and replaces the link with a public URL.

**Remote images** — finds `![](https://...)` links in the current note and downloads them into your vault, replacing the link with a local wiki-link. Images are labelled **R2** or **Ext** so you can tell where they come from.

## Setup

1. Go to **Settings → Images → R2**
2. Fill in your Cloudflare **Account ID**, **R2 API Token** (needs *Workers R2 Storage: Edit*), and **Bucket Name**
3. Optionally set a **Custom Domain** (e.g. `https://cdn.example.com`). If left empty, the bucket's managed `r2.dev` domain is used automatically

## Usage

Open the panel from the ribbon icon or command palette. Click a row to jump to the image in the editor. Upload or download individual items, or use the toolbar buttons to process all at once.

## Settings

| Setting | Description |
|---|---|
| Account ID | Cloudflare account ID |
| R2 API Token | API token with R2 Edit permission |
| Bucket Name | Target R2 bucket |
| Custom Domain | Base URL for uploaded images (optional) |
| Download folder | Where to save downloaded images (defaults to Obsidian's attachment folder) |

## Records

Every upload and download is logged to `.obsidian/images-r2-records.json`. This file is outside the plugin folder and will not be deleted if you uninstall the plugin. You can copy the path or open the file from the settings page.

## Development

```bash
npm i
npm run dev    # watch
npm run build  # production
```
