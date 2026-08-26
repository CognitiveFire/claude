/**
 * Minimal image metadata reader for PNG and JPEG.
 *
 * Written by hand rather than pulled in as a dependency: the native image
 * libraries fetch prebuilt binaries from hosts this environment blocks, and all
 * we need is what the file's own header already states. Anything it cannot
 * determine is returned as null and surfaces as UNKNOWN — it is never guessed.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ImageMetadata {
  readonly format: string;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly colourSpace: string | null;
  readonly hasAlpha: boolean | null;
  readonly fileSizeBytes: number;
  readonly declaredDpi: number | null;
  readonly sha256: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function readImageMetadata(filePath: string): Promise<ImageMetadata> {
  const buffer = await readFile(filePath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ...readPng(buffer), fileSizeBytes: buffer.length, sha256 };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { ...readJpeg(buffer), fileSizeBytes: buffer.length, sha256 };
  }

  return {
    format: extension || 'unknown',
    widthPx: null,
    heightPx: null,
    colourSpace: null,
    hasAlpha: null,
    declaredDpi: null,
    fileSizeBytes: buffer.length,
    sha256,
  };
}

type PartialMetadata = Omit<ImageMetadata, 'fileSizeBytes' | 'sha256'>;

function readPng(buffer: Buffer): PartialMetadata {
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let hasAlpha: boolean | null = null;
  let colourSpace: string | null = null;
  let declaredDpi: number | null = null;

  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;

    if (type === 'IHDR' && dataStart + 10 <= buffer.length) {
      widthPx = buffer.readUInt32BE(dataStart);
      heightPx = buffer.readUInt32BE(dataStart + 4);
      const colourType = buffer[dataStart + 9];
      // 4 = greyscale+alpha, 6 = truecolour+alpha. 3 (indexed) may carry alpha
      // via a tRNS chunk, handled below.
      hasAlpha = colourType === 4 || colourType === 6;
      if (colourType === 0 || colourType === 4) colourSpace = 'gray';
    } else if (type === 'tRNS') {
      hasAlpha = true;
    } else if (type === 'sRGB') {
      colourSpace = 'srgb';
    } else if (type === 'iCCP') {
      const nameEnd = buffer.indexOf(0, dataStart);
      const profile =
        nameEnd > dataStart && nameEnd < dataStart + length
          ? buffer.subarray(dataStart, nameEnd).toString('latin1').toLowerCase()
          : '';
      // Report what the profile says; do not normalise an unknown profile to sRGB.
      if (profile.includes('srgb')) colourSpace = 'srgb';
      else if (profile.includes('adobe')) colourSpace = 'adobe-rgb';
      else if (profile.includes('cmyk')) colourSpace = 'cmyk';
      else if (profile !== '') colourSpace = profile;
    } else if (type === 'pHYs' && dataStart + 9 <= buffer.length) {
      const pixelsPerUnitX = buffer.readUInt32BE(dataStart);
      const unit = buffer[dataStart + 8];
      // unit 1 = metres. 1 inch = 0.0254 m.
      if (unit === 1 && pixelsPerUnitX > 0) {
        declaredDpi = Math.round(pixelsPerUnitX * 0.0254);
      }
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4;
    if (length > buffer.length) break;
  }

  // A PNG with no sRGB, iCCP or greyscale marker is conventionally sRGB, but
  // "conventionally" is not "declared" — leave it null so the validator warns.
  return { format: 'png', widthPx, heightPx, colourSpace, hasAlpha, declaredDpi };
}

function readJpeg(buffer: Buffer): PartialMetadata {
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let declaredDpi: number | null = null;
  let colourSpace: string | null = null;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    const length = buffer.readUInt16BE(offset + 2);
    const dataStart = offset + 4;

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry frame dimensions.
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && dataStart + 6 <= buffer.length) {
      heightPx = buffer.readUInt16BE(dataStart + 1);
      widthPx = buffer.readUInt16BE(dataStart + 3);
      const components = buffer[dataStart + 5];
      if (components === 1) colourSpace = 'gray';
      else if (components === 3) colourSpace = 'srgb';
      else if (components === 4) colourSpace = 'cmyk';
      break;
    }

    if (marker === 0xe0 && dataStart + 12 <= buffer.length) {
      // APP0/JFIF density.
      const units = buffer[dataStart + 7];
      const densityX = buffer.readUInt16BE(dataStart + 8);
      if (units === 1 && densityX > 0) declaredDpi = densityX;
      if (units === 2 && densityX > 0) declaredDpi = Math.round(densityX * 2.54);
    }

    if (marker === 0xd9 || marker === 0xda) break;
    offset = dataStart + length - 2;
  }

  return { format: 'jpeg', widthPx, heightPx, colourSpace, hasAlpha: false, declaredDpi };
}
