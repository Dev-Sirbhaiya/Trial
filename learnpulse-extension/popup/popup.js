import { isCardDue } from '../lib/srs-engine.js';

const lessonTitle = document.getElementById('lesson-title');
const lessonSummary = document.getElementById('lesson-summary');
const lessonBody = document.getElementById('lesson-body');
const lessonSources = document.getElementById('lesson-sources');
const lessonExercise = document.getElementById('lesson-exercise');
const generateNowButton = document.getElementById('generate-now');
const flashcardElement = document.getElementById('flashcard');
const flashcardQuestion = document.getElementById('flashcard-question');
const flashcardAnswer = document.getElementById('flashcard-answer');
const flipButton = document.getElementById('flip-card');
const gradeButtonsContainer = document.getElementById('grade-buttons');
const streakValue = document.getElementById('streak-value');
const lessonsValue = document.getElementById('lessons-value');
const cardsValue = document.getElementById('cards-value');

let state = { lessons: [], flashcards: [], stats: {} };
let dueFlashcards = [];
let currentCardIndex = 0;
let isFlipped = false;

const grades = [0, 1, 2, 3, 4, 5];

init();

function init() {
  setupGradeButtons();
  flipButton.addEventListener('click', () => toggleCard());
  generateNowButton.addEventListener('click', handleGenerateNow);
  refreshState();
}

function setupGradeButtons() {
  gradeButtonsContainer.innerHTML = '';
  grades.forEach((grade) => {
    const button = document.createElement('button');
    button.textContent = grade.toString();
    button.title = `Grade ${grade}`;
    button.addEventListener('click', () => handleGrade(grade));
    gradeButtonsContainer.appendChild(button);
  });
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: 'learnpulse:getState' });
  state = response;
  renderLesson();
  prepareFlashcards();
  renderStats();
}

function renderLesson() {
  const todayKey = new Date().toISOString().slice(0, 10);
  let lesson = state.lessons.find((entry) => entry.date === todayKey);
  if (!lesson) {
    lesson = state.lessons[state.lessons.length - 1];
  }

  if (!lesson) {
    lessonTitle.textContent = 'No lesson generated yet';
    lessonSummary.textContent = 'Your daily capsule will appear here once generated.';
    lessonBody.innerHTML = '';
    lessonSources.innerHTML = '';
    lessonExercise.innerHTML = '';
    return;
  }

  lessonTitle.textContent = lesson.title || 'LearnPulse Lesson';
  if (Array.isArray(lesson.summary)) {
    lessonSummary.innerHTML = lesson.summary.map((item) => `• ${item}`).join('<br />');
  } else {
    lessonSummary.textContent = lesson.summary || '';
  }
  lessonBody.innerHTML = lesson.body || '';

  if (lesson.sources && lesson.sources.length) {
    const list = lesson.sources
      .map((source) => `<li>${source.title || source.reference}</li>`)
      .join('');
    lessonSources.innerHTML = `<strong>Sources</strong><ul>${list}</ul>`;
  } else {
    lessonSources.innerHTML = '';
  }

  if (lesson.exercise) {
    lessonExercise.innerHTML = `<strong>Exercise:</strong> ${lesson.exercise}`;
  } else {
    lessonExercise.innerHTML = '';
  }
}

function prepareFlashcards() {
  dueFlashcards = (state.flashcards || []).filter((card) => isCardDue(card));
  currentCardIndex = 0;
  isFlipped = false;
  updateFlashcardUi();
}

function updateFlashcardUi() {
  flashcardElement.classList.toggle('flipped', isFlipped);
  const current = dueFlashcards[currentCardIndex];
  if (!current) {
    flashcardQuestion.textContent = 'No cards due.';
    flashcardAnswer.textContent = 'You are up to date!';
    setGradeButtonsDisabled(true);
    flipButton.disabled = true;
    return;
  }

  flashcardQuestion.textContent = current.question;
  flashcardAnswer.textContent = current.answer;
  flipButton.disabled = false;
  setGradeButtonsDisabled(false);
}

function toggleCard() {
  isFlipped = !isFlipped;
  flashcardElement.classList.toggle('flipped', isFlipped);
}

async function handleGrade(grade) {
  const card = dueFlashcards[currentCardIndex];
  if (!card) return;
  setGradeButtonsDisabled(true);
  try {
    await chrome.runtime.sendMessage({
      type: 'learnpulse:gradeFlashcard',
      payload: { cardId: card.id, grade }
    });
    dueFlashcards.splice(currentCardIndex, 1);
    if (currentCardIndex >= dueFlashcards.length) {
      currentCardIndex = Math.max(0, dueFlashcards.length - 1);
    }
    isFlipped = false;
    await refreshState();
  } catch (error) {
    console.error('Failed to grade flashcard', error);
  } finally {
    setGradeButtonsDisabled(dueFlashcards.length === 0);
  }
}

function setGradeButtonsDisabled(disabled) {
  gradeButtonsContainer.querySelectorAll('button').forEach((button) => {
    button.disabled = disabled;
  });
}

function renderStats() {
  const stats = state.stats || {};
  streakValue.textContent = `${stats.streak || 0} day${stats.streak === 1 ? '' : 's'}`;
  lessonsValue.textContent = stats.totalLessons || 0;
  cardsValue.textContent = stats.totalFlashcardsReviewed || 0;
}

async function handleGenerateNow() {
  setGradeButtonsDisabled(true);
  generateNowButton.disabled = true;
  generateNowButton.textContent = 'Generating…';
  try {
    await chrome.runtime.sendMessage({ type: 'learnpulse:generateNow' });
    await refreshState();
  } catch (error) {
    console.error('Manual generation failed', error);
  } finally {
    generateNowButton.disabled = false;
    generateNowButton.textContent = '↻ Refresh';
    setGradeButtonsDisabled(dueFlashcards.length === 0);
  }
}

