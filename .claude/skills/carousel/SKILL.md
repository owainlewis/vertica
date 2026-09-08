---
name: carousel
description: Write a Vertica carousel from a transcript, article or idea. Produces JSON using Cover, Body 1, Body 2 and CTA with a clear promise, useful sequence and readable copy.
---

# Write a useful carousel

Choose the reader, the problem and the decision the post helps them make. Write
the argument before choosing images. The reader should get useful progress with
each swipe. A consistent text layout is enough when the idea is clear.

## Framework

The cover makes a specific, credible promise. Slide two starts paying it off with
an example, consequence or useful distinction. Later slides explain the method,
show evidence or address an objection. The final slide gives one relevant action.

For a change story, establish the problem and its cost, introduce another approach,
show the method and evidence, explain what improves, and lead to a decision. These
are possible beats, not a mandatory seven-slide formula. Combine or cut beats that
do not help. A comparison should apply both choices to the same task and end with
a usable decision rule. A playbook should leave a method the reader can repeat.

Use supplied or verified results only. Label hypothetical examples. A reference
creator's reach claims do not establish what caused that reach. Offer a download
or course only when the user has it and wants to promote it.

## Four layouts

| Editor name | JSON layout | Job |
|---|---|---|
| Cover | `cover` | A clear headline and one short subtitle in `body` |
| Body 1 | `content` | A bold lead in `title` followed by short paragraphs in `body` |
| Body 2 | `note` | One statement or a visual example; `title` only |
| CTA | `closing` | One next action in `title` and a supporting line in `body` |

Use Body 1 for most teaching. Its lead and paragraphs share a reading size;
weight and space supply the hierarchy. Body 2 gives a concise statement room, or
holds a diagram or pictures. Do not add layout changes to meet a quota.

Body 2 may set `visual: "photos"` with an `images` list, or `visual: "diagram"`
with a `diagram` SVG. Omit `visual` for text only. Body 2 does not draw `body`.
Photos and videos may also sit behind any layout using the background controls.
Cinematic imagery is optional and should contribute to the idea or requested tone.

## Copy and type

- Prefer a 4-10 word cover and about 15-35 words on teaching slides.
- Give each slide one useful point. Use concrete actions and consequences.
- Body 1 uses a bold sans lead and regular paragraphs at 5% of the slide width,
  about 19.5px at a 390px feed width. Keep the prose readable at that size.
- Separate paragraphs with a blank line. Use `|` sparingly for deliberate breaks
  on covers or CTAs; let Body 1 wrap naturally.
- Use `*italic*` or `**bold**` sparingly. No hype or invented first-person claims.
- `title` allows 120 characters and `body` 280. These are storage limits, not a
  guarantee the copy fits. Shorten any slide that triggers the overflow warning.
- Preserve the user's voice and use no em dashes.

## Diagrams

Use a diagram when it explains a mechanism better than text. At most six boxes.
Use `viewBox="0 0 800 500"`, with no root width or height. Use `currentColor` for
ink, `fill="none"` on shapes, 2-unit strokes, and 8-unit corner radii. Use
`font-family="inherit"` for theme labels. Start with 44-unit labels and 40-unit
notes; inspect actual phone-size rendering and reduce complexity if labels crowd.
Arrows use lines and polygon heads. No scripts or external references.

## Output and verification

Return the requested format. For app-ready JSON, include `version: 1`, `title`,
`author: "aiengineer.co"`, a short `mark`, optional `theme: "ai-engineer"`, and a
`slides` array using the four layout values above. Each slide needs `title`.
Use `parseCarouselConfig` in `app/carousel.ts` to validate JSON. Load it through
Create from text → JSON config. Writing a deck does not authorise social posting.

Read the sequence as plain text, then inspect the actual slides. Check the cover
promise, slide-two payoff, relevant examples, fair claims, phone-size text, line
breaks, visual labels and one useful final action. Avoid decorative changes that
hide a weak argument.
