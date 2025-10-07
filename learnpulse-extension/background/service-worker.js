/**
 * LearnPulse Background Service Worker
 * -----------------------------------
 * Responsibilities:
 *  - Maintain the daily alarm schedule for lesson generation.
 *  - Coordinate AI content creation through the available LLM connectors.
 *  - Persist lessons, flashcards, and progress to chrome.storage.
 *  - Serve requests from UI surfaces (popup, options) via runtime messaging.
 *  - Deliver notifications and catch-up logic when the browser restarts.
 */

import { generateLessonWithGemini } from '../lib/llm-gemini.js';
import { generateLessonWithOllama } from '../lib/llm-ollama.js';
import { generateLessonWithPromptApi, isPromptApiAvailable } from '../lib/llm-nano.js';
import { chunkSources } from '../lib/content-chunker.js';
import { applySm2Review } from '../lib/srs-engine.js';

const STORAGE_KEYS = {
  SETTINGS: 'learnpulse_settings',
  LESSONS: 'learnpulse_lessons',
  FLASHCARDS: 'learnpulse_flashcards',
  STATS: 'learnpulse_stats',
  LAST_GENERATED_AT: 'learnpulse_last_generated_at'
};

const DEFAULT_SETTINGS = {
  mode: 'autonomous',
  topic: 'Learning how to learn',
  curatedSources: [],
  schedule: { hour: 9, minute: 0 },
  backendPreference: ['gemini', 'ollama', 'promptApi'],
  lessonLength: 750,
  flashcardCount: 6,
  promptApiModel: 'gemini-pro',
  promptApiTemperature: 0.7,
  timezoneOffset: new Date().getTimezoneOffset(),
  notificationsEnabled: true
};

const GEMINI_MODEL = 'gemini-1.5-flash-latest';
const OLLAMA_MODEL = 'mistral';

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await initialiseDefaults();
  }
  await ensureDailyAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDailyAlarm();
  await maybeCatchUpOnMissedLessons();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name === 'learnpulse-daily') {
    await runDailyLessonPipeline('scheduled');
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};
  switch (type) {
    case 'learnpulse:getState':
      (async () => {
        const [settings, lessons, flashcards, stats] = await Promise.all([
          getFromStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS),
          getFromStorage(STORAGE_KEYS.LESSONS, []),
          getFromStorage(STORAGE_KEYS.FLASHCARDS, []),
          getFromStorage(STORAGE_KEYS.STATS, defaultStats())
        ]);
        sendResponse({ settings, lessons, flashcards, stats });
      })();
      return true;
    case 'learnpulse:gradeFlashcard':
      (async () => {
        const { cardId, grade } = payload;
        await gradeFlashcard(cardId, grade);
        sendResponse({ success: true });
      })();
      return true;
    case 'learnpulse:generateNow':
      (async () => {
        await runDailyLessonPipeline('manual');
        sendResponse({ success: true });
      })();
      return true;
    case 'learnpulse:updateSettings':
      (async () => {
        await saveSettings(payload);
        await ensureDailyAlarm();
        sendResponse({ success: true });
      })();
      return true;
    default:
      break;
  }
  return false;
});

/** Initialise default settings and empty state on fresh install. */
async function initialiseDefaults() {
  const currentSettings = await getFromStorage(STORAGE_KEYS.SETTINGS);
  if (!currentSettings) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.LESSONS]: await getFromStorage(STORAGE_KEYS.LESSONS, []),
    [STORAGE_KEYS.FLASHCARDS]: await getFromStorage(STORAGE_KEYS.FLASHCARDS, []),
    [STORAGE_KEYS.STATS]: await getFromStorage(STORAGE_KEYS.STATS, defaultStats())
  });
}

/** Return default stats object. */
function defaultStats() {
  return {
    streak: 0,
    lastLessonDate: null,
    totalLessons: 0,
    totalFlashcardsReviewed: 0
  };
}

/** Ensure a single repeating daily alarm is registered. */
async function ensureDailyAlarm() {
  const settings = await getFromStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  const { hour, minute } = settings.schedule || DEFAULT_SETTINGS.schedule;
  const when = computeNextOccurrence(hour, minute);
  await chrome.alarms.clear('learnpulse-daily');
  await chrome.alarms.create('learnpulse-daily', {
    when,
    periodInMinutes: 60 * 24
  });
}

/** Compute the timestamp (ms) of the next alarm occurrence. */
function computeNextOccurrence(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/** Generate a lesson if today's content is not yet available. */
async function runDailyLessonPipeline(triggerSource) {
  const [settings, lastGenerated] = await Promise.all([
    getFromStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS),
    getFromStorage(STORAGE_KEYS.LAST_GENERATED_AT, null)
  ]);

  const todayKey = new Date().toISOString().slice(0, 10);
  if (lastGenerated === todayKey && triggerSource === 'scheduled') {
    // Already generated today; avoid duplicates from alarm firing multiple times.
    return;
  }

  try {
    const generationContext = await prepareGenerationContext(settings);
    const generationResult = await executeWithFallback(settings.backendPreference, generationContext);

    await persistDailyContent(generationResult, todayKey, settings);
    if (settings.notificationsEnabled) {
      await chrome.notifications.create('learnpulse-daily-ready', {
        type: 'basic',
        title: 'LearnPulse',
        message: '📘 Your personalized lesson is ready. Dive in!',
        priority: 2
      });
    }
  } catch (error) {
    console.error('[LearnPulse] Daily generation failed:', error);
    await chrome.notifications.create('learnpulse-daily-error', {
      type: 'basic',
      title: 'LearnPulse',
      message: 'We could not generate today\'s lesson. Check your settings or connection.',
      priority: 2
    });
  }
}

