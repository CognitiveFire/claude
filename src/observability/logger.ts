/** Structured JSON logging to stderr, with secret redaction on every field. */

import { loadEnv } from '../config/env.ts';
import { redact, redactString } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function threshold(): number {
  try {
    return ORDER[loadEnv().LOG_LEVEL];
  } catch {
    return ORDER.info;
  }
}

function emit(
  level: LogLevel,
  message: string,
  bindings: Record<string, unknown>,
  fields?: Record<string, unknown>,
): void {
  if (ORDER[level] < threshold()) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: redactString(message),
    ...(redact({ ...bindings, ...fields }) as Record<string, unknown>),
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, f) => emit('debug', m, bindings, f),
    info: (m, f) => emit('info', m, bindings, f),
    warn: (m, f) => emit('warn', m, bindings, f),
    error: (m, f) => emit('error', m, bindings, f),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ app: 'indie-archive' });
