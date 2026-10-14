/**
 * Redraws a sanitised diagram as pen and pencil work: a graphite underdrawing
 * beneath every inked line, a wavering nib, pencil hatching for tinted shapes,
 * construction lines that overshoot each box, and a hatched cast shadow.
 *
 * It reads the sanitiser's output, never raw input, so every tag it meets was
 * already rebuilt from allowed attributes. What it adds is generated here. It
 * works on strings rather than the DOM because slides also render on the server.
 *
 * Ink is `currentColor`, so a drawing takes the slide's ink on any ground.
 */

type Element = { name: string; attributes: [string, string][]; children: Node[] };
type Node = Element | string;

type Paint = {
  stroke?: string;
  fill?: string;
  strokeWidth: number;
  fontSize: number;
  anchor: string;
  transformed: boolean;
};

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
/** Definitions and text are left as written; only visible line work is redrawn. */
const UNTOUCHED = new Set([
  "defs", "marker", "pattern", "clippath", "mask", "symbol", "filter",
  "lineargradient", "radialgradient", "title", "desc", "text",
]);

function decode(value: string) {
  return value.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function encode(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The sanitiser emits `<name a="v">`, `<name/>`, `</name>` and encoded text, nothing else. */
function parse(svg: string): Element | null {
  const root: Element = { name: "#root", attributes: [], children: [] };
  const stack = [root];
  const pattern = /<(\/?)([a-z][\w:.-]*)((?:\s+[^\s=]+="[^"]*")*)\s*(\/?)>|([^<]+)/gi;
  for (const match of svg.matchAll(pattern)) {
    const parent = stack[stack.length - 1];
    if (match[5] !== undefined) {
      parent.children.push(match[5]);
      continue;
    }
    if (match[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = [...match[3].matchAll(/([^\s=]+)="([^"]*)"/g)].map(([, name, value]) => [name, decode(value)] as [string, string]);
    const element: Element = { name: match[2].toLowerCase(), attributes, children: [] };
    parent.children.push(element);
    if (!match[4]) stack.push(element);
  }
  const svgRoot = root.children.find((child): child is Element => typeof child !== "string" && child.name === "svg");
  return svgRoot ?? null;
}

function serialize(node: Node): string {
  if (typeof node === "string") return node;
  const attributes = node.attributes.map(([name, value]) => ` ${name}="${encode(value)}"`).join("");
  return node.children.length
    ? `<${node.name}${attributes}>${node.children.map(serialize).join("")}</${node.name}>`
    : `<${node.name}${attributes}/>`;
}

function get(element: Element, name: string) {
  const style = element.attributes.find(([key]) => key.toLowerCase() === "style")?.[1];
  if (style) {
    for (const declaration of style.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0 && declaration.slice(0, colon).trim().toLowerCase() === name) return declaration.slice(colon + 1).trim();
    }
  }
  return element.attributes.find(([key]) => key.toLowerCase() === name)?.[1];
}

function set(element: Element, name: string, value: string) {
  const at = element.attributes.findIndex(([key]) => key.toLowerCase() === name);
  if (at >= 0) element.attributes[at] = [name, value];
  else element.attributes.push([name, value]);
}

function without(element: Element, ...names: string[]) {
  element.attributes = element.attributes.filter(([key]) => !names.includes(key.toLowerCase()));
}

function number(value: string | undefined, fallback = 0) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inherit(element: Element, paint: Paint): Paint {
  return {
    stroke: get(element, "stroke") ?? paint.stroke,
    fill: get(element, "fill") ?? paint.fill,
    strokeWidth: number(get(element, "stroke-width"), paint.strokeWidth),
    fontSize: number(get(element, "font-size"), paint.fontSize),
    anchor: get(element, "text-anchor") ?? paint.anchor,
    transformed: paint.transformed || Boolean(get(element, "transform")),
  };
}

const isNone = (value?: string) => !value || /^(none|transparent)$/i.test(value.trim());
const isInk = (value?: string) => !value || /^(currentcolor|black|#000|#000000)$/i.test(value.trim());

function classes(element: Element) {
  return (get(element, "class") ?? "").split(/\s+/);
}

/** A tinted fill is drawn as hatching; a solid ink fill, like an arrowhead, stays solid. */
function hatching(element: Element, paint: Paint): "hatch" | "crosshatch" | null {
  const names = classes(element);
  if (names.includes("crosshatch")) return "crosshatch";
  if (names.includes("hatch")) return "hatch";
  if (element.name === "line" || element.name === "polyline") return null;
  if (isNone(paint.fill) || isInk(paint.fill)) return null;
  return "hatch";
}

/** Small integer hash so a slide redraws identically in the editor and the export. */
function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function clone(element: Element, className: string, overrides: Record<string, string>): Element {
  const copy: Element = { name: element.name, attributes: element.attributes.map(([key, value]) => [key, value]), children: [] };
  without(copy, "id", "class", "style", "marker-start", "marker-mid", "marker-end", "mask", "clip-path", "filter");
  set(copy, "class", className);
  for (const [key, value] of Object.entries(overrides)) set(copy, key, value);
  return copy;
}

function shape(name: string, attributes: Record<string, string>): Element {
  return { name, attributes: Object.entries(attributes), children: [] };
}

type Label = { x: number; y: number; width: number; height: number };

function textContent(node: Node): string {
  return typeof node === "string" ? decode(node) : node.children.map(textContent).join("");
}

/**
 * Hatching stops short of lettering, as a draughtsman leaves paper clear before
 * writing a label. Text is measured by estimate because there is no layout here;
 * the margin around each label absorbs the difference between fonts.
 */
function labelBox(element: Element, paint: Paint): Label | null {
  const text = textContent(element).trim();
  if (!text || paint.transformed) return null;
  const size = paint.fontSize;
  const width = text.length * size * 0.56;
  const x = number(get(element, "x")?.split(/[\s,]+/)[0]);
  const y = number(get(element, "y")?.split(/[\s,]+/)[0]);
  const left = paint.anchor === "middle" ? x - width / 2 : paint.anchor === "end" ? x - width : x;
  return { x: left - size * 0.3, y: y - size * 0.95, width: width + size * 0.6, height: size * 1.35 };
}

function definitions(id: (name: string) => string, scale: number, bounds: string, seed: number) {
  const grain = (result: string, s: number) =>
    `<feTurbulence type="fractalNoise" baseFrequency="${(1.1 / scale).toFixed(3)}" numOctaves="2" seed="${s}" result="${result}"/>` +
    `<feColorMatrix in="${result}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.3 0 0 0 -0.55" result="${result}a"/>`;
  const wobble = (input: string, frequency: number, amount: number, s: number, result: string) =>
    `<feTurbulence type="fractalNoise" baseFrequency="${(frequency / scale).toFixed(4)}" numOctaves="2" seed="${s}" result="${result}n"/>` +
    `<feDisplacementMap in="${input}" in2="${result}n" scale="${(amount * scale).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
  const hatchLines = (lines: [number, number, number][], size: number, angle: number, name: string) =>
    `<pattern id="${id(name)}" patternUnits="userSpaceOnUse" width="${size * scale}" height="${size * scale}" patternTransform="rotate(${angle})">` +
    lines.map(([x, width, opacity]) =>
      `<line x1="${x * scale}" y1="${-2 * scale}" x2="${x * scale}" y2="${(size + 2) * scale}" stroke="currentColor" stroke-width="${width * scale}" stroke-opacity="${opacity}"/>`).join("") +
    `</pattern>`;
  return `<defs>` +
    `<filter id="${id("ink")}" filterUnits="userSpaceOnUse" ${bounds}>${wobble("SourceGraphic", 0.014, 3.2, seed % 97, "a")}${wobble("a", 0.6, 1.2, (seed >> 3) % 97, "b")}</filter>` +
    `<filter id="${id("ink2")}" filterUnits="userSpaceOnUse" ${bounds}>${wobble("SourceGraphic", 0.02, 4.4, (seed >> 5) % 97, "a")}</filter>` +
    `<filter id="${id("pencil")}" filterUnits="userSpaceOnUse" ${bounds}>${wobble("SourceGraphic", 0.02, 3, (seed >> 7) % 97, "a")}${grain("g", 2)}<feComposite in="a" in2="ga" operator="in"/></filter>` +
    `<filter id="${id("under")}" filterUnits="userSpaceOnUse" ${bounds}><feOffset dx="${2.4 * scale}" dy="${-1.8 * scale}" result="o"/>${wobble("o", 0.011, 7, (seed >> 9) % 97, "a")}${grain("g", 9)}<feComposite in="a" in2="ga" operator="in"/></filter>` +
    `<filter id="${id("hatchwob")}" filterUnits="userSpaceOnUse" ${bounds}>${wobble("SourceGraphic", 0.035, 5, (seed >> 11) % 97, "a")}${grain("g", 4)}<feComposite in="a" in2="ga" operator="in"/></filter>` +
    hatchLines([[1, 1.25, 0.62], [8.5, 0.85, 0.5], [17, 1.05, 0.56]], 25, 40, "hatch") +
    hatchLines([[2, 0.9, 0.5], [11, 1.1, 0.42], [19.5, 0.8, 0.48]], 27, -48, "cross") +
    hatchLines([[0, 1.3, 0.85]], 5, 40, "shadow") +
    `</defs>`;
}

export function drawnSvg(svg: string, key = "diagram"): string {
  const root = parse(svg);
  if (!root || !root.children.length) return svg;

  const viewBox = (get(root, "viewbox") ?? "0 0 800 500").split(/[\s,]+/).map((value) => number(value));
  const [minX, minY, width, height] = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? viewBox : [0, 0, 800, 500];
  // Line weights and textures are tuned on an 800-unit drawing and scale with it.
  const scale = width / 800;
  const seed = hash(svg);
  const prefix = `drawn-${key.replace(/[^\w-]/g, "")}-${seed.toString(36)}`;
  const id = (name: string) => `${prefix}-${name}`;
  const url = (name: string) => `url(#${id(name)})`;
  const bounds = `x="${minX - width}" y="${minY - height}" width="${width * 3}" height="${height * 3}"`;
  let random = seed;
  const next = () => ((random = (Math.imul(random, 1103515245) + 12345) >>> 0) / 4294967296);

  const labels: Label[] = [];
  const hatches: Element[] = [];

  function visit(element: Element, paint: Paint) {
    const drawn: Node[] = [];
    for (const child of element.children) {
      if (typeof child === "string") { drawn.push(child); continue; }
      const own = inherit(child, paint);
      if (child.name === "text") {
        const label = labelBox(child, own);
        if (label) labels.push(label);
        drawn.push(child);
        continue;
      }
      if (UNTOUCHED.has(child.name)) { drawn.push(child); continue; }
      if (!SHAPES.has(child.name)) { visit(child, own); drawn.push(child); continue; }

      const stroked = !isNone(own.stroke);
      const fill = hatching(child, own);
      const weight = own.strokeWidth;
      const before: Element[] = [];
      const after: Element[] = [];

      // A dashed outline marks an empty slot: it gets no construction lines or shadow.
      const dashed = !isNone(get(child, "stroke-dasharray"));
      if (child.name === "rect" && stroked && !dashed) {
        const x = number(get(child, "x")), y = number(get(child, "y"));
        const w = number(get(child, "width")), h = number(get(child, "height"));
        const reach = () => (14 + next() * 30) * scale;
        before.push(shape("path", {
          class: "drawn-construction", fill: "none", stroke: "currentColor", "stroke-width": String(1.1 * scale),
          "stroke-opacity": "0.55", filter: url("pencil"),
          d: `M${x - reach()} ${y}H${x + w + reach()}M${x - reach()} ${y + h}H${x + w + reach()}M${x} ${y - reach()}V${y + h + reach()}M${x + w} ${y - reach()}V${y + h + reach()}`,
        }));
        // Boxes cast a narrow shadow down and right. Frames that fill the drawing do not.
        if (w < width * 0.8 && h < height * 0.7) {
          const d = 8 * scale;
          before.push(shape("path", {
            class: "drawn-shadow", fill: url("shadow"), stroke: "none", filter: url("pencil"),
            d: `M${x + w} ${y + d}H${x + w + d}V${y + h + d}H${x + d}V${y + h}H${x + w}Z`,
          }));
        }
      }
      if (fill) {
        const layer = clone(child, "drawn-hatch", { fill: url("hatch"), "fill-opacity": "1", stroke: "none", filter: url("hatchwob") });
        before.push(layer);
        if (!own.transformed) hatches.push(layer);
        if (fill === "crosshatch") {
          const cross = clone(child, "drawn-hatch", { fill: url("cross"), "fill-opacity": "1", stroke: "none", filter: url("hatchwob") });
          before.push(cross);
          if (!own.transformed) hatches.push(cross);
        }
      }
      if (stroked) {
        before.push(clone(child, "drawn-pencil", {
          fill: "none", stroke: "currentColor", "stroke-width": String(Math.max(weight * 0.65, 0.8 * scale)),
          "stroke-opacity": "0.6", filter: url("under"),
        }));
        after.push(clone(child, "drawn-ink", {
          fill: "none", stroke: "currentColor", "stroke-width": String(weight * 0.45),
          "stroke-opacity": "0.6", filter: url("ink2"),
        }));
      }
      if (fill) set(child, "fill", "none");
      set(child, "filter", url("ink"));
      drawn.push(...before, child, ...after);
    }
    element.children = drawn;
  }

  // The root's own paint is where most diagrams set their stroke, so it is inherited too.
  visit(root, inherit(root, { stroke: undefined, fill: undefined, strokeWidth: 1, fontSize: 16, anchor: "start", transformed: false }));

  let defs = definitions(id, scale, bounds, seed);
  if (labels.length && hatches.length) {
    const holes = labels.map((label) =>
      `<rect x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" width="${label.width.toFixed(1)}" height="${label.height.toFixed(1)}" rx="${(6 * scale).toFixed(1)}" fill="black"/>`).join("");
    defs = defs.replace("</defs>",
      `<mask id="${id("clear")}" maskUnits="userSpaceOnUse" ${bounds}><rect ${bounds} fill="white"/>${holes}</mask></defs>`);
    for (const layer of hatches) set(layer, "mask", url("clear"));
  }

  set(root, "class", [get(root, "class"), "drawn-diagram"].filter(Boolean).join(" "));
  return serialize(root).replace(/^(<svg[^>]*>)/, `$1${defs}`);
}
