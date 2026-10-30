/**
 * Text preprocessing and chunking utility for Russian Speech Synthesis (TTS).
 * Removes markdown, technical artifacts, and splits long texts into natural sentence chunks.
 */

// Common emojis and unicode pictograms to filter out for cleaner natural speech
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu;

/**
 * Cleans a markdown-formatted assistant message into clean, natural text suitable for speech.
 */
export function cleanTextForSpeech(rawMarkdown: string): string {
  if (!rawMarkdown) return '';

  let text = rawMarkdown;

  // 1. Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, ' код опущен ');
  text = text.replace(/`([^`]+)`/g, '$1');

  // 2. Remove markdown images and replace links with just the anchor text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 3. Remove technical stop/error tags
  text = text.replace(/\[Остановлено\]/gi, '');
  text = text.replace(/\[Генерация[^\]]*\]/gi, '');

  // 4. Remove headings (#, ##, ###)
  text = text.replace(/^#{1,6}\s+/gm, '');

  // 5. Remove bold and italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // 6. Clean bullet list markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, '');
  text = text.replace(/^[\s]*\d+\.\s+/gm, '');

  // 7. Remove blockquotes and horizontal rules
  text = text.replace(/^>\s+/gm, '');
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // 8. Replace technical symbols, emojis, and math signs
  text = text.replace(EMOJI_REGEX, '');
  text = text.replace(/[«»„“]/g, '"');
  text = text.replace(/[—–]/g, ' - ');

  // 9. Normalize multiple whitespaces and newlines into smooth pauses
  text = text.replace(/\r?\n\s*\r?\n/g, '. ');
  text = text.replace(/\r?\n/g, ' ');
  text = text.replace(/\s{2,}/g, ' ');

  // 10. Clean up repeated punctuation
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/!{2,}/g, '!');
  text = text.replace(/\?{2,}/g, '?');

  return text.trim();
}

/**
 * Splits text into logical sentence chunks (max ~200 chars) for Web Speech API.
 * The browser SpeechSynthesis API in Chromium can stall or cut audio if a single utterance exceeds ~250 chars.
 * Chunking by natural sentences ensures smooth, continuous playback without clipping.
 */
export function splitTextIntoSpeechChunks(
  cleanedText: string,
  maxChunkChars = 200
): string[] {
  if (!cleanedText) return [];

  // Match sentence terminators (., !, ?) followed by whitespace or end of string
  const rawSentences = cleanedText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of rawSentences) {
    // If a single sentence is already very long, split it by commas or clauses
    if (sentence.length > maxChunkChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      const subClauses = sentence
        .split(/(?<=[,;:])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const clause of subClauses) {
        if ((currentChunk + ' ' + clause).trim().length <= maxChunkChars) {
          currentChunk = (currentChunk + ' ' + clause).trim();
        } else {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = clause;
        }
      }
    } else {
      if ((currentChunk + ' ' + sentence).trim().length <= maxChunkChars) {
        currentChunk = (currentChunk + ' ' + sentence).trim();
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 0);
}
