/**
 * Transport for producer adapters: either the live API or recorded fixtures.
 *
 * The distinction is carried all the way through to the economics engine as
 * DataProvenance. FIXTURE data can be priced and inspected but can never be
 * published — see services/publishProduct.ts. That is the mechanism that stops
 * a made-up supplier cost reaching a real product page.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DataProvenance } from '../../ports/producer.ts';
import { HttpClient, type HttpRequest } from '../http/client.ts';
import { logger } from '../../observability/logger.ts';

export interface RawTransport {
  readonly provenance: DataProvenance;
  /**
   * @param operation stable operation name, also the fixture filename
   * @param request   the live request to make when not using fixtures
   */
  call(operation: string, request: HttpRequest): Promise<unknown>;
}

export class HttpTransport implements RawTransport {
  readonly provenance: DataProvenance = 'LIVE_API';
  private readonly client: HttpClient;

  constructor(client: HttpClient) {
    this.client = client;
  }

  async call(_operation: string, request: HttpRequest): Promise<unknown> {
    const response = await this.client.request(request);
    return response.body;
  }
}

export class MissingFixtureError extends Error {
  constructor(producer: string, operation: string, file: string) {
    super(
      `No fixture for ${producer}.${operation} (expected ${file}). ` +
        'Record one, or set PRODUCER_USE_FIXTURES=false and supply credentials.',
    );
    this.name = 'MissingFixtureError';
  }
}

export class FixtureTransport implements RawTransport {
  readonly provenance: DataProvenance = 'FIXTURE';
  private readonly cache = new Map<string, unknown>();

  private readonly producer: string;
  private readonly directory: string;

  constructor(producer: string, directory = path.join(process.cwd(), 'fixtures')) {
    this.producer = producer;
    this.directory = directory;
  }

  async call(operation: string, request: HttpRequest): Promise<unknown> {
    const cached = this.cache.get(operation);
    if (cached !== undefined) return cached;

    const file = path.join(this.directory, this.producer, `${operation}.json`);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new MissingFixtureError(this.producer, operation, file);
    }

    const parsed = JSON.parse(text) as Record<string, unknown>;
    logger.debug('served fixture', {
      producer: this.producer,
      operation: operation,
      method: request.method,
      fixtureProvenance: parsed['_provenance'] ?? 'UNDECLARED',
    });

    this.cache.set(operation, parsed);
    return parsed;
  }
}
