/**
 * Helper utility for local disk file management in Electron (NotebookLM architecture)
 * Stores files persistently in Documents/BusinessAssistant/ without 15MB base64 memory limits.
 */

export interface DiskSaveResult {
  success: boolean;
  absolutePath?: string;
  folderPath?: string;
  sizeBytes?: number;
}

export async function saveFileToLocalDisk(
  file: File,
  school?: string,
  category?: string
): Promise<DiskSaveResult | null> {
  const filesApi = window.electronAPI?.files;
  if (!filesApi) {
    return null; // Not running in Electron environment
  }

  try {
    const buffer = await file.arrayBuffer();
    const result = await filesApi.saveToDisk({
      fileName: file.name,
      buffer,
      school,
      category,
    });
    return {
      success: result.success,
      absolutePath: result.absolutePath,
      folderPath: result.folderPath,
      sizeBytes: result.sizeBytes,
    };
  } catch (err) {
    console.error('[diskFileManager] Failed to save file to local disk:', err);
    return null;
  }
}

export async function openLocalFolder(params?: {
  school?: string;
  category?: string;
  folderPath?: string;
}): Promise<boolean> {
  const filesApi = window.electronAPI?.files;
  if (!filesApi) {
    return false;
  }
  try {
    const res = await filesApi.openFolder(params);
    return res.success;
  } catch (err) {
    console.error('[diskFileManager] Failed to open folder:', err);
    return false;
  }
}

export async function downloadOrExportFile(fileInfo: {
  filePath?: string;
  name: string;
  dataUrl?: string;
  extractedText?: string;
}): Promise<void> {
  const filesApi = window.electronAPI?.files;

  // 1. If in Electron and we have a path on disk, export via Save Dialog
  if (filesApi && fileInfo.filePath) {
    try {
      const res = await filesApi.saveCopy(fileInfo.filePath, fileInfo.name);
      if (res.success) return;
    } catch {
      // Fall through to browser fallback if saveCopy was canceled or errored
    }
  }

  // 2. Standard browser download fallback using dataUrl or Blob
  if (fileInfo.dataUrl) {
    const a = document.createElement('a');
    a.href = fileInfo.dataUrl;
    a.download = fileInfo.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else if (fileInfo.extractedText) {
    const blob = new Blob([fileInfo.extractedText], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileInfo.name.includes('.') ? fileInfo.name : `${fileInfo.name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
