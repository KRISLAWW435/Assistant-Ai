import {
  ChatAttachment,
  DocumentProcessingStatus,
  KnowledgeBaseBySchool,
  SchoolId,
  UploadedDocumentRecord,
} from '../types/assistant';
import { KNOWLEDGE_CATEGORIES } from '../config/schoolsAndModes';
import {
  getStatusLabelRu,
  ParsedDocumentResult,
  parseDocumentFile,
} from '../utils/documentParser';

import {
  OPENROUTER_MULTIMODAL_PRIORITY_MODELS,
  OpenRouterMultimodalModelId,
} from './aiProviderManager';

export { OPENROUTER_MULTIMODAL_PRIORITY_MODELS };
export type { OpenRouterMultimodalModelId };

export interface PreparedApiDocumentItem {
  id: string;
  name: string;
  source: 'dialogue_attachment' | 'school_document';
  categoryTitle?: string;
  extractedText: string;
}

export interface PreparedKnowledgeContextItem {
  categoryKey: string;
  categoryTitle: string;
  content: string;
}

export interface PreparedApiImageItem {
  id: string;
  name: string;
  mimeType: string;
  base64Data: string;
  visualRole?: string;
  source?: 'dialogue_attachment' | 'school_document';
}

/**
 * Minimal portable document & context provider interface (Stage 3.1 Section 6 & 7).
 * Handles local document text extraction and selective preparation of confirmed
 * documents and school-isolated Knowledge Base entries for API requests.
 */
export interface IDocumentProvider {
  parseFile(
    file: File,
    onProgress?: (status: DocumentProcessingStatus) => void
  ): Promise<ParsedDocumentResult>;
  getStatusLabel(status: DocumentProcessingStatus): string;
  prepareKnowledgeContextForSchool(
    schoolId: SchoolId,
    knowledgeBase: KnowledgeBaseBySchool,
    enabled: boolean
  ): PreparedKnowledgeContextItem[];
  prepareSelectedDocumentsForApi(params: {
    draftAttachment?: ChatAttachment | null;
    draftAttachments?: ChatAttachment[] | null;
    dialogueAttachments: ChatAttachment[];
    selectedDialogueAttachmentIds: string[];
    schoolDocuments: UploadedDocumentRecord[];
    selectedSchoolDocumentIds: string[];
    activeSchool: SchoolId;
  }): {
    sendableDocuments: PreparedApiDocumentItem[];
    sendableImages: PreparedApiImageItem[];
    skippedNoTextDocuments: string[];
    hasMultimodalImages: boolean;
    suggestedOpenRouterModels: readonly string[];
  };
}

export function sampleRepresentativeImages<T>(items: T[], targetCount: number): T[] {
  if (!items || items.length <= targetCount) return items ? [...items] : [];
  if (targetCount <= 0) return [];
  if (targetCount === 1) return [items[0]];

  const result: T[] = [];
  const total = items.length;
  const pickedIndices = new Set<number>();

  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(
      total - 1,
      Math.max(0, Math.round((i * (total - 1)) / (targetCount - 1)))
    );
    if (!pickedIndices.has(idx)) {
      pickedIndices.add(idx);
      result.push(items[idx]);
    }
  }

  return result;
}

