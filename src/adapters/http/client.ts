/**
 * Shared HTTP client for every external API.
 *
 * One chokepoint for retries, rate-limit handling, timeouts, redaction and raw
 * response capture. Adapters do not call fetch directly — a guard that lives in
 * the only client cannot be bypassed by a future code path.
 */

import { logger } from '../../observability/logger.ts';
import { redact } from '../../observability/redact.ts';

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawText: string;
  readonly durationMs: number;
  readonly attempts: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;
  readonly method: string;

  constructor(
    message: string,
    status: number,
    body: unknown,
    url: string,
    method: string,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
    this.method = method;
  }

  /** 4xx other than 408/429 will not succeed on retry. */
  get retryable(): boolean {
    if (this.status === 408 || this.status === 429) return true;
    return this.status >= 500;
  }
}

export interface HttpClientOptions {
  readonly name: string;
  readonly baseUrl: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** Hook so a caller can intercept every outbound request (used by guards). */
  readonly beforeRequest?: (request: HttpRequest) => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 4;

export class HttpClient {
  private readonly log;
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.log = logger.child({ http: options.name });
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.options.beforeRequest?.(request);

    const url = request.url.startsWith('http')
      ? request.url
      : `${this.options.baseUrl.replace(/\/$/, '')}/${request.url.replace(/^\//, '')}`;

    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.options.defaultHeaders,
      ...request.headers,
    };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (request.idempotencyKey) headers['idempotency-key'] = request.idempotencyKey;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: request.method,
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: controller.signal,
        });
        const rawText = await response.text();
        const durationMs = Date.now() - startedAt;

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });

        let body: unknown = null;
        if (rawText.length > 0) {
          try {
            body = JSON.parse(rawText);
          } catch {
            body = rawText;
          }
        }

        if (response.ok) {
          this.log.debug('request succeeded', {
            method: request.method,
            url,
            status: response.status,
            durationMs,
            attempt,
          });
          return { status: response.status, headers: responseHeaders, body, rawText, durationMs, attempts: attempt };
        }

        const error = new HttpError(
          `${this.options.name} ${request.method} ${url} failed with ${response.status}`,
          response.status,
          body,
          url,
          request.method,
        );

        if (!error.retryable || attempt === maxAttempts) throw error;

        const waitMs = this.retryDelayMs(attempt, responseHeaders);
        this.log.warn('retrying after error response', {
          method: request.method,
          url,
          status: response.status,
          attempt,
          waitMs,
          body: redact(body),
        });
        await sleep(waitMs);
        lastError = error;
        continue;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof HttpError) throw error;

        // Network failure or timeout: retryable by nature.
        if (attempt === maxAttempts) {
          this.log.error('request failed after final attempt', {
            method: request.method,
            url,
            attempt,
            error: redact(error),
          });
          throw error;
        }
        const waitMs = this.retryDelayMs(attempt, {});
        this.log.warn('retrying after transport failure', {
          method: request.method,
          url,
          attempt,
          waitMs,
          error: redact(error),
        });
        await sleep(waitMs);
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${this.options.name}: request failed with no error recorded`);
  }

  /**
   * Exponential backoff with jitter, but an explicit Retry-After always wins —
   * hammering a rate limiter is how an API key gets suspended.
   */
  private retryDelayMs(attempt: number, headers: Readonly<Record<string, string>>): number {
    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
    }
    const base = 2 ** (attempt - 1) * 1000;
    const jitter = Math.floor(Math.random() * 250);
    return Math.min(base + jitter, 30_000);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
