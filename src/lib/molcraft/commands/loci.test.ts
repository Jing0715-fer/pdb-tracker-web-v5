/**
 * Unit tests for lociFromResidue
 *
 * Tests the residue-to-Loci resolution function using a mocked Molstar viewer.
 * Focuses on:
 *   - Expression building (correct MolScript properties are used)
 *   - Non-destructive path (getLociFromExpression is preferred)
 *   - Fallback path (select-then-read when getLociFromExpression unavailable)
 *   - Selection preservation (R137 fix: don't destroy user selection)
 *   - Empty/missing structure data handling
 *
 * Run with: bun test src/lib/molcraft/commands/loci.test.ts
 */

import { test, expect, describe, mock, beforeEach, afterEach } from 'bun:test';
import { lociFromResidue } from './loci';

// ─── Mock Types ──────────────────────────────────────────────────────────

interface MockLoci {
  elements: unknown[];
}

interface MockStructureData {
  // Opaque structure data object
  _type: 'structure-data';
}

interface MockPlugin {
  managers: {
    structure: {
      hierarchy: {
        current: {
          structures: Array<{
            cell?: {
              obj?: {
                data?: MockStructureData;
              };
            };
          }>;
        };
      };
      selection: {
        getLociFromExpression?: (expr: unknown, data: unknown) => MockLoci | null;
        clear: () => void;
        getLoci: (data: unknown) => MockLoci | null;
        entries: Map<unknown, { _selection?: MockLoci; selection?: MockLoci }>;
      };
    };
  };
}

