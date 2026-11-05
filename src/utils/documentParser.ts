import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { Ream } from 'reamkit';
import {
  DocumentProcessingStatus,
  ExtractedDocumentImage,
  ExtractedSlideItem,
  ExtractedSpreadsheetSheet,
  KnowledgeFileType,
  VisualColorSample,
} from '../types/assistant';

// Configure PDF.js worker for Vite & static hosting compatibility
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'ppt',
  'xlsx',
  'xls',
  'txt',
  'csv',
  'md',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'zip',
  'mp4',
  'mov',
  'webm',
] as const;

export type SupportedDocumentExtension =
  (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

export interface ZipArchiveEntry {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  isSupported: boolean;
}

export interface ParsedDocumentResult {
  name: string;
  extension: string;
  sizeBytes: number;
  status: DocumentProcessingStatus;
  statusLabel: string;
  extractedText: string;
  warning?: string;
  pageCount?: number;
  fileType?: KnowledgeFileType;
  mimeType?: string;
  dataUrl?: string;
  thumbnailUrl?: string;
  slides?: ExtractedSlideItem[];
  colorPalette?: VisualColorSample[];
  extractedImages?: ExtractedDocumentImage[];
  tableSheets?: ExtractedSpreadsheetSheet[];
  durationSec?: number;
  videoWidth?: number;
  videoHeight?: number;
  archiveEntries?: ZipArchiveEntry[];
}

export function getStatusLabelRu(status: DocumentProcessingStatus): string {
  switch (status) {
    case 'uploading':
      return 'Загружается';
    case 'queued':
    case 'pending':
      return 'Ожидает обработки';
    case 'processing':
      return 'Обрабатывается';
    case 'processed':
    case 'verified':
      return 'Готов';
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

export function getFileTypeFromExtension(ext: string): KnowledgeFileType {
  const norm = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(norm)) return 'image';
  if (['pptx', 'ppt'].includes(norm)) return 'presentation';
  if (['zip'].includes(norm)) return 'archive';
  if (['mp4', 'mov', 'webm'].includes(norm)) return 'video';
  return 'document';
}

export function getMimeTypeFromExt(ext: string): string {
  const norm = ext.toLowerCase();
  switch (norm) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'md':
      return 'text/markdown';
    case 'zip':
      return 'application/zip';
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Extracts distinct HEX color codes from text (e.g. brandbook guidelines).
 */
export function extractHexColorsFromText(text: string): VisualColorSample[] {
  if (!text) return [];
  const hexRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const matches = text.match(hexRegex);
  if (!matches) return [];
  const unique = Array.from(new Set(matches.map((m) => m.toUpperCase())));
  return unique.slice(0, 16).map((hex) => ({ hex }));
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
 * Resizes an image Base64 data URL to a maximum dimension (default 1024x1024)
 * using HTML5 Canvas in browser, or returns original if cannot resize.
 */
export async function resizeImageBase64(
  dataUrl: string,
  maxDim = 1024
): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.startsWith('data:image/svg+xml')) return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    const timeout = setTimeout(() => resolve(dataUrl), 2500);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h || (w <= maxDim && h <= maxDim)) {
          resolve(dataUrl);
          return;
        }
        const scale = maxDim / Math.max(w, h);
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          canvas.width = 0;
          canvas.height = 0;
          resolve(compressed);
          return;
        }
      } catch {
        // ignore canvas errors
      }
      resolve(dataUrl);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(dataUrl);
    };

    img.src = dataUrl;
  });
}

/**
 * Renders a PDF page to a compressed base64 JPEG image URL scaled to maxDim (default 512x512).
 */
async function renderPdfPageToDataUrl(
  page: any,
  maxDim = 512
): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = Math.min(
      1.2,
      Math.min(maxDim / unscaledViewport.width, maxDim / unscaledViewport.height)
    );
    const viewport = page.getViewport({ scale: Math.max(scale, 0.4) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Solid white background for transparent pages
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.60);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } catch (err) {
    console.warn('[PDF Page Render Error]', err);
    return '';
  }
}

export const MAX_DOCUMENT_PAGES_TO_RENDER = 200;

/**
 * Extracts text and renders pages/slides into compressed base64 images from a PDF file using pdfjs-dist.
 */
export async function extractPdfMultimodal(
  buffer: ArrayBuffer,
  maxPagesToRender = MAX_DOCUMENT_PAGES_TO_RENDER
): Promise<{
  text: string;
  pageCount: number;
  emptyPagesCount: number;
  images: string[];
  extractedImages: ExtractedDocumentImage[];
  thumbnailUrl?: string;
}> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pageTexts: string[] = [];
  let emptyPagesCount = 0;
  const images: string[] = [];
  const extractedImages: ExtractedDocumentImage[] = [];
  let thumbnailUrl: string | undefined;

  const pagesToRender = Math.min(pageCount, maxPagesToRender);
  const docUid = Math.random().toString(36).slice(2, 8);

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);

    // 1. Text extraction
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

    // 2. Generate lightweight 100px thumbnail for page 1 preview
    if (i === 1 && typeof document !== 'undefined') {
      try {
        thumbnailUrl = await renderPdfPageToDataUrl(page, 100);
      } catch {
        thumbnailUrl = undefined;
      }
    }

    // 3. Render page to compressed image if within limit
    if (i <= pagesToRender && typeof document !== 'undefined') {
      try {
        const pageDataUrl = await renderPdfPageToDataUrl(page, 512);
        if (pageDataUrl) {
          images.push(pageDataUrl);
          extractedImages.push({
            id: `pdf-page-${docUid}-${i}`,
            name: `Страница ${i}`,
            dataUrl: pageDataUrl,
            mimeType: 'image/jpeg',
            sourceSlide: i,
          });
        }
      } catch (renderErr) {
        console.warn(`[PDF Render Page ${i} Warning]`, renderErr);
      }
    }
  }

  return {
    text: pageTexts.join('\n\n'),
    pageCount,
    emptyPagesCount,
    images,
    extractedImages,
    thumbnailUrl: thumbnailUrl || extractedImages[0]?.dataUrl,
  };
}

