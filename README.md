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

With `just` installed, run `just` or `just start` instead of `npm run dev`.

That starts the API on port 8787 and Vite on the port it prints, with `/api`
proxied through. Decks and images are written to `.data/` in the project, so
nothing leaves your machine.

`npm test` typechecks, builds, and runs the tests. `npm run lint` runs ESLint.

## How it is built

One Node process, one bucket, one container.

```
app/            the React app (Vite)
  carousel.ts     the document model, parser, generator, AI prompt
  slide.tsx       the one renderer, used for the editor, the gallery and the export
  editor.tsx      the editor screen
  dashboard.tsx   the gallery
  media-*.tsx     the media library and the picker
  export.ts       PDF and ZIP export, rasterised from the DOM at 2x
  image-store.ts  content-addressed media keys, IndexedDB cache in front of the API
  save-queue.ts   ordered, coalesced autosave
  globals.css     the design system and the app chrome
server/         the API and static host (Hono)
  bucket.ts       the storage interface: Google Cloud Storage, or a folder on disk
  store.ts        decks and media as objects
  api.ts          routes and validation
  auth.ts         the optional shared-password gate
tests/          node:test suites, run against the on-disk bucket
```

Three ideas do most of the work.

**One renderer.** `Slide` draws a slide from its JSON. The editor preview, the rail
thumbnails, the gallery cards and the export stage are all that component at
different sizes. Type is set in container-width units, so a 64px thumbnail and a
1080px export are the same drawing.

**Objects, not tables.** There is no database. A deck is `carousels/<id>.json` in the
bucket with its gallery summary in the object's metadata, so listing the gallery
never downloads a document. Its version is the object's generation, and every save
carries the generation the client last read. The bucket refuses a stale write, the
API turns that into a 409, and the editor asks you to reload. Two tabs on one deck
cannot clobber each other.

**Keys, not bytes.** Images live under a content hash at `media/<hash>`. A deck
stores `img:` keys, the browser caches bytes in IndexedDB, and the API serves them
on any machine. Deleting a library image is refused while a deck still uses it.

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

The service runs on Cloud Run with one Cloud Storage bucket. `npm run deploy` builds
from source and deploys; set `PROJECT`, `REGION`, `SERVICE` and `BUCKET` to override
the defaults at the top of `deploy.sh`.

One-time setup for a fresh project, with an authenticated `gcloud`:

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud storage buckets create gs://$BUCKET --location $REGION --uniform-bucket-level-access --public-access-prevention
printf '%s' "$PASSWORD" | gcloud secrets create vertica-app-secret --data-file=-
```

Then give the Cloud Run service account `roles/storage.objectAdmin` on the bucket,
`roles/secretmanager.secretAccessor` on the secret, and the build roles
(`cloudbuild.builds.builder`, `artifactregistry.writer`, `logging.logWriter`,
`storage.objectViewer`) on the project. The deploy disables Cloud Run's invoker IAM
check, because an organisation with domain-restricted sharing cannot grant
`allUsers` the invoker role and the URL would answer 403 to everyone. The app's own
password gate is what protects it.

The container requires two variables in production: `BUCKET`, the bucket name, and
`APP_SECRET`, the shared password. It refuses to start if either is missing, so a
misconfigured Cloud Run revision cannot silently write to ephemeral disk or expose an
open API. With `APP_SECRET` set the whole app sits behind one password,
exchanged for an HMAC-signed cookie so the secret itself never reaches the browser.
With it unset the app is open, which is what local development wants. With `BUCKET`
unset the server uses `.data/` on disk.

## Fonts

Signifier is a commercial face from Klim and is not bundled. The app loads it from
the machine and warns in the editor when it is missing, since the export would
otherwise ship Georgia. Helvetica is a system font on macOS; elsewhere Arial stands
in.

## Licence

MIT.
