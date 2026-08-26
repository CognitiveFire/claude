import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRINT_FILE_POLICY,
  effectiveDpi,
  validatePrintFile,
  type ArtworkMetadata,
} from '../src/core/printfile.ts';
import type { PrintAreaSpec } from '../src/ports/producer.ts';

const frontArea: PrintAreaSpec = {
  placement: 'front',
  widthPx: 3600,
  heightPx: 4800,
  dpi: 300,
  widthMm: 305,
  heightMm: 406,
};

const goodArtwork: ArtworkMetadata = {
  widthPx: 3600,
  heightPx: 4800,
  format: 'png',
  colourSpace: 'srgb',
  hasAlpha: true,
  fileSizeBytes: 12_000_000,
  declaredDpi: 300,
};

describe('effectiveDpi', () => {
  it('computes pixels per printed inch', () => {
    // 3600px print area at 300 DPI is 12 printed inches.
    expect(effectiveDpi(3600, 3600, 300)).toBe(300);
    expect(effectiveDpi(1800, 3600, 300)).toBe(150);
  });

  it('returns null rather than guessing when the supplier publishes no DPI', () => {
    expect(effectiveDpi(3600, 3600, null)).toBeNull();
  });
});

describe('validatePrintFile', () => {
  it('accepts artwork that fills the print area at full resolution', () => {
    const result = validatePrintFile(goodArtwork, frontArea);
    expect(result.acceptable).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.effectiveDpi).toBe(300);
  });

  it('refuses low-resolution artwork instead of warning about it', () => {
    const result = validatePrintFile(
      { ...goodArtwork, widthPx: 900, heightPx: 1200 },
      frontArea,
    );
    expect(result.acceptable).toBe(false);
    expect(result.errors.join(' ')).toMatch(/upscaling/);
  });

  it('refuses a resolution just below the DPI floor', () => {
    // 0.45 scale => 135 DPI, below the 150 floor, but coverage is also short.
    const result = validatePrintFile(
      { ...goodArtwork, widthPx: 1620, heightPx: 2160 },
      frontArea,
    );
    expect(result.acceptable).toBe(false);
  });

  it('warns but accepts between the DPI floor and the preferred DPI', () => {
    // 85% of the print area's pixels: coverage passes (>= 0.8) and effective
    // DPI is 255 — above the 150 floor, below the 300 preference.
    const result = validatePrintFile(
      { ...goodArtwork, widthPx: 3060, heightPx: 4080 },
      frontArea,
      DEFAULT_PRINT_FILE_POLICY,
    );
    expect(result.acceptable).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.effectiveDpi).toBeCloseTo(255, 0);
    expect(result.warnings.join(' ')).toMatch(/below the preferred/);
  });

  it('refuses a CMYK file', () => {
    const result = validatePrintFile({ ...goodArtwork, colourSpace: 'cmyk' }, frontArea);
    expect(result.acceptable).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Convert to sRGB/);
  });

  it('refuses an unprintable format', () => {
    const result = validatePrintFile({ ...goodArtwork, format: 'jpeg' }, frontArea);
    expect(result.acceptable).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not printable/);
  });

  it('marks DPI as UNKNOWN and demands a physical sample when the supplier omits it', () => {
    const result = validatePrintFile(goodArtwork, { ...frontArea, dpi: null });
    expect(result.effectiveDpi).toBeNull();
    expect(result.acceptable).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/UNKNOWN/);
    expect(result.warnings.join(' ')).toMatch(/physical sample/);
  });

  it('warns about a missing alpha channel and an aspect-ratio mismatch', () => {
    const result = validatePrintFile(
      { ...goodArtwork, hasAlpha: false, widthPx: 4800, heightPx: 4800 },
      frontArea,
    );
    expect(result.warnings.join(' ')).toMatch(/alpha channel/);
    expect(result.warnings.join(' ')).toMatch(/Aspect ratio/);
  });

  it('refuses an oversized file', () => {
    const result = validatePrintFile(
      { ...goodArtwork, fileSizeBytes: 300 * 1024 * 1024 },
      frontArea,
    );
    expect(result.acceptable).toBe(false);
    expect(result.errors.join(' ')).toMatch(/above the/);
  });
});
