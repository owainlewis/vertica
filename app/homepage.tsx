import { ArrowDown, ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { type CarouselConfig } from "./carousel";
import { Slide } from "./slide";

const example: CarouselConfig = {
  version: 1,
  title: "Make something worth saving",
  mark: "NOTES ON CREATING",
  author: "Made with Vertica",
  slides: [
    { id: "example-1", layout: "cover", title: "Make something|worth *saving.*", body: "Start with an idea only you could share." },
    { id: "example-2", layout: "content", title: "One slide.|One good idea.", body: "Share what you know. Say it simply. Give each thought room to land." },
    { id: "example-3", layout: "closing", title: "Your ideas.|Your voice.", body: "A little less noise. A little more you." },
  ],
};

type Tone = "paper" | "ink" | "sage";

export default function Homepage() {
  const [tone, setTone] = useState<Tone>("paper");

  return (
    <div className="home-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="home-header">
        <a className="home-brand" href="/" aria-label="Vertica home"><span className="app-symbol" aria-hidden="true">V</span>Vertica</a>
        <Button asChild variant="ghost" className="home-studio-link"><a href="/?view=carousels">Studio access <ArrowUpRight aria-hidden="true" /></a></Button>
      </header>
      <main id="main">
        <section className="home-hero" aria-labelledby="home-title">
          <h1 id="home-title">Build beautiful carousels<br className="home-title-break" /> for social media.</h1>
          <p>Grow your Instagram and LinkedIn with ideas worth sharing.<br className="home-copy-break" /> Your voice. Good design. No AI slop.</p>
          <Button asChild className="home-example-link"><a href="#example">See what you can make <ArrowDown aria-hidden="true" /></a></Button>
          <span className="home-availability">In development. Not open for sign-ups yet.</span>
        </section>
        <section id="example" className="home-example" aria-label="Example carousel">
          <div className="home-example-toolbar">
            <span>ONE IDEA. THREE SLIDES.</span>
            <ToggleGroup type="single" value={tone} onValueChange={(value) => { if (value) setTone(value as Tone); }} aria-label="Example colour theme" className="home-tones">
              {(["paper", "ink", "sage"] as const).map((value) => (
                <ToggleGroupItem key={value} value={value} aria-label={`${value[0].toUpperCase()}${value.slice(1)} theme`} className={`home-tone home-tone-${value}`}>
                  <span className="home-tone-swatch" aria-hidden="true">{tone === value && <Check size={12} />}</span>
                  <span className="home-tone-label">{value[0].toUpperCase()}{value.slice(1)}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {/* A focusable scroll region lets keyboard users reach slides off screen. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div role="region" className="home-slides" tabIndex={0} aria-label="Three example slides. Scroll horizontally on small screens.">
            {example.slides.map((slide, index) => <div className="home-slide" key={slide.id}><Slide slide={{ ...slide, tone: tone === "ink" ? "black" : tone }} config={example} index={index} /></div>)}
          </div>
          <div className="home-example-caption"><span>Real layouts from the studio.</span><span className="home-swipe-hint">Scroll to see all three →</span><span className="home-desktop-hint">Try a different colour above.</span></div>
        </section>
        <section className="home-details" aria-label="What Vertica does">
          <div><h2>Bring your own words.</h2><p>Turn your writing into a carousel. Shape each slide with your photos, colours and point of view.</p></div>
          <div><h2>Ready for the feed.</h2><p>Export JPEGs for Instagram or a PDF for LinkedIn. A consistent design from the first slide to the last.</p></div>
        </section>
      </main>
      <footer className="home-footer"><span>Vertica</span><span className="home-platforms"><span>Instagram</span><span aria-hidden="true">·</span><span>LinkedIn</span></span></footer>
    </div>
  );
}
