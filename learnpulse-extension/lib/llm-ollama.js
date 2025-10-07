/**
 * Ollama Connector
 * ----------------
 * Interfaces with a locally running Ollama server to generate lessons.
 */

const OLLAMA_HOST = 'http://localhost:11434';

/**
 * Generate a lesson using an Ollama model.
 * @param {Object} params
 * @param {string} params.model - Ollama model name.
 * @param {Object} params.context - Shared generation context.
 */
export async function generateLessonWithOllama({ model, context }) {
  const prompt = buildStructuredPrompt(context);
  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 800
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const text = data?.response;
  if (!text) {
    throw new Error('Ollama returned no response text.');
  }

  return normaliseOutput(text, context);
}

function buildStructuredPrompt(context) {
  const { settings, curatedChunks, recentLessons, dueFlashcards } = context;
  const modeLine = settings.mode === 'curated'
    ? 'Use ONLY the provided curated excerpts. If insufficient, explain why.'
    : 'Design a cohesive autonomous curriculum.';
  const curated = curatedChunks.map((chunk, index) => `[#${index + 1}] ${chunk.text}\nSource: ${chunk.sourceTitle}`).join('\n');
  const history = recentLessons.map((lesson) => `${lesson.date} — ${lesson.title}`).join('\n');
  const due = dueFlashcards.map((card) => `${card.question} => ${card.answer}`).join('\n');

  return `You are LearnPulse, generating a daily learning capsule.
${modeLine}
Topic: ${settings.topic || 'General knowledge'}
Preferred length: ${settings.lessonLength} words.
Required flashcards: ${settings.flashcardCount}.
Recent lessons:\n${history || 'None'}
Due flashcards:\n${due || 'None'}
Curated excerpts:\n${curated || 'N/A'}

Respond in minified JSON with keys title, summary (array of 3 bullets), lesson (HTML string), flashcards (array of {question, answer}), sources (array of {title, reference}), exercise.`;
}

function normaliseOutput(text, context) {
  const cleaned = text.trim().replace(/^```json\n?|```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Ollama response was not valid JSON: ${error.message}`);
  }

  return {
    title: parsed.title || 'LearnPulse Lesson',
    summary: Array.isArray(parsed.summary) ? parsed.summary : [parsed.summary].filter(Boolean),
    lesson: parsed.lesson || '<p>No lesson content produced.</p>',
    flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
    sources: parsed.sources || context.curatedChunks?.slice(0, 3) || [],
    exercise: parsed.exercise || 'Reflect on what you learned today.'
  };
}

