import { describe, expect, it } from 'vitest';
import {
  ProtectedReferenceError,
  assertCopyIsClean,
  evaluateRightsGate,
  initialRightsRecord,
  scanForProtectedReferences,
  type RightsRecord,
} from '../src/core/rights.ts';

describe('scanForProtectedReferences', () => {
  it('flags the first product’s own phrase as an album-title reference', () => {
    const flags = scanForProtectedReferences(['DEFINITELY MAYBE?']);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.category).toBe('ALBUM_TITLE');
  });

  it('flags band and artist names', () => {
    const flags = scanForProtectedReferences(['Inspired by Oasis and Jarvis Cocker']);
    expect(flags.map((f) => f.matched)).toEqual(
      expect.arrayContaining(['oasis', 'jarvis cocker']),
    );
  });

  it('flags lyrics and false claims of official status', () => {
    const flags = scanForProtectedReferences([
      'Champagne Supernova tee — officially licensed',
    ]);
    expect(flags.map((f) => f.category)).toEqual(
      expect.arrayContaining(['LYRIC', 'LOGO_OR_MARK']),
    );
  });

  it('does not flag unrelated text that merely contains a term as a substring', () => {
    expect(scanForProtectedReferences(['Blurred edges and pulpy texture'])).toEqual([]);
  });

  it('finds nothing in genuinely original copy', () => {
    expect(
      scanForProtectedReferences([
        'A heavyweight cotton tee carrying an original painting in muted indigo.',
      ]),
    ).toEqual([]);
  });
});

describe('evaluateRightsGate', () => {
  const cleared: RightsRecord = {
    artworkRightsStatus: 'CLEARED',
    brandReferenceStatus: 'CLEARED',
    licensingRequired: false,
    licensingStatus: 'NOT_REQUIRED',
    advertisingRestrictions: [],
    reviewNotes: [],
  };

  it('allows a fully cleared record', () => {
    expect(evaluateRightsGate(cleared)).toEqual({ allowed: true, blockers: [] });
  });

  it('treats UNKNOWN as a blocker, not as permission', () => {
    const result = evaluateRightsGate({ ...cleared, brandReferenceStatus: 'UNKNOWN' });
    expect(result.allowed).toBe(false);
    expect(result.blockers.join(' ')).toContain('an unknown is not a clearance');
  });

  it('blocks publication while a reference is under review', () => {
    const record = initialRightsRecord(scanForProtectedReferences(['DEFINITELY MAYBE?']));
    const result = evaluateRightsGate(record);
    expect(result.allowed).toBe(false);
    expect(result.blockers.join(' ')).toContain('REVIEW_REQUIRED');
  });

  it('blocks when a licence is required but not obtained', () => {
    const result = evaluateRightsGate({
      ...cleared,
      licensingRequired: true,
      licensingStatus: 'REQUIRED_NOT_OBTAINED',
    });
    expect(result.allowed).toBe(false);
  });

  it('records advertising restrictions when a reference is detected', () => {
    const record = initialRightsRecord(scanForProtectedReferences(['DEFINITELY MAYBE?']));
    expect(record.advertisingRestrictions.join(' ')).toContain('official endorsement');
  });
});

describe('assertCopyIsClean', () => {
  it('rejects generated copy that names a band', () => {
    expect(() => assertCopyIsClean(['For fans of Oasis.'])).toThrow(ProtectedReferenceError);
  });

  it('permits original copy', () => {
    expect(() =>
      assertCopyIsClean(['Heavyweight organic cotton. Printed in the UK. Original artwork.']),
    ).not.toThrow();
  });
});

describe('per-product phrase clearance', () => {
  it('stops flagging a phrase a human has explicitly cleared for this product', () => {
    const flags = scanForProtectedReferences(['DEFINITELY MAYBE? — original tee'], {
      allowedPhrases: ['definitely maybe'],
    });
    expect(flags).toEqual([]);
  });

  it('still blocks artist names and official-status claims after clearance', () => {
    const flags = scanForProtectedReferences(
      ['DEFINITELY MAYBE? — official merchandise, as worn by Liam Gallagher'],
      { allowedPhrases: ['definitely maybe'] },
    );
    const categories = flags.map((f) => f.category);
    expect(categories).toContain('ARTIST_OR_BAND_NAME');
    expect(categories).toContain('LOGO_OR_MARK');
    expect(categories).not.toContain('ALBUM_TITLE');
  });

  it('clearance is per-phrase, not a blanket exemption for other titles', () => {
    const flags = scanForProtectedReferences(['Parklife print'], {
      allowedPhrases: ['definitely maybe'],
    });
    expect(flags.map((f) => f.matched)).toEqual(['parklife']);
  });
});
