/**
 * Print-file validation.
 *
 * Local and deterministic: given the supplier's print-area specification and
 * the artwork's real metadata, decide whether this file can be printed. It
 * REFUSES rather than warns on anything that would visibly degrade the garment
 * — a soft warning gets clicked through, and the customer receives a blurry
 * shirt.
 *
 * Suppliers generally do not offer a "validate this file" endpoint, so this is
 * where that check lives, not in an adapter.
 */

import type { PrintAreaSpec, PrintFileValidationResult } from '../ports/producer.ts';

export interface ArtworkMetadata {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly format: string;
  /** e.g. "srgb", "cmyk", "gray". Null when it could not be determined. */
  readonly colourSpace: string | null;
  readonly hasAlpha: boolean | null;
  readonly fileSizeBytes: number | null;
  /** DPI recorded in the file's own metadata, if any. */
  readonly declaredDpi: number | null;
}

export interface PrintFilePolicy {
  /** Below this effective DPI the print is rejected outright. */
  readonly minimumDpi: number;
  /** Between minimumDpi and preferredDpi the file is accepted with a warning. */
  readonly preferredDpi: number;
  readonly allowedFormats: readonly string[];
  /** Reject colour spaces the supplier cannot honour predictably. */
  readonly allowedColourSpaces: readonly string[];
  readonly maxFileSizeBytes: number;
  /** Fraction of the print area the artwork must cover in each dimension. */
  readonly minimumCoverage: number;
}

export const DEFAULT_PRINT_FILE_POLICY: PrintFilePolicy = {
  minimumDpi: 150,
  preferredDpi: 300,
  allowedFormats: ['png', 'tiff'],
  allowedColourSpaces: ['srgb', 'rgb', 'adobe-rgb'],
  maxFileSizeBytes: 200 * 1024 * 1024,
  minimumCoverage: 0.8,
};

/**
 * Effective DPI: how many of the artwork's real pixels land in each printed
 * inch when the artwork is scaled to fill the print area.
 */
export function effectiveDpi(
  artworkPx: number,
  printAreaPx: number,
  printAreaDpi: number | null,
): number | null {
  if (printAreaDpi === null || printAreaPx <= 0 || artworkPx <= 0) return null;
  const printedInches = printAreaPx / printAreaDpi;
  if (printedInches <= 0) return null;
  return artworkPx / printedInches;
}

export function validatePrintFile(
  artwork: ArtworkMetadata,
  printArea: PrintAreaSpec,
  policy: PrintFilePolicy = DEFAULT_PRINT_FILE_POLICY,
): PrintFileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const format = artwork.format.toLowerCase().replace(/^\./, '');
  if (!policy.allowedFormats.includes(format)) {
    errors.push(
      `Format "${format}" is not printable. Supply one of: ${policy.allowedFormats.join(', ')}.`,
    );
  }

  if (artwork.colourSpace === null) {
    warnings.push(
      'Colour space could not be determined. Confirm the file is RGB before ordering ' +
        'a sample — an unexpected CMYK conversion shifts colour visibly.',
    );
  } else if (!policy.allowedColourSpaces.includes(artwork.colourSpace.toLowerCase())) {
    errors.push(
      `Colour space "${artwork.colourSpace}" is not accepted. Convert to sRGB: ` +
        'the supplier will otherwise convert it with an unpredictable result.',
    );
  }

  if (artwork.fileSizeBytes !== null && artwork.fileSizeBytes > policy.maxFileSizeBytes) {
    errors.push(
      `File is ${(artwork.fileSizeBytes / 1024 / 1024).toFixed(1)} MB, above the ` +
        `${(policy.maxFileSizeBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }

  // Coverage: the artwork must be large enough to fill the print area without
  // being upscaled beyond the DPI floor.
  const widthRatio = artwork.widthPx / printArea.widthPx;
  const heightRatio = artwork.heightPx / printArea.heightPx;
  if (widthRatio < policy.minimumCoverage || heightRatio < policy.minimumCoverage) {
    errors.push(
      `Artwork is ${artwork.widthPx}x${artwork.heightPx}px against a ` +
        `${printArea.widthPx}x${printArea.heightPx}px print area for "${printArea.placement}". ` +
        `It would need upscaling to fill the placement.`,
    );
  }

  const dpiWidth = effectiveDpi(artwork.widthPx, printArea.widthPx, printArea.dpi);
  const dpiHeight = effectiveDpi(artwork.heightPx, printArea.heightPx, printArea.dpi);
  const dpi =
    dpiWidth === null || dpiHeight === null ? null : Math.min(dpiWidth, dpiHeight);

  if (dpi === null) {
    warnings.push(
      `Effective DPI is UNKNOWN because the supplier did not publish a print ` +
        `resolution for "${printArea.placement}". Print quality cannot be verified ` +
        'from data alone — order a physical sample before going live.',
    );
  } else if (dpi < policy.minimumDpi) {
    errors.push(
      `Effective print resolution is ${dpi.toFixed(0)} DPI, below the ` +
        `${policy.minimumDpi} DPI floor. This would print visibly soft.`,
    );
  } else if (dpi < policy.preferredDpi) {
    warnings.push(
      `Effective print resolution is ${dpi.toFixed(0)} DPI, below the preferred ` +
        `${policy.preferredDpi} DPI. Acceptable, but a higher-resolution scan would print better.`,
    );
  }

  if (artwork.hasAlpha === false) {
    warnings.push(
      'No alpha channel: the artwork will print with a filled rectangular ' +
        'background. Supply a transparent PNG unless that is intended.',
    );
  }

  const aspectArtwork = artwork.widthPx / artwork.heightPx;
  const aspectArea = printArea.widthPx / printArea.heightPx;
  const aspectDrift = Math.abs(aspectArtwork - aspectArea) / aspectArea;
  if (aspectDrift > 0.05) {
    warnings.push(
      `Aspect ratio differs from the print area by ${(aspectDrift * 100).toFixed(0)}%. ` +
        'The artwork will be letterboxed or cropped — confirm the intended placement.',
    );
  }

  return {
    acceptable: errors.length === 0,
    effectiveDpi: dpi,
    errors,
    warnings,
    printArea,
  };
}