/**
 * Prepare context for lesson generation, including curated source chunks and history.
 */
async function prepareGenerationContext(settings) {
  const [lessons, flashcards] = await Promise.all([
    getFromStorage(STORAGE_KEYS.LESSONS, []),
    getFromStorage(STORAGE_KEYS.FLASHCARDS, [])
  ]);

  const recentLessons = lessons.slice(-5);
  const dueFlashcards = flashcards.filter((card) => {
    const dueDate = card.dueDate ? new Date(card.dueDate) : null;
    return !dueDate || dueDate <= new Date();
  });

  let curatedChunks = [];
  if (settings.mode === 'curated') {
    curatedChunks = await chunkSources(settings.curatedSources || []);
    if (!curatedChunks.length) {
      throw new Error('Curated mode requires at least one processed source.');
    }
  }

  return {
    settings,
    recentLessons,
    dueFlashcards,
    curatedChunks
  };
}

/** Execute the LLM pipeline with graceful fallback over preferred backends. */
async function executeWithFallback(preferences, context) {
  const preferenceOrder = Array.isArray(preferences) && preferences.length
    ? preferences
    : DEFAULT_SETTINGS.backendPreference;

  const errors = [];
  for (const backend of preferenceOrder) {
    try {
      if (backend === 'gemini') {
        const apiKey = await getGeminiApiKey();
        if (!apiKey) throw new Error('Missing Gemini API key');
        return await generateLessonWithGemini({
          apiKey,
          model: GEMINI_MODEL,
          context
        });
      }
      if (backend === 'ollama') {
        const modelName = context?.settings?.ollamaModel || OLLAMA_MODEL;
        return await generateLessonWithOllama({ model: modelName, context });
      }
      if (backend === 'promptApi') {
        const available = await isPromptApiAvailable();
        if (!available) {
          throw new Error('Chrome Prompt API unavailable');
        }
        const modelName = context?.settings?.promptApiModel || 'gemini-pro';
        const temperature = typeof context?.settings?.promptApiTemperature === 'number'
          ? context.settings.promptApiTemperature
          : 0.7;
        return await generateLessonWithPromptApi({
          context,
          model: modelName,
          temperature
        });
      }
    } catch (error) {
      console.warn(`[LearnPulse] Backend ${backend} failed`, error);
      errors.push({ backend, error: error?.message || String(error) });
    }
  }
  console.warn('[LearnPulse] Falling back to offline lesson.', errors);
  return buildOfflineFallbackLesson(context, errors);
}

function buildOfflineFallbackLesson(context, errors) {
  const today = new Date().toLocaleDateString();
  const topic = context.settings?.topic || 'Independent learning';
  const summary = [
    `Offline fallback for ${topic}.`,
    'Review a recent concept and capture notes manually.',
    'Resolve connectivity or API key issues to resume AI generation.'
  ];

  const priorLesson = context.recentLessons?.slice(-1)?.[0];
  const body = `
    <h2>Offline Study Day</h2>
    <p>Our AI backends were unreachable (${errors.length} errors). Use this self-guided prompt to stay on track.</p>
    <p><strong>Topic focus:</strong> ${topic}</p>
    <ul>
      <li>Summarise what you learned yesterday${priorLesson ? ` (${priorLesson.title})` : ''}.</li>
      <li>Write down two questions you still have.</li>
      <li>Skim one curated source offline and capture a key quote.</li>
    </ul>
  `;

  const flashcards = (context.dueFlashcards || []).slice(0, 5).map((card) => ({
    question: card.question,
    answer: card.answer
  }));

  if (!flashcards.length) {
    flashcards.push({
      question: `What is one insight about ${topic} you can recall without assistance?`,
      answer: 'Write your answer in your notes to reinforce memory.'
    });
  }

  return {
    title: `Offline reflection — ${today}`,
    summary,
    lesson: body,
    flashcards,
    sources: context.curatedChunks?.slice(0, 3).map((chunk) => ({
      title: chunk.sourceTitle,
      reference: chunk.reference || 'Offline excerpt'
    })) || [],
    exercise: 'Spend 10 minutes journaling what you remember and identify blockers to restore connectivity.'
  };
}

