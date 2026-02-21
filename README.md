# Images → R2

An Obsidian plugin that uploads local images in the current note to a Cloudflare R2 bucket, and optionally replaces `![[wiki links]]` with public markdown image URLs.

## Features

- One-click upload via ribbon icon or command palette
- Operates on the **current active note only**
- Targets `![[image.ext]]` wiki-link syntax for local images
- Supports PNG, JPG, JPEG, GIF, WebP, SVG, BMP, ICO, TIFF
- Optional: replace wiki links with public R2 URLs after upload

## Setup

### 1. Cloudflare credentials

You need:

- **Account ID** — found on the Cloudflare dashboard sidebar
- **R2 API Token** — create one at `R2 > Manage R2 API Tokens` with **Workers R2 Storage: Edit** permission
- **Bucket name** — the R2 bucket to upload images into

### 2. Public URL (optional)

To have the plugin replace local links with public URLs, enable **Use Custom Domain** in settings and provide the base URL for your bucket. This can be:

- A custom domain you've configured on the bucket (e.g. `https://cdn.example.com`)
- The managed r2.dev public URL (e.g. `https://pub-xxxx.r2.dev`)

## Usage

1. Open a note containing `![[image.png]]` references
2. Click the **upload** icon in the left ribbon, or run the command **"Upload images in current file to R2"** from the command palette
3. The plugin uploads each local image to your R2 bucket
4. If **Use Custom Domain** is enabled, each `![[image.png]]` is replaced with `![image.png](https://your-domain/image.png)`

## Settings

| Setting | Description |
|---|---|
| Account ID | Your Cloudflare Account ID |
| R2 API Token | API token with R2 Edit permission |
| Bucket Name | Target R2 bucket |
| Use Custom Domain | Replace local links with public URLs after upload |
| Custom Domain | Base URL for uploaded images (shown when toggle is on) |

## Development

```bash
npm i
npm run dev      # watch mode
npm run build    # production build
npm run lint     # lint
```

Requires Node.js 16+.
