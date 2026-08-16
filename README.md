# Vertica

A minimal, local-first studio for creating LinkedIn document carousels.

## What it does

- turns pasted text into an editable slide sequence
- imports and exports a small JSON format that Claude or Codex can generate
- includes Editorial and Signal templates
- accepts local background images per slide
- exports every slide as a 1080 × 1350 page in one PDF
- runs entirely in the browser with no account, backend, or API key

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Use AI-generated configs

Open **Design → Edit JSON config → Copy AI prompt**. Paste that prompt and your source text into Claude or Codex, then paste the returned JSON into Vertica and choose **Apply config**.

Backgrounds are deliberately restricted to locally uploaded image data. Remote image URLs are rejected so PDF export remains reliable and private.

## Checks

```bash
npm run lint
npm test
```