/**
 * Extracts text and embedded media images (/media/) from a DOCX file using Mammoth and JSZip.
 */
export async function extractDocxMultimodal(
  buffer: ArrayBuffer
): Promise<{
  text: string;
  images: string[];
  extractedImages: ExtractedDocumentImage[];
  warnings: string[];
}> {
  let text = '';
  const warnings: string[] = [];

  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    text = (result.value || '').replace(/\r\n/g, '\n').trim();
    const messages = (result.messages || [])
      .filter((m) => m.type === 'warning')
      .map((m) => m.message);
    warnings.push(...messages);
  } catch {
    // Fallback to JSZip XML parsing
  }

  const zip = await JSZip.loadAsync(buffer);

  if (!text) {
    const docFile = zip.file('word/document.xml');
    if (docFile) {
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
      text = paragraphs.join('\n');
    }
  }

  // Extract embedded media images from word/media/* or media/*
  const images: string[] = [];
  const extractedImages: ExtractedDocumentImage[] = [];
  const mediaPaths: string[] = [];

  zip.forEach((p) => {
    const lower = p.toLowerCase();
    if (
      lower.startsWith('word/media/') ||
      lower.includes('/media/') ||
      lower.startsWith('media/')
    ) {
      mediaPaths.push(p);
    }
  });

  let imgIdx = 1;
  const docxDocUid = Math.random().toString(36).slice(2, 8);
  for (const mediaPath of mediaPaths.slice(0, 25)) {
    const file = zip.file(mediaPath);
    if (!file) continue;
    const fileName = mediaPath.split('/').pop() || `image_${imgIdx}.png`;
    const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
      try {
        const base64 = await file.async('base64');
        const mimeType = getMimeTypeFromExt(ext);
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const resizedUrl = await resizeImageBase64(dataUrl, 1024);
        images.push(resizedUrl);
        extractedImages.push({
          id: `docx-img-${docxDocUid}-${imgIdx++}`,
          name: fileName,
          dataUrl: resizedUrl,
          mimeType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
        });
      } catch {
        // ignore corrupt media item
      }
    }
  }

  return { text, images, extractedImages, warnings };
}

/**
 * Converts a PPTX ArrayBuffer into a PDF ArrayBuffer using reamkit in-memory parser/converter.
 * Does not require LibreOffice or external software.
 */
export async function convertPptxToPdf(
  buffer: ArrayBuffer
): Promise<{
  success: boolean;
  pdfBuffer?: ArrayBuffer;
  error?: string;
  message?: string;
}> {
  // 1. Local pure-JS/TS conversion using reamkit (no LibreOffice required)
  try {
    const bytes = new Uint8Array(buffer);
    const doc = Ream.parse(bytes);
    const pdfUint8 = await doc.convert('pdf');
    if (pdfUint8 && pdfUint8.byteLength > 0) {
      const raw = pdfUint8.buffer.slice(
        pdfUint8.byteOffset,
        pdfUint8.byteOffset + pdfUint8.byteLength
      );
      return { success: true, pdfBuffer: raw as ArrayBuffer };
    }
  } catch (reamErr) {
    console.warn('[Reamkit local conversion notice, trying IPC]', reamErr);
  }

  // 2. Electron desktop IPC fallback
  if (typeof window !== 'undefined') {
    const electronApi = (window as unknown as {
      electronAPI?: {
        files?: {
          convertPptxToPdf?: (payload: { buffer: ArrayBuffer }) => Promise<{
            success: boolean;
            pdfBuffer?: ArrayBuffer | Uint8Array;
            error?: string;
            message?: string;
          }>;
        };
      };
    })?.electronAPI;

    if (electronApi?.files && typeof electronApi.files.convertPptxToPdf === 'function') {
      try {
        const res = await electronApi.files.convertPptxToPdf({ buffer });
        if (res.success && res.pdfBuffer) {
          const raw =
            res.pdfBuffer instanceof Uint8Array
              ? res.pdfBuffer.buffer.slice(
                  res.pdfBuffer.byteOffset,
                  res.pdfBuffer.byteOffset + res.pdfBuffer.byteLength
                )
              : res.pdfBuffer;
          return { success: true, pdfBuffer: raw as ArrayBuffer };
        }
        return {
          success: false,
          error: res.error,
          message:
            res.message ||
            'Не удалось автоматически конвертировать презентацию. Пожалуйста, сохраните её в PDF вручную',
        };
      } catch (err) {
        console.warn('[Electron PPTX-to-PDF IPC error]', err);
      }
    }
  }

  return {
    success: false,
    error: 'CONVERSION_FAILED',
    message:
      'Не удалось автоматически конвертировать презентацию. Пожалуйста, сохраните её в PDF вручную',
  };
}

/**
 * Extracts slide text, speaker notes, embedded media images, and color themes from a PPTX file using JSZip.
 */
