/** Explicitly added by the user. These instruction values never depend on UI language. */
export const ENGLISH_EDITING_RULES = [
  {
    id: 'englishPunctuation',
    text: 'Use standard English punctuation in English passages. Correct only clear punctuation errors without changing the speaker’s wording or meaning. Preserve apostrophes in contractions, decimal points, URLs, and meaningful hesitation or uncertainty. Do not translate non-English passages.',
  },
  {
    id: 'englishSpacing',
    text: 'In English passages, use a single space between words and after sentence punctuation, with no space before commas, periods, question marks, or exclamation marks. Preserve URLs, decimal numbers, code, and intentional formatting. Do not change wording or translate non-English passages.',
  },
] as const;
