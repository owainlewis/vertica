import { lazy, Suspense, useEffect, useState } from "react";
import Homepage from "./homepage";
import { isStudioLocation } from "./routes";

const Studio = lazy(() => import("./app"));

/** The public page never asks for a session or loads private carousel data. */
export default function Root() {
  const [studio, setStudio] = useState(() => isStudioLocation(window.location));
  useEffect(() => {
    const syncRoute = () => setStudio(isStudioLocation(window.location));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);
  useEffect(() => {
    document.title = studio ? "Vertica | Carousel studio" : "Vertica | Build beautiful carousels for social media";
  }, [studio]);
  return studio ? <Suspense fallback={<main className="signin-shell" role="status">Opening studio…</main>}><Studio /></Suspense> : <Homepage />;
}
