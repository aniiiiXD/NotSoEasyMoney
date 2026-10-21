/**
 * A short, self-reported set of preferences for introductions.
 *
 * These questions are not a validated personality assessment and cannot
 * predict attraction or relationship outcomes. A new questionnaire version
 * is required if the questions, response anchors, or scoring change.
 */
export const QUESTIONNAIRE_VERSION = "1.0.0" as const;

export const QUESTION_IDS = [
  "social_setting",
  "planning_style",
  "novelty",
  "conversation_style",
  "message_frequency",
  "date_atmosphere",
] as const;

export type PersonalityQuestionId = (typeof QUESTION_IDS)[number];
export type AnswerValue = 1 | 2 | 3 | 4 | 5 | null;
export type PersonalityAnswers = Record<PersonalityQuestionId, AnswerValue>;
export type PersonalityVector = Record<PersonalityQuestionId, number | null>;

export interface PersonalityQuestion {
  readonly id: PersonalityQuestionId;
  readonly prompt: string;
  /** Ordered answers for values 1 through 5; skipping is represented by null. */
  readonly anchors: readonly [string, string, string, string, string];
}

export const QUESTIONS = [
  {
    id: "social_setting",
    prompt: "What setting do you enjoy when getting to know someone?",
    anchors: [
      "Just the two of us",
      "Mostly one-on-one",
      "A mix of one-on-one and groups",
      "Mostly in small groups",
      "In larger groups",
    ],
  },
  {
    id: "planning_style",
    prompt: "How do you like to make plans?",
    anchors: [
      "Well in advance",
      "Usually in advance",
      "A mix of both",
      "Usually at short notice",
      "In the moment",
    ],
  },
  {
    id: "novelty",
    prompt: "What kinds of activities do you enjoy sharing?",
    anchors: [
      "Mostly familiar activities",
      "More familiar than new activities",
      "A mix of familiar and new activities",
      "More new than familiar activities",
      "Mostly new activities",
    ],
  },
  {
    id: "conversation_style",
    prompt: "What kinds of conversations do you usually enjoy?",
    anchors: [
      "Mostly light and playful",
      "More light than in-depth",
      "A mix of light and in-depth",
      "More in-depth than light",
      "Mostly in-depth",
    ],
  },
  {
    id: "message_frequency",
    prompt: "How often do you like to message someone you're getting to know?",
    anchors: [
      "About once a week or less",
      "Every few days",
      "About once a day",
      "A few times a day",
      "Throughout the day",
    ],
  },
  {
    id: "date_atmosphere",
    prompt: "What atmosphere do you enjoy when spending time together?",
    anchors: [
      "Very quiet and low-key",
      "Mostly quiet and low-key",
      "A mix of quiet and lively",
      "Mostly lively",
      "Very lively",
    ],
  },
] as const satisfies readonly PersonalityQuestion[];

export const QUESTIONNAIRE = {
  version: QUESTIONNAIRE_VERSION,
  questions: QUESTIONS,
} as const;

/**
 * Validate and copy an untrusted answer object. Every question must be
 * present, with null used for a skipped or context-dependent answer. Unknown
 * keys, inherited keys and values outside the 1–5 scale are rejected.
 */
export function parsePersonalityAnswers(input: unknown): PersonalityAnswers {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Answers must be a plain object with exactly the questionnaire keys.");
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Answers must be a plain object with exactly the questionnaire keys.");
  }

  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== QUESTION_IDS.length ||
    keys.some((key) => typeof key !== "string" || !QUESTION_IDS.includes(key as PersonalityQuestionId))
  ) {
    throw new TypeError("Answers must contain exactly the questionnaire keys.");
  }

  const source = input as Record<string, unknown>;
  const answers = {} as PersonalityAnswers;
  for (const id of QUESTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(source, id)) {
      throw new TypeError("Answers must contain exactly the questionnaire keys.");
    }

    const answer = source[id];
    if (
      answer !== null &&
      (typeof answer !== "number" || !Number.isInteger(answer) || answer < 1 || answer > 5)
    ) {
      throw new TypeError(`Answer for ${id} must be an integer from 1 to 5 or null.`);
    }
    answers[id] = answer as AnswerValue;
  }

  return answers;
}

/**
 * Map answered values to [0, 1]. Null stays null: a skipped question is not
 * the same as a midpoint response and must not be guessed.
 */
export function normalizeAnswers(input: unknown): PersonalityVector {
  const answers = parsePersonalityAnswers(input);
  const vector = {} as PersonalityVector;

  for (const id of QUESTION_IDS) {
    const answer = answers[id];
    vector[id] = answer === null ? null : (answer - 1) / 4;
  }

  return vector;
}
