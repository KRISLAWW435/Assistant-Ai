import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  return table;
}

const crcTable = createCrc32Table();

function calculateCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writePngChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crcTarget = chunk.subarray(4, 8 + len);
  const crc = calculateCrc32(crcTarget);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

export function generateAppIconPng(width = 256, height = 256): Buffer {
  // Raw scanlines: width * 4 bytes per row + 1 filter byte per row
  const rowStride = width * 4 + 1;
  const rawData = Buffer.alloc(rowStride * height);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.44;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawData[rowOffset] = 0; // Filter byte 0 (None)

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded squircle background
      const cornerRadius = 48;
      const sqX = Math.max(0, Math.abs(dx) - (width / 2 - cornerRadius - 12));
      const sqY = Math.max(0, Math.abs(dy) - (height / 2 - cornerRadius - 12));
      const sqDist = Math.sqrt(sqX * sqX + sqY * sqY);

      if (sqDist > cornerRadius) {
        // Outside squircle: transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Background gradient: Deep slate navy (#0F172A to #1E293B)
      const gradRatio = (y / height);
      let r = Math.round(15 + gradRatio * 15);
      let g = Math.round(23 + gradRatio * 20);
      let b = Math.round(42 + gradRatio * 25);
      let a = 255;

      // Outer border glow
      if (sqDist > cornerRadius - 3) {
        // Subtle cyan/gold border
        r = 0;
        g = 168;
        b = 181;
      }

      // Draw stylized Pixel companion face & cyber grid
      // Cyan ear left
      if (x >= 64 && x <= 96 && y >= 52 && y <= 84 && (96 - x) + (y - 52) >= 32) {
        r = 0; g = 168; b = 181;
      }
      // Lime/Yellow ear right
      if (x >= 160 && x <= 192 && y >= 52 && y <= 84 && (x - 160) + (y - 52) >= 32) {
        r = 255; g = 215; b = 0;
      }

      // Robot Head Box: x from 72 to 184, y from 80 to 180
      if (x >= 72 && x <= 184 && y >= 80 && y <= 180) {
        // Head inner fill (#162238)
        r = 22; g = 34; b = 56;
        // Head frame border
        if (x <= 76 || x >= 180 || y <= 84 || y >= 176) {
          r = 0; g = 168; b = 181; // KIBER cyan
        }

        // Left Eye (Cyan Glow: x from 92 to 112, y from 112 to 132)
        if (x >= 94 && x <= 114 && y >= 114 && y <= 134) {
          r = 0; g = 225; b = 245;
        }

        // Right Eye (Gold Glow: x from 142 to 162, y from 112 to 132)
        if (x >= 142 && x <= 162 && y >= 114 && y <= 134) {
          r = 255; g = 215; b = 0;
        }

        // Friendly smile / mouth bar
        if (x >= 112 && x <= 144 && y >= 152 && y <= 158) {
          r = 132; g = 204; b = 22; // Renderia lime
        }
      }

      // Bottom school initials "K · R"
      if (y >= 196 && y <= 216 && x >= 88 && x <= 168) {
        // Subtle accent bar
        if (y >= 204 && y <= 208) {
          r = 0; g = 168; b = 181;
        }
      }

      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  const ihdrChunk = writePngChunk('IHDR', ihdrData);

  const compressedData = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = writePngChunk('IDAT', compressedData);
  const iendChunk = writePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

export function generateAppIconIco(pngBuffer: Buffer): Buffer {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved: 0
  icoHeader.writeUInt16LE(1, 2); // Type: 1 (ICO)
  icoHeader.writeUInt16LE(1, 4); // Number of images: 1

  const dirEntry = Buffer.alloc(16);
  dirEntry[0] = 0; // Width: 256 (0 means 256)
  dirEntry[1] = 0; // Height: 256 (0 means 256)
  dirEntry[2] = 0; // Color count: >= 256
  dirEntry[3] = 0; // Reserved: 0
  dirEntry.writeUInt16LE(1, 4); // Color planes: 1
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel: 32
  dirEntry.writeUInt32LE(pngBuffer.length, 8); // Image size in bytes
  dirEntry.writeUInt32LE(22, 12); // Image offset (6 + 16 = 22)

  return Buffer.concat([icoHeader, dirEntry, pngBuffer]);
}

export function writeDefaultIcons(targetDir: string, force = false): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const icoPath = path.join(targetDir, 'icon.ico');
  const pngPath = path.join(targetDir, 'icon.png');

  // If valid icon.ico or icon.png already exists, preserve it!
  const icoExists = fs.existsSync(icoPath) && fs.statSync(icoPath).size > 0;
  const pngExists = fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0;

  if (!force && icoExists && pngExists) {
    console.log(`[IconGen] Preserving existing custom icons in ${targetDir}`);
    return;
  }

  // Check alternative folder (build vs public) before generating from scratch
  const rootDir = process.cwd();
  const buildIco = path.join(rootDir, 'build', 'icon.ico');
  const buildPng = path.join(rootDir, 'build', 'icon.png');
  const publicIco = path.join(rootDir, 'public', 'icon.ico');
  const publicPng = path.join(rootDir, 'public', 'icon.png');

  if (!icoExists) {
    if (fs.existsSync(buildIco) && fs.statSync(buildIco).size > 0) {
      fs.copyFileSync(buildIco, icoPath);
      console.log(`[IconGen] Copied existing icon.ico from build/ to ${targetDir}`);
    } else if (fs.existsSync(publicIco) && fs.statSync(publicIco).size > 0) {
      fs.copyFileSync(publicIco, icoPath);
      console.log(`[IconGen] Copied existing icon.ico from public/ to ${targetDir}`);
    }
  }

  if (!pngExists) {
    if (fs.existsSync(buildPng) && fs.statSync(buildPng).size > 0) {
      fs.copyFileSync(buildPng, pngPath);
      console.log(`[IconGen] Copied existing icon.png from build/ to ${targetDir}`);
    } else if (fs.existsSync(publicPng) && fs.statSync(publicPng).size > 0) {
      fs.copyFileSync(publicPng, pngPath);
      console.log(`[IconGen] Copied existing icon.png from public/ to ${targetDir}`);
    }
  }

  // Only generate synthetic icons if still missing
  const stillNeedsIco = !fs.existsSync(icoPath) || fs.statSync(icoPath).size === 0;
  const stillNeedsPng = !fs.existsSync(pngPath) || fs.statSync(pngPath).size === 0;

  if (force || stillNeedsIco || stillNeedsPng) {
    const png = generateAppIconPng(256, 256);
    const ico = generateAppIconIco(png);

    if (force || stillNeedsPng) {
      fs.writeFileSync(pngPath, png);
    }
    if (force || stillNeedsIco) {
      fs.writeFileSync(icoPath, ico);
    }
    console.log(`[IconGen] Generated fallback icons in ${targetDir}`);
  }
}

// Run only when directly invoked from CLI
const isDirectRun =
  typeof process !== 'undefined' &&
  Boolean(process.argv[1]?.includes('generate-icon'));

if (isDirectRun) {
  writeDefaultIcons(path.resolve(process.cwd(), 'build'));
  writeDefaultIcons(path.resolve(process.cwd(), 'public'));
}
