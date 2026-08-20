/**
 * Unit tests for vlm-capture-loop.ts
 *
 * Tests the VLM-controlled capture loop helper functions:
 *   - selectAnglesToRecapture (Plan C)
 *   - applyVlmHints (Plan D)
 *   - computeInterfaceAngles (Plan B)
 *
 * Run with: bun test src/lib/molcraft/vlm-capture-loop.test.ts
 */

import { test, expect, describe } from 'bun:test';
import {
  selectAnglesToRecapture,
  applyVlmHints,
  computeInterfaceAngles,
} from './vlm-capture-loop';
import type { VlmResult, ScreenshotData } from './vlm-client';

// ─── Test Data ───────────────────────────────────────────────────────────

const sampleScreenshots: ScreenshotData[] = [
  { dataUri: 'data:image/png;base64,aaa', angle: 'front', label: 'test - front' },
  { dataUri: 'data:image/png;base64,bbb', angle: 'side', label: 'test - side' },
  { dataUri: 'data:image/png;base64,ccc', angle: 'top', label: 'test - top' },
];

// ─── selectAnglesToRecapture ────────────────────────────────────────────

describe('selectAnglesToRecapture', () => {
  test('returns empty array when all scores are above threshold', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'good',
      scores: [8, 7, 9],
      quality: 'acceptable',
      issues: ['无问题', '无问题', '无问题'],
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    expect(result).toHaveLength(0);
  });

  test('returns only angles with scores below threshold', () => {
    const vlm: VlmResult = {
      bestIndex: 2,
      commentary: 'mixed',
      scores: [8, 3, 9],
      quality: 'degraded',
      issues: ['无问题', '侧链未显示', '无问题'],
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.angle).toBe('side');
    expect(result[0]!.index).toBe(1);
    expect(result[0]!.reason).toContain('score=3');
  });

  test('returns angles with issues even if score is above threshold', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'has issues',
      scores: [8, 7, 9],
      quality: 'degraded',
      issues: ['无问题', '黑屏', '无问题'],
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.angle).toBe('side');
  });

  test('returns all angles when all scores are below threshold', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'all bad',
      scores: [2, 3, 1],
      quality: 'unacceptable',
      issues: ['黑屏', '黑屏', '黑屏'],
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    expect(result).toHaveLength(3);
  });

  test('handles missing scores array', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'no scores',
      quality: 'degraded',
      issues: ['问题1', '无问题', '无问题'],
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    // All should be bad since scores default to 0
    expect(result).toHaveLength(3);
  });

  test('handles missing issues array', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'no issues',
      scores: [8, 3, 9],
      quality: 'degraded',
    };
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 5);
    expect(result).toHaveLength(1);
    expect(result[0]!.angle).toBe('side');
  });

  test('uses custom threshold', () => {
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'custom threshold',
      scores: [6, 7, 8],
      quality: 'acceptable',
      issues: ['无问题', '无问题', '无问题'],
    };
    // With threshold 7, score 6 is below threshold (6 < 7 = true)
    // score 7 is NOT below (7 < 7 = false), score 8 is not below
    const result = selectAnglesToRecapture(sampleScreenshots, vlm, 7);
    expect(result).toHaveLength(1);
    expect(result[0]!.angle).toBe('front');
  });
});

// ─── applyVlmHints ──────────────────────────────────────────────────────

describe('applyVlmHints', () => {
  test('applies zoom out hint', () => {
    const vizParams: Record<string, unknown> = { chain1: 'A' };
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'zoom out',
      quality: 'degraded',
      recaptureHints: { zoom: 'out' },
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result._zoomOut).toBe(true);
    expect(result._focusRadiusMultiplier).toBe(1.5);
    expect(result.chain1).toBe('A'); // original preserved
  });

  test('applies zoom in hint', () => {
    const vizParams: Record<string, unknown> = { chain1: 'A' };
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'zoom in',
      quality: 'degraded',
      recaptureHints: { zoom: 'in' },
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result._zoomIn).toBe(true);
    expect(result._focusRadiusMultiplier).toBe(0.7);
  });

  test('applies focus hint', () => {
    const vizParams: Record<string, unknown> = {};
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'focus interface',
      quality: 'degraded',
      recaptureHints: { focus: 'interface' },
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result._vlmFocusHint).toBe('interface');
  });

  test('applies suggested angles', () => {
    const vizParams: Record<string, unknown> = {};
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'try these angles',
      quality: 'degraded',
      recaptureHints: { angles: ['front', 'top'] },
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result._vlmSuggestedAngles).toEqual(['front', 'top']);
  });

  test('does not modify original vizParams', () => {
    const vizParams: Record<string, unknown> = { chain1: 'A' };
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'test',
      quality: 'degraded',
      recaptureHints: { zoom: 'out' },
    };
    applyVlmHints(vizParams, vlm);
    // Original should be unchanged
    expect(vizParams._zoomOut).toBeUndefined();
    expect(vizParams._focusRadiusMultiplier).toBeUndefined();
  });

  test('handles missing recaptureHints', () => {
    const vizParams: Record<string, unknown> = { chain1: 'A' };
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'no hints',
      quality: 'degraded',
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result.chain1).toBe('A');
    expect(result._zoomOut).toBeUndefined();
    expect(result._vlmFocusHint).toBeUndefined();
  });

  test('applies all hints together', () => {
    const vizParams: Record<string, unknown> = { chain1: 'A', chain2: 'B' };
    const vlm: VlmResult = {
      bestIndex: 0,
      commentary: 'all hints',
      quality: 'degraded',
      recaptureHints: {
        zoom: 'out',
        focus: 'ligand',
        angles: ['side', 'top'],
      },
    };
    const result = applyVlmHints(vizParams, vlm);
    expect(result._zoomOut).toBe(true);
    expect(result._focusRadiusMultiplier).toBe(1.5);
    expect(result._vlmFocusHint).toBe('ligand');
    expect(result._vlmSuggestedAngles).toEqual(['side', 'top']);
    expect(result.chain1).toBe('A');
    expect(result.chain2).toBe('B');
  });
});

// ─── computeInterfaceAngles ─────────────────────────────────────────────

describe('computeInterfaceAngles', () => {
  test('returns default angles when centers are null', () => {
    const result = computeInterfaceAngles(null, null);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });

  test('returns default angles when interface center is null', () => {
    const structureCenter = { x: 0, y: 0, z: 0 };
    const result = computeInterfaceAngles(null, structureCenter);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });

  test('returns default angles when structure center is null', () => {
    const interfaceCenter = { x: 10, y: 10, z: 10 };
    const result = computeInterfaceAngles(interfaceCenter, null);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });

  test('returns default angles when centers are identical (len < 0.1)', () => {
    const center = { x: 5, y: 5, z: 5 };
    const result = computeInterfaceAngles(center, center);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });

  test('returns default angles when centers are very close', () => {
    const interfaceCenter = { x: 5.01, y: 5, z: 5 };
    const structureCenter = { x: 5, y: 5, z: 5 };
    const result = computeInterfaceAngles(interfaceCenter, structureCenter);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });

  test('returns default angles even when normal is computable (R143 TODO)', () => {
    // R143: computeInterfaceAngles computes the normal but returns default
    // angles because applyCameraAngle only supports front/side/top/back
    const interfaceCenter = { x: 10, y: 0, z: 0 };
    const structureCenter = { x: 0, y: 0, z: 0 };
    const result = computeInterfaceAngles(interfaceCenter, structureCenter);
    expect(result).toHaveLength(3);
    expect(result.map(a => a.label)).toEqual(['front', 'side', 'top']);
  });
});
