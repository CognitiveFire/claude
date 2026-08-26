/**
 * Secret redaction for logs and error messages.
 *
 * Leaked-credential-in-stack-trace is the common failure, so redaction is
 * applied to error paths too, not just to happy-path logging. Secrets are
 * registered once at startup and replaced by a stable fingerprint, which lets
 * us prove WHICH credential acted without ever writing the credential down.
 */

import { createHash } from 'node:crypto';

const secrets = new Map<string, string>();

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|authorization|api[-_]?key|access[-_]?token|signature)/i;

/** Short, stable, non-reversible identifier for a credential. */
export function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 12);
}

export function registerSecret(secret: string | undefined | null): void {
  if (typeof secret !== 'string') return;
  const trimmed = secret.trim();
  // Very short values would match too much text and mangle unrelated output.
  if (trimmed.length < 8) return;
  secrets.set(trimmed, `[redacted:${fingerprint(trimmed)}]`);
}

export function resetSecrets(): void {
  secrets.clear();
}

export function redactString(input: string): string {
  let output = input;
  for (const [secret, replacement] of secrets) {
    if (output.includes(secret)) output = output.split(secret).join(replacement);
  }
  return output;
}

/** Deep-redact a value: registered secrets by content, and secrets by key name. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? typeof inner === 'string' && inner.length >= 8
        ? `[redacted:${fingerprint(inner)}]`
        : '[redacted]'
      : redact(inner, depth + 1);
  }
  return output;
}
