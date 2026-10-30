/**
 * Text preprocessing and chunking utility for Russian Speech Synthesis (TTS).
 * Removes markdown, technical artifacts, emojis, code and tables without leaving
 * orphan punctuation marks, and splits long texts into natural sentence chunks.
 */

// Common emojis and unicode pictograms to filter out for clean natural speech
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}]/gu;

/**
 * Cleans a markdown-formatted assistant message into clean, natural text suitable for speech.
 * Eliminates technical markers, tables, code blocks, duplicate dots, and expands common business abbreviations.
 */
export function cleanTextForSpeech(rawMarkdown: string): string {
  if (!rawMarkdown) return '';

  let text = rawMarkdown;

  // 1. Remove markdown code blocks completely (do not pronounce raw code or JSON)
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');

  // 2. Remove markdown tables (lines containing pipes |)
  text = text.replace(/^\|.*\|$/gm, '');
  text = text.replace(/^[\s]*[-|:\s]+$/gm, '');

  // 3. Remove markdown images and replace links with anchor text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/https?:\/\/\S+/g, '');

  // 4. Remove technical stop/error tags and UI status markers
  text = text.replace(/\[Остановлено\]/gi, '');
  text = text.replace(/\[Генерация[^\]]*\]/gi, '');
  text = text.replace(/\[Уточнить[^\]]*\]/gi, '');

  // 5. Headings: remove leading # and ensure line ends with a natural pause (period)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => {
    const trimmed = heading.trim();
    if (!trimmed) return '';
    return /[.!?:;]$/.test(trimmed) ? trimmed : trimmed + '.';
  });

  // 6. Bold, italic, strikethrough markdown
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // 7. Bullet and numbered lists: clean markers, keep sentence ends
  text = text.replace(/^[\s]*[-*+]\s+(.+)$/gm, (_, item) => {
    const trimmed = item.trim();
    return /[.!?;:]$/.test(trimmed) ? trimmed : trimmed + '.';
  });
  text = text.replace(/^[\s]*\d+\.\s+(.+)$/gm, (_, item) => {
    const trimmed = item.trim();
    return /[.!?;:]$/.test(trimmed) ? trimmed : trimmed + '.';
  });

  // 8. Blockquotes and horizontal rules
  text = text.replace(/^>\s+/gm, '');
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // 9. Emojis and decorative symbols (remove without leaving dangling spaces before punctuation)
  text = text.replace(EMOJI_REGEX, '');
  text = text.replace(/[•▪▫★☆▶►✔✓✕✖✅❌⚠️]/g, '');
  text = text.replace(/[«»„“]/g, '"');
  text = text.replace(/[—–]/g, ' - ');

  // 10. Common Russian abbreviations expansion for natural pronunciation
  text = text.replace(/\bт\.д\./gi, 'так далее');
  text = text.replace(/\bт\.п\./gi, 'тому подобное');
  text = text.replace(/\bт\.е\./gi, 'то есть');
  text = text.replace(/\bнапр\./gi, 'например');
  text = text.replace(/\bруб\./gi, 'рублей');
  text = text.replace(/\bчел\./gi, 'человек');
  text = text.replace(/\bшт\./gi, 'штук');
  text = text.replace(/\b(\d+)\s*г\./gi, '$1 года');
  text = text.replace(/\b(\d+)\s*руб\b/gi, '$1 рублей');

  // 11. Normalize line breaks into natural sentence pauses without extra dots
  text = text.replace(/([.!?:;])\s*\r?\n\s*\r?\n/g, '$1 ');
  text = text.replace(/([^.!?:;\s])\s*\r?\n\s*\r?\n/g, '$1. ');
  text = text.replace(/\r?\n/g, ' ');

  // 12. Fix whitespace before punctuation marks: 'Анна !' -> 'Анна!'
  text = text.replace(/\s+([.,!?;:])/g, '$1');

  // 13. Fix colliding punctuation (e.g., '! .' -> '!', '? .' -> '?', ': .' -> ':', '. .' -> '.')
  text = text.replace(/([!?])\s*\.+/g, '$1');
  text = text.replace(/([:;,])\s*\.+/g, '$1');
  text = text.replace(/\.+\s*([!?])/g, '$1');
  text = text.replace(/\.{2,}/g, '.');
  text = text.replace(/!{2,}/g, '!');
  text = text.replace(/\?{2,}/g, '?');

  // 14. Multiple whitespaces normalization
  text = text.replace(/\s{2,}/g, ' ');

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
