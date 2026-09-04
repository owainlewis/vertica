# Vertica

A studio for LinkedIn and Instagram carousels. One editorial design system, seven
slide layouts, a media library, and one-click export to PDF or numbered JPEGs.

Every deck is a small JSON document. You can write it by hand, paste it from Claude,
or generate it from plain text, and the app renders it the same way in the editor,
in the gallery, and in the export.

![Vertica editor](docs/editor.jpg)

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the URL the terminal prints. Decks, images and settings persist locally in a
Miniflare-backed D1 database and R2 bucket under `.wrangler/`, so nothing leaves
your machine in development.

`npm test` typechecks, builds, and runs the unit tests. `npm run lint` runs ESLint.

## How it is built

The app is a single Cloudflare Worker. It serves a React 19 front end rendered by
[vinext](https://github.com/cloudflare/vinext) (a Next.js app-router runtime on
Vite) and a JSON API under `/api`.

```
app/            the React app
  carousel.ts     the document model, parser, generator, AI prompt
  slide.tsx       the one renderer, used for the editor, the gallery and the export
  editor.tsx      the editor screen
  dashboard.tsx   the gallery
  media-*.tsx     the media library and the picker
  export.ts       PDF and ZIP export, rasterised from the DOM at 2x
  image-store.ts  content-addressed media keys, IndexedDB cache in front of R2
  save-queue.ts   ordered, coalesced autosave
  globals.css     the design system and the app chrome
worker/         the Worker
  api.ts          routes, validation, media garbage collection
  db.ts           D1 schema and queries
  media.ts        R2 storage
  auth.ts         the optional shared-password gate
tests/          node:test suites, run against the built worker where it matters
```

Two ideas do most of the work.

**One renderer.** `Slide` draws a slide from its JSON. The editor preview, the rail
thumbnails, the gallery cards and the export stage are all that component at
different sizes. Type is set in container-width units, so a 64px thumbnail and a
1080px export are the same drawing.

**Keys, not bytes.** Images live in R2 under a content hash. A deck stores `img:`
keys, the browser caches bytes in IndexedDB, and the API resolves keys on any
machine. The Worker garbage-collects unreferenced media with a grace period, so a
save that is still uploading can never lose its picture.

Writes are optimistic. Every save carries the version the client last read, and the
server refuses a stale one with a 409 rather than overwriting.

## The design system

Signifier for headlines, Helvetica for copy and furniture, paper ground with sage
and black as the two alternative grounds. A faint twelve-column field sits under
every text slide. Series label top left, page number top right, footer and optional
avatar bottom left, a swipe arrow bottom right on every slide but the last.

Seven layouts, each with one job. Note, poster, diagram and photos draw the headline
only, so nothing can collide with the figure.

| Layout | Draws | Use it for |
|---|---|---|
| `cover` | headline, one-line subtitle | the opener |
| `content` | headline, copy | most slides |
| `note` | one sans statement, `**bold**` for emphasis | an aside |
| `poster` | one short serif statement | the strongest line |
| `diagram` | inline SVG, headline as caption | architecture and flows |
| `photos` | one to nine pictures under a title | a figure, a filmstrip, a grid |
| `closing` | headline, one line | the finish |

Inline marks: `*word*` for italic, `**phrase**` for a highlighter stroke, `|` in a
headline to force the line break. Photos can also sit behind the copy on any slide,
with a per-slide veil dial.

`.claude/skills/carousel/SKILL.md` is the house style for writing a deck: the
seven-slide arc, the one character slide, copy rules, diagram rules, and the JSON
shape. In Claude Code, `/carousel` loads it.

## The document

```json
{
  "version": 1,
  "title": "What is a software factory?",
  "author": "aiengineer.co",
  "mark": "Software factories",
  "slides": [
    { "layout": "cover", "title": "What is a | software *factory*?", "body": "A thesis, and the place it breaks" },
    { "layout": "content", "title": "Agents are | inconsistent", "body": "Fifty runs, fifty answers.\n\nPrompts narrow the spread. They do not close it." },
    { "layout": "poster", "tone": "sage", "title": "*Except…*" },
    { "layout": "diagram", "title": "Control plane and data plane", "diagram": "<svg viewBox=\"0 0 800 500\">…</svg>" },
    { "layout": "closing", "title": "Build the tool. | Keep the agent for *judgment*.", "body": "Link in the comments." }
  ]
}
```

Optional fields: `avatar` (a media key or data URL), `numbering` (`"fraction"` for
02 / 06), `arrow: false`, and per slide `tone`, `position`, `align`, `background`,
`veil`, `images`. `parseCarouselConfig` in `app/carousel.ts` is the contract; it
throws a plain message for anything the app would refuse, and it maps older layout
names onto the current seven.

Diagrams are sanitised on the way in. Scripts, event handlers, embedded HTML and
external references are stripped, so a pasted SVG can draw but never run or fetch.

## Deploying

The Worker needs a D1 database and an R2 bucket. Binding names come from
`.openai/hosting.json` (`d1` and `r2`); `vite.config.ts` reads them for local
development and the hosting platform provides the real bindings in production.
With no database bound the API returns a clear 503 rather than failing quietly.

Set an `APP_SECRET` binding to put the whole app behind one shared password. It is
exchanged for an HMAC-signed cookie, so the secret itself never reaches the browser.
With no secret the app is open, which is what local development wants.

## Fonts

Signifier is a commercial face from Klim and is not bundled. The app loads it from
the machine and warns in the editor when it is missing, since the export would
otherwise ship Georgia. Helvetica is a system font on macOS; elsewhere Arial stands
in.

## Licence

MIT.
