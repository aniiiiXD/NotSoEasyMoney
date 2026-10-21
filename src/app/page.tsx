import Link from "next/link";
import { QUESTIONS } from "@/lib/personality";

export default function Home() {
  const startHref = "/join";
  const startLabel = "Get started";

  return (
    <div className="landing" id="top">
      <header className="landing-header">
        <div className="landing-width header-content">
          <Link className="wordmark" href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#the-method">The method</a>
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
              <p className="section-label">Blind dating, by method</p>
              <h1 id="hero-title">No photos. <em>Just the person.</em></h1>
              <p className="hero-description">Everyone sees the same questionnaire and sets their dating preferences. Answer at least three questions and skip the rest if you like. We compare your answers to suggest introductions. You talk here, and only swap socials if you both want to.</p>
              <div className="hero-actions">
                <Link className="landing-button" href="/join">Take the questionnaire</Link>
                <a className="landing-text-link" href="#how-it-works">See how matching works <span aria-hidden="true">↓</span></a>
              </div>
            </div>

          </div>
        </section>

        <section className="promise-strip" aria-label="Our promises">
          <ul className="landing-width promises">
            <li><strong>0</strong><span>photos, ever. We never ask for one.</span></li>
            <li><strong>{QUESTIONS.length}</strong><span>questions to explore, with skips allowed</span></li>
            <li><strong>2</strong><span>yeses before any conversation opens</span></li>
            <li><strong>You</strong><span>decide if socials are exchanged</span></li>
          </ul>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="landing-width">
            <div className="section-heading">
              <p className="section-label">How it works</p>
              <h2 id="how-title">From answers to a first hello.</h2>
              <p>Four steps. None of them involve a picture.</p>
            </div>
            <ol className="steps">
              <li>
                <span className="step-number">01</span>
                <h3>Fill in the questionnaire</h3>
                <p>Explore 20 questions drawn from a personality scale and dating research. Answer at least three and skip any that don&apos;t fit. You also set your dating preferences: who you&apos;d like to meet and the age range you&apos;re open to.</p>
              </li>
              <li>
                <span className="step-number">02</span>
                <h3>Become a vector</h3>
                <p>Each answer is placed on a scale from 0 to 1. Together they form your profile vector, a private set of numbers that is never shown to anyone.</p>
              </li>
              <li>
                <span className="step-number">03</span>
                <h3>Similarity search</h3>
                <p>Among people whose preferences fit yours, and yours theirs, we rank who is closest to you. You see them under a nickname, never a face.</p>
              </li>
              <li>
                <span className="step-number">04</span>
                <h3>Talk, then decide</h3>
                <p>When you both say hello, a private chat opens here. If it clicks, you can choose to swap socials. If not, no one ever saw your photo.</p>
              </li>
            </ol>
          </div>
        </section>

        <section className="method-section" id="the-method" aria-labelledby="method-title">
          <div className="landing-width method-grid">
            <div className="method-heading">
              <p className="section-label">The method</p>
              <h2 id="method-title">Matching you can actually explain.</h2>
              <p>No black box and no swiping on looks. Here is exactly what happens to your answers.</p>
            </div>
            <dl className="method-list">
              <div>
                <dt>Questions from research</dt>
                <dd>Seventeen questions come from the Mini-IPIP, a short, public-domain measure of the Big Five personality traits used widely in psychology. Three come from OkCupid&apos;s analysis of the questions long-term couples most often agreed on.</dd>
              </div>
              <div>
                <dt>Preferences come first</dt>
                <dd>You&apos;re only introduced when both people fall within each other&apos;s gender and age preferences. This is a hard rule, not a weight.</dd>
              </div>
              <div>
                <dt>Answers become numbers</dt>
                <dd>Each answer on the five-point scale becomes a value between 0 and 1. A skipped question is left out, never guessed.</dd>
              </div>
              <div>
                <dt>Closest first</dt>
                <dd>We compare vectors question by question, using only questions you both answered, and at least three of them. The smallest average difference ranks highest.</dd>
              </div>
              <div>
                <dt>Honest about limits</dt>
                <dd>Similarity decides who you meet first. It can&apos;t predict chemistry. That part is up to the conversation.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="reveal-section" id="your-call" aria-labelledby="reveal-title">
          <div className="landing-width reveal-grid">
            <div className="reveal-copy">
              <p className="section-label">Socials, later</p>
              <h2 id="reveal-title">Share your socials only if you both want to.</h2>
              <p>Every conversation starts with nicknames. If you both feel comfortable, you can choose to share your socials in your conversation.</p>
            </div>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="landing-width closing-content">
            <div>
              <p className="section-label">When you&apos;re ready</p>
              <h2 id="closing-title">Let someone get to know you first.</h2>
            </div>
            <Link className="landing-button landing-button-light" href={startHref}>{startLabel}</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-width footer-content">
          <div>
            <Link className="wordmark" href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
            <p>Blind dating by questionnaire. No photos, ever.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#the-method">The method</a>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
