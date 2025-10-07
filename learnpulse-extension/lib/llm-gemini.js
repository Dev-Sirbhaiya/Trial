/**
 * Gemini API Connector
 * ---------------------
 * Provides a wrapper around the Google Gemini REST API and the Chrome Prompt API (Gemini Nano)
 * with unified output for lesson + flashcard generation.
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Generate a lesson packet using Gemini.
 * @param {Object} params
 * @param {string|undefined} params.apiKey - Google AI Studio API key. Required unless using prompt API.
 * @param {string} params.model - Gemini model identifier.
 * @param {Object} params.context - Context prepared by the background worker.
 * @param {boolean} [params.usePromptApi=false] - Whether to use the on-device Prompt API.
 * @param {number} [params.temperature=0.7] - Sampling temperature forwarded to the model.
 */
export async function generateLessonWithGemini({
  apiKey,
  model,
  context,
  usePromptApi = false,
  temperature = 0.7
}) {
  if (usePromptApi) {
    return generateViaPromptApi({ model, context, temperature });
  }
  if (!apiKey) {
    throw new Error('Gemini API key is required for cloud inference.');
  }

  const prompt = buildLessonPrompt(context);

  const response = await fetch(`${GEMINI_ENDPOINT}/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API responded with ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned no content.');
  }

  return normaliseModelOutput(text, context);
}

/**
 * Attempt to use the Chrome Prompt API for on-device inference (if available).
 */
async function generateViaPromptApi({ model, context, temperature }) {
  if (!self.ai || !self.ai.languageModel) {
    throw new Error('Chrome Prompt API is unavailable in this environment.');
  }
  const session = await self.ai.languageModel.create({
    model: model || 'gemini-pro',
    temperature: typeof temperature === 'number' ? temperature : 0.7
  });
  const prompt = buildLessonPrompt(context);
  const text = await session.prompt(prompt);
  return normaliseModelOutput(text, context);
}

/**
 * Build a deterministic prompt instructing the model to emit JSON.
 */
function buildLessonPrompt(context) {
  const { settings, curatedChunks, recentLessons, dueFlashcards } = context;
  const historySummary = recentLessons.map((lesson) => `- ${lesson.date}: ${lesson.title}`).join('\n');
  const flashcardSummary = dueFlashcards.map((card) => `Q: ${card.question}\nA: ${card.answer}`).join('\n');
  const curatedSummary = curatedChunks
    .map((chunk) => `Source: ${chunk.sourceTitle}\nExcerpt: ${chunk.text}`)
    .join('\n---\n');

  return `You are LearnPulse, an autonomous daily mentor.
Generate a JSON object with the following structure without additional commentary:
{
  "title": string,
  "summary": [array of 3 concise bullet strings],
  "lesson": string (HTML formatted),
  "flashcards": [
    {"question": string, "answer": string}
  ],
  "sources": [
    {"title": string, "reference": string}
  ],
  "exercise": string
}

User mode: ${settings.mode}
Primary topic: ${settings.topic || 'Not specified'}
Desired lesson length: ${settings.lessonLength} words.
Requested flashcards: ${settings.flashcardCount}.
Recent lessons:\n${historySummary || 'None yet.'}
Due flashcards:\n${flashcardSummary || 'None due.'}
Curated context (if mode=curated, stay strictly within these excerpts):\n${curatedSummary || 'No curated content provided.'}

Rules:
- Obey curated context strictly; if insufficient, set lesson to "Insufficient curated context".
- Reintroduce one prior concept briefly.
- Provide flashcards aligned with the new concept and prior reviews.
- Keep HTML limited to <h2>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>.
- Provide an exercise that encourages reflection or application.`;
}

/**
 * Convert the raw model output (expected JSON) into the canonical structure.
 */
function normaliseModelOutput(rawText, context) {
  const cleaned = rawText.trim().replace(/^```json\n?|```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.warn('Failed to parse model JSON. Falling back to heuristic parser.', error);
    parsed = fallbackParser(cleaned);
  }

  const summary = Array.isArray(parsed.summary) ? parsed.summary : [parsed.summary].filter(Boolean);
  const flashcards = Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];

  if (context.settings.mode === 'curated' && context.curatedChunks?.length) {
    const curatedReferences = context.curatedChunks.slice(0, 3).map((chunk) => ({
      title: chunk.sourceTitle,
      reference: chunk.reference || chunk.url || 'User provided source'
    }));
    if (!sources.length) {
      sources.push(...curatedReferences);
    }
  }

  return {
    title: parsed.title || generateFallbackTitle(context.settings),
    summary: summary.length ? summary : ['Daily concept update from LearnPulse.'],
    lesson: parsed.lesson || `<p>${parsed.summary || 'Lesson content unavailable.'}</p>`,
    flashcards: flashcards.length ? flashcards : generateFallbackFlashcards(context),
    sources,
    exercise: parsed.exercise || 'Reflect on today\'s concept and write down one question you still have.'
  };
}

function generateFallbackTitle(settings) {
  if (settings.mode === 'curated') {
    return 'Curated Knowledge Review';
  }
  return `Learning Snapshot: ${settings.topic || 'General Curiosity'}`;
}

function generateFallbackFlashcards(context) {
  const topic = context?.settings?.topic || 'Learning Science';
  return [
    {
      question: `What is one actionable insight about ${topic}?`,
      answer: `Summarise one takeaway about ${topic} from today\'s reading.`
    }
  ];
}

function fallbackParser(text) {
  const [firstLine, ...rest] = text.split('\n');
  return {
    title: firstLine?.replace(/[#*-]/g, '').trim() || 'LearnPulse Daily Lesson',
    summary: rest.slice(0, 3).map((line) => line.trim()).filter(Boolean),
    lesson: `<p>${rest.join(' ')}</p>`,
    flashcards: generateFallbackFlashcards({ settings: {} }),
    sources: []
  };
}

