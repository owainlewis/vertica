---
name: carousel
description: Write a Vertica carousel from a transcript, article or idea. Use when asked to make, draft, rewrite or tighten a LinkedIn or Instagram carousel for this app. Produces the JSON config the app loads, with one clear point per slide, a story that builds, and one character slide.
---

# Great carousels

A carousel is a short story told in one design system. Seven slides is the sweet spot.
Never more than ten. Every slide makes one point in one sentence. The reader should
understand the whole deck from the headlines alone.

## The structure that works

This is the shape of "What is a software factory?", which is the reference deck.

| # | Slide | Layout | Job |
|---|---|---|---|
| 1 | Cover | `cover` | Ask the question or name the idea. One italic word. One-line subtitle. |
| 2 | The problem | `content` | Why the reader should care. What hurts today. |
| 3 | The definition | `content` | What the thing is, in plain words. |
| 4 | How it works | `diagram` | One drawing that shows the mechanism. Caption only. |
| 5 | The beat | `poster` on `sage` | One short line that turns the story. The character slide. |
| 6 | The payoff | `content` | What changes once you have it. |
| 7 | Closing | `closing` | The takeaway in one line, and one line of what to do. |

Vary it, but keep the arc: problem, definition, mechanism, turn, payoff, close. A deck
that is all definitions is a glossary. A deck that is all payoff is an advert.

## The character slide

One slide per deck breaks the pattern. It is short, it is on the sage ground, and it
is the line people remember. Two forms work:

- **The turn.** A single word or fragment, set in italic, that pivots the story:
  `*But…*`, `*Except…*`, `*Until…*`. Put it right before the payoff.
- **The rule.** A short statement of the principle: `Same prompt, | *every* task`.

Use `poster` for both, `tone: "sage"`, title only. A poster of ten characters or
fewer is set nearly twice the size, so the turn fills the page. Never more than one sage slide, and
never two posters in a row.

## Layouts

Seven, each with one job. Note, poster, diagram and photos draw the title only.

- `cover`: headline plus a one-line subtitle in `body`
- `content`: headline plus two short paragraphs in `body`
- `note`: one plain sentence in sans, `**bold**` for the phrase that matters, no headline
- `poster`: one short serif statement, eight words or fewer
- `diagram`: inline SVG in `diagram`, headline as caption
- `photos`: one to nine pictures in `images`, one-line headline
- `closing`: headline plus one line in `body`

Position and alignment have sensible defaults. Leave them out unless a slide needs
them.

## Copy rules

- Headlines: ten words or fewer. Sentence case. No colons, no hype, no "unlock".
- Put `|` where the headline should break. Do it on every headline of five or more
  words. Break where the sense breaks, not in the middle of a phrase.
- Bodies: two paragraphs at most, separated by a blank line, forty-five words total.
- One italic word on the cover with `*word*`. At most two more in the deck.
- One highlighter phrase in the whole deck with `**phrase**`, on a content slide.
- Numbers only when they change what the reader does. One per deck at most.
- Write the closing as an instruction or a promise, not a summary.

## Diagrams

Draw the mechanism, not the org chart. Six boxes at most. Rules for the SVG:

- `viewBox="0 0 800 500"`, no `width` or `height` on the root
- `stroke="currentColor"` and `fill="none"` on shapes, `fill="currentColor"` on text
- `stroke-width="2"`, `rx="8"` on boxes
- `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`, labels 24px, notes 18px, nothing smaller (a phone shows the slide at about a third of its size)
- arrows as a line plus a small polygon marker
- no colour, no gradients, no scripts, no external references

Dashed groups with a small uppercase label work well for regions like "control
plane" and "data plane".

## Output

Return JSON only, in this shape. The app validates it and maps old layout names.

```json
{
  "version": 1,
  "title": "What is a software factory?",
  "author": "aiengineer.co",
  "mark": "Software factories",
  "slides": [
    { "layout": "cover", "title": "What is a | software *factory*?", "body": "And why your coding agents might want one" },
    { "layout": "content", "title": "The problem | it solves", "body": "You change the model, the prompt, the harness or a skill.\n\nDid it help? With a local agent you have no way to know." },
    { "layout": "content", "title": "A factory is a | defined process", "body": "Work goes in. It runs through one fixed sequence. Metrics come out." },
    { "layout": "diagram", "title": "Control plane and data plane", "diagram": "<svg viewBox=\"0 0 800 500\">…</svg>" },
    { "layout": "poster", "tone": "sage", "title": "Same prompt, | *every* task" },
    { "layout": "content", "title": "Now you can | **measure** it", "body": "Swap a model, run for a few days, and compare with data instead of a hunch." },
    { "layout": "closing", "title": "Delegate the batch. | Keep the *craft* local.", "body": "Overnight work goes to the factory. Design and fast iteration stay with you." }
  ]
}
```

`mark` is the series label at the top of every slide. Keep it short and in sentence
case. `author` is the footer. Both default to the AI Engineer brand if omitted.

## Loading it

Paste the JSON into the app under Generate, then JSON config. Or save it straight to
the local server:

```bash
node -e "const fs=require('fs');fs.writeFileSync('payload.json',JSON.stringify({id:'',version:null,config:fs.readFileSync('deck.json','utf8')}))"
curl -s -X POST http://localhost:3001/api/carousels -H 'content-type: application/json' --data-binary @payload.json
```

Validate first with `parseCarouselConfig` from `app/carousel.ts` if in doubt. It
throws a plain message for anything the app would refuse.

## Before you hand it over

- Read the headlines alone, top to bottom. Do they tell the story?
- Is there exactly one sage slide, and is it the line you would quote?
- Does every content slide make one point, not two?
- Would slide two make someone stop scrolling?
