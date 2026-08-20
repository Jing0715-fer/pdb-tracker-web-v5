/**
 * Unit tests for normalizeColorTheme
 *
 * Tests the color theme normalization function that maps LLM-friendly
 * color theme names to Molstar's actual built-in color theme names.
 *
 * Run with: bun test src/lib/molcraft/commands/color-theme.test.ts
 */

import { test, expect, describe } from 'bun:test';
import { normalizeColorTheme, hexToNumber, categoryLabel } from './color-theme';

describe('normalizeColorTheme', () => {
  describe('canonical Molstar theme names (should pass through unchanged)', () => {
    const canonicalThemes = [
      'uniform', 'chain-id', 'entity-id', 'entity-source', 'model-index',
      'structure-index', 'residue-name', 'element-symbol', 'element-index',
      'sequence-id', 'hydrophobicity', 'occupancy', 'uncertainty',
      'polymer-id', 'polymer-index', 'operator-hkl', 'operator-name',
      'partial-charge', 'formal-charge', 'residue-charge',
      'secondary-structure', 'molecule-type', 'carbohydrate-symbol',
      'cartoon', 'illustrative', 'shape-group', 'trajectory-index',
      'unit-index', 'volume-value', 'volume-segment', 'volume-instance',
      'external-structure', 'external-volume', 'atom-id',
    ];

    for (const theme of canonicalThemes) {
      test(`canonical "${theme}" → "${theme}"`, () => {
        expect(normalizeColorTheme(theme)).toBe(theme);
      });
    }
  });

  describe('LLM-friendly aliases (should map to canonical names)', () => {
    const aliases: Array<[string, string]> = [
      // Chain aliases
      ['chain', 'chain-id'],
      ['chainid', 'chain-id'],
      ['by-chain', 'chain-id'],
      ['bychain', 'chain-id'],
      ['colorbychain', 'chain-id'],
      // Element aliases
      ['element', 'element-symbol'],
      ['by-element', 'element-symbol'],
      ['byelement', 'element-symbol'],
      ['colorbyelement', 'element-symbol'],
      // Residue aliases
      ['residue', 'residue-name'],
      ['by-residue', 'residue-name'],
      ['byresidue', 'residue-name'],
      ['amino-acid', 'residue-name'],
      ['aminoacid', 'residue-name'],
      // Sequence aliases
      ['sequence', 'sequence-id'],
      ['by-sequence', 'sequence-id'],
      ['bysequence', 'sequence-id'],
      ['seq', 'sequence-id'],
      ['seqid', 'sequence-id'],
      // Hydrophobicity aliases
      ['hydrophobic', 'hydrophobicity'],
      ['by-hydrophobicity', 'hydrophobicity'],
      // Entity/Model/Structure/Polymer aliases
      ['entity', 'entity-id'],
      ['model', 'model-index'],
      ['structure', 'structure-index'],
      ['polymer', 'polymer-index'],
      // B-factor aliases (R137 fix: maps to uncertainty, NOT bfactor)
      ['bfactor', 'uncertainty'],
      ['b-factor', 'uncertainty'],
      ['bfact', 'uncertainty'],
      ['temperature', 'uncertainty'],
      // Secondary structure aliases (R137 fix: now recognized)
      ['secondary', 'secondary-structure'],
      ['ss', 'secondary-structure'],
      ['secstruc', 'secondary-structure'],
      ['helix-sheet', 'secondary-structure'],
      // Charge aliases (R137 fix: now recognized)
      ['charge', 'partial-charge'],
      ['partial', 'partial-charge'],
      ['electrostatic', 'partial-charge'],
      ['formal', 'formal-charge'],
      // Molecule aliases
      ['molecule', 'molecule-type'],
      ['mol-type', 'molecule-type'],
    ];

    for (const [alias, expected] of aliases) {
      test(`alias "${alias}" → "${expected}"`, () => {
        expect(normalizeColorTheme(alias)).toBe(expected);
      });
    }
  });

  describe('case and separator normalization', () => {
    test('uppercase is normalized', () => {
      expect(normalizeColorTheme('CHAIN-ID')).toBe('chain-id');
      expect(normalizeColorTheme('ChainId')).toBe('chain-id');
      expect(normalizeColorTheme('ELEMENT_SYMBOL')).toBe('element-symbol');
    });

    test('spaces are normalized to hyphens', () => {
      expect(normalizeColorTheme('chain id')).toBe('chain-id');
      expect(normalizeColorTheme('element symbol')).toBe('element-symbol');
    });

    test('underscores are normalized to hyphens', () => {
      expect(normalizeColorTheme('chain_id')).toBe('chain-id');
      expect(normalizeColorTheme('secondary_structure')).toBe('secondary-structure');
    });

    test('mixed separators are normalized', () => {
      expect(normalizeColorTheme('chain id')).toBe('chain-id');
      expect(normalizeColorTheme('chain_id')).toBe('chain-id');
      expect(normalizeColorTheme('chain  id')).toBe('chain-id');
    });

    test('whitespace is trimmed', () => {
      expect(normalizeColorTheme('  chain-id  ')).toBe('chain-id');
      expect(normalizeColorTheme('\tchain-id\n')).toBe('chain-id');
    });
  });

  describe('invalid inputs (should return null)', () => {
    test('undefined returns null', () => {
      expect(normalizeColorTheme(undefined)).toBeNull();
    });

    test('empty string returns null', () => {
      expect(normalizeColorTheme('')).toBeNull();
    });

    test('unknown theme returns null', () => {
      expect(normalizeColorTheme('nonexistent-theme')).toBeNull();
      expect(normalizeColorTheme('rainbow')).toBeNull();
      expect(normalizeColorTheme('temperature-factor')).toBeNull();
    });

    test('non-string returns null', () => {
      expect(normalizeColorTheme(null as unknown as string)).toBeNull();
      expect(normalizeColorTheme(123 as unknown as string)).toBeNull();
      expect(normalizeColorTheme({} as unknown as string)).toBeNull();
    });
  });

  describe('R137 regression tests', () => {
    test('BFIX: "bfactor" must NOT map to "bfactor" (invalid Molstar theme)', () => {
      // R137: Previously "bfactor" mapped to itself, which is invalid.
      // It must now map to "uncertainty" (Molstar's B-factor color theme).
      const result = normalizeColorTheme('bfactor');
      expect(result).not.toBe('bfactor');
      expect(result).toBe('uncertainty');
    });

    test('FIX: "partial-charge" must be recognized as canonical', () => {
      // R137: Previously missing from CANONICAL set, causing silent no-ops
      expect(normalizeColorTheme('partial-charge')).toBe('partial-charge');
    });

    test('FIX: "secondary-structure" must be recognized as canonical', () => {
      // R137: Previously missing from CANONICAL set, causing silent no-ops
      expect(normalizeColorTheme('secondary-structure')).toBe('secondary-structure');
    });

    test('FIX: "formal-charge" must be recognized as canonical', () => {
      expect(normalizeColorTheme('formal-charge')).toBe('formal-charge');
    });

    test('FIX: "molecule-type" must be recognized as canonical', () => {
      expect(normalizeColorTheme('molecule-type')).toBe('molecule-type');
    });
  });
});

