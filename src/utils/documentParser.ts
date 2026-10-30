import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { DocumentProcessingStatus } from '../types/assistant';

// Configure PDF.js worker for Vite & static hosting compatibility
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'txt',
  'csv',
  'md',
] as const;

export type SupportedDocumentExtension =
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

export interface ParsedDocumentResult {
  name: string;
  extension: string;
  sizeBytes: number;
  status: DocumentProcessingStatus;
  statusLabel: string;
  extractedText: string;
  warning?: string;
  pageCount?: number;
}

export function getStatusLabelRu(status: DocumentProcessingStatus): string {
  switch (status) {
    case 'queued':
    case 'pending':
      return 'Ожидает обработки';
    case 'processing':
      return 'Обрабатывается';
    case 'processed':
    case 'verified':
      return 'Успешно обработан';
    case 'no_text':
      return 'Нет доступного текста';
    case 'error':
      return 'Ошибка обработки';
    default:
      return 'Ожидает обработки';
  }
}

export function isSupportedDocumentExtension(ext: string): boolean {
  return (SUPPORTED_DOCUMENT_EXTENSIONS as readonly string[]).includes(
    ext.toLowerCase()
  );
}

/**
 * Decodes text buffer with UTF-8 first, falling back to windows-1251 for Russian CSV/TXT files saved from Excel/Windows.
 */
function decodeTextBufferSmart(buffer: ArrayBuffer): string {
  try {
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    return utf8Decoder.decode(buffer);
  } catch {
    try {
      const win1251Decoder = new TextDecoder('windows-1251');
      return win1251Decoder.decode(buffer);
    } catch {
      const fallbackDecoder = new TextDecoder('utf-8');
      return fallbackDecoder.decode(buffer);
    }
  }
}

/**
 * Extracts text from a PDF file using pdfjs-dist.
 * Detects scanned/image-only PDFs and reports 'no_text' honestly without faking OCR.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<{
  text: string;
  pageCount: number;
  emptyPagesCount: number;
}> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pageTexts: string[] = [];
  let emptyPagesCount = 0;

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings: string[] = [];
    for (const item of content.items) {
      if ('str' in item && typeof item.str === 'string') {
        strings.push(item.str);
      }
    }
    const joinedPage = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (joinedPage.length > 0) {
      pageTexts.push(
        pageCount > 1 ? `[Страница ${i}]\n${joinedPage}` : joinedPage
      );
    } else {
      emptyPagesCount++;
    }
  }

  return {
    text: pageTexts.join('\n\n'),
    pageCount,
    emptyPagesCount,
  };
}

/**
 * Extracts text from a DOCX file using Mammoth, with JSZip XML fallback.
 */
async function extractDocxText(buffer: ArrayBuffer): Promise<{
  text: string;
  warnings: string[];
}> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const raw = (result.value || '').replace(/\r\n/g, '\n').trim();
    const messages = (result.messages || [])
      .filter((m) => m.type === 'warning')
      .map((m) => m.message);
    if (raw.length > 0) {
      return { text: raw, warnings: messages };
    }
  } catch {
    // Fallback to JSZip XML parsing below
  }

  // Fallback: inspect word/document.xml via JSZip
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error(
      'Файл не содержит структуры документа Word (word/document.xml). Проверьте, что это корректный файл .docx.'
    );
  }
  const xmlStr = await docFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
  const paragraphs: string[] = [];
  const pNodes = Array.from(xmlDoc.getElementsByTagName('w:p'));

  for (const p of pNodes) {
    const tNodes = Array.from(p.getElementsByTagName('w:t'));
    const line = tNodes
      .map((t) => t.textContent || '')
      .join('')
      .trim();
    if (line) {
      paragraphs.push(line);
    }
  }

  return { text: paragraphs.join('\n'), warnings: [] };
}

/**
 * Extracts slide text and speaker notes from a PPTX file using JSZip.
 */
async function extractPptxText(buffer: ArrayBuffer): Promise<{
  text: string;
  slideCount: number;
  emptySlidesCount: number;
}> {
  const zip = await JSZip.loadAsync(buffer);
  const slideRegex = /^ppt\/slides\/slide(\d+)\.xml$/i;

  const slideEntries: { num: number; path: string }[] = [];
  zip.forEach((relativePath) => {
    const match = relativePath.match(slideRegex);
    if (match) {
      slideEntries.push({
        num: parseInt(match[1], 10),
        path: relativePath,
      });
    }
  });

  if (slideEntries.length === 0) {
    throw new Error(
      'В архиве презентации не найдены слайды (ppt/slides/slide*.xml). Проверьте корректность файла .pptx.'
    );
  }

  slideEntries.sort((a, b) => a.num - b.num);

  const parser = new DOMParser();
  const slideBlocks: string[] = [];
  let emptySlidesCount = 0;

  for (const entry of slideEntries) {
    const slideFile = zip.file(entry.path);
    if (!slideFile) continue;

    const xmlStr = await slideFile.async('string');
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');

    // Collect text from <a:t> nodes paragraph by paragraph (<a:p>)
    const pNodes = Array.from(xmlDoc.getElementsByTagName('a:p'));
    const lines: string[] = [];

    if (pNodes.length > 0) {
      for (const p of pNodes) {
        const tNodes = Array.from(p.getElementsByTagName('a:t'));
        const line = tNodes
          .map((t) => t.textContent || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) lines.push(line);
      }
    } else {
      const allT = Array.from(xmlDoc.getElementsByTagName('a:t'));
      const fallback = allT
        .map((t) => t.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (fallback) lines.push(fallback);
    }

    // Check optional speaker notes for this slide
    const notesPath = `ppt/notesSlides/notesSlide${entry.num}.xml`;
    const notesFile = zip.file(notesPath);
    if (notesFile) {
      try {
        const notesXml = await notesFile.async('string');
        const notesDoc = parser.parseFromString(notesXml, 'application/xml');
        const notesT = Array.from(notesDoc.getElementsByTagName('a:t'))
          .map((t) => t.textContent || '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (notesT && notesT !== String(entry.num)) {
          lines.push(`[Заметки к слайду: ${notesT}]`);
        }
      } catch {
        // ignore notes error
      }
    }

    if (lines.length > 0) {
      slideBlocks.push(`[Слайд ${entry.num}]\n${lines.join('\n')}`);
    } else {
      emptySlidesCount++;
    }
  }

  return {
    text: slideBlocks.join('\n\n'),
    slideCount: slideEntries.length,
    emptySlidesCount,
  };
}

/**
 * Formats CSV content cleanly while keeping all rows and columns readable.
 */
function formatCsvText(rawCsv: string): {
  text: string;
  rowCount: number;
} {
  const normalized = rawCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { text: '', rowCount: 0 };
  }
  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return {
    text: lines.join('\n'),
    rowCount: lines.length,
  };
}

