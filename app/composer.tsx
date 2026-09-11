import { Copy, Sparkles, X } from "lucide-react";
import { useRef, useState } from "react";
import { aiPrompt, type CarouselConfig, generateCarouselFromText, parseCarouselConfig, slideTypeface } from "./carousel";
import Dialog from "./dialog";

export type ComposerMode = "text" | "json";
type Notice = { kind: "success" | "error"; message: string } | null;

/**
 * Builds a whole deck from pasted text or a JSON config. The text draft belongs to
 * the editor so it survives closing the dialog; the JSON always starts from the
 * current deck.
 */
export default function Composer({ config, initialMode, sourceText, onSourceText, onApply, onClose }: {
  config: CarouselConfig;
  initialMode: ComposerMode;
  sourceText: string;
  onSourceText: (text: string) => void;
  onApply: (next: CarouselConfig) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(config, null, 2));
  const [message, setMessage] = useState<Notice>(null);
  const focusRef = useRef<HTMLTextAreaElement>(null);

  function apply() {
    try {
      onApply(mode === "json" ? parseCarouselConfig(jsonText) : {
        ...generateCarouselFromText(sourceText, config.author, config.theme, slideTypeface(config.slides[0] ?? {}, config.theme)),
        format: config.format,
        mark: config.mark,
        arrow: config.arrow,
      });
    } catch (error) {
      setMessage({ kind: "error", message: error instanceof Error ? error.message : "Could not create the carousel." });
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(aiPrompt(config));
      setMessage({ kind: "success", message: "Prompt copied. Add your source text in Claude or Codex." });
    } catch {
      setMessage({ kind: "error", message: "Could not copy the prompt. Check clipboard access and try again." });
    }
  }

  return (
    <Dialog labelId="composer-title" onDismiss={onClose} initialFocus={focusRef}>
      <section className="composer-dialog">
        <div className="dialog-header">
          <div><span className="dialog-icon"><Sparkles size={17} /></span><div><h2 id="composer-title">Create slides</h2></div></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mode-tabs">
          <button aria-pressed={mode === "text"} className={mode === "text" ? "active" : ""} type="button" onClick={() => setMode("text")}>Paste text</button>
          <button aria-pressed={mode === "json"} className={mode === "json" ? "active" : ""} type="button" onClick={() => setMode("json")}>JSON config</button>
        </div>
        {mode === "text" ? (
          <div className="composer-body">
            <label htmlFor="source-text">Source text</label>
            <textarea ref={focusRef} id="source-text" rows={12} value={sourceText} onChange={(event) => onSourceText(event.target.value)} placeholder="Paste an article, notes, or a rough idea. Separate sections with blank lines for more control…" />
            <p>Vertica turns each paragraph into a slide. You can edit every word afterward.</p>
          </div>
        ) : (
          <div className="composer-body">
            <div className="json-label"><label htmlFor="json-config">Carousel config</label><button type="button" onClick={() => { void copyPrompt(); }}><Copy size={13} /> Copy AI prompt</button></div>
            <textarea ref={focusRef} className="json-editor" id="json-config" rows={15} value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
            <p>Ask Claude or Codex to return this shape, then paste the result here.</p>
          </div>
        )}
        {message && <p className={`composer-message ${message.kind}`} role="status">{message.message}</p>}
        <div className="dialog-footer">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={apply}><Sparkles size={15} /> {mode === "text" ? "Create slides" : "Apply config"}</button>
        </div>
      </section>
    </Dialog>
  );
}
