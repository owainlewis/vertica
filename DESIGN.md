---
name: Vertica
description: Restrained cream, ink, and cobalt interface framing editorial carousel artwork.
colors:
  background: "#f7f7f2"
  homepage-background: "#fafbf8"
  panel: "#ffffff"
  panel-secondary: "#f0f1ec"
  line: "#e2e4dc"
  line-strong: "#cfcbbf"
  ink: "#1a1a17"
  muted: "#62665e"
  faint: "#70756b"
  primary: "#2455db"
  primary-soft: "#edf2ff"
  primary-ink: "#204bc1"
  danger: "#9b3a2e"
typography:
  display:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
    fontSize: "clamp(42px, 5.2vw, 72px)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-.057em"
  body:
    fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
  artwork:
    fontFamily: "Signifier, Georgia, serif"
  label:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
rounded:
  control: "10px"
  small: "7px"
  theme-choice: "6px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
---

# Design System: Vertica

## Overview

Vertica frames the creator's work with a quiet, precise interface. Warm near-white surfaces, dark ink, generous space, and hairline divisions give the public homepage an editorial structure. Cobalt identifies the principal action. Real carousel artwork supplies the visual richness.

The homepage is deliberately small: product promise, interactive example, two practical explanations, and a compact footer. The private studio uses denser controls around the same artwork. PRODUCT.md records product scope and messaging; this file records the built visual system.

## Colors

Use the frontmatter palette through the existing variables in `app/globals.css`. Cobalt (`--accent`) serves primary actions and focus; `--accent-soft` and `--accent-ink` support interaction states. Ink is the main text color; muted and faint text support secondary information. White panels and the secondary surface sit against the cream studio background. Hairline and stronger border tokens separate regions and fields.

The homepage uses its own slightly lighter background and a subdued green-gray example surface (`#eff1eb`). Paper, Ink, and Sage are artwork choices, not alternate application themes. Preserve the artwork renderer's independent palette.

## Typography

Interface headings and body copy use Helvetica Neue with Helvetica and Arial fallbacks. Signifier, falling back to Georgia, belongs to carousel artwork and the italic V mark. Signifier loads from locally installed fonts; do not assume it is available on every device.

The homepage headline is medium weight, tightly tracked, and balanced. Its desktop scale is in the frontmatter; at 760px and below it becomes `clamp(38px, 7.1vw, 54px)`. Hero supporting copy is 17px with 1.65 line height, reducing to 15px on smaller screens. Detail headings are 18px; their body copy is 14px with 1.65 line height. Studio page titles use `clamp(28px, 3vw, 36px)`, weight 600. Mono labels distinguish small example annotations and technical values.

## Layout

The homepage has a 1120px maximum width and 40px side gutters. Its header is 96px tall. The centered hero leads into a framed example, followed by two equal detail columns separated by a vertical rule. At 760px, gutters become 20px, the header becomes 76px, and the three-column example becomes a horizontal scroll area. Each portrait slide snaps to the start and measures up to 320px wide. At 420px, the detail columns stack and the example toolbar may wrap.

The studio retains a 200px left navigation rail and a scrolling main region. The rail compresses to 76px on tablet widths and becomes a top navigation row at 640px. Studio content uses a 1280px maximum width and 40px desktop gutters. Standard controls are 40px tall, increasing to 44px on mobile.

## Elevation & Depth

Most structure comes from surface changes and one-pixel rules. The homepage example frame is flat; its individual slides have a restrained paper shadow. Selected theme choices have a small shadow to show state. The studio reserves stronger elevation for dialogs, popovers, and toasts using `--shadow-lift`; `--shadow-soft` supports quieter surfaces. Avoid adding depth to every section.

## Shapes

Large homepage section frames and slide artwork have square corners. Controls are softly rounded, normally 10px; small studio surfaces use 7px. Theme choices use 6px corners and circular color swatches. Keep borders thin and low contrast. Rounded controls should not turn the entire page into a collection of rounded cards.

## Components

- **Actions:** Cobalt primary actions, outlined white secondary actions, and quiet ghost links. The homepage CTA is 44px high and links to the example. Studio access is a subdued header link. Preserve visible focus, disabled states, and accessible names for icon controls.
- **Signature example:** The homepage renders three real `Slide` components using cover, content, and closing layouts. A single-select Radix toggle group switches all three between Paper, Ink, and Sage, defaulting to Paper. Ink maps to the renderer's `black` tone. Selecting the current theme leaves it selected. A check mark supplements color; small screens hide visible labels but retain accessible names. The scroll region is keyboard focusable.
- **Fields:** Studio fields use white surfaces, strong border tokens, restrained rounding, and clear focus treatment. Keep error and disabled states distinct. The public homepage has no form.
- **Navigation:** The studio's left navigation uses muted resting labels and a tinted active background. The homepage uses only its brand link and studio access link. Keep the skip link available on keyboard focus.
- **Implementation:** `app/components/ui` contains shadcn components built on Radix, with Lucide icons. `components.json` uses the New York style and neutral base; `app/ui.css` maps semantic colors to Vertica tokens. Tailwind imports theme and utilities only. Its global preflight is intentionally omitted, and required control resets are scoped to `data-slot` attributes so exported artwork stays intact. Continue this isolation when adding primitives. Respect reduced-motion preferences.

## Do's and Don'ts

- Do use actual product output to demonstrate the studio and keep preview and export rendering aligned.
- Do keep UI headings sans serif and let the artwork carry editorial serif typography.
- Do preserve generous homepage spacing and practical, concise studio controls.
- Do keep theme state understandable without relying on color alone.
- Don't add decorative subtitles, redundant counts, or generic feature-card grids.
- Don't imply AI generation, public accounts, paid plans, or available sign-ups. The current CTA explores an example; studio access retains the existing access behavior.
- Don't apply global framework resets or application typography rules that alter slide artwork.
