# Vertica

A minimal studio for creating LinkedIn document carousels.

## What it does

- saves every carousel to a database and lists them on a home gallery
- turns pasted text into an editable slide sequence
- imports and exports a small JSON format that Claude or Codex can generate
- sets titles in Playfair at weight 300 and text in Inter, with Cinematic, Midnight and Paper colours per slide
- keeps colour, placement and slide type separate, so any text position works with any colour
- accepts local background images per slide, and darkens each one to suit its own brightness
- exports one PDF for LinkedIn, or numbered JPEGs zipped for Instagram, both at 2×
- undo and redo across the whole deck, with ⌘Z and ⇧⌘Z
- a deck wordmark, and a text plate for copy that has to sit on a busy photograph

## The gallery

Three across, four pixel gutters, no rounded corners and no card chrome anywhere a
slide is drawn. Tiles show the slide at its own 4:5, which is what a carousel is.
Instagram centre-crops a portrait post to a square on the profile grid; the editor's
**Grid crop** toggle draws that cut over the full slide when you want to check it,
which is better than designing against the crop all day.

## Storage

Carousels live in Cloudflare D1. The binding name is set by `"d1"` in
`.openai/hosting.json`; with it unset the app still runs and the API returns a clear
503 instead of failing quietly.

Background images do **not** go in the database. D1 caps a single value at 1MB, which
a photograph exceeds, so images are held in the browser's IndexedDB keyed by content
hash and the carousel row stores only those keys. `app/image-store.ts` is the seam to
replace when the images move to cloud storage: reimplement `putImage` and
`loadImages` and nothing else changes, because the rest of the app deals in keys.

The practical limit today is that images are per-browser. Open a carousel on another
machine and the text and layout arrive but the backgrounds do not. A key that cannot
be resolved is kept rather than dropped, so editing a deck in a second browser hides
the images there without erasing them from the saved carousel.

Every write carries the version the client last read, and the server refuses one built
on a stale version with a 409 rather than overwriting. Two tabs open on the same deck
will not silently clobber each other; the second one is told to reload.

## Access

Set an `APP_SECRET` binding to put the dashboard and API behind one shared password.
With no secret set the app is open, which is what local development wants.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal.

## Branding

Every deck is branded AI Engineer unless it says otherwise: `AI ENGINEER` as the
wordmark at the top of each slide, `AIENGINEER.CO` in the footer. Both are defaults in
`app/carousel.ts`, so a new deck, a generated deck and a pasted config all get them
without anyone typing them in.

## Typography

Sizes are set in container-width units against the slide itself, so the preview and the
export are the same drawing at different scales. The deck is set at one title size,
chosen so the longest headline fits, on a continuous curve rather than fixed steps: one
extra character never resizes the deck, and the cover boost backs off rather than push a
headline past three lines. Leading opens as a headline takes more lines. Put a `|` in a
headline to break the line where the sense breaks; the words after it are still balanced.

Quotes, apostrophes, ellipses and number ranges are made typographic at render time,
never in the stored text, so what you typed is what the editor and the exported config
give back.

## Use AI-generated configs

Open **Design → Edit JSON config → Copy AI prompt**. Paste that prompt and your source text into Claude or Codex, then paste the returned JSON into Vertica and choose **Apply config**.

Backgrounds are deliberately restricted to locally uploaded image data. Remote image URLs are rejected so PDF export remains reliable and private.

## Checks

```bash
npm run lint
npm test
```
