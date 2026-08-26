/**
 * Intellectual-property gating.
 *
 * This module flags; it does not adjudicate. Nothing here is a legal opinion,
 * and a CLEAR status means "no automated flag was raised", never "this is
 * lawful". Anything touching a protected reference goes to REVIEW_REQUIRED and
 * hard-blocks publication and advertising until a human clears it.
 *
 * The reference scanner exists because the first product deliberately makes a
 * cultural reference ("DEFINITELY MAYBE?"). The system must therefore be
 * capable of noticing that, rather than silently shipping it.
 */

export type RightsStatus = 'UNKNOWN' | 'REVIEW_REQUIRED' | 'CLEARED' | 'BLOCKED';
export type LicensingStatus = 'NOT_REQUIRED' | 'REQUIRED_NOT_OBTAINED' | 'OBTAINED' | 'UNKNOWN';

export interface RightsRecord {
  /** Do we own or licence the artwork itself? */
  readonly artworkRightsStatus: RightsStatus;
  /** Does the product reference a third-party brand, band or work? */
  readonly brandReferenceStatus: RightsStatus;
  readonly licensingRequired: boolean | null;
  readonly licensingStatus: LicensingStatus;
  /** Free-text restrictions that must be honoured in advertising. */
  readonly advertisingRestrictions: readonly string[];
  readonly reviewNotes: readonly string[];
}

export type ReferenceCategory =
  | 'ARTIST_OR_BAND_NAME'
  | 'ALBUM_TITLE'
  | 'LYRIC'
  | 'LOGO_OR_MARK'
  | 'CELEBRITY_LIKENESS';

export interface ReferenceFlag {
  readonly category: ReferenceCategory;
  readonly matched: string;
  readonly context: string;
  readonly note: string;
}

/**
 * Terms that must never appear in generated product copy or ad creative
 * without explicit human clearance. This is a FLAGGING list, not a claim about
 * what is or is not protected. It errs towards over-flagging: a false flag
 * costs a human thirty seconds, a missed one costs a takedown.
 */
const ARTIST_OR_BAND_TERMS: readonly string[] = [
  'oasis', 'blur', 'pulp', 'the verve', 'suede', 'stone roses', 'primal scream',
  'happy mondays', 'the smiths', 'radiohead', 'supergrass', 'elastica',
  'gallagher', 'liam gallagher', 'noel gallagher', 'damon albarn', 'jarvis cocker',
  'richard ashcroft', 'ian brown',
];

const ALBUM_OR_WORK_TERMS: readonly string[] = [
  'definitely maybe', "(what's the story) morning glory", 'parklife',
  'different class', 'urban hymns', 'dog man star', 'be here now',
];

const LYRIC_FRAGMENTS: readonly string[] = [
  'champagne supernova', 'wonderwall', 'live forever', 'common people',
  'bittersweet symphony', 'song 2',
];

const MARK_TERMS: readonly string[] = [
  'britpop™', 'official merchandise', 'officially licensed', 'official merch',
];

interface TermSet {
  readonly category: ReferenceCategory;
  readonly terms: readonly string[];
  readonly note: string;
}

const TERM_SETS: readonly TermSet[] = [
  {
    category: 'ARTIST_OR_BAND_NAME',
    terms: ARTIST_OR_BAND_TERMS,
    note:
      'Artist and band names must not appear in product copy or advertising: ' +
      'they imply endorsement we do not have.',
  },
  {
    category: 'ALBUM_TITLE',
    terms: ALBUM_OR_WORK_TERMS,
    note:
      'Album and work titles are protected references. The design may allude to ' +
      'one, but the product page and adverts must not name it.',
  },
  {
    category: 'LYRIC',
    terms: LYRIC_FRAGMENTS,
    note: 'Lyrics are copyrighted. Do not reproduce them in copy or on product.',
  },
  {
    category: 'LOGO_OR_MARK',
    terms: MARK_TERMS,
    note:
      'Claims of official status or licensing are false unless a licence exists, ' +
      'and are independently a consumer-protection problem.',
  },
];

export interface ScanOptions {
  /**
   * Phrases a human has explicitly cleared for THIS product.
   *
   * The first product's design phrase is itself a flagged album title. Once a
   * person has reviewed and accepted that specific reference, it stops being a
   * blocker for that product — while artist names, lyrics, other titles and
   * claims of official status stay blocked. Clearance is per-phrase and
   * per-product, never global.
   */
  readonly allowedPhrases?: readonly string[];
}

