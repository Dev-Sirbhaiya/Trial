/**
 * Content Chunker
 * ---------------
 * Converts curated sources (URLs, pasted text, uploaded files) into manageable
 * text chunks suitable for prompting LLMs while enforcing strict source attribution.
 */

const DEFAULT_CHUNK_SIZE = 900; // characters

/**
 * Chunk an array of curated sources.
 * @param {Array} sources - User-provided sources from settings.
 * @returns {Promise<Array>} Array of chunk objects containing text and metadata.
 */
export async function chunkSources(sources = []) {
  const chunks = [];

  for (const source of sources) {
    try {
      const text = await resolveSourceText(source);
      if (!text) continue;
      const clean = sanitiseText(text);
      const chunkSet = splitIntoChunks(clean, DEFAULT_CHUNK_SIZE).map((chunk, index) => ({
        id: `${source.id || source.url || source.label || 'source'}-${index}`,
        text: chunk,
        sourceTitle: source.label || source.title || source.url || 'User Provided Material',
        reference: source.url || source.label || 'Uploaded text',
        url: source.url || null
      }));
      chunks.push(...chunkSet);
    } catch (error) {
      console.warn('Failed to process source', source, error);
    }
  }

  return chunks;
}

async function resolveSourceText(source) {
  if (!source) return '';
  if (source.type === 'text') {
    return source.value || source.text || '';
  }
  if (source.type === 'url' && source.url) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      return stripHtml(html);
    } catch (error) {
      console.warn('Unable to fetch URL source', source.url, error);
      return '';
    }
  }
  if (source.type === 'file' && source.content) {
    const decoder = new TextDecoder('utf-8');
    if (typeof source.content === 'string') {
      try {
        return atob(source.content);
      } catch (error) {
        return source.content;
      }
    }
    if (source.content instanceof ArrayBuffer) {
      return decoder.decode(source.content);
    }
  }
  return '';
}

function sanitiseText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function splitIntoChunks(text, chunkSize) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    const slice = text.slice(cursor, cursor + chunkSize);
    chunks.push(slice);
    cursor += chunkSize;
  }
  return chunks;
}

function stripHtml(html) {
  const withoutScripts = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const text = withoutScripts.replace(/<[^>]+>/g, ' ');
  return text;
}

