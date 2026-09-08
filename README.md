# Vertica

A studio for LinkedIn and Instagram carousels. Two themes, four
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

## Experimental video backgrounds

Install `ffmpeg` and `ffprobe` on the server's PATH (`brew install ffmpeg` on
macOS). The Docker image includes them. In the editor, open **Design → Choose a
video**, upload an MP4 or MOV, and set the clip's start and duration. Use the
existing text, positioning, colours, and background veil. Pause/play controls are
available in the editor and reader preview.

**Export → Video slide** downloads the selected slide as a silent 1080 × 1350,
30 fps H.264 MP4. It keeps the preview's centred 4:5 crop and burns in the text,
branding, and veil. New uploads retain their exact original file; MP4 export
encodes directly from that original at CRF 16 with the medium preset and Lanczos
scaling. PDF and JPEG exports also read their selected first frame from the
original. The final resize and H.264 encode are not mathematically lossless.
MP4 export currently produces one slide at a time; there is no audio, animated
text, timeline, or combined deck video.

Sources can be 1–120 seconds, up to 512 MB and 4096 pixels on either side. Clips
can be 1–30 seconds. The editor reads and stores the source duration and constrains
the start and duration to fit; older saved intervals are corrected when the video
metadata loads. Uploads use 8 MB chunks in the
same storage bucket as the app, so they work across server instances. Compatible
H.264 clips are repackaged as silent MP4s without changing their video pixels,
resolution, or frame rate. Stream copy accepts common 8-bit profiles through
level 5.1, up to UHD dimensions and 60 fps, with square pixels and no rotation.
Other formats or playback files over 96 MB get a smaller H.264 preview capped at
30 fps, preserving slower source frame rates;
exports still use the untouched original. Short compatible clips usually avoid
that fallback. Each upload has its own ID so failed writes can be rolled back
without deleting another upload, even when the original files are identical.
The server deletes temporary upload chunks after processing, and deleting an
unused video removes both copies and its poster. Interrupted uploads expire
after an hour and are cleaned up on the next upload.

Existing videos can be reused from the video picker. Uploads made before original
retention still export from their playback copy. Re-upload those videos to gain
the higher quality; previously discarded source detail cannot be restored.

Video processing uses temporary disk and one encoder per instance, with a
three-minute processing timeout. The deploy script allocates 2 GiB of memory,
two CPUs, four concurrent requests, and a five-minute request timeout because
Cloud Run also charges temporary files against memory. A busy encoder returns a
retryable error. This branch changes deployment settings but does not deploy them.

Run `npm test` with FFmpeg installed to include actual video upload, encoding,
crop, overlay, duration, and error-path checks. Those integration checks report
as skipped when FFmpeg is absent; parser and API validation checks still run.

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

Choose **Editorial** or **AI Engineer** in the editor's **Design → Carousel theme**.
The theme applies to the whole deck and is saved, duplicated, imported and exported
with it. Existing decks default to Editorial.

AI Engineer pairs bundled Geist regular and italic fonts with a forest cover
(`#0c110f`) and soft-grey slides (`#efeeea`, the same paper as Editorial). Unset
backgrounds use forest for covers and soft grey for every other layout, including
Body 2 and CTA slides. Choose Soft grey (`paper`) or Forest (`black`) for an
explicit background. Older AI Engineer decks with `sage` tones also render soft
grey; their stored choices are kept so switching to Editorial restores sage.
Alignment choices survive switching themes. Automatic alignment is left. Forest
slides keep cream text and sand emphasis; light slides use dark ink and muted
green emphasis.
AI Engineer diagrams inherit the theme font unless their markup sets a font explicitly;
use `font-family="inherit"` for labels that should follow the deck.

Set `"theme": "ai-engineer"` in a JSON config to use it; omit the field or use
`"editorial"` for the original theme. Both themes use the same four layouts and
renderer in the gallery, editor, reader preview and PDF/JPEG export.

