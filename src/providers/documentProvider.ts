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
    draftAttachment: ChatAttachment | null;
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

    const MAX_MULTIMODAL_IMAGES_TOTAL = 3;
    const MAX_MULTIMODAL_IMAGES_PER_DOC = 3;

    // 1. Draft attachment explicitly attached to the current outgoing message
    if (draftAttachment) {
      seenIds.add(draftAttachment.id);
      const isImg =
        draftAttachment.mimeType?.startsWith('image/') ||
        ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(
          draftAttachment.extension.toLowerCase()
        );

      if (isImg && draftAttachment.dataUrl) {
        if (sendableImages.length < MAX_MULTIMODAL_IMAGES_TOTAL) {
          sendableImages.push({
            id: draftAttachment.id,
            name: draftAttachment.name,
            mimeType: draftAttachment.mimeType || 'image/png',
            base64Data: extractBase64(draftAttachment.dataUrl),
            source: 'dialogue_attachment',
          });
        }
      } else {
        const text = (draftAttachment.extractedText || '').trim();
        if (text.length > 0 && draftAttachment.status !== 'error') {
          sendableDocuments.push({
            id: draftAttachment.id,
            name: draftAttachment.name,
            source: 'dialogue_attachment',
            extractedText: text,
          });
        } else if (
          !draftAttachment.extractedImages ||
          draftAttachment.extractedImages.length === 0
        ) {
          skippedNoTextDocuments.push(draftAttachment.name);
        }

        // Multimodal support: forward extracted slide/page/media images to Gemini (capped to MAX_MULTIMODAL_IMAGES_PER_DOC)
        if (
          draftAttachment.extractedImages &&
          draftAttachment.extractedImages.length > 0
        ) {
          let countForDoc = 0;
          for (const extImg of draftAttachment.extractedImages) {
            if (sendableImages.length >= MAX_MULTIMODAL_IMAGES_TOTAL) break;
            if (countForDoc >= MAX_MULTIMODAL_IMAGES_PER_DOC) break;
            sendableImages.push({
              id: extImg.id,
              name: `${draftAttachment.name} — ${extImg.name}`,
              mimeType: extImg.mimeType || 'image/jpeg',
              base64Data: extractBase64(extImg.dataUrl),
              source: 'dialogue_attachment',
            });
            countForDoc++;
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
        if (sendableImages.length < MAX_MULTIMODAL_IMAGES_TOTAL) {
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

        // Multimodal support: forward extracted slide/page/media images to Gemini
        if (att.extractedImages && att.extractedImages.length > 0) {
          let countForDoc = 0;
          for (const extImg of att.extractedImages) {
            if (sendableImages.length >= MAX_MULTIMODAL_IMAGES_TOTAL) break;
            if (countForDoc >= MAX_MULTIMODAL_IMAGES_PER_DOC) break;
            sendableImages.push({
              id: extImg.id,
              name: `${att.name} — ${extImg.name}`,
              mimeType: extImg.mimeType || 'image/jpeg',
              base64Data: extractBase64(extImg.dataUrl),
              source: 'dialogue_attachment',
            });
            countForDoc++;
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
        if (sendableImages.length < MAX_MULTIMODAL_IMAGES_TOTAL) {
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
        let countForDoc = 0;
        for (const extImg of doc.extractedImages) {
          if (sendableImages.length >= MAX_MULTIMODAL_IMAGES_TOTAL) break;
          if (countForDoc >= MAX_MULTIMODAL_IMAGES_PER_DOC) break;
          sendableImages.push({
            id: extImg.id,
            name: `${doc.name} — ${extImg.name}`,
            mimeType: extImg.mimeType || 'image/jpeg',
            base64Data: extractBase64(extImg.dataUrl),
            visualRole: extImg.visualRole || doc.visualRole,
            source: 'school_document',
          });
          countForDoc++;
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
