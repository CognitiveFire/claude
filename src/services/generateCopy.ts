/**
 * Generate and store product copy.
 *
 * The rights record decides what the model is allowed to reference. Output is
 * scanned before storage, so unclean copy never reaches the database, let alone
 * a product page.
 */

import { audit } from '../observability/audit.ts';
import { assertCopyIsClean } from '../core/rights.ts';
import { generateProductCopy, type GeneratedCopy } from '../adapters/ai/copy.ts';
import { getArtwork, getProduct, updateProductCopy } from '../db/repositories/index.ts';
import type { Context } from './context.ts';

export interface GenerateCopyInput {
  readonly productId: string;
  readonly garmentDescription: string;
  readonly artworkDescription: string;
  readonly designPhrase: string | null;
  /** Phrases a human has cleared for this product. */
  readonly allowedPhrases: readonly string[];
  /** Load copy from a JSON file instead of generating it. */
  readonly fromFile?: GeneratedCopy;
}

export async function generateCopy(
  context: Context,
  input: GenerateCopyInput,
): Promise<GeneratedCopy> {
  const product = await getProduct(context.db, input.productId);
  if (!product) throw new Error(`Unknown product ${input.productId}.`);
  const artwork = await getArtwork(context.db, product.artworkId);
  if (!artwork) throw new Error(`Product ${input.productId} has no artwork.`);

  const copy =
    input.fromFile ??
    (await generateProductCopy(
      {
        productName: product.name,
        garmentDescription: input.garmentDescription,
        artworkTitle: artwork.title,
        artworkDescription: input.artworkDescription,
        designPhrase: input.designPhrase,
        allowedPhrases: input.allowedPhrases,
        market: 'United Kingdom',
        fulfilmentNote: null,
      },
      context.env,
    ));

  // Hand-written copy loaded from a file goes through the same gate.
  assertCopyIsClean(
    [copy.title, copy.descriptionHtml, copy.seoTitle, copy.seoDescription, ...copy.tags],
    { allowedPhrases: input.allowedPhrases },
  );

  await updateProductCopy(context.db, input.productId, {
    descriptionHtml: copy.descriptionHtml,
    seoTitle: copy.seoTitle,
    seoDescription: copy.seoDescription,
    tags: copy.tags,
  });

  await audit({
    actor: context.actor,
    action: 'product.copy',
    entityType: 'product',
    entityId: input.productId,
    outcome: 'SUCCESS',
    after: {
      source: input.fromFile ? 'FILE' : 'AI',
      seoTitleLength: copy.seoTitle.length,
      tags: copy.tags.length,
    },
  });

  return copy;
}
