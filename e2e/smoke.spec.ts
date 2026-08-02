import { test, expect } from '@playwright/test';

test.describe('PDB Tracker v15 E2E smoke', () => {
  test('homepage loads and shows PDB Structure Tracker', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);

    await expect(page).toHaveTitle(/PDB Structure Tracker/);

    // Wait for client hydration: SSR shells are minimal, real content lands after
    // dynamic() boundary resolves. Give it a generous timeout.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  });

  test('API: db-config responds and reports confirmed DB', async ({ request }) => {
    const res = await request.get('/api/db-config');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('confirmed');
    expect(json).toHaveProperty('hasSchema');
    expect(json).toHaveProperty('tables');
    expect(Array.isArray(json.tables)).toBe(true);
  });

  test('API: llm/providers lists available CLI providers', async ({ request }) => {
    // WSL probe can take up to 45s on first launch. The test-level
    // timeout default is 30s, so bump both. Probe cache also has a 5min
    // TTL so subsequent runs are fast.
    test.setTimeout(75_000);
    const res = await request.get('/api/llm/providers', { timeout: 70_000 });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('available');
    expect(Array.isArray(json.available)).toBe(true);
    // We know Hermes CLI is installed locally
    const hermes = json.available.find((p: { provider: string }) => p.provider === 'cli:hermes');
    expect(hermes).toBeDefined();
    expect(hermes.available).toBe(true);
  });

  test('API: evaluations returns batch data', async ({ request }) => {
    const res = await request.get('/api/evaluations');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('batches');
    expect(Array.isArray(json.batches)).toBe(true);
  });

  test('API: snapshots returns array (possibly empty)', async ({ request }) => {
    const res = await request.get('/api/snapshots');
    expect(res.status()).toBe(200);
    const text = await res.text();
    // Empty array '[]' or '[{...}]'
    expect(text).toMatch(/^\[.*\]$/);
  });
});
