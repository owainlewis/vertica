# Vertica

A minimal studio for creating LinkedIn document carousels.

## What it does

- saves every carousel to a database and lists them on a home gallery
- turns pasted text into an editable slide sequence
- imports and exports a small JSON format that Claude or Codex can generate
- uses one Signifier editorial system with a faint twelve-column grid
- keeps colour, placement and slide type separate, so any text position works with any colour
- puts photographs on the paper as objects: a square grid, a filmstrip that bleeds off both edges, or one contained figure
- accepts a background photograph per slide as well, veiled to suit the copy sitting over it
- a deck avatar bottom-left, a series label top-left, a bare page number top-right, and a swipe arrow on every slide but the last
- exports one PDF for LinkedIn, or numbered JPEGs zipped for Instagram, both at 2×
- blocks an export rather than silently omitting a background that only exists in another browser
- undo and redo across the whole deck, with ⌘Z and ⇧⌘Z
- serializes autosaves and flushes queued edits before leaving the editor
- a deck wordmark, understated quote callouts, and a text plate for copy that has to sit on a busy photograph

## The shell

One frame on every screen: a rail on the left with the mark, Carousels and Media, then
the page. Opening a deck keeps the rail, so the editor is a room in the same house
rather than a different app. Leaving a deck through the rail flushes its queued edits
first. The chrome takes its palette from the slides: paper ground, ink type, sage for
the one accent, Signifier for page titles and Helvetica for controls.

## The gallery

Three across, square corners and no card chrome anywhere a slide is drawn. Tiles show
the slide at its own 4:5, which is what a carousel is. The editor's slide rail draws
the same real slides small, so it is an honest table of contents.
Instagram centre-crops a portrait post to a square on the profile grid; the editor's
**Grid crop** toggle draws that cut over the full slide when you want to check it,
which is better than designing against the crop all day.

## Storage

Carousels live in Cloudflare D1. The binding name is set by `"d1"` in
`.openai/hosting.json`; with it unset the app still runs and the API returns a clear
503 instead of failing quietly.

Background images do **not** go in the database. D1 caps a single value at 1MB, which
a photograph exceeds, so R2 stores the bytes and the carousel row stores only a
content-hash key. IndexedDB is a local cache, and `app/image-store.ts` uploads and
resolves the same key through `/api/media`, so a saved carousel can load its images in
another browser. Existing browser-local images migrate to R2 the next time that
browser opens and saves the carousel. The logical R2 binding is `MEDIA` in
`.openai/hosting.json`. Uploads accept PNG, JPEG, GIF, AVIF, and WebP images.

If an image cannot be resolved, the key is kept rather than dropped. This protects the
saved carousel while making the missing media visible instead of silently overwriting
the deck without its background.

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

Every deck is branded AI Engineer unless it says otherwise: `AI Engineer` as the
series label at the top of each slide, `aiengineer.co` in the footer. Both are defaults
in `app/carousel.ts`, so a new deck, a generated deck and a pasted config all get them
without anyone typing them in. Case is kept as written. The furniture is sentence case
and a light weight on purpose: it holds the frame without competing with the headline.
Both are editable under Design, along with the avatar, the page number style and the
swipe arrow.

## Layouts

Seven, each with one job. Cover, content and closing draw the headline and the copy.
Note, poster, diagram and photos draw the headline only, so nothing can collide with
the figure. Their copy is kept in the document and comes back if the slide type
changes.

- `cover`: big headline, one-line subtitle at the foot
- `content`: headline and copy, the workhorse
- `note`: one plain sans statement, `**bold**` for the phrase that matters
- `poster`: one short serif statement, oversized
- `diagram`: an inline SVG figure with the headline as its caption
- `photos`: pictures under a one-line title. One is a figure, two or three a filmstrip, four or more a grid
- `closing`: headline and one line

Older names still load: `quote` and `split` read as content, `grid`, `strip` and
`figure` read as photos.

## Pictures and diagrams

`images` holds up to nine pictures for a photos slide. `diagram` holds inline SVG for a
diagram slide, sanitised on the way in so it can draw but not run or fetch. Draw with
`currentColor` and the figure takes the slide's ink on any ground. `background` still
exists for a photograph behind the copy, veiled with one smooth gradient.

## Writing a deck with Claude

`.claude/skills/carousel/SKILL.md` is the house style: the seven-slide arc, the one
sage character slide, copy rules, diagram rules and the JSON shape. In Claude Code,
`/carousel` loads it. Paste the result under Generate, JSON config.

## Generator

Pasted text becomes slides with the rhythm of the reference decks: a cover whose
second sentence is the subtitle, content slides that explain, a short statement of
eight words or fewer set as a poster, the first poster after the setup on a sage
ground, and a closing slide. Titles of five words or more get one suggested `|` break
before their last two or three words.

## Typography

Sizes are set in container-width units against the slide itself, so the preview and the
export are the same drawing at different scales. Every carousel uses the same title and
body sizes. Put a `|` in a headline to break the line where the sense breaks; the words
after it are still balanced.

Headlines are Signifier, loaded from the machine because its web licence is separate
from the desktop one. Body copy is Helvetica at regular weight with a touch of
negative tracking, the way the reference decks pair a serif headline with a plain
paragraph. The editor warns when it is missing, since
the export would otherwise ship Georgia without anyone noticing. Labels and controls
use Helvetica. `*word*` sets a phrase in italic and `**word**` paints a sage
highlighter stroke behind it. Castoro is
bundled for italic emphasis in the interface, so marked phrases keep their contrast without a network
font request.

The **Signifier** system uses the locally installed Signifier regular and italic cuts
on cool grey paper, with Georgia as a safe fallback. A subtle twelve-column grid,
fixed folio, small sans-serif furniture, generous margins and a tighter display scale
make it suitable for minimalist editorial decks. Poster and split layouts add more
expressive compositions, while per-slide sage and black grounds can punctuate one key
idea. Every text element on a slide uses the same ink colour.

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
