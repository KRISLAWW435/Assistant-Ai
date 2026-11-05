import { Ream } from 'reamkit';

/**
 * Converts a PPTX Buffer into a PDF Buffer using reamkit (in-memory TypeScript parser/converter).
 * Does NOT require LibreOffice, soffice, or any external software installed on the machine.
 */
export async function convertPptxToPdfBuffer(pptxBuffer: Buffer): Promise<{
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
  message?: string;
}> {
  try {
    const uint8 = new Uint8Array(pptxBuffer);
    const doc = Ream.parse(uint8);
    const pdfUint8 = await doc.convert('pdf');
    const pdfBuf = Buffer.from(
      pdfUint8.buffer,
      pdfUint8.byteOffset,
      pdfUint8.byteLength
    );
    return {
      success: true,
      pdfBuffer: pdfBuf,
    };
  } catch (err: unknown) {
    const msg = String(err instanceof Error ? err.message : err || '');
    console.warn('[Reamkit PPTX-to-PDF Conversion Error]', msg);
    return {
      success: false,
      error: 'CONVERSION_FAILED',
      message: 'Не удалось автоматически конвертировать презентацию. Пожалуйста, сохраните её в PDF вручную',
    };
  }
}
