import Link from "next/link";
import { SAMPLE_PROFILES, SAMPLE_VIEWER_ANSWERS } from "@/lib/demo";
import { normalizeAnswers, QUESTION_IDS, QUESTIONS, type PersonalityQuestionId } from "@/lib/personality";

// A few of the twenty questions, with short labels for the illustrative vector card.
const SHOWN: { id: PersonalityQuestionId; label: string }[] = [
  { id: "life_of_party", label: "Life of the party" },
  { id: "feel_emotions", label: "Feels others' emotions" },
  { id: "like_order", label: "Likes order" },
  { id: "upset_easily", label: "Gets upset easily" },
  { id: "vivid_imagination", label: "Vivid imagination" },
  { id: "horror_movies", label: "Likes horror movies" },
];

// The demo's sample answers compared with a fictional profile, using every question.
function exampleComparison() {
  const sample = SAMPLE_PROFILES[0];
  const you = normalizeAnswers(SAMPLE_VIEWER_ANSWERS);
  const them = normalizeAnswers(sample.answers);
  const difference = QUESTION_IDS.reduce((total, id) => total + Math.abs((you[id] ?? 0) - (them[id] ?? 0)), 0);
  return {
    alias: sample.alias.replace(" (sample)", ""),
    rows: SHOWN.map(({ id, label }) => ({ id, label, you: you[id] ?? 0, them: them[id] ?? 0 })),
    similarity: Math.round((1 - difference / QUESTION_IDS.length) * 100),
  };
}

export default function Home() {
  const demoAvailable = process.env.NODE_ENV === "development" && Boolean(process.env.AUTH_SECRET);
  const hostedPreview = Boolean(process.env.VERCEL);
  const startHref = hostedPreview ? "/preview" : "/join";
  const startLabel = hostedPreview ? "Try the demo" : "Get started";
  const heroHref = hostedPreview ? "/preview" : demoAvailable ? "/sign-in" : "/join";
  const heroLabel = hostedPreview || demoAvailable ? "Try the demo" : "Take the questionnaire";
  const comparison = exampleComparison();

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
              <p className="hero-description">Everyone answers the same questionnaire and sets their dating preferences. We turn your answers into a vector and use similarity search to find the people closest to you. You talk here, and only swap socials if you both want to.</p>
              <div className="hero-actions">
                <Link className="landing-button" href={heroHref}>{heroLabel}</Link>
                <a className="landing-text-link" href="#how-it-works">See how matching works <span aria-hidden="true">↓</span></a>
              </div>
              {(demoAvailable || hostedPreview) && <p className="demo-hint">The demo uses fictional profiles and scripted replies.</p>}
            </div>

            <figure className="vector-card" aria-labelledby="vector-caption">
              <div className="vector-card-top">
                <span id="vector-caption">Two profiles, as vectors</span>
                <span className="vector-tag">Example</span>
              </div>
              <div className="vector-legend" aria-hidden="true">
                <span><i className="dot dot-you" />You</span>
                <span><i className="dot dot-them" />{comparison.alias}</span>
              </div>
              <ul className="vector-rows">
                {comparison.rows.map((row) => (
                  <li key={row.id}>
                    <div className="vector-row-label"><span>{row.label}</span><span className="vector-range">Not me to Very me</span></div>
                    <div className="vector-track" aria-hidden="true">
                      <i className="dot dot-them" style={{ left: `${row.them * 100}%` }} />
                      <i className="dot dot-you" style={{ left: `${row.you * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="vector-result">
                <span>Similarity</span>
                <strong>{comparison.similarity}%</strong>
              </div>
              <p className="vector-footnote">Showing 6 of {QUESTIONS.length} questions. No photo, name, or face anywhere in the comparison.</p>
            </figure>
          </div>
        </section>

        <section className="promise-strip" aria-label="Our promises">
          <ul className="landing-width promises">
            <li><strong>0</strong><span>photos, ever. We never ask for one.</span></li>
            <li><strong>{QUESTIONS.length}</strong><span>research-based questions every member answers</span></li>
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
                <p>Everyone answers the same 20 questions, drawn from a published personality scale and dating research, plus their dating preferences: who you&apos;d like to meet and the age range you&apos;re open to.</p>
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
              <p>Every conversation starts anonymous. When it feels right, either of you can offer to swap socials. They&apos;re only revealed if both of you agree. Until then, you&apos;re just two nicknames talking.</p>
            </div>
            <div className="chat-mock" aria-hidden="true">
              <div className="chat-mock-top"><span className="avatar-blank">S</span><div><strong>Sage</strong><span>Matched by similarity</span></div></div>
              <p className="bubble bubble-them">Okay, a bookshop then a long dinner. That&apos;s my perfect Sunday too.</p>
              <p className="bubble bubble-you">Honestly, this is the best conversation I&apos;ve had on a dating app.</p>
              <div className="swap-card">
                <span className="swap-icon">@</span>
                <div><strong>Swap socials?</strong><span>Shared only if you both say yes</span></div>
                <div className="swap-status"><span className="swap-yes">You ✓</span><span>Sage …</span></div>
              </div>
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
