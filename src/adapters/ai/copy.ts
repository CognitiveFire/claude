/**
 * Product copy and SEO generation.
 *
 * Constraints enforced here, not merely requested in the prompt:
 *  - The model is given the real cost/price figures only as context it must not
 *    restate. It is never asked to produce a number, so it cannot invent one.
 *  - Output is scanned for protected references before it is returned. A model
 *    that helpfully adds "as worn by..." is rejected, retried once with the
 *    violation quoted back, then fails. It never reaches the database.
 *  - No claim of official status, licensing, endorsement or scarcity.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ConfigError, type Env } from '../../config/env.ts';
import { logger } from '../../observability/logger.ts';
import { registerSecret } from '../../observability/redact.ts';
import {
  ProtectedReferenceError,
  assertCopyIsClean,
  scanForProtectedReferences,
} from '../../core/rights.ts';

export interface CopyBrief {
  readonly productName: string;
  readonly garmentDescription: string;
  readonly artworkTitle: string;
  readonly artworkDescription: string;
  /** The design's visual text, e.g. "DEFINITELY MAYBE?". */
  readonly designPhrase: string | null;
  /** Phrases a human has cleared for this product. */
  readonly allowedPhrases: readonly string[];
  readonly market: string;
  readonly fulfilmentNote: string | null;
}

export interface GeneratedCopy {
  readonly title: string;
  readonly descriptionHtml: string;
  readonly seoTitle: string;
  readonly seoDescription: string;
  readonly tags: readonly string[];
}

const copySchema = z.object({
  title: z.string().min(3).max(120),
  descriptionHtml: z.string().min(40).max(4000),
  seoTitle: z.string().min(3).max(70),
  seoDescription: z.string().min(20).max(160),
  tags: z.array(z.string().min(2).max(40)).min(3).max(15),
});

const SYSTEM_PROMPT = `You write product copy for Indie Archive, an independent
British art and clothing label. One original painting, printed on a
heavyweight cotton garment.

Voice: restrained, confident, physical. Describe the garment and the artwork.
Short sentences. No exclamation marks. It should read like an independent
European fashion label, not like a dropshipping store.

Absolute rules:
- Never name a musician, band, album, song or lyric. Not one.
- Never claim the product is official, licensed, endorsed by, or affiliated
  with anyone.
- Never invent or restate prices, discounts, shipping costs, delivery times,
  stock levels, materials or certifications that are not given to you.
- No fake scarcity ("only 3 left"), no fake social proof, no testimonials.
- No emoji. No hashtags in the description.
- If the design carries a phrase, you may refer to the phrase as a phrase. Do
  not explain what it alludes to or who might have said it.

Return ONLY a JSON object with these keys: title, descriptionHtml, seoTitle,
seoDescription, tags. descriptionHtml may use <p>, <ul>, <li>, <strong>.`;

export class CopyGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopyGenerationError';
  }
}

export async function generateProductCopy(
  brief: CopyBrief,
  env: Env,
): Promise<GeneratedCopy> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ConfigError(
      'ANTHROPIC_API_KEY is not set, so product copy cannot be generated. ' +
        'Set it, or write the copy by hand and load it with `ia product:copy --from-file`.',
    );
  }
  registerSecret(env.ANTHROPIC_API_KEY);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const log = logger.child({ service: 'copy', model: env.ANTHROPIC_MODEL });

  let lastViolation: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const message = await client.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(brief, lastViolation),
        },
      ],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      lastViolation = 'The previous response was not valid JSON.';
      log.warn('copy response was not valid JSON, retrying', { attempt });
      continue;
    }

    const validated = copySchema.safeParse(parsed);
    if (!validated.success) {
      lastViolation = `The previous response failed validation: ${validated.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`;
      log.warn('copy response failed schema validation, retrying', { attempt });
      continue;
    }

    const copy = validated.data;
    const texts = [
      copy.title,
      copy.descriptionHtml,
      copy.seoTitle,
      copy.seoDescription,
      ...copy.tags,
    ];

    try {
      assertCopyIsClean(texts, { allowedPhrases: brief.allowedPhrases });
    } catch (error) {
      if (!(error instanceof ProtectedReferenceError) || attempt === 2) throw error;
      const flags = scanForProtectedReferences(texts, { allowedPhrases: brief.allowedPhrases });
      lastViolation =
        'The previous response contained forbidden references and was rejected: ' +
        flags.map((f) => `"${f.matched}" (${f.category})`).join(', ') +
        '. Remove them entirely; do not substitute a hint or an initial.';
      log.warn('copy contained protected references, retrying', {
        attempt,
        flags: flags.map((f) => f.category),
      });
      continue;
    }

    log.info('copy generated and cleared', { attempt, tags: copy.tags.length });
    return {
      title: copy.title,
      descriptionHtml: copy.descriptionHtml,
      seoTitle: copy.seoTitle,
      seoDescription: copy.seoDescription,
      tags: copy.tags,
    };
  }

  throw new CopyGenerationError(
    `Copy generation failed after 2 attempts. Last problem: ${lastViolation ?? 'unknown'}`,
  );
}

function buildUserPrompt(brief: CopyBrief, lastViolation: string | null): string {
  const lines = [
    `Product: ${brief.productName}`,
    `Garment: ${brief.garmentDescription}`,
    `Artwork: ${brief.artworkTitle}`,
    `Artwork notes: ${brief.artworkDescription}`,
    brief.designPhrase ? `Phrase printed on the garment: ${brief.designPhrase}` : null,
    `Market: ${brief.market}`,
    brief.fulfilmentNote ? `Fulfilment: ${brief.fulfilmentNote}` : null,
    '',
    'Do not state a price, a delivery time, or a stock level anywhere.',
  ].filter((line): line is string => line !== null);

  if (lastViolation) {
    lines.push('', `Your previous attempt was rejected. ${lastViolation}`);
  }
  return lines.join('\n');
}

/** Models sometimes wrap JSON in prose or a fenced block. Take the object. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}