async function extractPptxTextAndVisuals(buffer: ArrayBuffer): Promise<{
  text: string;
  slideCount: number;
  emptySlidesCount: number;
  slides: ExtractedSlideItem[];
  extractedImages: ExtractedDocumentImage[];
  colorPalette: VisualColorSample[];
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

  // 1. Extract embedded media images from ppt/media/* (including icons, vectors, and embedded visuals)
  const mediaImages = new Map<string, { base64: string; mimeType: string }>();
  const mediaPaths: string[] = [];
  zip.forEach((rawPath) => {
    const norm = rawPath.replace(/\\/g, '/');
    const lower = norm.toLowerCase();
    if (
      lower.startsWith('ppt/media/') ||
      lower.includes('/ppt/media/') ||
      lower.startsWith('media/') ||
      lower.includes('/media/')
    ) {
      mediaPaths.push(norm);
    }
  });

  // Natural sort so slide 1 media precedes slide 2, etc. (e.g. image1, image2, image10)
  mediaPaths.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  const SYSTEM_MEDIA_PATTERNS = [
    /^thumb/i,
    /_thumb/i,
    /\.bin$/i,
    /\.wmf$/i,
    /\.emf$/i,
    /\.xml$/i,
    /\.rels$/i,
    /\.tmp$/i,
    /\.ds_store$/i,
  ];

  for (const mediaPath of mediaPaths) {
    const mediaFile = zip.file(mediaPath);
    if (!mediaFile) continue;
    const fileName = mediaPath.split('/').pop() || 'image.png';

    // Filter out system files, thumbnails, dummy binaries, and macOS metadata
    if (
      fileName.startsWith('.') ||
      mediaPath.includes('__MACOSX') ||
      SYSTEM_MEDIA_PATTERNS.some((p) => p.test(fileName))
    ) {
      continue;
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'jfif', 'bmp'].includes(ext)) {
      try {
        const base64 = await mediaFile.async('base64');
        if (!base64 || base64.length < 32) continue; // Skip empty or corrupted items
        const mimeType = getMimeTypeFromExt(ext);
        mediaImages.set(fileName, { base64, mimeType });
      } catch {
        // ignore unreadable media file
      }
    }
  }

  // 2. Extract theme colors from ppt/theme/theme1.xml
  const colorPalette: VisualColorSample[] = [];
  const seenHex = new Set<string>();
  const addHex = (hex: string, label?: string) => {
    const clean = hex.toUpperCase().replace(/^#/, '');
    if (/^[0-9A-F]{6}$/.test(clean) && !seenHex.has(clean)) {
      seenHex.add(clean);
      colorPalette.push({ hex: `#${clean}`, label });
    }
  };

  const themeFile = zip.file('ppt/theme/theme1.xml');
  if (themeFile) {
    try {
      const themeXml = await themeFile.async('string');
      const matches = themeXml.matchAll(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/gi);
      for (const m of matches) {
        if (m[1]) addHex(m[1]);
      }
    } catch {
      // ignore
    }
  }

  const parser = new DOMParser();
  const slideBlocks: string[] = [];
  const slides: ExtractedSlideItem[] = [];
  let emptySlidesCount = 0;

  for (const entry of slideEntries) {
    const slideFile = zip.file(entry.path);
    if (!slideFile) continue;

    const xmlStr = await slideFile.async('string');
    const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');

    // Also look for color codes directly in slide shapes
    const slideColors = xmlStr.matchAll(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/gi);
    for (const m of slideColors) {
      if (m[1]) addHex(m[1]);
    }

    // Collect text from <a:p> and <p> nodes
    const lines: string[] = [];
    const pNodes = Array.from(xmlDoc.getElementsByTagName('a:p')).concat(
      Array.from(xmlDoc.getElementsByTagName('p'))
    );

    if (pNodes.length > 0) {
      for (const p of pNodes) {
        const tNodes = Array.from(p.getElementsByTagName('a:t')).concat(
          Array.from(p.getElementsByTagName('t'))
        );
        const line = tNodes
          .map((t) => t.textContent || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (line) lines.push(line);
      }
    } else {
      const allT = Array.from(xmlDoc.getElementsByTagName('a:t')).concat(
        Array.from(xmlDoc.getElementsByTagName('t'))
      );
      const fallback = allT
        .map((t) => t.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (fallback) lines.push(fallback);
    }

    // Fallback: regex extraction to guarantee no text loss on text-only slides
    if (lines.length === 0) {
      const tMatches = xmlStr.matchAll(/<(?:a:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:a:)?t>/gi);
      const regexTokens: string[] = [];
      for (const m of tMatches) {
        if (m[1]) {
          const unescaped = m[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
          if (unescaped) regexTokens.push(unescaped);
        }
      }
      if (regexTokens.length > 0) {
        lines.push(regexTokens.join(' '));
      }
    }

    // Speaker notes
    let notesText: string | undefined;
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
          notesText = notesT;
          lines.push(`[Заметки к слайду: ${notesT}]`);
        }
      } catch {
        // ignore
      }
    }

    // Map images for this specific slide via slide relationships
    const slideFileName = entry.path.split('/').pop() || `slide${entry.num}.xml`;
    let relsFile = zip.file(`ppt/slides/_rels/${slideFileName}.rels`);
    if (!relsFile) {
      relsFile = zip.file(`ppt/slides/_rels/slide${entry.num}.xml.rels`);
    }
    const slideImageUrls: string[] = [];

    if (relsFile) {
      try {
        const relsXml = await relsFile.async('string');
        const relsDoc = parser.parseFromString(relsXml, 'application/xml');
        const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
        for (const rel of relNodes) {
          const target = rel.getAttribute('Target') || '';
          const targetFileName = target.split('/').pop()?.split('\\').pop() || '';
          const foundImg = mediaImages.get(targetFileName);
          if (foundImg) {
            slideImageUrls.push(
              `data:${foundImg.mimeType};base64,${foundImg.base64}`
            );
          }
        }
      } catch {
        // ignore
      }
    }

    const joinedSlideText = lines.join('\n');
    if (joinedSlideText.length > 0) {
      slideBlocks.push(`[Слайд ${entry.num}]\n${joinedSlideText}`);
    } else {
      emptySlidesCount++;
    }

    slides.push({
      slideNumber: entry.num,
      text: joinedSlideText,
      imageUrls: slideImageUrls.length > 0 ? slideImageUrls : undefined,
      notes: notesText,
    });
  }

  // Compile extracted images list
  const extractedImages: ExtractedDocumentImage[] = [];
  const pptxDocUid = Math.random().toString(36).slice(2, 8);
  let imgCounter = 1;
  for (const [imgName, item] of mediaImages.entries()) {
    extractedImages.push({
      id: `img-pptx-${pptxDocUid}-${imgCounter++}`,
      name: imgName,
      dataUrl: `data:${item.mimeType};base64,${item.base64}`,
      mimeType: item.mimeType,
    });
  }

  if (extractedImages.length > 5) {
    console.warn(
      `[PPTX Parser] Из файла извлечено ${extractedImages.length} визуальных элементов (превышает 5). В ИИ будет отправлена адаптивная выборка из 10 ключевых изображений (обложка, концовка и середина).`
    );
  }

  return {
    text: slideBlocks.join('\n\n'),
    slideCount: slideEntries.length,
    emptySlidesCount,
    slides,
    extractedImages,
    colorPalette: colorPalette.slice(0, 12),
  };
}