/**
 * Scan text for protected references.
 *
 * Matching is word-boundary aware so "Oasis" is flagged but "oasislike" in a
 * longer word is not, and so "definitely maybe?" as a design phrase is caught
 * regardless of punctuation.
 */
export function scanForProtectedReferences(
  texts: readonly string[],
  options: ScanOptions = {},
): readonly ReferenceFlag[] {
  const flags: ReferenceFlag[] = [];
  const haystack = texts.filter((t) => typeof t === 'string' && t.length > 0);
  const allowed = new Set(
    (options.allowedPhrases ?? []).map((phrase) => phrase.trim().toLowerCase()),
  );

  for (const text of haystack) {
    const lower = text.toLowerCase();
    for (const set of TERM_SETS) {
      for (const term of set.terms) {
        if (allowed.has(term)) continue;
        const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, 'i');
        const match = pattern.exec(lower);
        if (!match) continue;
        const index = match.index;
        flags.push({
          category: set.category,
          matched: term,
          context: text.slice(Math.max(0, index - 30), index + term.length + 30).trim(),
          note: set.note,
        });
      }
    }
  }
  return dedupe(flags);
}

/** A rights record for artwork whose provenance has not yet been established. */
export function initialRightsRecord(flags: readonly ReferenceFlag[]): RightsRecord {
  const hasReference = flags.length > 0;
  return {
    artworkRightsStatus: 'UNKNOWN',
    brandReferenceStatus: hasReference ? 'REVIEW_REQUIRED' : 'UNKNOWN',
    licensingRequired: hasReference ? null : null,
    licensingStatus: 'UNKNOWN',
    advertisingRestrictions: hasReference
      ? [
          'Do not name any artist, band, album or lyric in advertising copy or creative.',
          'Do not imply official endorsement, licence or affiliation.',
          'Do not use band logos, album artwork or artist likenesses.',
        ]
      : [],
    reviewNotes: flags.map((f) => `${f.category}: "${f.matched}" — ${f.note}`),
  };
}

export interface RightsGateResult {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
}

/**
 * The gate. Called before publishing a product and before creating any advert.
 * Fails closed: UNKNOWN is not permission.
 */
export function evaluateRightsGate(record: RightsRecord): RightsGateResult {
  const blockers: string[] = [];

  if (record.artworkRightsStatus !== 'CLEARED') {
    blockers.push(
      `artwork_rights_status is ${record.artworkRightsStatus}. Confirm you own or ` +
        'licence the artwork, then clear it explicitly.',
    );
  }
  if (record.brandReferenceStatus === 'BLOCKED') {
    blockers.push('brand_reference_status is BLOCKED. This product must not be published.');
  }
  if (record.brandReferenceStatus === 'REVIEW_REQUIRED') {
    blockers.push(
      'brand_reference_status is REVIEW_REQUIRED. A potentially protected reference ' +
        'was detected and needs human clearance before publication.',
    );
  }
  if (record.brandReferenceStatus === 'UNKNOWN') {
    blockers.push(
      'brand_reference_status is UNKNOWN. Run the reference scan and record a ' +
        'decision — an unknown is not a clearance.',
    );
  }
  if (record.licensingRequired === true && record.licensingStatus !== 'OBTAINED') {
    blockers.push(
      `Licensing is required but licensing_status is ${record.licensingStatus}.`,
    );
  }
  if (record.licensingRequired === null) {
    blockers.push(
      'licensing_required has not been decided. Record whether a licence is needed.',
    );
  }

  return { allowed: blockers.length === 0, blockers };
}

/**
 * Guard for generated copy. AI-written text is scanned before it is stored, so
 * a model that helpfully adds "as worn by..." cannot reach a product page.
 */
export function assertCopyIsClean(
  texts: readonly string[],
  options: ScanOptions = {},
): void {
  const flags = scanForProtectedReferences(texts, options);
  if (flags.length === 0) return;
  const detail = flags
    .map((f) => `  ${f.category}: "${f.matched}" in "${f.context}"`)
    .join('\n');
  throw new ProtectedReferenceError(
    `Generated copy contains protected references and was rejected:\n${detail}`,
    flags,
  );
}

export class ProtectedReferenceError extends Error {
  readonly flags: readonly ReferenceFlag[];

  constructor(message: string, flags: readonly ReferenceFlag[]) {
    super(message);
    this.name = 'ProtectedReferenceError';
    this.flags = flags;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupe(flags: readonly ReferenceFlag[]): readonly ReferenceFlag[] {
  const seen = new Set<string>();
  const output: ReferenceFlag[] = [];
  for (const flag of flags) {
    const key = `${flag.category}:${flag.matched}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(flag);
  }
  return output;
}
