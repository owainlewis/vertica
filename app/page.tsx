"use client";

import { Images, LayoutGrid, LoaderCircle, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSession, inlineBackgrounds, loadCarousel, signIn, type CarouselSummary } from "./api-client";
import { BRAND_FOOTER, BRAND_MARK, CarouselConfig } from "./carousel";
import Dashboard from "./dashboard";
import Editor from "./editor";
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
    template: "editorial",
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

export default function Home() {
  const [authorised, setAuthorised] = useState<boolean | null>(null);
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
      const painted = await inlineBackgrounds(config);
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
      .then(async ({ summary, config }) => ({ config: await inlineBackgrounds(config), version: summary.version }))
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

  if (view.kind === "editor") {
    return (
      <Editor
        key={view.key}
        carouselId={view.id}
        initialConfig={view.config}
        initialVersion={view.version}
        onExit={exitToGallery}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div className="library-shell">
      {error && <div className="toast error" role="status">{error}</div>}
      <aside className="library-nav" aria-label="Main navigation">
        <span className="brand"><span className="brand-mark">V</span><span>Vertica</span></span>
        <nav>
          <button type="button" className={view.kind === "gallery" ? "active" : ""} aria-current={view.kind === "gallery" ? "page" : undefined} onClick={() => showLibrary("gallery")}><LayoutGrid size={17} /> Carousels</button>
          <button type="button" className={view.kind === "media" ? "active" : ""} aria-current={view.kind === "media" ? "page" : undefined} onClick={() => showLibrary("media")}><Images size={17} /> Media</button>
        </nav>
        <p>Images now. Video backgrounds can join this library later.</p>
      </aside>
      {view.kind === "media"
        ? <MediaGallery />
        : <Dashboard onOpen={openCarousel} onCreate={createCarousel} reloadToken={reloadToken} />}
    </div>
  );
}
