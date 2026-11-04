import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import {
  DocumentProcessingStatus,
  ExtractedDocumentImage,
  ExtractedSlideItem,
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
  durationSec?: number;
  videoWidth?: number;
  videoHeight?: number;
  archiveEntries?: ZipArchiveEntry[];
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } catch (err) {
    console.warn('[PDF Page Render Error]', err);
    return '';
  }
}

/**
 * Extracts text and renders pages/slides into compressed base64 images from a PDF file using pdfjs-dist.
 */
export async function extractPdfMultimodal(
  buffer: ArrayBuffer,
  maxPagesToRender = 50
): Promise<{
  text: string;
  pageCount: number;
  emptyPagesCount: number;
  images: string[];
  extractedImages: ExtractedDocumentImage[];
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

  const pagesToRender = Math.min(pageCount, maxPagesToRender);

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

    // 2. Render page to compressed image if within limit
    if (i <= pagesToRender && typeof document !== 'undefined') {
      try {
        const pageDataUrl = await renderPdfPageToDataUrl(page, 512);
        if (pageDataUrl) {
          images.push(pageDataUrl);
          extractedImages.push({
            id: `pdf-page-${i}`,
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
          id: `docx-img-${imgIdx++}`,
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

  // 1. Extract embedded media images from ppt/media/*
  const mediaImages = new Map<string, { base64: string; mimeType: string }>();
  const mediaPaths: string[] = [];
  zip.forEach((path) => {
    if (path.toLowerCase().startsWith('ppt/media/')) {
      mediaPaths.push(path);
    }
  });

  for (const mediaPath of mediaPaths.slice(0, 35)) {
    const mediaFile = zip.file(mediaPath);
    if (!mediaFile) continue;
    const fileName = mediaPath.split('/').pop() || 'image.png';
    const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) {
      try {
        const base64 = await mediaFile.async('base64');
        const mimeType = getMimeTypeFromExt(ext);
        mediaImages.set(fileName, { base64, mimeType });
      } catch {
        // ignore
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

    // Collect text from <a:t> nodes
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
    const relsPath = `ppt/slides/_rels/slide${entry.num}.xml.rels`;
    const relsFile = zip.file(relsPath);
    const slideImageUrls: string[] = [];

    if (relsFile) {
      try {
        const relsXml = await relsFile.async('string');
        const relsDoc = parser.parseFromString(relsXml, 'application/xml');
        const relNodes = Array.from(relsDoc.getElementsByTagName('Relationship'));
        for (const rel of relNodes) {
          const target = rel.getAttribute('Target') || '';
          const targetFileName = target.split('/').pop() || '';
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
  let imgCounter = 1;
  for (const [imgName, item] of mediaImages.entries()) {
    extractedImages.push({
      id: `img-pptx-${imgCounter++}`,
      name: imgName,
      dataUrl: `data:${item.mimeType};base64,${item.base64}`,
      mimeType: item.mimeType,
    });
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
      warning: `Формат .${ext || 'неизвестен'} не поддерживается. Допустимые форматы: PDF, DOCX, PPTX, PPT, TXT, CSV, MD, PNG, JPG, JPEG, WEBP, ZIP, MP4, MOV, WEBM.`,
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
      const { text, rowCount } = formatCsvText(decoded);
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
      };
    }

    // =========================================================================
    // 6. PDF (Multimodal: text + rendered page slides)
    // =========================================================================
    if (ext === 'pdf') {
      const { text, pageCount, emptyPagesCount, extractedImages } =
        await extractPdfMultimodal(buffer, 10);
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
    // 8. PPTX
    // =========================================================================
    if (ext === 'pptx') {
      const {
        text,
        slideCount,
        emptySlidesCount,
        slides,
        extractedImages,
        colorPalette,
      } = await extractPptxTextAndVisuals(buffer);

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
          warning: `Презентация PPTX (${slideCount} сл.) не содержит распознаваемого текста или медиа-файлов.`,
        };
      }

      const partialWarning =
        emptySlidesCount > 0
          ? `Извлечён текст с ${slideCount - emptySlidesCount} из ${slideCount} слайдов. Сохранено ${extractedImages.length} встроенных изображений.`
          : `Извлечено ${slideCount} слайдов и ${extractedImages.length} встроенных изображений.`;

      return {
        name: file.name,
        extension: ext,
        sizeBytes: file.size,
        status: 'processed',
        statusLabel: getStatusLabelRu('processed'),
        extractedText: text,
        pageCount: slideCount,
        fileType: 'presentation',
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        warning: partialWarning,
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
    const res = await extractPdfMultimodal(buffer, 10);
    return {
      text: res.text,
      images: res.images,
    };
  }

  // 2. PPTX
  if (ext === 'pptx') {
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
