import Link from "next/link";
import { QUESTIONS } from "@/lib/personality";

export default function Home() {
  const startHref = "/join";
  const startLabel = "Find my match";

  return (
    <div className="landing" id="top">
      <header className="landing-header">
        <div className="landing-width header-content">
          <Link className="wordmark" href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#the-method">Why it works</a>
            <a href="#your-call">Socials, later</a>
          </nav>
          <div className="header-links">
            <Link className="header-sign-in" href="/sign-in">Sign in</Link>
            <Link className="header-start" href={startHref}>{startLabel}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-band" aria-labelledby="hero-title">
          <div className="landing-width hero">
            <div className="hero-content">
              <p className="section-label">Blind dating</p>
              <h1 id="hero-title">Stop swiping. <em>Let us match you.</em></h1>
              <p className="hero-description">Tired of being judged on one photo in half a second? Here nobody sees your face. Answer a few questions about who you really are, and we pair you with someone whose personality fits yours. No guessing, no endless scrolling. Every introduction is a match made by us.</p>
              <div className="hero-actions">
                <Link className="landing-button" href={startHref}>{startLabel}</Link>
                <a className="landing-text-link" href="#how-it-works">See how we match you <span aria-hidden="true">↓</span></a>
              </div>
            </div>
          </div>
        </section>

        <section className="promise-strip" aria-label="Our promises">
          <ul className="landing-width promises">
            <li><strong>0</strong><span>photos. Nobody judges you on a picture.</span></li>
            <li><strong>{QUESTIONS.length}</strong><span>quick questions. Skip any you like.</span></li>
            <li><strong>1</strong><span>match picked for you by personality, not by a swipe</span></li>
            <li><strong>2</strong><span>yeses and your private chat opens</span></li>
          </ul>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="landing-width">
            <div className="section-heading">
              <p className="section-label">How it works</p>
              <h2 id="how-title">You answer. We match. You talk.</h2>
              <p>No bio to write, no photos to pick, no swiping. We do the hard part.</p>
            </div>
            <ol className="steps">
              <li>
                <span className="step-number">01</span>
                <h3>Tell us who you are</h3>
                <p>Answer up to {QUESTIONS.length} quick questions about your personality and what matters to you in a relationship. Answer at least three and skip the rest. Then tell us who you&apos;d like to meet.</p>
              </li>
              <li>
                <span className="step-number">02</span>
                <h3>We read your personality</h3>
                <p>Your answers become a private personality profile. Nobody else ever sees it. Not your answers, not your name, not your face.</p>
              </li>
              <li>
                <span className="step-number">03</span>
                <h3>We find your closest fit</h3>
                <p>Out of everyone who&apos;s looking for someone like you, we pick the person whose personality is closest to yours and introduce you under a nickname.</p>
              </li>
              <li>
                <span className="step-number">04</span>
                <h3>Say hello</h3>
                <p>When you both say yes, a private chat opens. Talk for as long as you like. If it clicks, swap socials. If it doesn&apos;t, nobody ever saw your photo.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="method-section" id="the-method" aria-labelledby="method-title">
          <div className="landing-width method-grid">
            <div className="method-heading">
              <p className="section-label">Why it works</p>
              <h2 id="method-title">Matched on who you are, not how you look.</h2>
              <p>Swipe apps reward a good photo. We look at how you actually think, and then we make the match.</p>
            </div>
            <dl className="method-list">
              <div>
                <dt>Built on real psychology</dt>
                <dd>Seventeen questions come from the Mini-IPIP, a well-known measure of the Big Five personality traits used widely in psychology. Three come from OkCupid&apos;s research into the questions long-term couples most often agree on.</dd>
              </div>
              <div>
                <dt>Only people who want you too</dt>
                <dd>We only introduce you to someone when you both fit each other&apos;s gender and age preferences. No one-sided matches.</dd>
              </div>
              <div>
                <dt>Closest personality first</dt>
                <dd>We compare your answers question by question with everyone who fits. The person most like you comes first.</dd>
              </div>
              <div>
                <dt>Chemistry is yours</dt>
                <dd>We find the person most like you. Whether it sparks is up to the two of you.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="reveal-section" id="your-call" aria-labelledby="reveal-title">
          <div className="landing-width reveal-grid">
            <div className="reveal-copy">
              <p className="section-label">Socials, later</p>
              <h2 id="reveal-title">Get to know them first. Show your socials when you&apos;re ready.</h2>
              <p>Every conversation starts with nicknames, so you can be yourself without the pressure. If you both feel it, swap socials right in the chat.</p>
            </div>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="landing-width closing-content">
            <div>
              <p className="section-label">Your turn</p>
              <h2 id="closing-title">Someone might love how you think. Let us find them.</h2>
            </div>
            <Link className="landing-button landing-button-light" href={startHref}>{startLabel}</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-width footer-content">
          <div>
            <Link className="wordmark" href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
            <p>Blind dating. Matched by personality. No photos.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#the-method">Why it works</a>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
