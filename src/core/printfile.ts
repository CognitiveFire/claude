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
  /** Dimensions of the delivered file. */
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * True source resolution, when the delivered file has been upscaled or
   * placed on a larger canvas.
   *
   * Without this, a padded or upscaled file defeats the DPI check: the file
   * measures 3600px against a 3600px print area and reports 300 DPI, while its
   * content carries the detail of a 1080px original. Upscaling adds pixels, not
   * information. When present, effective DPI is computed from these.
   */
  readonly nativeWidthPx?: number | null;
  readonly nativeHeightPx?: number | null;
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

  // Effective DPI is computed from the NATIVE pixels when they are known, so an
  // upscaled or padded file cannot report a resolution it does not have.
  const nativeWidth = artwork.nativeWidthPx ?? artwork.widthPx;
  const nativeHeight = artwork.nativeHeightPx ?? artwork.heightPx;
  const upscaleFactor = nativeWidth > 0 ? artwork.widthPx / nativeWidth : 1;
  if (upscaleFactor > 1.01) {
    warnings.push(
      `Delivered file is a ${upscaleFactor.toFixed(2)}x upscale of a ` +
        `${nativeWidth}x${nativeHeight}px original. Resolution checks below use the ` +
        'original pixels: upscaling adds pixels, not detail.',
    );
  }


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
  const widthRatio = nativeWidth / printArea.widthPx;
  const heightRatio = nativeHeight / printArea.heightPx;
  if (widthRatio < policy.minimumCoverage || heightRatio < policy.minimumCoverage) {
    errors.push(
      `Artwork is ${nativeWidth}x${nativeHeight}px against a ` +
        `${printArea.widthPx}x${printArea.heightPx}px print area for "${printArea.placement}". ` +
        `It would need upscaling to fill the placement.`,
    );
  }

  const dpiWidth = effectiveDpi(nativeWidth, printArea.widthPx, printArea.dpi);
  const dpiHeight = effectiveDpi(nativeHeight, printArea.heightPx, printArea.dpi);
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

  const aspectArtwork = nativeWidth / nativeHeight;
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

// ---------------------------------------------------------------------------
// Placement-based validation
// ---------------------------------------------------------------------------

export interface PrintPlacement {
  readonly placement: string;
  /** Intended printed width in millimetres. */
  readonly widthMm: number;
  /** Intended printed height in millimetres. */
  readonly heightMm: number;
}

/**
 * Effective DPI for a chosen printed size, independent of any canvas.
 *
 * This is the honest question for artwork that will not fill the whole print
 * area: not "does the file match the placement's pixel dimensions" but "how
 * many real pixels land in each printed inch at the size we intend to print".
 */
export function effectiveDpiForPrintSize(nativePx: number, printMm: number): number | null {
  if (nativePx <= 0 || printMm <= 0) return null;
  return nativePx / (printMm / 25.4);
}

/** The largest printed width, in mm, that a given pixel count supports. */
export function maxPrintWidthMm(nativePx: number, atDpi: number): number {
  if (nativePx <= 0 || atDpi <= 0) return 0;
  return (nativePx / atDpi) * 25.4;
}

export interface PlacedPrintResult {
  readonly acceptable: boolean;
  readonly effectiveDpi: number | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Printed size that would meet the DPI floor, for the operator's reference. */
  readonly maxWidthMmAtFloor: number;
  readonly maxWidthMmAtPreferred: number;
}

/**
 * Validate artwork against an intended printed size.
 *
 * Use this when the artwork is printed at a chosen size within a larger print
 * area — which is the normal case for a chest print. `validatePrintFile` asks
 * whether the file fills the supplier's whole placement; this asks whether the
 * artwork holds up at the size actually being printed.
 */
export function validatePlacedPrint(
  artwork: ArtworkMetadata,
  placement: PrintPlacement,
  policy: PrintFilePolicy = DEFAULT_PRINT_FILE_POLICY,
): PlacedPrintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nativeWidth = artwork.nativeWidthPx ?? artwork.widthPx;
  const nativeHeight = artwork.nativeHeightPx ?? artwork.heightPx;

  const format = artwork.format.toLowerCase().replace(/^\./, '');
  if (!policy.allowedFormats.includes(format)) {
    errors.push(
      `Format "${format}" is not printable. Supply one of: ${policy.allowedFormats.join(', ')}.`,
    );
  }
  if (artwork.colourSpace !== null && !policy.allowedColourSpaces.includes(artwork.colourSpace.toLowerCase())) {
    errors.push(`Colour space "${artwork.colourSpace}" is not accepted. Convert to sRGB.`);
  }

  const dpiWidth = effectiveDpiForPrintSize(nativeWidth, placement.widthMm);
  const dpiHeight = effectiveDpiForPrintSize(nativeHeight, placement.heightMm);
  const dpi = dpiWidth === null || dpiHeight === null ? null : Math.min(dpiWidth, dpiHeight);

  if (dpi === null) {
    errors.push('Cannot compute effective resolution: artwork or placement size is zero.');
  } else if (dpi < policy.minimumDpi) {
    errors.push(
      `At ${placement.widthMm}x${placement.heightMm}mm the effective resolution is ` +
        `${dpi.toFixed(0)} DPI, below the ${policy.minimumDpi} DPI floor. Print smaller ` +
        `than ${maxPrintWidthMm(nativeWidth, policy.minimumDpi).toFixed(0)}mm wide, or ` +
        'supply a higher-resolution original.',
    );
  } else if (dpi < policy.preferredDpi) {
    warnings.push(
      `At ${placement.widthMm}x${placement.heightMm}mm the effective resolution is ` +
        `${dpi.toFixed(0)} DPI — above the ${policy.minimumDpi} DPI floor but below the ` +
        `preferred ${policy.preferredDpi}. Acceptable for direct-to-garment on cotton, ` +
        'where fabric texture limits perceivable detail. Order a physical sample.',
    );
  }

  const aspectArtwork = nativeWidth / nativeHeight;
  const aspectPlacement = placement.widthMm / placement.heightMm;
  const drift = Math.abs(aspectArtwork - aspectPlacement) / aspectPlacement;
  if (drift > 0.02) {
    errors.push(
      `Artwork aspect ratio ${aspectArtwork.toFixed(3)} does not match the requested ` +
        `placement ${aspectPlacement.toFixed(3)}. The print would be stretched or ` +
        'cropped — set a placement size with the same proportions.',
    );
  }

  if (artwork.hasAlpha === false) {
    warnings.push(
      'No alpha channel: the artwork prints as a filled rectangle. On a dark garment ' +
        'this needs a white underbase, which changes hand-feel and cost.',
    );
  }

  return {
    acceptable: errors.length === 0,
    effectiveDpi: dpi,
    errors,
    warnings,
    maxWidthMmAtFloor: maxPrintWidthMm(nativeWidth, policy.minimumDpi),
    maxWidthMmAtPreferred: maxPrintWidthMm(nativeWidth, policy.preferredDpi),
  };
}
