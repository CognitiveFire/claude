/**
 * Register an artwork.
 *
 * Reads the file's real metadata, hashes it (the hash is the artwork's
 * identity, not the filename), scans the supplied text for protected
 * references, and records the rights fields with the safe default.
 */

import { audit } from '../observability/audit.ts';
import { readImageMetadata } from '../core/imagemeta.ts';
import { initialRightsRecord, scanForProtectedReferences } from '../core/rights.ts';
import { insertArtwork } from '../db/repositories/index.ts';
import type { Context } from './context.ts';

export interface OnboardArtworkInput {
  readonly filePath: string;
  readonly title: string;
  readonly artist: string | null;
  /** Text printed on the garment, e.g. "DEFINITELY MAYBE?". */
  readonly designPhrase: string | null;
}

export interface OnboardArtworkResult {
  readonly artworkId: string;
  readonly metadata: Awaited<ReturnType<typeof readImageMetadata>>;
  readonly referenceFlags: readonly { category: string; matched: string; note: string }[];
}

export async function onboardArtwork(
  context: Context,
  input: OnboardArtworkInput,
): Promise<OnboardArtworkResult> {
  const metadata = await readImageMetadata(input.filePath);

  if (metadata.widthPx === null || metadata.heightPx === null) {
    throw new Error(
      `Could not read pixel dimensions from ${input.filePath} (detected format: ` +
        `${metadata.format}). Supply a PNG or JPEG — print suitability cannot be ` +
        'assessed from a file whose dimensions are unknown.',
    );
  }

  const flags = scanForProtectedReferences(
    [input.title, input.artist ?? '', input.designPhrase ?? ''],
  );
  const rights = initialRightsRecord(flags);

  const artworkId = await insertArtwork(context.db, {
    title: input.title,
    artist: input.artist,
    sourcePath: input.filePath,
    fileHash: metadata.sha256,
    widthPx: metadata.widthPx,
    heightPx: metadata.heightPx,
    format: metadata.format,
    colourSpace: metadata.colourSpace,
    hasAlpha: metadata.hasAlpha,
    fileSizeBytes: metadata.fileSizeBytes,
    declaredDpi: metadata.declaredDpi,
    brandReferenceStatus: rights.brandReferenceStatus,
    advertisingRestrictions: rights.advertisingRestrictions,
    reviewNotes: rights.reviewNotes,
  });

  await audit({
    actor: context.actor,
    action: 'artwork.register',
    entityType: 'artwork',
    entityId: artworkId,
    outcome: 'SUCCESS',
    after: { title: input.title, fileHash: metadata.sha256, flags: flags.length },
  });

  return {
    artworkId,
    metadata,
    referenceFlags: flags.map((f) => ({
      category: f.category,
      matched: f.matched,
      note: f.note,
    })),
  };
}