/**
 * Captures video metadata (duration, width, height) and an offscreen canvas thumbnail snapshot.
 */
export async function captureVideoMetadataAndThumbnail(file: File): Promise<{
  durationSec: number;
  width: number;
  height: number;
  thumbnailUrl: string;
}> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve({ durationSec: 0, width: 0, height: 0, thumbnailUrl: '' });
      return;
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
    } catch {
      resolve({ durationSec: 0, width: 0, height: 0, thumbnailUrl: '' });
      return;
    }

    const cleanup = () => {
      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        video.remove();
      } catch {
        // ignore
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ durationSec: 0, width: 0, height: 0, thumbnailUrl: '' });
    }, 7000);

    video.onloadedmetadata = () => {
      const duration = Math.round(video.duration || 0);
      const width = video.videoWidth || 640;
      const height = video.videoHeight || 360;

      const seekTime = Math.min(1.0, duration > 1 ? 1.0 : 0.1);
      video.currentTime = seekTime;

      video.onseeked = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 480;
          const scale = Math.min(1, maxDim / Math.max(width, height));
          canvas.width = Math.round(width * scale) || 320;
          canvas.height = Math.round(height * scale) || 180;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const thumb = canvas.toDataURL('image/jpeg', 0.8);
            cleanup();
            resolve({
              durationSec: duration,
              width,
              height,
              thumbnailUrl: thumb,
            });
            return;
          }
        } catch {
          // ignore canvas draw errors
        }
        cleanup();
        resolve({
          durationSec: duration,
          width,
          height,
          thumbnailUrl: '',
        });
      };
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve({ durationSec: 0, width: 0, height: 0, thumbnailUrl: '' });
    };
  });
}

/**
 * Inspects ZIP archive contents without executing or running any files.
 */
export async function inspectZipArchive(file: File): Promise<ZipArchiveEntry[]> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const entries: ZipArchiveEntry[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    if (
      relativePath.includes('__MACOSX') ||
      relativePath.includes('.DS_Store') ||
      relativePath.startsWith('.')
    ) {
      return;
    }
    const name = relativePath.split('/').pop() || relativePath;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const sizeBytes = (zipEntry as unknown as { _data?: { uncompressedSize?: number } })?._data
      ?.uncompressedSize || 0;

    entries.push({
      path: relativePath,
      name,
      extension: ext,
      sizeBytes,
      isSupported: isSupportedDocumentExtension(ext),
    });
  });

  return entries;
}

/**
 * Unpacks selected files from a ZIP archive into real File objects for importing into Knowledge Base.
 */
export async function unpackSelectedZipEntries(
  zipFile: File,
  selectedPaths: string[]
): Promise<File[]> {
  const buffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const extractedFiles: File[] = [];

  for (const p of selectedPaths) {
    const entry = zip.file(p);
    if (!entry) continue;
    const name = p.split('/').pop() || 'file';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const mime = getMimeTypeFromExt(ext);
    const blob = await entry.async('blob');
    const f = new File([blob], name, { type: mime });
    extractedFiles.push(f);
  }

  return extractedFiles;
}

/**
 * Parses CSV content cleanly into structured headers and rows, supporting comma, semicolon and tab delimiters.
 */
export function parseCsvStructured(rawCsv: string): {
  text: string;
  sheet: ExtractedSpreadsheetSheet;
  rowCount: number;
} {
  const normalized = rawCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return {
      text: '',
      sheet: { name: 'CSV', headers: [], rows: [], rowCount: 0, columnCount: 0 },
      rowCount: 0,
    };
  }
  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return {
      text: '',
      sheet: { name: 'CSV', headers: [], rows: [], rowCount: 0, columnCount: 0 },
      rowCount: 0,
    };
  }

  // Detect delimiter: semicolon (standard in Russian Windows Excel), comma or tab
  const firstLine = lines[0];
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter =
    tabCount > semiCount && tabCount > commaCount
      ? '\t'
      : semiCount >= commaCount
        ? ';'
        : ',';

  // Parse CSV line accounting for quoted fields
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const parsedRows = lines.map(parseLine);
  const maxCols = Math.max(...parsedRows.map((r) => r.length), 1);
  const normalizedRows = parsedRows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  const headers = normalizedRows[0] || [];
  const dataRows = normalizedRows.slice(1);

  const sheet: ExtractedSpreadsheetSheet = {
    name: 'CSV Таблица',
    headers,
    rows: dataRows,
    rowCount: lines.length,
    columnCount: maxCols,
  };

  const mdLines: string[] = [
    `### Таблица CSV (${lines.length} строк, ${maxCols} столбцов)`,
    `| ${headers.map((h, i) => (h ? h.replace(/\|/g, '\\|') : `Колонка ${i + 1}`)).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...dataRows.map(
      (row) => `| ${row.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
    ),
  ];

  return {
    text: mdLines.join('\n'),
    sheet,
    rowCount: lines.length,
  };
}