export const documentProvider: IDocumentProvider = {
  parseFile: (file, onProgress) => parseDocumentFile(file, onProgress),
  getStatusLabel: (status) => getStatusLabelRu(status),

  prepareKnowledgeContextForSchool(schoolId, knowledgeBase, enabled) {
    if (!enabled) return [];
    const schoolFields = knowledgeBase[schoolId];
    if (!schoolFields) return [];

    return KNOWLEDGE_CATEGORIES.map((cat) => ({
      categoryKey: cat.key,
      categoryTitle: cat.title,
      content: (schoolFields[cat.key] || '').trim(),
    })).filter((item) => item.content.length > 0);
  },

  prepareSelectedDocumentsForApi({
    draftAttachment,
    draftAttachments,
    dialogueAttachments,
    selectedDialogueAttachmentIds,
    schoolDocuments,
    selectedSchoolDocumentIds,
    activeSchool,
  }) {
    const sendableDocuments: PreparedApiDocumentItem[] = [];
    const sendableImages: PreparedApiImageItem[] = [];
    const skippedNoTextDocuments: string[] = [];
    const seenIds = new Set<string>();

    const extractBase64 = (dataUrl: string): string => {
      return dataUrl.includes(',') ? dataUrl.split(',')[1].trim() : dataUrl.trim();
    };

    // Target maximum multimodal images across all documents in a single request to guarantee swift execution (<25s) without timeouts
    const TARGET_MAX_MULTIMODAL_IMAGES = 16;

    const draftList: ChatAttachment[] = Array.isArray(draftAttachments) && draftAttachments.length > 0
      ? draftAttachments
      : draftAttachment
        ? [draftAttachment]
        : [];

    // Count how many documents have extracted slides/images
    const draftDocsWithExtractedImages = draftList.filter(
      (d) => d && Array.isArray(d.extractedImages) && d.extractedImages.length > 0
    );
    const totalExtractedInDrafts = draftDocsWithExtractedImages.reduce(
      (acc, d) => acc + (d.extractedImages?.length || 0),
      0
    );

    // Calculate balanced quota per document (e.g. 2-3 per doc for 6 files, or up to 15 for 1 file)
    const perDocImageQuota =
      draftDocsWithExtractedImages.length > 0
        ? Math.max(
            2,
            Math.floor(
              TARGET_MAX_MULTIMODAL_IMAGES / draftDocsWithExtractedImages.length
            )
          )
        : TARGET_MAX_MULTIMODAL_IMAGES;

    // 1. Draft attachments explicitly attached to the current outgoing message
    for (const draftAtt of draftList) {
      if (!draftAtt || seenIds.has(draftAtt.id)) continue;
      seenIds.add(draftAtt.id);

      const isImg =
        draftAtt.mimeType?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(
          draftAtt.extension.toLowerCase()
        );

      if (isImg && draftAtt.dataUrl) {
        if (sendableImages.length < TARGET_MAX_MULTIMODAL_IMAGES) {
          sendableImages.push({
            id: draftAtt.id,
            name: draftAtt.name,
            mimeType: draftAtt.mimeType || 'image/png',
            base64Data: extractBase64(draftAtt.dataUrl),
            source: 'dialogue_attachment',
          });
        }
      } else {
        const text = (draftAtt.extractedText || '').trim();
        if (text.length > 0 && draftAtt.status !== 'error') {
          sendableDocuments.push({
            id: draftAtt.id,
            name: draftAtt.name,
            source: 'dialogue_attachment',
            extractedText: text,
          });
        } else if (
          !draftAtt.extractedImages ||
          draftAtt.extractedImages.length === 0
        ) {
          skippedNoTextDocuments.push(draftAtt.name);
        }

        // Multimodal support: sample balanced representative slides from this document
        if (
          draftAtt.extractedImages &&
          draftAtt.extractedImages.length > 0
        ) {
          const imagesToSample =
            totalExtractedInDrafts > TARGET_MAX_MULTIMODAL_IMAGES
              ? sampleRepresentativeImages(
                  draftAtt.extractedImages,
                  perDocImageQuota
                )
              : draftAtt.extractedImages.slice(0, TARGET_MAX_MULTIMODAL_IMAGES);

          for (const extImg of imagesToSample) {
            if (sendableImages.length >= TARGET_MAX_MULTIMODAL_IMAGES) break;
            sendableImages.push({
              id: extImg.id,
              name: `${draftAtt.name} — ${extImg.name}`,
              mimeType: extImg.mimeType || 'image/jpeg',
              base64Data: extractBase64(extImg.dataUrl),
              source: 'dialogue_attachment',
            });
          }
        }
      }
    }

    // 2. Dialogue attachments explicitly checked by Anna for this request
    const selectedDialogueSet = new Set(selectedDialogueAttachmentIds);
    for (const att of dialogueAttachments) {
      if (seenIds.has(att.id) || !selectedDialogueSet.has(att.id)) {
        continue;
      }
      seenIds.add(att.id);

      const isImg =
        att.mimeType?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(
          att.extension.toLowerCase()
        );

      if (isImg && att.dataUrl) {
        if (sendableImages.length < TARGET_MAX_MULTIMODAL_IMAGES) {
          sendableImages.push({
            id: att.id,
            name: att.name,
            mimeType: att.mimeType || 'image/png',
            base64Data: extractBase64(att.dataUrl),
            source: 'dialogue_attachment',
          });
        }
      } else {
        const text = (att.extractedText || '').trim();
        if (text.length > 0 && att.status !== 'error') {
          sendableDocuments.push({
            id: att.id,
            name: att.name,
            source: 'dialogue_attachment',
            extractedText: text,
          });
        } else if (
          !att.extractedImages ||
          att.extractedImages.length === 0
        ) {
          skippedNoTextDocuments.push(att.name);
        }

        // Multimodal support: forward extracted slide/page/media images to API
        if (att.extractedImages && att.extractedImages.length > 0) {
          const sampled = sampleRepresentativeImages(
            att.extractedImages,
            perDocImageQuota
          );
          for (const extImg of sampled) {
            if (sendableImages.length >= TARGET_MAX_MULTIMODAL_IMAGES) break;
            sendableImages.push({
              id: extImg.id,
              name: `${att.name} — ${extImg.name}`,
              mimeType: extImg.mimeType || 'image/jpeg',
              base64Data: extractBase64(extImg.dataUrl),
              source: 'dialogue_attachment',
            });
          }
        }
      }
    }

    // 3. Verified school documents explicitly selected by Anna
    // STRICT SCHOOL ISOLATION: doc must match activeSchool OR be explicitly marked 'all'
    const selectedSchoolDocSet = new Set(selectedSchoolDocumentIds);
    for (const doc of schoolDocuments) {
      const isEligibleSchool =
        doc.schoolId === activeSchool || doc.schoolId === 'all';
      if (
        !isEligibleSchool ||
        seenIds.has(doc.id) ||
        !selectedSchoolDocSet.has(doc.id)
      ) {
        continue;
      }
      seenIds.add(doc.id);

      const isImg =
        doc.fileType === 'image' ||
        doc.mimeType?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(
          doc.extension.toLowerCase()
        );

      if (isImg && doc.dataUrl) {
        if (sendableImages.length < TARGET_MAX_MULTIMODAL_IMAGES) {
          sendableImages.push({
            id: doc.id,
            name: doc.name,
            mimeType: doc.mimeType || 'image/png',
            base64Data: extractBase64(doc.dataUrl),
            visualRole: doc.visualRole,
            source: 'school_document',
          });
        }
      }

      const text = (doc.extractedText || '').trim();
      const catMeta = KNOWLEDGE_CATEGORIES.find(
        (c) => c.key === doc.categoryKey
      );

      // If document has extracted text or brand rules, include it
      if (text.length > 0 && doc.status !== 'error') {
        const rolePrefix = doc.visualRole
          ? `[Визуальный материал: ${doc.visualRole}] `
          : '';
        sendableDocuments.push({
          id: doc.id,
          name: doc.name,
          source: 'school_document',
          categoryTitle: catMeta?.title || doc.categoryKey,
          extractedText: `${rolePrefix}${text}`,
        });
      } else if (
        !isImg &&
        (!doc.extractedImages || doc.extractedImages.length === 0)
      ) {
        skippedNoTextDocuments.push(doc.name);
      }

      // Multimodal support: forward extracted images from verified school documents
      if (doc.extractedImages && doc.extractedImages.length > 0) {
        const sampled = sampleRepresentativeImages(
          doc.extractedImages,
          perDocImageQuota
        );
        for (const extImg of sampled) {
          if (sendableImages.length >= TARGET_MAX_MULTIMODAL_IMAGES) break;
          sendableImages.push({
            id: extImg.id,
            name: `${doc.name} — ${extImg.name}`,
            mimeType: extImg.mimeType || 'image/jpeg',
            base64Data: extractBase64(extImg.dataUrl),
            visualRole: extImg.visualRole || doc.visualRole,
            source: 'school_document',
          });
        }
      }
    }

    const hasMultimodalImages = sendableImages.length > 0;

    return {
      sendableDocuments,
      sendableImages,
      skippedNoTextDocuments,
      hasMultimodalImages,
      suggestedOpenRouterModels: hasMultimodalImages
        ? OPENROUTER_MULTIMODAL_PRIORITY_MODELS
        : OPENROUTER_MULTIMODAL_PRIORITY_MODELS,
    };
  },
};

export type { ParsedDocumentResult };
