/**
 * SM-2 Spaced Repetition Engine
 * -----------------------------
 * Provides utilities to schedule flashcards using the SM-2 algorithm.
 */

/**
 * Apply the SM-2 review formula to a flashcard.
 * @param {Object} card - Flashcard metadata.
 * @param {number} grade - Quality of recall (0-5).
 * @returns {Object} Updated card with new interval, repetitions, ease factor, and due date.
 */
export function applySm2Review(card, grade) {
  const clampedGrade = Math.max(0, Math.min(5, Number(grade)));
  const updated = { ...card };

  if (!updated.easeFactor) updated.easeFactor = 2.5;
  if (!updated.interval) updated.interval = 1;
  if (!updated.repetitions) updated.repetitions = 0;

  if (clampedGrade < 3) {
    updated.repetitions = 0;
    updated.interval = 1;
  } else {
    if (updated.repetitions === 0) {
      updated.interval = 1;
    } else if (updated.repetitions === 1) {
      updated.interval = 6;
    } else {
      updated.interval = Math.round(updated.interval * updated.easeFactor);
    }
    updated.repetitions += 1;
    updated.easeFactor = Math.max(
      1.3,
      updated.easeFactor + (0.1 - (5 - clampedGrade) * (0.08 + (5 - clampedGrade) * 0.02))
    );
  }

  const due = new Date();
  due.setDate(due.getDate() + updated.interval);
  updated.dueDate = due.toISOString();
  updated.lastReviewedAt = new Date().toISOString();
  updated.lastGrade = clampedGrade;

  return updated;
}

/**
 * Determine whether a flashcard is due.
 */
export function isCardDue(card) {
  if (!card?.dueDate) return true;
  return new Date(card.dueDate) <= new Date();
}

