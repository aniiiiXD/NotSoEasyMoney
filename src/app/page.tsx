import Link from "next/link";

export default function Home() {
  const demoAvailable = process.env.NODE_ENV === "development" && Boolean(process.env.AUTH_SECRET);
  return (
    <div className="landing" id="top">
      <header className="landing-header">
        <div className="landing-width header-content">
          <Link className="wordmark" href="/">Mystery Match</Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#our-approach">Our approach</a>
          </nav>
          <div className="header-links">
            <Link className="header-sign-in" href="/sign-in">Sign in</Link>
            <Link className="header-start" href="/join">Get started</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-width hero" aria-labelledby="hero-title">
          <div className="hero-content">
            <p className="section-label">A different way to date</p>
            <h1 id="hero-title">Get to know someone before you see them.</h1>
            <p className="hero-description">A good connection is more than a first impression. Start with personality and conversation. Photos can wait.</p>
            <div className="hero-actions">
              <Link className="landing-button" href={demoAvailable ? "/sign-in" : "/join"}>{demoAvailable ? "Try the demo" : "Get started"}</Link>
              <a className="landing-text-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            {demoAvailable && <p className="demo-hint">Explore a local preview with sample profiles and conversations.</p>}
          </div>
          <figure className="conversation-prompt">
            <figcaption>A question to start with</figcaption>
            <blockquote>What could you talk about for hours?</blockquote>
            <p>Good conversations begin somewhere.</p>
          </figure>
        </section>

        <section className="how-section" id="how-it-works" aria-labelledby="how-title">
          <div className="landing-width">
            <div className="section-heading">
              <p className="section-label">How it works</p>
              <h2 id="how-title">Start with who you are.</h2>
              <p>A little curiosity can go a long way. Here&apos;s where to begin.</p>
            </div>
            <ol className="steps">
              <li>
                <span className="step-number">01</span>
                <div>
                  <h3>Tell us about yourself</h3>
                  <p>Answer a few questions about who you are and what you&apos;re looking for.</p>
                </div>
              </li>
              <li>
                <span className="step-number">02</span>
                <div>
                  <h3>Find someone to connect with</h3>
                  <p>Your answers and preferences help guide who we suggest.</p>
                </div>
              </li>
              <li>
                <span className="step-number">03</span>
                <div>
                  <h3>Start a conversation</h3>
                  <p>Get to know each other without a photo making the first impression.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="landing-width approach-section" id="our-approach" aria-labelledby="approach-title">
          <div className="approach-heading">
            <p className="section-label">Our approach</p>
            <h2 id="approach-title">There&apos;s more to a person than a picture.</h2>
          </div>
          <div className="approach-copy">
            <p>What makes you laugh. The things you care about. How you spend a quiet Sunday. That&apos;s the good stuff, and it deserves to come first.</p>
            <Link className="landing-text-link" href="/join">Get started <span aria-hidden="true">→</span></Link>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="landing-width closing-content">
            <div>
              <p className="section-label">When you&apos;re ready</p>
              <h2 id="closing-title">Let&apos;s start with hello.</h2>
            </div>
            <Link className="landing-button" href="/join">Get started</Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-width footer-content">
          <div>
            <Link className="wordmark" href="/">Mystery Match</Link>
            <p>A little more getting to know you.</p>
          </div>
          <nav aria-label="Footer navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#our-approach">Our approach</a>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
