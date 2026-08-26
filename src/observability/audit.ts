/**
 * Audit trail.
 *
 * Every mutation — ours or an external API's — writes a row here, including the
 * ones that fail. A missing audit row for a failed attempt is how a system
 * loses the ability to explain itself.
 */

import { getDatabase, schema } from '../db/client.ts';
import { logger } from './logger.ts';
import { redact } from './redact.ts';

export interface AuditEntry {
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly outcome: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  readonly before?: unknown;
  readonly after?: unknown;
  readonly externalRequest?: unknown;
  readonly externalResponse?: unknown;
  readonly credentialFingerprint?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  const record = {
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    outcome: entry.outcome,
    before: (redact(entry.before ?? null) ?? null) as Record<string, unknown> | null,
    after: (redact(entry.after ?? null) ?? null) as Record<string, unknown> | null,
    externalRequest: (redact(entry.externalRequest ?? null) ?? null) as Record<string, unknown> | null,
    externalResponse: (redact(entry.externalResponse ?? null) ?? null) as Record<string, unknown> | null,
    credentialFingerprint: entry.credentialFingerprint ?? null,
  };

  logger.info('audit', {
    action: record.action,
    entityType: record.entityType,
    entityId: record.entityId,
    outcome: record.outcome,
  });

  try {
    await getDatabase().insert(schema.auditLog).values(record);
  } catch (error) {
    // An audit failure must be loud, but it must not swallow the original
    // operation's own error by throwing over the top of it.
    logger.error('failed to write audit row', { error: redact(error), action: record.action });
  }
}
