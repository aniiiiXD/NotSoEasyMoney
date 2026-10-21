"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { emptyAnswers, hasAnswers, QUESTIONS, type AnswerValue, type PersonalityAnswers, type PersonalityQuestionId } from "@/lib/personality";
import type { ProfileInput } from "@/lib/local-matching";
import styles from "../app.module.css";

const genderOptions = ["woman", "man", "nonbinary", "another identity"] as const;
const lastStep = QUESTIONS.length + 1;

export default function ProfileForm({ initial, logout }: { initial: ProfileInput | null; logout: () => Promise<void> }) {
  const router = useRouter();
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [age, setAge] = useState(initial ? String(initial.age) : "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [seeking, setSeeking] = useState<string[]>(initial?.seeking ?? []);
  const [minAge, setMinAge] = useState(initial ? String(initial.minAge) : "18");
  const [maxAge, setMaxAge] = useState(initial ? String(initial.maxAge) : "99");
  const [answers, setAnswers] = useState<PersonalityAnswers>(() => initial?.answers ?? emptyAnswers());
  const [analyticsConsent, setAnalyticsConsent] = useState(initial?.analyticsConsent ?? false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [skipped, setSkipped] = useState<Set<PersonalityQuestionId>>(() => new Set());
  const answered = Object.values(answers).filter((answer) => answer !== null).length;
  const question = step > 0 && step <= QUESTIONS.length ? QUESTIONS[step - 1] : null;

  useEffect(() => {
    if (step > 0) document.getElementById(step === lastStep ? "privacy-title" : "question-title")?.focus();
  }, [step]);

  function goToStep(next: number) {
    setError("");
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  function answerQuestion(id: PersonalityQuestionId, value: AnswerValue) {
    setAnswers((previous) => ({ ...previous, [id]: value }));
    setSkipped((previous) => { const next = new Set(previous); next.delete(id); return next; });
  }

  async function saveProfile(profile: unknown) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "Could not save your profile."); return; }
      router.push("/discover");
      router.refresh();
    } catch {
      setError("Could not connect. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (step === 0) {
      if (seeking.length === 0) { setError("Choose at least one option for who you’d like to meet."); return; }
      if (Number(minAge) > Number(maxAge)) { setError("Your preferred age range must start at or below the end of the range."); return; }
    }
    if (step < lastStep) { goToStep(step + 1); return; }
    if (answered < 3) { setError("Answer at least three questions to see introductions."); return; }
    await saveProfile({ alias, age: Number(age), gender, seeking, minAge: Number(minAge), maxAge: Number(maxAge), answers, analyticsConsent });
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <Link href="/" className={styles.wordmark}><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
          {initial ? <Link className={styles.headerLink} href="/discover">Back to introductions</Link> : <><Link className={styles.headerLink} href="/account">Account & support</Link><form action={logout}><button className={styles.signOut} type="submit">Sign out</button></form></>}
        </div>
      </header>
      <main className={styles.narrow}>
        {initial && !hasAnswers(initial.answers) && step === 0 && <p className={styles.demoNote}><strong>New questions.</strong> We’ve updated the questionnaire. Please answer the new questions to keep getting introductions.</p>}
        <div className={styles.progressHeader} aria-live="polite"><span>{initial ? "Edit profile" : "Your profile"}</span><span>Step {step + 1} of {lastStep + 1}</span></div>
        <div className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${((step + 1) / (lastStep + 1)) * 100}%` }} /></div>
        <form className={styles.form} onSubmit={submit}>
          {step === 0 && <section className={styles.formSection} aria-labelledby="about-title">
            <div className={styles.intro}><p className={styles.kicker}>Let’s start here</p><h1 id="about-title">A little about you.</h1><p>Choose a nickname that doesn’t identify you. Mystery Match is for adults 18 and over.</p></div>
            <div className={styles.fieldGrid}>
              <label className={styles.field}>Your nickname<input required minLength={2} maxLength={24} value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="e.g. moonbeam" autoComplete="off" /></label>
              <label className={styles.field}>Your age<input required type="number" min={18} max={120} value={age} onChange={(event) => setAge(event.target.value)} placeholder="18+" inputMode="numeric" /></label>
              <label className={styles.field}>I identify as<select required value={gender} onChange={(event) => setGender(event.target.value)}><option value="">Choose one</option>{genderOptions.map((option) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>
            </div>
            <fieldset className={styles.fieldset}><legend>I’d like to meet</legend><div className={styles.choiceRow}>{genderOptions.map((option) => <label className={styles.choice} key={option}><input type="checkbox" checked={seeking.includes(option)} onChange={(event) => setSeeking((previous) => event.target.checked ? [...previous, option] : previous.filter((item) => item !== option))} /><span>{option[0].toUpperCase() + option.slice(1)}</span></label>)}</div></fieldset>
            <div className={styles.ageRow}><label className={styles.field}>Preferred age from<input type="number" required min={18} max={120} value={minAge} onChange={(event) => setMinAge(event.target.value)} inputMode="numeric" /></label><label className={styles.field}>To<input type="number" required min={18} max={120} value={maxAge} onChange={(event) => setMaxAge(event.target.value)} inputMode="numeric" /></label></div>
          </section>}

          {question && <section className={styles.formSection} aria-labelledby="question-title">
            <div className={styles.intro}><p className={styles.kicker}>Question {step} of {QUESTIONS.length} · {answered} answered · {question.source}</p><h1 id="question-title" tabIndex={-1}>{question.prompt}</h1><p>Describe yourself as you generally are now, not as you wish to be. There are no right answers. Answer at least three; skip anything that doesn’t fit.</p></div>
            <fieldset className={styles.question} aria-labelledby="question-title">
              <div className={styles.answerList}>{question.anchors.map((anchor, index) => {
                const value = (index + 1) as AnswerValue;
                return <label className={styles.answer} key={anchor}><input type="radio" name={question.id} checked={answers[question.id] === value} onChange={() => answerQuestion(question.id, value)} /><span>{anchor}</span></label>;
              })}<label className={styles.answer}><input type="radio" name={question.id} checked={skipped.has(question.id)} onChange={() => { setAnswers((previous) => ({ ...previous, [question.id]: null })); setSkipped((previous) => new Set(previous).add(question.id)); }} /><span>Skip or it depends</span></label></div>
            </fieldset>
          </section>}

          {step === lastStep && <section className={styles.formSection} aria-labelledby="privacy-title">
            <div className={styles.intro}><p className={styles.kicker}>One last thing</p><h1 id="privacy-title" tabIndex={-1}>Your data, your choice.</h1><p>Your profile is stored in our database. Other people see only your nickname during introductions.</p></div>
            <div className={styles.privacyBlock}>
              {initial ? <p>Manage your usage analytics choice in <Link href="/analytics/consent">privacy settings</Link>.</p> : <><label className={styles.consent}><input type="checkbox" checked={analyticsConsent} onChange={(event) => setAnalyticsConsent(event.target.checked)} /><span>Allow usage events to be included in aggregated analytics.</span></label><Link href="/analytics/consent" target="_blank">Learn about analytics</Link></>}
            </div>
            <p className={styles.answerCount}>{answered} of {QUESTIONS.length} questions answered</p>
            <p className={styles.helper}>Your answers help suggest introductions; they can’t predict chemistry.</p>
          </section>}

          {error && <div className={styles.error} role="alert"><p>{error}</p>{step === lastStep && answered < 3 && <button type="button" onClick={() => goToStep(1)}>Review questions</button>}</div>}
          <div className={styles.submitRow}>
            {step > 0 && <button className={styles.backButton} type="button" onClick={() => goToStep(step - 1)}>Back</button>}
            <button className={styles.primary} disabled={saving} type="submit">{saving ? "Saving…" : step < lastStep ? "Continue" : initial ? "Save preferences" : "See introductions"}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
