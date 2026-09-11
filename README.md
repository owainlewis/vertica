# Vertica

A studio for image and video carousels. Three themes, four slide layouts,
a media library, and exports to PDF, numbered JPEGs, or numbered MP4s.

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

## Image and video carousels

Choose **New image carousel** or **New video carousel** in the library. Both
start with the Cinematic theme. **Content** puts the background picker beside
the slide copy; **Design → Carousel format** changes the output intent while
keeping the existing media and text. Older decks remain image carousels unless
you change their format.

Image carousels export through **Export → JPEG images** as ordered files in a
ZIP. Video carousels export through **Export → Video carousel** as one numbered,
silent MP4 per slide in a ZIP. Attach a video to every slide first. Reuse a
library clip on several slides or choose different footage for each, then set
each clip's start and duration in Design.

Choose **Export → Reel** to join those slides into one silent MP4. Each slide
plays for its saved duration, followed by a straight cut to the next slide.
There is no added transition time. The export keeps the existing 4:5 framing,
text and footage; it does not crop the artwork to 9:16. Every slide needs a video.
The server renders slides sequentially, then joins them with FFmpeg without a
second lossy encode. Reel artwork is limited to 32 MB and encoded clips to
256 MB. Keep the tab open until the single-file download finishes.

Video carousel export checks every slide before starting, renders one clip at a
time, and reports progress. A missing clip or failed render stops the export
with a slide number; it never downloads an incomplete archive. ZIPs are limited
to 256 MB of encoded video; ZIP assembly avoids an extra copy of those buffers,
but the browser also needs memory for rendering and the final Blob. For larger decks, shorten the clips or export
the video slides individually. Keep the tab open until the download finishes.

## Video backgrounds

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
The video carousel ZIP contains separate clips in slide order. There is no
audio, animated text, timeline, or combined deck video.

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
The server deletes temporary upload chunks after processing. Removing unused
media hides it from the library while retaining its files, so a concurrent deck
save cannot lose its image or video. Retained files continue to incur storage
costs; there is no automatic purge. Uploading an image again restores its library
entry. Uploading a video again creates a new entry; the retained original remains
available to existing references. Interrupted uploads expire after an hour and
are cleaned up on the next upload.

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
  editor.tsx      the editor screen: rail, canvas, autosave and export
  inspector.tsx   the editor's Content, Layout and Design panels
  composer.tsx    the "create from text or JSON" dialog
  use-history.ts  undo and redo over whole decks
  dashboard.tsx   the gallery
  media-*.tsx     the media library and the picker
  export.ts       PDF and ZIP export, rasterised from the DOM at 2x
  image-store.ts  content-addressed media keys, IndexedDB cache in front of the API
  *-formats.ts    image and video rules shared with the server
  save-queue.ts   ordered, coalesced autosave
  globals.css     the design system and the app chrome
server/         the API and static host (Hono)
  bucket.ts       the storage interface: Google Cloud Storage, or a folder on disk
  store.ts        decks and media as objects
  api.ts          routes and validation
  video.ts        video upload, processing and export routes
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

Cinematic is the shared theme for image and video carousels. Choose **Layout →
Typography → Sans · Geist** or **Serif · Signifier** for a slide, or apply that
choice to every slide. All four layouts use the selected typeface at the same
size, including covers, inner slides and visual captions.

The rounded golden-ratio scale at a 390px slide width is **16px body → 26px
sans titles → 42px serif titles**, with 10px metadata. Body copy always uses
Geist, with 1.618 line height and a 1.618em gap below the title. All sizes scale
with the slide. Gallery thumbnails, the editor, reader and JPEG/PDF/video exports
share the same renderer. Signifier uses the existing locally installed font;
the editor warns when it is unavailable and Georgia is used as a fallback.

Use full-bleed photos, video or a quiet solid ground: Paper, Sage or Black.
Image slides default to text near the top; video slides default to the middle.
Explicit alignment and position choices win. Horizontal footage uses a separate
text band above the video. The background veil controls readability over
full-bleed footage. Use **Content → Slide label** for a short tag such as
“Rule 01”, and `**phrase**` or `*phrase*` for emphasis. There are no coloured
highlights or badges.

JSON uses `"theme": "cinematic"`, `"format": "image"` or `"video"`, and optional
per-slide `"typeface": "sans"` or `"serif"`. Older Editorial and AI Engineer theme
values remain readable and retain their saved positions and tone choices.
Editorial defaults to Serif; AI Engineer defaults to Sans. Both render through
Cinematic, and an explicit per-slide typeface takes precedence.

Pictures and diagrams share a contained figure area, with a caption below by
default; choose Top to put the caption above. Visual slides offer Top and Bottom
only. Older visual slides set to Middle render their caption above the figure
while retaining the saved value.

Keep teaching slides around 30 words. The editor warns when rendered copy overlaps
or leaves the frame. Explicit `|` breaks are preserved; generated copy wraps
naturally. Generated Editorial decks keep a paper ground instead of inserting
colour changes. Background choices remain available. Pages have no decorative
column rules or header borders, and inline emphasis uses weight rather than a
highlighter stroke.

SVG text keeps its authored size and font. The AI prompt recommends one 48-unit
size for labels and notes in an 800-unit-wide drawing, approximately 19px at phone
width when the full figure fits. Inspect dense or tall diagrams at phone size;
labels can be smaller when the figure is constrained by height.

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
with an inline `diagram` SVG. One picture is contained in the figure area; two to
nine form a grid inside the same margins. Images are shown in full, without
filmstrip overflow or cropping. Switching
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


### Horizontal video carousels

Landscape footage defaults to **Horizontal** when selected. In **Design → Video
framing**, choose Horizontal or Fill slide. Horizontal uses a black 4:5 canvas,
a 16:9 footage window below the text, and a separate footer. At 1× zoom the whole
source fits; **Zoom** can crop up to 1.3× without changing the text size. Keep the
copy short enough to fit the upper band. Framing and zoom are saved per slide and
used in the gallery, editor, reader, JPEG/PDF and MP4 exports. Existing clips keep
Fill slide until you choose otherwise. Horizontal framing ignores the background
veil so the footage stays clear; Fill slide restores the saved veil and position.