describe('hexToNumber', () => {
  test('converts #rrggbb to number', () => {
    expect(hexToNumber('#ff0000')).toBe(0xff0000);
    expect(hexToNumber('#00ff00')).toBe(0x00ff00);
    expect(hexToNumber('#0000ff')).toBe(0x0000ff);
  });

  test('converts rrggbb without # prefix', () => {
    expect(hexToNumber('ff0000')).toBe(0xff0000);
    expect(hexToNumber('ffffff')).toBe(0xffffff);
  });

  test('handles mixed case', () => {
    expect(hexToNumber('#FFaA00')).toBe(0xffaa00);
    expect(hexToNumber('FfFfFf')).toBe(0xffffff);
  });
});

describe('categoryLabel', () => {
  test('returns Chinese labels for known categories', () => {
    expect(categoryLabel('hydrophobic')).toBe('疏水');
    expect(categoryLabel('polar')).toBe('极性');
    expect(categoryLabel('positive')).toBe('正电');
    expect(categoryLabel('negative')).toBe('负电');
    expect(categoryLabel('glycine')).toBe('甘氨酸');
  });

  test('returns "其他" for unknown categories', () => {
    expect(categoryLabel('unknown')).toBe('其他');
    expect(categoryLabel('')).toBe('其他');
    expect(categoryLabel('aromatic')).toBe('其他');
  });
});
