"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SAMPLE_PROFILES } from "@/lib/demo";
import { rankCandidates, type MatchingProfile } from "@/lib/matching";
import {
  normalizeAnswers,
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  type AnswerValue,
  type PersonalityAnswers,
} from "@/lib/personality";
import styles from "./preview.module.css";

type Screen = "profile" | "questions" | "introductions" | "match" | "chat" | "analytics";
type DemoScreen = Exclude<Screen, "analytics">;
type Message = { from: "you" | "sample"; text: string };

const sampleAnswers: PersonalityAnswers = {
  social_setting: 2,
  planning_style: 3,
  novelty: 4,
  conversation_style: 3,
  message_frequency: 3,
  date_atmosphere: 2,
};

function emptyAnswers(): PersonalityAnswers {
  return {
    social_setting: null,
    planning_style: null,
    novelty: null,
    conversation_style: null,
    message_frequency: null,
    date_atmosphere: null,
  };
}

const sampleDetails: Record<string, { description: string; opening: string; replies: string[] }> = {
  sage: {
    description: "A slow coffee, a good question, and the occasional spontaneous plan.",
    opening: "Hello! Would you rather spend a Sunday in a bookshop or cooking something new?",
    replies: [
      "That sounds lovely. I like plans that leave a little room for surprise.",
      "I’d bring a good playlist and make an afternoon of it.",
      "This has been a nice little imaginary conversation.",
    ],
  },
  river: {
    description: "Curious about new places, lively evenings, and stories that make you laugh.",
    opening: "Hi there! What’s a small adventure you’d say yes to this weekend?",
    replies: [
      "I like the sound of that. Exploring somewhere new is always tempting.",
      "I’d be happy to get a little lost along the way.",
      "This has been a nice little imaginary conversation.",
    ],
  },
  ember: {
    description: "Drawn to thoughtful conversations, familiar places, and noticing the little things.",
    opening: "Hello! What’s something small that made your day a little better?",
    replies: [
      "Those are the moments I like hearing about.",
      "A quiet walk and a long conversation would make my list too.",
      "This has been a nice little imaginary conversation.",
    ],
  },
};

// These figures describe a fictional cohort, not visitors or events in this demo.
const exampleFunnel = [
  { label: "Started a profile", count: 240 },
  { label: "Finished a profile", count: 198 },
  { label: "Saw an introduction", count: 156 },
  { label: "Made a mutual match", count: 96 },
  { label: "Sent a first message", count: 60 },
] as const;

function demoMatchingProfile(id: string, answers: PersonalityAnswers): MatchingProfile {
  return {
    userId: id,
    active: true,
    age: 27,
    gender: "sample",
    preferences: { acceptedGenders: ["sample"], minAge: 18, maxAge: 99 },
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    vector: normalizeAnswers(answers),
    blockedUserIds: [],
    excludedUserIds: [],
  };
}

