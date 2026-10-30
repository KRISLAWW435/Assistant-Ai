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
    skippedNoTextDocuments: string[];
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
    const skippedNoTextDocuments: string[] = [];
    const seenIds = new Set<string>();

    // 1. Draft attachment explicitly attached to the current outgoing message
    if (draftAttachment) {
      seenIds.add(draftAttachment.id);
      const text = (draftAttachment.extractedText || '').trim();
      if (text.length > 0 && draftAttachment.status !== 'error') {
        sendableDocuments.push({
          id: draftAttachment.id,
          name: draftAttachment.name,
          source: 'dialogue_attachment',
          extractedText: text,
        });
      } else {
        skippedNoTextDocuments.push(draftAttachment.name);
      }
    }

    // 2. Dialogue attachments explicitly checked by Anna for this request
    const selectedDialogueSet = new Set(selectedDialogueAttachmentIds);
    for (const att of dialogueAttachments) {
      if (seenIds.has(att.id) || !selectedDialogueSet.has(att.id)) {
        continue;
      }
      seenIds.add(att.id);
      const text = (att.extractedText || '').trim();
      if (text.length > 0 && att.status !== 'error') {
        sendableDocuments.push({
          id: att.id,
          name: att.name,
          source: 'dialogue_attachment',
          extractedText: text,
        });
      } else {
        skippedNoTextDocuments.push(att.name);
      }
    }

    // 3. Verified school documents explicitly selected by Anna (strictly isolated by activeSchool)
    const selectedSchoolDocSet = new Set(selectedSchoolDocumentIds);
    for (const doc of schoolDocuments) {
      if (
        doc.schoolId !== activeSchool ||
        seenIds.has(doc.id) ||
        !selectedSchoolDocSet.has(doc.id)
      ) {
        continue;
      }
      seenIds.add(doc.id);
      const text = (doc.extractedText || '').trim();
      const catMeta = KNOWLEDGE_CATEGORIES.find(
        (c) => c.key === doc.categoryKey
      );
      if (text.length > 0 && doc.status !== 'error') {
        sendableDocuments.push({
          id: doc.id,
          name: doc.name,
          source: 'school_document',
          categoryTitle: catMeta?.title || doc.categoryKey,
          extractedText: text,
        });
      } else {
        skippedNoTextDocuments.push(doc.name);
      }
    }

    return {
      sendableDocuments,
      skippedNoTextDocuments,
    };
  },
};

export type { ParsedDocumentResult };