Both themes use 5% of the slide width for paragraphs, Body 1 leads and visual
captions: 19.5px in a 390px feed and 54px in a 1080px export. Body 1 uses a bold
sans lead at the same size as its paragraphs, with 1.4 line height. Body 2 statements
use 6%; CTA headlines use 8%. Cover headlines retain each theme's display face and
scale. Body layouts use a quiet ground and consistent 9.5% side margins.

Keep teaching slides around 30 words. The editor warns when rendered copy overlaps
or leaves the frame; it does not shrink type to hide an overcrowded slide. Explicit
`|` breaks are preserved, while new Body 1 leads wrap naturally. SVG text keeps its
authored size; the AI prompt recommends 44-unit labels and 40-unit notes in an
800-unit-wide drawing. Check dense diagrams at phone size.

**Layout → Show header / Show footer** controls the series label, page number,
author and swipe arrow independently. Settings apply to previews and exports.

| Editor layout | JSON value | Purpose |
|---|---|---|
| Cover | `cover` | A specific promise and a short subtitle |
| Body 1 | `content` | A bold lead followed by short paragraphs |
| Body 2 | `note` | A short statement or visual example with a caption |
| CTA | `closing` | One next action and a supporting line |

For Body 2, choose **Content → Visual example → Pictures / Diagram**, or keep
**Text only**. JSON uses `visual: "photos"` with `images`, or `visual: "diagram"`
with an inline `diagram` SVG. Pictures still support one to nine images. Switching
layouts or visual types keeps the unused copy and assets for switching back.

Older `poster`, `diagram`, `photos`, `grid`, `strip` and `figure` layouts load as
Body 2, retaining their visuals and hidden supporting copy. Older `quote` and
`split` layouts become Body 1. Existing text remains editable; it adopts the new
type scale. The four roles share one renderer across the editor, reader, gallery
and exports.

Inline marks: `*word*` for italic, `**phrase**` for emphasis, `|` for an explicit
headline break. Pictures and videos can also sit behind the copy on any layout.

`.claude/skills/carousel/SKILL.md` describes the house writing framework, the four
layouts, typography and diagram guidance. In Claude Code, `/carousel` loads it.

## The document

```json
{
  "version": 1,
  "title": "Choose a design for the work",
  "author": "aiengineer.co",
  "mark": "AI system design",
  "slides": [
    {
      "layout": "cover",
      "title": "Choose a design | for the *work*.",
      "body": "Start with the task you need to complete."
    },
    {
      "layout": "content",
      "title": "Put known steps in code.",
      "body": "A model can read a request while code controls the next step.\n\nEach path has a rule you can test."
    },
    {
      "layout": "note",
      "title": "The model can help | inside a fixed workflow."
    },
    {
      "layout": "closing",
      "title": "Map the next step.",
      "body": "If the route is known, code it. If it must be discovered, consider an agent."
    }
  ]
}
```

Optional fields: `arrow: false`, and per slide `tone`, `position`, `align`,
`background`, `video`, `veil`, `visual`, `diagram`, `images`, `showHeader`, `showFooter`. Header and
footer default to visible; set either to `false` to hide it on that slide. Page
numbers always use `01`, `02`, etc.
`parseCarouselConfig` in `app/carousel.ts` is the contract; it
throws a plain message for anything the app would refuse, and it maps older layout
names onto the current four.

Diagrams are sanitised on the way in. Scripts, event handlers, embedded HTML,
stylesheets, and external references are stripped. Use SVG presentation attributes
or inline styles for drawing properties such as fill, stroke, and font size;
page layout rules and resource-loading CSS are removed.

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

The AI Engineer theme bundles Geist under the SIL Open Font License 1.1. Its fonts
and license are in `public/fonts/geist/`; no font installation is needed.

Signifier is a commercial face from Klim and is not bundled. The app loads it from
the machine and warns in the editor when it is missing, since the export would
otherwise ship Georgia. Helvetica is a system font on macOS; elsewhere Arial stands
in.

## Licence

MIT.
