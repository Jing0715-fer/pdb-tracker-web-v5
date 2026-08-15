/**
 * LlmRuntime — the adapter registry & call preparation seam.
 *
 * Adapters register themselves for one or more providers. `prepareCall`
 * resolves the adapter for a (provider, model) route and returns a
 * PreparedLlmCall. `stream` runs the (optional) middleware chain then the
 * resolved adapter. This is the LLM capability seam: the agent loop talks to
 * `ctx.llm`, never to a concrete provider.
 */

import type { LlmAdapter, LlmCallConfig, PreparedLlmCall, GenerateOptions, StreamChunk } from './types';

export type StreamMiddleware = (
  options: GenerateOptions,
  next: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
) => AsyncIterable<StreamChunk>;

export interface AdapterHandle {
  readonly provider: string;
  replace(adapter: LlmAdapter): void;
  dispose(): void;
}

export class LlmRuntime {
  private readonly adapters = new Map<string, LlmAdapter>();
  private readonly middlewares: StreamMiddleware[] = [];

  registerAdapter(providers: string[], adapter: LlmAdapter): AdapterHandle {
    for (const p of providers) this.adapters.set(p, adapter);
    return {
      provider: providers[0] ?? '',
      replace: (next: LlmAdapter) => {
        for (const p of providers) this.adapters.set(p, next);
      },
      dispose: () => {
        for (const p of providers) {
          const cur = this.adapters.get(p);
          if (cur === adapter) this.adapters.delete(p);
        }
      },
    };
  }

  use(middleware: StreamMiddleware): () => void {
    this.middlewares.push(middleware);
    return () => {
      const i = this.middlewares.indexOf(middleware);
      if (i >= 0) this.middlewares.splice(i, 1);
    };
  }

  listProviders(): string[] {
    return [...this.adapters.keys()];
  }

  getAdapter(provider: string): LlmAdapter | undefined {
    return this.adapters.get(provider);
  }

  prepareCall(config: LlmCallConfig): PreparedLlmCall {
    const adapter = this.adapters.get(config.provider);
    if (!adapter) {
      throw new Error(`No LLM adapter registered for provider "${config.provider}"`);
    }
    return {
      config,
      stream: (options) => this.stream(options),
    };
  }

  /** Run the middleware chain, then the resolved adapter. */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const run = (opts: GenerateOptions): AsyncIterable<StreamChunk> => {
      const adapter = this.adapters.get(opts.provider);
      if (!adapter) {
        return (async function* () {
          yield {
            type: 'finish',
            reason: { kind: 'error', error: `No adapter for provider "${opts.provider}"` },
          };
        })();
      }
      return adapter.stream(opts);
    };

    // Fold middlewares: last registered is outermost.
    let handler = run;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      const next = handler;
      handler = (opts) => mw(opts, next);
    }
    return handler(options);
  }
}
