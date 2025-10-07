/**
 * Chrome Prompt API Connector (Gemini Nano)
 * ----------------------------------------
 * Provides a thin abstraction over the on-device Prompt API so the background
 * worker can treat it as another backend alongside Gemini cloud and Ollama.
 */

import { generateLessonWithGemini } from './llm-gemini.js';

/**
 * Determine whether the Chrome Prompt API is currently available.
 * The API may be gated behind flags or hardware requirements.
 * @returns {Promise<boolean>} true when the API can create a language model session.
 */
export async function isPromptApiAvailable() {
  try {
    if (!self.ai || !self.ai.languageModel || typeof self.ai.languageModel.capabilities !== 'function') {
      return Boolean(self.ai?.languageModel?.create);
    }
    const capabilities = await self.ai.languageModel.capabilities();
    return capabilities?.available !== 'no';
  } catch (error) {
    console.warn('Prompt API capability check failed:', error);
    return false;
  }
}

/**
 * Generate a LearnPulse lesson using the on-device Prompt API.
 * @param {Object} params
 * @param {Object} params.context - Generation context built by the background worker.
 * @param {string} [params.model] - Optional Prompt API model identifier.
 * @param {number} [params.temperature] - Optional creativity control for the prompt API.
 */
export async function generateLessonWithPromptApi({ context, model = 'gemini-pro', temperature = 0.7 }) {
  const available = await isPromptApiAvailable();
  if (!available) {
    throw new Error('Chrome Prompt API is not available on this device.');
  }
  return generateLessonWithGemini({
    apiKey: undefined,
    model,
    context,
    usePromptApi: true,
    temperature
  });
}