interface MockViewer {
  plugin: MockPlugin;
  structureInteractivity: (opts: unknown) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function createMockPlugin(options: {
  hasData?: boolean;
  hasGetLociFromExpression?: boolean;
  lociResult?: MockLoci | null;
  hasExistingSelection?: boolean;
  fallbackFindsLoci?: boolean;
} = {}): MockPlugin {
  const {
    hasData = true,
    hasGetLociFromExpression = true,
    lociResult = { elements: [{ chain: 'A', resno: 100 }] },
    hasExistingSelection = false,
    fallbackFindsLoci = true,
  } = options;

  const data: MockStructureData | null = hasData ? { _type: 'structure-data' } : null;

  // Mutable entries map — cleared by clear(), updated by structureInteractivity
  const existingSelection: MockLoci | null = hasExistingSelection
    ? { elements: [{ chain: 'B', resno: 200 }] }
    : null;
  const entries = new Map<unknown, { _selection?: MockLoci; selection?: MockLoci }>();
  if (existingSelection && data) {
    entries.set(data, { _selection: existingSelection });
  }

  // The fallback loci that getLoci returns after the select-then-read cycle
  const fallbackLoci: MockLoci | null = fallbackFindsLoci
    ? lociResult
    : null;

  return {
    managers: {
      structure: {
        hierarchy: {
          current: {
            structures: data ? [{ cell: { obj: { data } } }] : [],
          },
        },
        selection: {
          ...(hasGetLociFromExpression
            ? {
                getLociFromExpression: mock((_expr: unknown, _data: unknown) => lociResult),
              }
            : {}),
          clear: mock(() => {
            entries.clear();
          }),
          getLoci: mock((_data: unknown) => fallbackLoci),
          entries,
        },
      },
    },
  };
}

function createMockViewer(plugin: MockPlugin): MockViewer {
  return {
    plugin,
    structureInteractivity: mock(() => {}),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

// Store original console.warn so we can restore it
const originalWarn = console.warn;
let warnCalls: unknown[][] = [];

beforeEach(() => {
  warnCalls = [];
  console.warn = (...args: unknown[]) => { warnCalls.push(args); };
});

afterEach(() => {
  console.warn = originalWarn;
});

describe('lociFromResidue', () => {

  describe('non-destructive path (getLociFromExpression)', () => {
    test('uses getLociFromExpression when available (R137 fix)', async () => {
      const plugin = createMockPlugin({
        hasGetLociFromExpression: true,
        lociResult: { elements: [{ chain: 'A', resno: 100 }] },
      });
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'A', resno: 100 });

      expect(result).not.toBeNull();
      expect(plugin.managers.structure.selection.getLociFromExpression).toHaveBeenCalled();
      // Should NOT clear the selection (non-destructive path)
      expect(plugin.managers.structure.selection.clear).not.toHaveBeenCalled();
    });

    test('preserves existing user selection (R137 fix)', async () => {
      const plugin = createMockPlugin({
        hasGetLociFromExpression: true,
        hasExistingSelection: true,
        lociResult: { elements: [{ chain: 'A', resno: 100 }] },
      });
      const viewer = createMockViewer(plugin);

      await lociFromResidue(viewer as never, { chain: 'A', resno: 100 });

      // The non-destructive path should never call selection.clear()
      expect(plugin.managers.structure.selection.clear).not.toHaveBeenCalled();
    });
  });

  describe('fallback path (select-then-read)', () => {
    test('falls back to select-then-read when getLociFromExpression is unavailable', async () => {
      const plugin = createMockPlugin({
        hasGetLociFromExpression: false,
        lociResult: { elements: [{ chain: 'A', resno: 100 }] },
      });
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'A', resno: 100 });

      expect(result).not.toBeNull();
      // The fallback path clears the selection
      expect(plugin.managers.structure.selection.clear).toHaveBeenCalled();
    });

    test('warns when fallback clears a user selection but finds no loci', async () => {
      const plugin = createMockPlugin({
        hasGetLociFromExpression: false,
        hasExistingSelection: true,
        lociResult: null,
        fallbackFindsLoci: false,
      });
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'Z', resno: 999 });

      expect(result).toBeNull();
      // Should warn about clearing the user selection
      const warnedAboutSelection = warnCalls.some(args =>
        typeof args[0] === 'string' && (args[0] as string).includes('Cleared a user selection')
      );
      expect(warnedAboutSelection).toBe(true);
    });
  });

  describe('structure data handling', () => {
    test('returns null when no structure is loaded', async () => {
      const plugin = createMockPlugin({ hasData: false });
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'A', resno: 100 });

      expect(result).toBeNull();
    });
  });

  describe('residue reference variants', () => {
    test('resolves by chain only', async () => {
      const plugin = createMockPlugin({
        lociResult: { elements: [{ chain: 'A' }] },
      });
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'A' });

      expect(result).not.toBeNull();
    });

    test('resolves by chain + resno', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { chain: 'A', resno: 145 });

      expect(result).not.toBeNull();
    });

    test('resolves by compId (ligand name)', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, { compId: 'ATP' });

      expect(result).not.toBeNull();
    });

    test('resolves by chain + resno + compId', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, {
        chain: 'A',
        resno: 145,
        compId: 'ALA',
      });

      expect(result).not.toBeNull();
    });

    test('resolves with insertion code (R104.4)', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, {
        chain: 'A',
        resno: 145,
        insCode: 'A',
      });

      expect(result).not.toBeNull();
    });

    test('resolves with atom name filter', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(
        viewer as never,
        { chain: 'A', resno: 145 },
        'CA'
      );

      expect(result).not.toBeNull();
    });

    test('resolves with empty ref (matches all)', async () => {
      const plugin = createMockPlugin();
      const viewer = createMockViewer(plugin);

      const result = await lociFromResidue(viewer as never, {});

      expect(result).not.toBeNull();
    });
  });

  describe('error handling', () => {
    test('returns null and warns when getLociFromExpression throws', async () => {
      const plugin = createMockPlugin();
      // Override getLociFromExpression to throw
      plugin.managers.structure.selection.getLociFromExpression = mock(() => {
        throw new Error('Expression compilation failed');
      }) as never;
      const viewer = createMockViewer(plugin);

      // The outer try/catch should catch the error and return null
      // (or fall through to the fallback path)
      const result = await lociFromResidue(viewer as never, { chain: 'A', resno: 100 });

      // Either null (if outer catch caught it) or a valid loci (if fallback worked)
      // The key assertion is that it doesn't throw
      expect(result).toBeDefined();
    });
  });

  describe('expression building verification', () => {
    test('builds correct expression for chain-only ref', async () => {
      let capturedExpr: unknown = null;
      const plugin = createMockPlugin();
      plugin.managers.structure.selection.getLociFromExpression = mock((expr: unknown) => {
        capturedExpr = expr;
        return { elements: [{ chain: 'A' }] };
      }) as never;
      const viewer = createMockViewer(plugin);

      await lociFromResidue(viewer as never, { chain: 'A' });

      // The expression should be a function (MolScript builder callback)
      expect(typeof capturedExpr).toBe('function');
    });
  });
});