/**
 * Extracts structured sheets, tables, and formatted markdown from an XLSX/XLS buffer using JSZip.
 */
export async function extractXlsxSpreadsheet(buffer: ArrayBuffer): Promise<{
  text: string;
  sheets: ExtractedSpreadsheetSheet[];
  rowCount: number;
  columnCount: number;
  warning?: string;
}> {
  try {
    const zip = await JSZip.loadAsync(buffer);

    // 1. Parse sharedStrings.xml
    const sharedStrings: string[] = [];
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    if (sharedStringsFile) {
      const xml = await sharedStringsFile.async('text');
      const siMatches = xml.match(/<si[\s\S]*?<\/si>/g) || [];
      for (const si of siMatches) {
        const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
        const fullString = tMatches
          .map((m) => m.replace(/<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, ''))
          .join('')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        sharedStrings.push(fullString);
      }
    }

    // 2. Parse workbook.xml to find sheet names and relationship IDs
    const workbookFile = zip.file('xl/workbook.xml');
    const sheetDefs: Array<{ name: string; rId: string; sheetId: string }> = [];
    if (workbookFile) {
      const wbXml = await workbookFile.async('text');
      const sheetTags = wbXml.match(/<sheet\s+[^>]*\/?>/g) || [];
      for (const tag of sheetTags) {
        const nameMatch = tag.match(/name="([^"]+)"/);
        const rIdMatch = tag.match(/r:id="([^"]+)"/);
        const sheetIdMatch = tag.match(/sheetId="([^"]+)"/);
        if (nameMatch) {
          sheetDefs.push({
            name: nameMatch[1],
            rId: rIdMatch ? rIdMatch[1] : '',
            sheetId: sheetIdMatch ? sheetIdMatch[1] : `${sheetDefs.length + 1}`,
          });
        }
      }
    }

    // 3. Parse workbook.xml.rels to resolve target filenames for sheets
    const relsMap: Record<string, string> = {};
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (relsFile) {
      const relsXml = await relsFile.async('text');
      const relTags = relsXml.match(/<Relationship\s+[^>]*\/?>/g) || [];
      for (const rel of relTags) {
        const idMatch = rel.match(/Id="([^"]+)"/);
        const targetMatch = rel.match(/Target="([^"]+)"/);
        if (idMatch && targetMatch) {
          relsMap[idMatch[1]] = targetMatch[1]
            .replace(/^\/?xl\//, '')
            .replace(/^\//, '');
        }
      }
    }

    // 4. Extract data from each worksheet
    const extractedSheets: ExtractedSpreadsheetSheet[] = [];
    let totalRows = 0;
    let maxCols = 0;

    const sheetsToProcess =
      sheetDefs.length > 0
        ? sheetDefs
        : [{ name: 'Лист 1', rId: '', sheetId: '1' }];

    for (let sIdx = 0; sIdx < sheetsToProcess.length; sIdx++) {
      const def = sheetsToProcess[sIdx];
      let sheetPath =
        def.rId && relsMap[def.rId]
          ? `xl/${relsMap[def.rId]}`
          : `xl/worksheets/sheet${sIdx + 1}.xml`;
      let sheetFile = zip.file(sheetPath);
      if (!sheetFile) {
        sheetPath = `xl/worksheets/sheet${sIdx + 1}.xml`;
        sheetFile = zip.file(sheetPath);
      }
      if (!sheetFile) continue;

      const sheetXml = await sheetFile.async('text');
      const rowMatches = sheetXml.match(/<row\s+[^>]*>[\s\S]*?<\/row>/g) || [];
      const parsedRows: string[][] = [];

      for (const rowXml of rowMatches) {
        const cellMatches =
          rowXml.match(/<c\s+[^>]*>[\s\S]*?<\/c>|<c\s+[^>]*\/>/g) || [];
        const rowCells: Record<number, string> = {};
        let maxColInRow = 0;

        for (const cellXml of cellMatches) {
          const rMatch = cellXml.match(/r="([A-Z]+)(\d+)"/);
          if (!rMatch) continue;
          const colLetters = rMatch[1];
          let colIdx = 0;
          for (let c = 0; c < colLetters.length; c++) {
            colIdx = colIdx * 26 + (colLetters.charCodeAt(c) - 64);
          }
          colIdx -= 1; // 0-indexed

          const tMatch = cellXml.match(/t="([^"]+)"/);
          const cellType = tMatch ? tMatch[1] : '';

          let val = '';
          if (cellType === 's') {
            const vMatch = cellXml.match(/<v>(\d+)<\/v>/);
            if (vMatch) {
              const strIdx = parseInt(vMatch[1], 10);
              val = sharedStrings[strIdx] || '';
            }
          } else if (cellType === 'inlineStr') {
            const isMatch = cellXml.match(
              /<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/
            );
            val = isMatch ? isMatch[1] : '';
          } else {
            const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
            val = vMatch ? vMatch[1] : '';
          }

          val = val
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();

          rowCells[colIdx] = val;
          if (colIdx > maxColInRow) maxColInRow = colIdx;
        }

        const rowArr: string[] = [];
        for (let i = 0; i <= maxColInRow; i++) {
          rowArr.push(rowCells[i] || '');
        }
        if (rowArr.some((c) => c.length > 0)) {
          parsedRows.push(rowArr);
        }
      }

      if (parsedRows.length > 0) {
        const sheetMaxCols = Math.max(...parsedRows.map((r) => r.length), 1);
        const normalizedRows = parsedRows.map((r) => {
          const padded = [...r];
          while (padded.length < sheetMaxCols) padded.push('');
          return padded;
        });

        const headers = normalizedRows[0] || [];
        const dataRows = normalizedRows.slice(1);

        extractedSheets.push({
          name: def.name || `Лист ${sIdx + 1}`,
          headers,
          rows: dataRows,
          rowCount: parsedRows.length,
          columnCount: sheetMaxCols,
        });

        totalRows += parsedRows.length;
        if (sheetMaxCols > maxCols) maxCols = sheetMaxCols;
      }
    }

    if (extractedSheets.length === 0) {
      return {
        text: '',
        sheets: [],
        rowCount: 0,
        columnCount: 0,
        warning: 'Таблица Excel пуста или не содержит распознаваемых данных.',
      };
    }

    // Build clean Markdown tables for LLM
    const mdParts: string[] = [];
    for (const sh of extractedSheets) {
      mdParts.push(
        `### Лист: «${sh.name}» (строк: ${sh.rowCount}, столбцов: ${sh.columnCount})`
      );
      if (sh.headers.length > 0) {
        mdParts.push(
          `| ${sh.headers.map((h, i) => (h ? h.replace(/\|/g, '\\|') : `Колонка ${i + 1}`)).join(' | ')} |`
        );
        mdParts.push(`| ${sh.headers.map(() => '---').join(' | ')} |`);
        for (const row of sh.rows) {
          mdParts.push(
            `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`
          );
        }
      }
      mdParts.push('');
    }

    return {
      text: mdParts.join('\n').trim(),
      sheets: extractedSheets,
      rowCount: totalRows,
      columnCount: maxCols,
    };
  } catch (err: unknown) {
    const msg = String(err instanceof Error ? err.message : err || '');
    console.warn('[XLSX Extraction Error]', msg);
    return {
      text: '',
      sheets: [],
      rowCount: 0,
      columnCount: 0,
      warning: `Не удалось разобрать файл Excel: ${msg}. Пожалуйста, убедитесь, что файл не повреждён.`,
    };
  }
}