export default function Preview() {
  const [screen, setScreen] = useState<Screen>("profile");
  const [returnScreen, setReturnScreen] = useState<DemoScreen>("profile");
  const [nickname, setNickname] = useState("");
  const [answers, setAnswers] = useState<PersonalityAnswers>(emptyAnswers);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [usedSampleAnswers, setUsedSampleAnswers] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const question = QUESTIONS[questionIndex];
  const selectedSample = SAMPLE_PROFILES.find(({ key }) => key === selectedKey);
  const selectedDetails = selectedKey ? sampleDetails[selectedKey] : undefined;
  const chatMessages = selectedKey ? messages[selectedKey] ?? [] : [];
  const answeredCount = Object.values(answers).filter((answer) => answer !== null).length;

  const introductions = useMemo(() => {
    const viewer = demoMatchingProfile("viewer", answers);
    const ranked = rankCandidates(viewer, SAMPLE_PROFILES.map((sample) => ({
      candidateId: sample.key,
      blindAlias: sample.alias,
      profile: demoMatchingProfile(sample.key, sample.answers),
    })));

    // The matching heuristic needs three shared answers. The demo still has
    // something to explore when someone chooses to skip more questions.
    const order = ranked.length ? ranked.map(({ candidateId }) => candidateId) : SAMPLE_PROFILES.map(({ key }) => key);
    return order.flatMap((key) => {
      const sample = SAMPLE_PROFILES.find((profile) => profile.key === key);
      return sample ? [sample] : [];
    });
  }, [answers]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [screen, questionIndex]);

  useEffect(() => {
    if (screen === "chat" && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, screen, selectedKey]);

  function startOver() {
    setScreen("profile");
    setReturnScreen("profile");
    setNickname("");
    setAnswers(emptyAnswers());
    setQuestionIndex(0);
    setUsedSampleAnswers(false);
    setSelectedKey(null);
    setMessages({});
    setDraft("");
  }

  function goToQuestions() {
    setUsedSampleAnswers(false);
    setQuestionIndex(0);
    setScreen("questions");
  }

  function useSampleProfile() {
    setAnswers({ ...sampleAnswers });
    setUsedSampleAnswers(true);
    setScreen("introductions");
  }

  function nextQuestion() {
    if (questionIndex === QUESTIONS.length - 1) {
      setScreen("introductions");
    } else {
      setQuestionIndex((current) => current + 1);
    }
  }

  function skipQuestion() {
    setAnswers((current) => ({ ...current, [question.id]: null }));
    nextQuestion();
  }

  function previousQuestion() {
    if (questionIndex === 0) setScreen("profile");
    else setQuestionIndex((current) => current - 1);
  }

  function showAnalytics() {
    if (screen !== "analytics") {
      setReturnScreen(screen);
      setScreen("analytics");
    }
  }

  function chooseSample(key: string) {
    setSelectedKey(key);
    setDraft("");
    setScreen("match");
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedKey || !selectedDetails) return;

    const key = selectedKey;
    const replies = selectedDetails.replies;
    setMessages((current) => {
      const previous = current[key] ?? [];
      const replyIndex = previous.filter((message) => message.from === "sample").length;
      const reply = replies[Math.min(replyIndex, replies.length - 1)];
      return { ...current, [key]: [...previous, { from: "you", text }, { from: "sample", text: reply }] };
    });
    setDraft("");
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
          {screen === "analytics" ? (
            <button type="button" className={styles.headerAction} onClick={() => setScreen(returnScreen)}>Back to demo</button>
          ) : (
            <button type="button" className={styles.headerAction} onClick={showAnalytics}>Sample analytics</button>
          )}
        </div>
      </header>

      <div className={styles.demoBanner}>
        <div className={styles.bannerInner}>
          <strong>Interactive demo</strong>
          <span>Profiles are fictional and replies are scripted. Your entries stay in this tab.</span>
        </div>
      </div>

      <main className={styles.main}>
        {screen !== "profile" && (
          <div className={styles.utilityRow}>
            <span>{screen === "analytics" ? "Illustrative analytics" : "Fictional demo"}</span>
            <button type="button" onClick={startOver}>Start over</button>
          </div>
        )}

        {screen === "profile" && (
          <section className={styles.screen} aria-labelledby="profile-heading">
            <p className={styles.eyebrow}>A first look</p>
            <h1 ref={headingRef} id="profile-heading" tabIndex={-1}>Get to know the idea.</h1>
            <p className={styles.lede}>Try the journey from a few questions to a blind introduction. No account needed.</p>
            <div className={styles.profileForm}>
              <label htmlFor="demo-nickname">Choose a nickname <span>(optional)</span></label>
              <input id="demo-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={24} autoComplete="off" placeholder="Something just for the demo" />
              <p>Use an imaginary name if you like. Your answers and messages disappear when you refresh.</p>
              <button type="button" className={styles.primary} onClick={goToQuestions}>Answer the questions</button>
              <button type="button" className={styles.secondary} onClick={useSampleProfile}>Use sample answers instead</button>
            </div>
          </section>
        )}

        {screen === "questions" && (
          <section className={styles.screen} aria-labelledby="question-heading">
            <div className={styles.progressMeta}><span>Question {questionIndex + 1} of {QUESTIONS.length}</span><span>{answeredCount} answered</span></div>
            <div className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${((questionIndex + 1) / QUESTIONS.length) * 100}%` }} /></div>
            <h1 ref={headingRef} id="question-heading" tabIndex={-1}>{question.prompt}</h1>
            <p className={styles.lede}>There are no right answers. Pick what feels closest, or skip.</p>
            <fieldset className={styles.choices} aria-labelledby="question-heading">
              {question.anchors.map((anchor, index) => {
                const value = (index + 1) as AnswerValue;
                return <label className={styles.choice} key={anchor}>
                  <input type="radio" name={question.id} checked={answers[question.id] === value} onChange={() => setAnswers((current) => ({ ...current, [question.id]: value }))} />
                  <span>{anchor}</span>
                </label>;
              })}
            </fieldset>
            <div className={styles.stepActions}>
              <button type="button" className={styles.primary} disabled={answers[question.id] === null} onClick={nextQuestion}>{questionIndex === QUESTIONS.length - 1 ? "See sample introductions" : "Continue"}</button>
              <button type="button" className={styles.secondary} onClick={skipQuestion}>Skip this question</button>
            </div>
            <button type="button" className={styles.backLink} onClick={previousQuestion}>Back</button>
          </section>
        )}

        {screen === "introductions" && (
          <section className={styles.screen} aria-labelledby="introductions-heading">
            <p className={styles.eyebrow}>Sample introductions</p>
            <h1 ref={headingRef} id="introductions-heading" tabIndex={-1}>{nickname.trim() ? `Here’s who you could meet, ${nickname.trim()}.` : "A little mystery, a good hello."}</h1>
            <p className={styles.lede}>These are fictional profiles. Choose one to try a scripted conversation.</p>
            {answeredCount >= 3 && <p className={styles.explainer}>Shown in an order based on your answers. This simple comparison can’t predict chemistry.</p>}
            <div className={styles.introductionList}>
              {introductions.map((sample) => (
                <article className={styles.introduction} key={sample.key}>
                  <div className={styles.introductionTop}>
                    <h2>{sample.alias.replace(" (sample)", "")}</h2>
                    <span>Fictional profile</span>
                  </div>
                  <p>{sampleDetails[sample.key].description}</p>
                  <button type="button" className={styles.introductionButton} onClick={() => chooseSample(sample.key)}>Choose this sample <span aria-hidden="true">↗</span></button>
                </article>
              ))}
            </div>
            <button type="button" className={styles.backLink} onClick={() => {
              if (usedSampleAnswers) setScreen("profile");
              else { setQuestionIndex(QUESTIONS.length - 1); setScreen("questions"); }
            }}>Back to {usedSampleAnswers ? "your demo profile" : "questions"}</button>
          </section>
        )}

        {screen === "match" && selectedSample && (
          <section className={styles.screen} aria-labelledby="match-heading">
            <p className={styles.eyebrow}>Sample match</p>
            <h1 ref={headingRef} id="match-heading" tabIndex={-1}>Your conversation is ready.</h1>
            <p className={styles.lede}>You chose {selectedSample.alias.replace(" (sample)", "")}. This is an instant demo match with a fictional profile, not a real person.</p>
            <div className={styles.matchActions}>
              <button type="button" className={styles.primary} onClick={() => setScreen("chat")}>Open sample conversation</button>
              <button type="button" className={styles.secondary} onClick={() => setScreen("introductions")}>Back to introductions</button>
            </div>
          </section>
        )}

        {screen === "chat" && selectedSample && selectedDetails && (
          <section className={styles.screen} aria-labelledby="chat-heading">
            <button type="button" className={styles.backLink} onClick={() => setScreen("introductions")}>Back to introductions</button>
            <div className={styles.chatHeading}>
              <div><p className={styles.eyebrow}>Sample conversation</p><h1 ref={headingRef} id="chat-heading" tabIndex={-1}>{selectedSample.alias.replace(" (sample)", "")}</h1></div>
              <span className={styles.scriptedTag}>Scripted replies</span>
            </div>
            <p className={styles.chatNote}>This person is fictional. Replies are prewritten and don’t respond to what you type.</p>
            <div className={styles.messages} ref={logRef} role="log" aria-label="Sample conversation" aria-live="polite" aria-relevant="additions" tabIndex={0}>
              <div className={styles.message}><span>{selectedSample.alias.replace(" (sample)", "")} · scripted</span><p>{selectedDetails.opening}</p></div>
              {chatMessages.map((message, index) => <div className={message.from === "you" ? styles.yourMessage : styles.message} key={`${message.from}-${index}`}>
                <span>{message.from === "you" ? "You" : `${selectedSample.alias.replace(" (sample)", "")} · scripted`}</span><p>{message.text}</p>
              </div>)}
            </div>
            <form className={styles.composer} onSubmit={sendMessage}>
              <label htmlFor="demo-message">Your message</label>
              <div className={styles.composeRow}><input id="demo-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} placeholder="Say hello…" autoComplete="off" /><button type="submit" disabled={!draft.trim()}>Send</button></div>
            </form>
          </section>
        )}

        {screen === "analytics" && (
          <section className={styles.screen} aria-labelledby="analytics-heading">
            <p className={styles.eyebrow}>Sample analytics</p>
            <h1 ref={headingRef} id="analytics-heading" tabIndex={-1}>A little perspective.</h1>
            <p className={styles.lede}>An example of how the journey from profile to conversation could be understood.</p>
            <div className={styles.analyticsNote}><strong>Made-up numbers.</strong> This is a static illustration, not real users, events, or your demo activity.</div>
            <div className={styles.funnelHeader}><div><p className={styles.eyebrow}>Example funnel</p><h2>A fictional journey</h2></div><span>Illustrative cohort</span></div>
            <ol className={styles.funnel}>
              {exampleFunnel.map(({ label, count }) => <li key={label}>
                <div><span>{label}</span><strong>{count}</strong></div>
                <div className={styles.barTrack} aria-hidden="true"><span style={{ width: `${(count / exampleFunnel[0].count) * 100}%` }} /></div>
              </li>)}
            </ol>
            <p className={styles.analyticsFootnote}>These figures are examples only; this demo does not record analytics events.</p>
            <button type="button" className={styles.secondary} onClick={() => setScreen(returnScreen)}>Back to demo</button>
          </section>
        )}
      </main>
      <footer className={styles.footer}><span>Mystery Match</span><span>Fictional demo · nothing is saved</span></footer>
    </div>
  );
}