/**
 * Main entry point to parse any supported document file on the client side.
 */
export async function parseDocumentFile(
  file: File,
  onStatusChange?: (status: DocumentProcessingStatus, label: string) => void
): Promise<ParsedDocumentResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const notify = (status: DocumentProcessingStatus) => {
    onStatusChange?.(status, getStatusLabelRu(status));
  };

  notify('queued');

  if (!isSupportedDocumentExtension(ext)) {
    return {
      name: file.name,
      extension: ext,
      sizeBytes: file.size,
      status: 'error',
      statusLabel: getStatusLabelRu('error'),
      extractedText: '',
      warning: `Формат .${ext || 'неизвестен'} не входит в список поддерживаемых документов (PDF, DOCX, PPTX, TXT, CSV, MD).`,
    };
  }

  if (file.size === 0) {
    return {
      name: file.name,
      extension: ext,
      sizeBytes: 0,
      status: 'no_text',
      statusLabel: getStatusLabelRu('no_text'),
      extractedText: '',
      warning: 'Выбранный файл пуст (0 байт) и не содержит текста.',
    };
  }

  notify('processing');

  try {
    const buffer = await file.arrayBuffer();

    // 1. TXT & MD
    if (ext === 'txt' || ext === 'md') {
      const decoded = decodeTextBufferSmart(buffer)
        .replace(/\r\n/g, '\n')
        .trim();
      if (!decoded) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          warning: 'Текстовый файл не содержит печатных символов.',
        };
      }
      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: decoded,
      };
    }

    // 2. CSV
    if (ext === 'csv') {
      const decoded = decodeTextBufferSmart(buffer);
      const { text, rowCount } = formatCsvText(decoded);
      if (!text || rowCount === 0) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          warning: 'Таблица CSV пуста и не содержит строк с данными.',
        };
      }
      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        pageCount: rowCount,
      };
    }

    // 3. PDF
    if (ext === 'pdf') {
      const { text, pageCount, emptyPagesCount } = await extractPdfText(buffer);
      if (!text.trim()) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          pageCount,
          warning: `Документ PDF (${pageCount} стр.) не содержит извлекаемого текстового слоя. Вероятно, это отсканированное изображение. Оптическое распознавание (OCR) в приложении не используется — вы можете внести текст вручную.`,
        };
      }

      const partialWarning =
        emptyPagesCount > 0
          ? `Извлечён текст с ${pageCount - emptyPagesCount} из ${pageCount} стр. На ${emptyPagesCount} стр. текстовый слой отсутствует (возможны изображения или сканы).`
          : undefined;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        pageCount,
        warning: partialWarning,
      };
    }

    // 4. DOCX
    if (ext === 'docx') {
      const { text } = await extractDocxText(buffer);
      if (!text.trim()) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          warning:
            'Документ DOCX успешно открыт, но не содержит текстовых абзацев (возможно, внутри только изображения).',
        };
      }
      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
      };
    }

    // 5. PPTX
    if (ext === 'pptx') {
      const { text, slideCount, emptySlidesCount } =
        await extractPptxText(buffer);
      if (!text.trim()) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          pageCount: slideCount,
          warning: `Презентация PPTX (${slideCount} сл.) не содержит текстовых блоков (вероятно, слайды состоят только из иллюстраций).`,
        };
      }

      const partialWarning =
        emptySlidesCount > 0
          ? `Извлечён текст с ${slideCount - emptySlidesCount} из ${slideCount} слайдов (${emptySlidesCount} сл. без текста).`
          : undefined;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        pageCount: slideCount,
        warning: partialWarning,
      };
    }

    return {
      name: file.name,
      extension: ext,
      sizeBytes: file.size,
      status: 'error',
      statusLabel: getStatusLabelRu('error'),
      extractedText: '',
      warning: `Не удалось определить обработчик для формата .${ext}.`,
    };
  } catch (err) {
    const errMsg =
      err instanceof Error
        ? err.message
        : 'Не удалось прочитать структуру файла.';
    return {
      name: file.name,
      extension: ext,
      sizeBytes: file.size,
      status: 'error',
      statusLabel: getStatusLabelRu('error'),
      extractedText: '',
      warning: `Ошибка при разборе файла «${file.name}»: ${errMsg}`,
    };
  }
}