/** Persist generated lesson and flashcards to storage, updating stats. */
async function persistDailyContent(result, todayKey, settings) {
  const [lessons, flashcards, stats] = await Promise.all([
    getFromStorage(STORAGE_KEYS.LESSONS, []),
    getFromStorage(STORAGE_KEYS.FLASHCARDS, []),
    getFromStorage(STORAGE_KEYS.STATS, defaultStats())
  ]);

  const newLesson = {
    id: `lesson-${todayKey}`,
    date: todayKey,
    title: result.title,
    summary: Array.isArray(result.summary) ? result.summary : [result.summary].filter(Boolean),
    body: result.lesson,
    sources: result.sources,
    exercise: result.exercise,
    generatedAt: new Date().toISOString(),
    mode: settings.mode
  };

  const updatedLessons = [...lessons.filter((lesson) => lesson.date !== todayKey), newLesson]
    .sort((a, b) => (a.date > b.date ? 1 : -1))
    .slice(-60);

  const newCards = (result.flashcards || []).map((card, index) => ({
    id: `card-${todayKey}-${index}`,
    question: card.question,
    answer: card.answer,
    sourceLessonId: newLesson.id,
    interval: card.interval ?? 1,
    easeFactor: card.easeFactor ?? 2.5,
    repetitions: card.repetitions ?? 0,
    dueDate: new Date().toISOString()
  }));

  const mergedCards = mergeFlashcards(flashcards, newCards);

  const updatedStats = updateStats(stats, todayKey, newCards.length);

  await chrome.storage.local.set({
    [STORAGE_KEYS.LESSONS]: updatedLessons,
    [STORAGE_KEYS.FLASHCARDS]: mergedCards,
    [STORAGE_KEYS.STATS]: updatedStats,
    [STORAGE_KEYS.LAST_GENERATED_AT]: todayKey
  });
}

/** Merge newly generated flashcards, preserving existing scheduling metadata. */
function mergeFlashcards(existing, incoming) {
  const merged = [...existing];
  const indexByQuestion = new Map(existing.map((card, index) => [card.question, index]));

  for (const card of incoming) {
    if (indexByQuestion.has(card.question)) {
      const index = indexByQuestion.get(card.question);
      merged[index] = {
        ...merged[index],
        sourceLessonId: card.sourceLessonId,
        // Reset scheduling for refreshed content.
        interval: card.interval,
        easeFactor: merged[index].easeFactor || card.easeFactor,
        repetitions: merged[index].repetitions || 0,
        dueDate: card.dueDate
      };
    } else {
      merged.push(card);
    }
  }

  return merged;
}

/** Update streaks and aggregate statistics. */
function updateStats(stats, todayKey, newCardCount) {
  const updated = { ...stats };
  const yesterday = new Date(todayKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (stats.lastLessonDate === todayKey) {
    // Already counted for today.
  } else if (stats.lastLessonDate === yesterdayKey) {
    updated.streak = (stats.streak || 0) + 1;
  } else {
    updated.streak = 1;
  }

  updated.lastLessonDate = todayKey;
  updated.totalLessons = (stats.totalLessons || 0) + 1;
  updated.totalFlashcardsReviewed = stats.totalFlashcardsReviewed || 0;
  updated.flashcardsGeneratedToday = newCardCount;
  return updated;
}

/** Apply SM-2 update for a flashcard after grading. */
async function gradeFlashcard(cardId, grade) {
  const flashcards = await getFromStorage(STORAGE_KEYS.FLASHCARDS, []);
  const stats = await getFromStorage(STORAGE_KEYS.STATS, defaultStats());
  const index = flashcards.findIndex((card) => card.id === cardId);
  if (index === -1) return;

  const updatedCard = applySm2Review(flashcards[index], grade);
  const updatedCards = [...flashcards];
  updatedCards[index] = updatedCard;

  const updatedStats = {
    ...stats,
    totalFlashcardsReviewed: (stats.totalFlashcardsReviewed || 0) + 1
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.FLASHCARDS]: updatedCards,
    [STORAGE_KEYS.STATS]: updatedStats
  });
}

/** Fetch Gemini API key stored in chrome.storage.sync. */
async function getGeminiApiKey() {
  const result = await chrome.storage.sync.get('learnpulse_gemini_api_key');
  return result?.learnpulse_gemini_api_key || null;
}

/** Persist updated settings merging existing ones. */
async function saveSettings(incoming) {
  const current = await getFromStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
  const merged = {
    ...current,
    ...incoming,
    schedule: { ...current.schedule, ...incoming.schedule }
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
}

/** Retrieve a value from chrome.storage.local with a default. */
async function getFromStorage(key, defaultValue = undefined) {
  const result = await chrome.storage.local.get(key);
  if (!result || result[key] === undefined) {
    return defaultValue;
  }
  return result[key];
}

/**
 * Check if we missed any lessons due to downtime and catch up.
 * Generates the newest lesson only (to avoid overwhelming the user).
 */
async function maybeCatchUpOnMissedLessons() {
  const lastGenerated = await getFromStorage(STORAGE_KEYS.LAST_GENERATED_AT, null);
  if (!lastGenerated) return;
  const last = new Date(lastGenerated);
  const today = new Date();
  const diffDays = Math.floor((today - last) / (1000 * 60 * 60 * 24));
  if (diffDays >= 1) {
    await runDailyLessonPipeline('catchup');
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('learnpulse-')) {
    chrome.action.openPopup().catch((error) => console.warn('Failed to open popup', error));
  }
});

