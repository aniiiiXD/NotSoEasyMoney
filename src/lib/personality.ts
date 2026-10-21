/**
 * A self-reported questionnaire used to rank introductions.
 *
 * Seventeen items come from the Mini-IPIP (Donnellan et al., 2006), a short
 * public-domain Big Five measure from the International Personality Item Pool
 * (https://ipip.ori.org/MiniIPIPKey.htm). Three come from OkCupid's 2011
 * analysis of questions shared by long-term couples. Items are compared one by
 * one and are never summed into trait scores, so reverse-keyed items keep
 * their original wording. Similarity on these answers cannot predict
 * attraction or relationship outcomes. A new questionnaire version is
 * required if the questions, response anchors, or scoring change.
 */
export const QUESTIONNAIRE_VERSION = "2.0.0" as const;

export const QUESTION_IDS = [
  "life_of_party",
  "talk_at_parties",
  "dont_talk_much",
  "keep_in_background",
  "sympathize_feelings",
  "feel_emotions",
  "not_interested_in_others",
  "chores_right_away",
  "like_order",
  "forget_to_put_back",
  "make_a_mess",
  "mood_swings",
  "upset_easily",
  "relaxed",
  "seldom_blue",
  "vivid_imagination",
  "not_interested_abstract",
  "horror_movies",
  "travel_alone",
  "sailboat",
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
  /** Where the item comes from, shown beside the question. */
  readonly source: string;
}

// The IPIP's standard response scale for describing yourself.
const ACCURACY = [
  "Very inaccurate",
  "Moderately inaccurate",
  "Neither accurate nor inaccurate",
  "Moderately accurate",
  "Very accurate",
] as const;

const AGREEMENT = [
  "Strongly disagree",
  "Disagree",
  "Neither agree nor disagree",
  "Agree",
  "Strongly agree",
] as const;

const MINI_IPIP = "Mini-IPIP personality scale";
const OKCUPID = "OkCupid long-term couples research";

export const QUESTIONS = [
  { id: "life_of_party", prompt: "I am the life of the party.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "talk_at_parties", prompt: "I talk to a lot of different people at parties.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "dont_talk_much", prompt: "I don't talk a lot.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "keep_in_background", prompt: "I keep in the background.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "sympathize_feelings", prompt: "I sympathize with others' feelings.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "feel_emotions", prompt: "I feel others' emotions.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "not_interested_in_others", prompt: "I am not really interested in others.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "chores_right_away", prompt: "I get chores done right away.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "like_order", prompt: "I like order.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "forget_to_put_back", prompt: "I often forget to put things back in their proper place.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "make_a_mess", prompt: "I make a mess of things.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "mood_swings", prompt: "I have frequent mood swings.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "upset_easily", prompt: "I get upset easily.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "relaxed", prompt: "I am relaxed most of the time.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "seldom_blue", prompt: "I seldom feel blue.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "vivid_imagination", prompt: "I have a vivid imagination.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "not_interested_abstract", prompt: "I am not interested in abstract ideas.", anchors: ACCURACY, source: MINI_IPIP },
  { id: "horror_movies", prompt: "I like horror movies.", anchors: AGREEMENT, source: OKCUPID },
  { id: "travel_alone", prompt: "I would enjoy traveling alone in another country.", anchors: AGREEMENT, source: OKCUPID },
  { id: "sailboat", prompt: "Chucking it all to go live on a sailboat sounds fun.", anchors: AGREEMENT, source: OKCUPID },
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

/** Answers with every question skipped. */
export function emptyAnswers(): PersonalityAnswers {
  return Object.fromEntries(QUESTION_IDS.map((id) => [id, null])) as PersonalityAnswers;
}

/** Build answers from values listed in QUESTION_IDS order. */
export function answersInOrder(values: readonly AnswerValue[]): PersonalityAnswers {
  if (values.length !== QUESTION_IDS.length) throw new RangeError(`Expected ${QUESTION_IDS.length} answers.`);
  return Object.fromEntries(QUESTION_IDS.map((id, index) => [id, values[index]])) as PersonalityAnswers;
}

/** True when at least one question has an answer. */
export function hasAnswers(answers: PersonalityAnswers): boolean {
  return Object.values(answers).some((answer) => answer !== null);
}