/**
 * Main entry point to parse any supported document or media file on the client side.
 */
export async function parseDocumentFile(
  file: File,
  onStatusChange?: (status: DocumentProcessingStatus, label: string) => void
): Promise<ParsedDocumentResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const fileType = getFileTypeFromExtension(ext);
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
      fileType,
      warning: `Формат .${ext || 'неизвестен'} не поддерживается. Допустимые форматы: PDF, DOCX, PPTX, PPT, XLSX, XLS, TXT, CSV, MD, PNG, JPG, JPEG, WEBP, ZIP, MP4, MOV, WEBM.`,
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
      fileType,
      warning: 'Выбранный файл пуст (0 байт).',
    };
  }

  notify('processing');

  try {
    // =========================================================================
    // 1. IMAGES (PNG, JPG, JPEG, WEBP, GIF, SVG)
    // =========================================================================
    if (fileType === 'image') {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      let dimensions = '';
      if (typeof window !== 'undefined') {
        try {
          const img = new Image();
          await new Promise<void>((res) => {
            img.onload = () => {
              dimensions = `${img.naturalWidth} × ${img.naturalHeight} px`;
              res();
            };
            img.onerror = () => res();
            img.src = dataUrl;
          });
        } catch {
          // ignore
        }
      }

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: `[Изображение: ${file.name}${dimensions ? ` (${dimensions})` : ''}, формат ${ext.toUpperCase()}]`,
        fileType: 'image',
        mimeType: getMimeTypeFromExt(ext),
        dataUrl,
        thumbnailUrl: dataUrl,
      };
    }

    // =========================================================================
    // 2. VIDEO (MP4, MOV, WEBM)
    // =========================================================================
    if (fileType === 'video') {
      let videoMeta = { durationSec: 0, width: 0, height: 0, thumbnailUrl: '' };
      if (typeof window !== 'undefined') {
        try {
          videoMeta = await captureVideoMetadataAndThumbnail(file);
        } catch {
          // ignore
        }
      }

      let dataUrl: string | undefined;
      // If smaller than 12MB, create base64 dataUrl for offline storage
      if (file.size <= 12 * 1024 * 1024) {
        try {
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        } catch {
          dataUrl = undefined;
        }
      }

      const durationStr =
        videoMeta.durationSec > 0
          ? `${Math.floor(videoMeta.durationSec / 60)} мин ${videoMeta.durationSec % 60} с`
          : 'не определена';
      const resStr =
        videoMeta.width > 0 ? `${videoMeta.width} × ${videoMeta.height}` : '';

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: 'Видео сохранено (локальный просмотр)',
        extractedText: `[Видеозапись: ${file.name}, формат ${ext.toUpperCase()}${resStr ? `, разрешение ${resStr}` : ''}${videoMeta.durationSec > 0 ? `, длительность ${durationStr}` : ''}]`,
        fileType: 'video',
        mimeType: getMimeTypeFromExt(ext),
        dataUrl,
        thumbnailUrl: videoMeta.thumbnailUrl,
        durationSec: videoMeta.durationSec,
        videoWidth: videoMeta.width,
        videoHeight: videoMeta.height,
        warning:
          'Видео сохранено для локального воспроизведения. В облачные ИИ-модели большие видеозаписи не отправляются.',
      };
    }

    // =========================================================================
    // 3. ARCHIVES (ZIP)
    // =========================================================================
    if (fileType === 'archive') {
      const entries = await inspectZipArchive(file);
      const supportedCount = entries.filter((e) => e.isSupported).length;
      const listPreview = entries
        .slice(0, 15)
        .map(
          (e, idx) =>
            `${idx + 1}. ${e.name} (${e.extension.toUpperCase()}, ${(e.sizeBytes / 1024).toFixed(1)} КБ)`
        )
        .join('\n');
      const summary = `[Архив ZIP: «${file.name}», файлов внутри: ${entries.length}, поддерживаемых документов и медиа: ${supportedCount}]\n\nСписок содержимого:\n${listPreview}${entries.length > 15 ? `\n...и ещё ${entries.length - 15} файлов` : ''}`;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: 'Архив прочитан',
        extractedText: summary,
        fileType: 'archive',
        mimeType: 'application/zip',
        archiveEntries: entries,
        pageCount: entries.length,
        warning:
          'Архив успешно открыт без выполнения кода. Вы можете выбрать отдельные файлы для добавления в Базу знаний.',
      };
    }

    const buffer = await file.arrayBuffer();

    // =========================================================================
    // 4. TXT & MD
    // =========================================================================
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
          fileType: 'document',
          mimeType: ext === 'md' ? 'text/markdown' : 'text/plain',
          warning: 'Текстовый файл не содержит печатных символов.',
        };
      }
      const palette = extractHexColorsFromText(decoded);
      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: decoded,
        fileType: 'document',
        mimeType: ext === 'md' ? 'text/markdown' : 'text/plain',
        colorPalette: palette.length > 0 ? palette : undefined,
      };
    }

    // =========================================================================
    // 5. CSV
    // =========================================================================
    if (ext === 'csv') {
      const decoded = decodeTextBufferSmart(buffer);
      const { text, sheet, rowCount } = parseCsvStructured(decoded);
      if (!text || rowCount === 0) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          fileType: 'document',
          mimeType: 'text/csv',
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
        fileType: 'document',
        mimeType: 'text/csv',
        tableSheets: [sheet],
      };
    }

    // =========================================================================
    // 5.1 XLSX & XLS (Structured Spreadsheet parsing with JSZip)
    // =========================================================================
    if (ext === 'xlsx' || ext === 'xls') {
      onStatusChange?.(
        'processing',
        'Анализ листов и ячеек таблицы Excel...'
      );
      const { text, sheets, rowCount, warning } =
        await extractXlsxSpreadsheet(buffer);

      if (!text || sheets.length === 0) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          fileType: 'document',
          mimeType: getMimeTypeFromExt(ext),
          warning:
            warning ||
            'Таблица Excel не содержит строк с данными или формулами.',
        };
      }

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: `Распознано листов: ${sheets.length}`,
        extractedText: text,
        pageCount: rowCount,
        fileType: 'document',
        mimeType: getMimeTypeFromExt(ext),
        tableSheets: sheets,
        warning,
      };
    }

    // =========================================================================
    // 6. PDF (Multimodal: text + rendered page slides)
    // =========================================================================
    if (ext === 'pdf') {
      const { text, pageCount, emptyPagesCount, extractedImages, thumbnailUrl } =
        await extractPdfMultimodal(buffer, 200);
      const palette = extractHexColorsFromText(text);

      const hasContent = text.trim().length > 0 || extractedImages.length > 0;

      if (!hasContent) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          pageCount,
          fileType: 'document',
          mimeType: 'application/pdf',
          warning: `Документ PDF (${pageCount} стр.) не содержит распознаваемого текста или страниц.`,
        };
      }

      const partialWarning =
        extractedImages.length > 0
          ? `Извлечено ${pageCount} стр. и ${extractedImages.length} визуальных материалов для анализа нейросетью.${
              emptyPagesCount > 0
                ? ` (На ${emptyPagesCount} стр. печатный текст отсутствует, переданы страницы-изображения).`
                : ''
            }`
          : emptyPagesCount > 0
            ? `Извлечён текст с ${pageCount - emptyPagesCount} из ${pageCount} стр.`
            : undefined;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        pageCount,
        fileType: 'document',
        mimeType: 'application/pdf',
        thumbnailUrl: thumbnailUrl || extractedImages[0]?.dataUrl,
        warning: partialWarning,
        extractedImages:
          extractedImages.length > 0 ? extractedImages : undefined,
        colorPalette: palette.length > 0 ? palette : undefined,
      };
    }

    // =========================================================================
    // 7. DOCX (Multimodal: text + embedded illustrations / media)
    // =========================================================================
    if (ext === 'docx') {
      const { text, extractedImages } = await extractDocxMultimodal(buffer);
      const palette = extractHexColorsFromText(text);

      const hasContent = text.trim().length > 0 || extractedImages.length > 0;

      if (!hasContent) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          fileType: 'document',
          mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          warning:
            'Документ DOCX успешно открыт, но не содержит текста или изображений.',
        };
      }

      const warning =
        extractedImages.length > 0
          ? `Извлечён текст и ${extractedImages.length} встроенных изображений из документа Word.`
          : undefined;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        fileType: 'document',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        warning,
        extractedImages:
          extractedImages.length > 0 ? extractedImages : undefined,
        colorPalette: palette.length > 0 ? palette : undefined,
      };
    }

    // =========================================================================
    // 8. PPTX (Automatic Conversion to PDF for Vector & Visual Rendering)
    // =========================================================================
    if (ext === 'pptx') {
      onStatusChange?.(
        'processing',
        'Конвертация PPTX в PDF для полного анализа...'
      );

      let pdfExtracted: (Awaited<ReturnType<typeof extractPdfMultimodal>>) | null = null;
      let conversionWarning: string | undefined;

      try {
        const conv = await convertPptxToPdf(buffer);
        if (conv.success && conv.pdfBuffer) {
          pdfExtracted = await extractPdfMultimodal(conv.pdfBuffer, 200);
        } else if (conv.message) {
          conversionWarning = conv.message;
        } else {
          conversionWarning =
            'Не удалось автоматически конвертировать презентацию. Пожалуйста, сохраните её в PDF вручную';
        }
      } catch (convErr) {
        console.warn(
          '[PPTX conversion failed, falling back to direct parse]',
          convErr
        );
        conversionWarning =
          'Не удалось автоматически конвертировать презентацию. Пожалуйста, сохраните её в PDF вручную';
      }

      // Also extract slide text and colors directly from PPTX XML
      const pptxRes = await extractPptxTextAndVisuals(buffer);

      // If PDF rendering succeeded:
      if (pdfExtracted && pdfExtracted.extractedImages.length > 0) {
        const text = (
          pdfExtracted.text.trim().length > 0
            ? pdfExtracted.text
            : pptxRes.text
        ).trim();
        const combinedPalette = [
          ...pptxRes.colorPalette,
          ...extractHexColorsFromText(text),
        ].filter(
          (c, i, arr) => arr.findIndex((x) => x.hex === c.hex) === i
        );

        const pageCount = pdfExtracted.pageCount || pptxRes.slideCount;

        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'processed',
          statusLabel: `Успешно распознано ${pageCount} страниц`,
          extractedText: text,
          pageCount,
          fileType: 'presentation',
          mimeType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          thumbnailUrl:
            pdfExtracted.thumbnailUrl ||
            pdfExtracted.extractedImages[0]?.dataUrl,
          warning: undefined,
          slides: pptxRes.slides,
          extractedImages: pdfExtracted.extractedImages,
          colorPalette: combinedPalette.length > 0 ? combinedPalette : undefined,
        };
      }

      // Fallback if LibreOffice was not available / conversion returned no pages:
      const {
        text,
        slideCount,
        emptySlidesCount,
        slides,
        extractedImages,
        colorPalette,
      } = pptxRes;

      const combinedPalette = [
        ...colorPalette,
        ...extractHexColorsFromText(text),
      ].filter(
        (c, i, arr) => arr.findIndex((x) => x.hex === c.hex) === i
      );

      const hasContent = text.trim().length > 0 || extractedImages.length > 0;

      if (!hasContent) {
        return {
          name: file.name,
          extension: ext,
          sizeBytes: file.size,
          status: 'no_text',
          statusLabel: getStatusLabelRu('no_text'),
          extractedText: '',
          pageCount: slideCount,
          fileType: 'presentation',
          mimeType:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          warning:
            conversionWarning ||
            `Презентация PPTX (${slideCount} сл.) не содержит распознаваемого текста или медиа-файлов.`,
        };
      }

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: `Успешно распознано ${slideCount} страниц`,
        extractedText: text,
        pageCount: slideCount,
        fileType: 'presentation',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        thumbnailUrl: extractedImages[0]?.dataUrl,
        warning:
          conversionWarning ||
          (extractedImages.length > 0
            ? `Извлечено ${extractedImages.length} медиа-изображений из слайдов.`
            : undefined),
        slides,
        extractedImages,
        colorPalette: combinedPalette.length > 0 ? combinedPalette : undefined,
      };
    }

    // =========================================================================
    // 9. PPT (Binary Legacy PowerPoint)
    // =========================================================================
    if (ext === 'ppt') {
      const decoded = decodeTextBufferSmart(buffer);
      const cleanMatches = decoded.match(/[\p{L}\p{N}\s.,!?;:()«»""'-]{5,}/gu);
      const extracted = cleanMatches
        ? cleanMatches
            .map((s) => s.trim())
            .filter((s) => s.length > 4)
            .join('\n')
        : '';

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: extracted.length > 0 ? 'processed' : 'no_text',
        statusLabel:
          extracted.length > 0
            ? getStatusLabelRu('processed')
            : getStatusLabelRu('no_text'),
        extractedText: extracted,
        fileType: 'presentation',
        mimeType: 'application/vnd.ms-powerpoint',
        warning:
          'Формат .ppt является устаревшим бинарным форматом PowerPoint. Текст извлечён частично. Для разделения по слайдам и извлечения картинок рекомендуется пересохранить файл в современный .pptx.',
      };
    }

    return {
      name: file.name,
      extension: ext,
      sizeBytes: file.size,
      status: 'error',
      statusLabel: getStatusLabelRu('error'),
      extractedText: '',
      fileType,
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
      fileType,
      warning: `Ошибка при разборе файла «${file.name}»: ${errMsg}`,
    };
  }
}

