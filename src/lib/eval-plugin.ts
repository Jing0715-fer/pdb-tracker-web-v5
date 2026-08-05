/**
 * Plugin System — Custom Evaluation Module Registry
 * -------------------------------------------------------------
 * Mirror of `plugin-system.ts` but for evaluation pipelines. Lets a
 * third party hook into three points of the per-target evaluation
 * flow used by `src/lib/target-evaluation.ts` and the eval skill
 * module:
 *
 *   1. `preEvaluate(uniprotId)` — runs BEFORE the main pipeline. Can
 *      short-circuit the run by returning `{ skip: true }` (e.g. for
 *      a known-uninteresting target) and/or inject extra data that the
 *      downstream scoring step can read.
 *   2. `postScore(uniprotId, scores)` — runs AFTER scoring but BEFORE
 *      report generation. Can mutate/extend the scores object (e.g.
 *      add a `Confidence` sub-score derived from external evidence).
 *   3. `customScore({ pdbCount, blastCount, coverage })` — runs as
 *      part of scoring. Returns `{ score, label, details? }` which is
 *      merged into the scores object under the plugin's id.
 *
 * All three hooks are optional — a plugin may implement only the ones
 * it cares about. The registry never throws when a hook is missing;
 * it just skips that hook for that plugin.
 *
 * Like the LLM registry, this is a process-wide singleton
 * (`evalPluginRegistry`) attached to `globalThis` so hot-reload does
 * not duplicate state.
 */

export interface EvalPreEvaluateResult {
  /** If true, the main pipeline is skipped entirely for this target. */
  skip?: boolean;
  /** Optional data merged into the evaluation context before scoring. */
  extraData?: Record<string, unknown>;
}

export interface EvalCustomScoreInput {
  pdbCount: number;
  blastCount: number;
  coverage: number;
}

export interface EvalCustomScoreResult {
  /** 0–100 integer score. */
  score: number;
  /** Short label, e.g. "Druggability". */
  label: string;
  /** Optional human-readable explanation. */
  details?: string;
}

export interface EvalModulePlugin {
  /** Stable unique id, e.g. `acme:druggability`. */
  id: string;
  name: string;
  description: string;
  /** Called before the main evaluation pipeline. */
  preEvaluate?: (uniprotId: string) => Promise<EvalPreEvaluateResult>;
  /** Called after scoring, before report generation. */
  postScore?: (
    uniprotId: string,
    scores: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  /** Custom scoring function — merged into the scores object under the plugin's id. */
  customScore?: (data: EvalCustomScoreInput) => Promise<EvalCustomScoreResult>;
}

export class EvalPluginRegistry {
  private modules = new Map<string, EvalModulePlugin>();

  /** Register (or replace) a module. Validates required fields. */
  register(module: EvalModulePlugin): void {
    if (!module || typeof module !== 'object') {
      throw new TypeError('eval-plugin: register() expects a module object');
    }
    if (!module.id || typeof module.id !== 'string') {
      throw new TypeError('eval-plugin: module.id is required (string)');
    }
    if (
      typeof module.preEvaluate !== 'function' &&
      typeof module.postScore !== 'function' &&
      typeof module.customScore !== 'function'
    ) {
      throw new TypeError(
        `eval-plugin: module "${module.id}" must implement at least one of preEvaluate / postScore / customScore`,
      );
    }
    if (!module.name) module.name = module.id;
    if (!module.description) module.description = '';
    this.modules.set(module.id, module);
  }

  /** Remove a module by id. No-op if not registered. */
  unregister(id: string): void {
    this.modules.delete(id);
  }

  /** Get a single module by id (or undefined). */
  get(id: string): EvalModulePlugin | undefined {
    return this.modules.get(id);
  }

  /** List all registered modules (insertion order). */
  list(): EvalModulePlugin[] {
    return Array.from(this.modules.values());
  }

  /**
   * Run all `preEvaluate` hooks in registration order and merge results.
   * Returns `{ skip, extraData }` where `skip` is true if ANY plugin
   * requested a skip, and `extraData` is the merged set of all
   * `extraData` objects (later plugins override earlier keys).
   *
   * A throwing hook is logged and skipped — it must never crash the
   * main evaluation pipeline.
   */
  async runPreEvaluate(
    uniprotId: string,
  ): Promise<EvalPreEvaluateResult> {
    let skip = false;
    const extraData: Record<string, unknown> = {};

    for (const m of this.list()) {
      if (typeof m.preEvaluate !== 'function') continue;
      try {
        const result = await m.preEvaluate(uniprotId);
        if (result?.skip) skip = true;
        if (result?.extraData && typeof result.extraData === 'object') {
          Object.assign(extraData, result.extraData);
        }
      } catch (err) {
        // Log and continue — a broken plugin must not poison the pipeline.
        console.error(
          `[eval-plugin] preEvaluate for "${m.id}" on ${uniprotId} threw:`,
          err,
        );
      }
    }
    return { skip, extraData: Object.keys(extraData).length ? extraData : undefined };
  }

  /**
   * Run all `postScore` hooks. Each plugin receives the output of the
   * previous one (so plugins can build on each other's mutations).
   * Returns the final (possibly mutated) scores object.
   */
  async runPostScore(
    uniprotId: string,
    scores: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let acc = { ...scores };
    for (const m of this.list()) {
      if (typeof m.postScore !== 'function') continue;
      try {
        const next = await m.postScore(uniprotId, acc);
        if (next && typeof next === 'object') {
          acc = next as Record<string, unknown>;
        }
      } catch (err) {
        console.error(
          `[eval-plugin] postScore for "${m.id}" on ${uniprotId} threw:`,
          err,
        );
      }
    }
    return acc;
  }

  /**
   * Run all `customScore` hooks. Each plugin's result is stored under
   * its id in the returned object:
   *   `{ [pluginId]: { score, label, details? } }`
   */
  async runCustomScores(
    data: EvalCustomScoreInput,
  ): Promise<Record<string, EvalCustomScoreResult>> {
    const out: Record<string, EvalCustomScoreResult> = {};
    for (const m of this.list()) {
      if (typeof m.customScore !== 'function') continue;
      try {
        const result = await m.customScore(data);
        if (result && typeof result.score === 'number' && typeof result.label === 'string') {
          out[m.id] = result;
        }
      } catch (err) {
        console.error(
          `[eval-plugin] customScore for "${m.id}" threw:`,
          err,
        );
      }
    }
    return out;
  }
}

const GLOBAL_KEY = '__pdb_eval_plugin_registry__';
const g = globalThis as unknown as { [GLOBAL_KEY]?: EvalPluginRegistry };

export const evalPluginRegistry: EvalPluginRegistry =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new EvalPluginRegistry());
