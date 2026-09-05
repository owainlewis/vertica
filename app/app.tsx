import { Images, LayoutGrid, LoaderCircle, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, loadCarousel, resolveMedia, signIn, type CarouselSummary } from "./api-client";
import { BRAND_FOOTER, BRAND_MARK, CarouselConfig } from "./carousel";
import Dashboard from "./dashboard";
import Editor, { type EditorHandle } from "./editor";
import MediaGallery from "./media-gallery";

type View =
  | { kind: "gallery" }
  | { kind: "media" }
  /**
   * `key` identifies which document is open and never changes while it is open.
   * The Editor used to be keyed on `id`, which is null until the first save lands
   * and then becomes real: React saw a new key, remounted the Editor, and re-seeded
   * its state from this stale `config`. Every brand new carousel silently threw away
   * whatever had been typed into it, and came back with a null version that the
   * server then refused, leaving the deck unsavable.
   */
  | { kind: "editor"; key: string; id: string | null; config: CarouselConfig; version: number | null };

/** A blank deck, so a new carousel does not open on last time's words. */
function emptyConfig(): CarouselConfig {
  return {
    version: 1,
    title: "Untitled carousel",
    author: BRAND_FOOTER,
    mark: BRAND_MARK,
    slides: [
      { id: `slide-${Date.now().toString(36)}`, layout: "cover", title: "Your headline here", body: "" },
    ],
  };
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(password);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signin-shell">
      <form className="signin-card" onSubmit={submit}>
        <span className="dialog-icon"><Lock size={17} /></span>
        <h1>Vertica</h1>
        <p>Enter the password to open your carousels.</p>
        <input
          type="password"
          aria-label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <span className="signin-error" role="status">{error}</span>}
        <button className="export-button" type="submit" disabled={busy || !password}>
          {busy ? <LoaderCircle className="spin" size={15} /> : null} Sign in
        </button>
      </form>
    </main>
  );
}

/**
 * The frame every screen shares: the mark and the two places you can be. It never
 * changes shape between the library and a deck, so opening a carousel feels like
 * moving within one room rather than into another app.
 */
function AppNav({ active, onNavigate }: { active: "gallery" | "media" | "editor"; onNavigate: (kind: "gallery" | "media") => void }) {
  return (
    <nav className="app-nav" aria-label="Main navigation">
      <button className="app-mark" type="button" onClick={() => onNavigate("gallery")} aria-label="Vertica home"><span className="app-symbol" aria-hidden="true">V</span><span>Vertica</span></button>
      <div className="app-nav-links">
        <button type="button" className={`app-nav-item ${active === "gallery" || active === "editor" ? "active" : ""}`} aria-current={active === "gallery" ? "page" : undefined} onClick={() => onNavigate("gallery")}>
          <LayoutGrid size={18} /> Carousels
        </button>
        <button type="button" className={`app-nav-item ${active === "media" ? "active" : ""}`} aria-current={active === "media" ? "page" : undefined} onClick={() => onNavigate("media")}>
          <Images size={18} /> Media
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  const [authorised, setAuthorised] = useState<boolean | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const [view, setView] = useState<View>({ kind: "gallery" });
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((session) => setAuthorised(!session.gated || session.authorised))
      .catch(() => setAuthorised(true));
  }, []);

  // Nothing here touches state before the first await, so calling it straight from
  // an effect does not schedule a render inside that effect's body.
  const openCarousel = useCallback(async (id: string, push = true) => {
    try {
      const { summary, config } = await loadCarousel(id);
      const painted = await resolveMedia(config);
      setError(null);
      setView({ kind: "editor", key: id, id, config: painted, version: summary.version });
      // Arriving here from popstate means the entry is already the current one.
      // Pushing again appended a duplicate, so Back could never reach the gallery.
      if (push) window.history.pushState({ id }, "", `/?id=${id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that carousel.");
    }
  }, []);

  // A deep link opens straight into the editor. Cancelled if the view moves on
  // before the fetch lands, so a slow load cannot overwrite a later choice.
  useEffect(() => {
    if (authorised !== true) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (!id) {
      let live = true;
      if (params.get("view") === "media") {
        queueMicrotask(() => { if (live) setView({ kind: "media" }); });
      }
      return () => { live = false; };
    }

    let live = true;
    loadCarousel(id)
      .then(async ({ summary, config }) => ({ config: await resolveMedia(config), version: summary.version }))
      .then(({ config, version }) => { if (live) setView({ kind: "editor", key: id, id, config, version }); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not open that carousel."); });
    return () => { live = false; };
  }, [authorised]);

  // The back button returns to whatever the URL says.
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("id");
      if (next) void openCarousel(next, false);
      else setView({ kind: params.get("view") === "media" ? "media" : "gallery" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openCarousel]);

  function createCarousel() {
    setView({ kind: "editor", key: `new-${Date.now().toString(36)}`, id: null, config: emptyConfig(), version: null });
    window.history.pushState({}, "", "/");
  }

  function exitToGallery() {
    setView({ kind: "gallery" });
    setReloadToken((token) => token + 1);
    window.history.pushState({}, "", "/");
  }

  function showLibrary(kind: "gallery" | "media") {
    setView({ kind });
    if (kind === "gallery") setReloadToken((token) => token + 1);
    window.history.pushState({}, "", kind === "media" ? "/?view=media" : "/");
  }

  // Leaving an open deck through the rail flushes its queued edits first, the same
  // as the crumb inside the editor does, so no route out of a deck can lose work.
  async function navigate(kind: "gallery" | "media") {
    if (view.kind === "editor") {
      const saved = await (editorRef.current?.flush() ?? Promise.resolve(true));
      if (!saved) return;
    }
    showLibrary(kind);
  }

  function handleSaved(summary: CarouselSummary) {
    // Only the id is adopted here. The editor owns the live version, and writing a
    // stale one back into view state would make its next save look out of date.
    setView((current) => (current.kind === "editor" && !current.id ? { ...current, id: summary.id } : current));
    window.history.replaceState({ id: summary.id }, "", `/?id=${summary.id}`);
  }

  if (authorised === null) {
    return <main className="signin-shell"><LoaderCircle className="spin" size={22} /></main>;
  }

  if (!authorised) {
    return <SignIn onDone={() => setAuthorised(true)} />;
  }

  return (
    <div className="app">
      {error && <div className="toast error" role="status">{error}</div>}
      <AppNav active={view.kind} onNavigate={(kind) => { void navigate(kind); }} />
      <div className="app-main">
        {view.kind === "editor" ? (
          <Editor
            ref={editorRef}
            key={view.key}
            carouselId={view.id}
            initialConfig={view.config}
            initialVersion={view.version}
            onExit={exitToGallery}
            onSaved={handleSaved}
          />
        ) : view.kind === "media" ? (
          <MediaGallery />
        ) : (
          <Dashboard onOpen={openCarousel} onCreate={createCarousel} reloadToken={reloadToken} />
        )}
      </div>
    </div>
  );
}