/**
 * Universal multimodal extraction function.
 * Extracts both textual content and base64 images from PDF, PPTX, DOCX, and image files.
 * Returns: { text: string, images: string[] }
 */
export async function extractMultimodalContent(
  input: File | Blob | ArrayBuffer | Uint8Array,
  fileNameOrType = ''
): Promise<{ text: string; images: string[] }> {
  let buffer: ArrayBuffer;
  let detectedName = fileNameOrType;

  if (typeof File !== 'undefined' && input instanceof File) {
    detectedName = detectedName || input.name;
    buffer = await input.arrayBuffer();
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    buffer = await input.arrayBuffer();
  } else if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    buffer = copy.buffer;
  } else {
    buffer = input as ArrayBuffer;
  }

  const ext = (detectedName.split('.').pop() || detectedName).toLowerCase();

  // 1. PDF
  if (ext === 'pdf') {
    const res = await extractPdfMultimodal(buffer, 200);
    return {
      text: res.text,
      images: res.images,
    };
  }

  // 2. PPTX
  if (ext === 'pptx') {
    try {
      const conv = await convertPptxToPdf(buffer);
      if (conv.success && conv.pdfBuffer) {
        const res = await extractPdfMultimodal(conv.pdfBuffer, 200);
        return {
          text: res.text,
          images: res.images,
        };
      }
    } catch {
      // fallback to internal parser
    }
    const res = await extractPptxTextAndVisuals(buffer);
    return {
      text: res.text,
      images: res.extractedImages.map((img) => img.dataUrl),
    };
  }

  // 3. DOCX
  if (ext === 'docx') {
    const res = await extractDocxMultimodal(buffer);
    return {
      text: res.text,
      images: res.images,
    };
  }

  // 4. Pure image formats
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
    const mime = getMimeTypeFromExt(ext);
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const b64 =
      typeof btoa !== 'undefined'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    return {
      text: `[Изображение: ${detectedName || 'file'}]`,
      images: [dataUrl],
    };
  }

  // 5. Plain text, markdown, CSV, or unknown
  const text = decodeTextBufferSmart(buffer);
  return {
    text,
    images: [],
  };
}
