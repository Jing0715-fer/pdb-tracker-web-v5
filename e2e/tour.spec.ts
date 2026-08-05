import { test, expect } from '@playwright/test';

test.describe('Onboarding tour v15', () => {
  test.beforeEach(async ({ context }) => {
    // Ensure tour flag is reset so tour auto-starts on first visit.
    // Also force desktop viewport (tour autoStartDelay 1500ms only fires on
    // window.innerWidth >= 768 per useTour.ts).
    await context.addInitScript(() => {
      try { localStorage.removeItem('pdb-tracker:tour-completed'); } catch {}
      try { localStorage.removeItem('pdb-welcomed'); } catch {}
    });
  });

  test('tour auto-starts on first visit (desktop)', async ({ page }) => {
    const errors: string[] = [];
    const allConsole: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      allConsole.push(`${msg.type()}: ${msg.text()}`);
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Filter out known-noise HMR ws failures
      if (url.includes('webpack-hmr')) return;
      errors.push(`requestfailed: ${url} ${req.failure()?.errorText}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });

    // Dump all errors + last 10 console messages for debugging
    await page.waitForTimeout(3_000);
    if (errors.length > 0) {
      console.log('=== Page errors detected ===');
      errors.slice(0, 10).forEach((e) => console.log('  ' + e));
    }
    console.log('=== Last 10 console messages ===');
    allConsole.slice(-10).forEach((m) => console.log('  ' + m));
    console.log('=== Body innerText (first 500 chars) ===');
    const body = await page.evaluate(() => document.body.innerText);
    console.log('  ' + body.slice(0, 500).replace(/\n/g, ' | '));

    // Step 0 title is "欢迎使用 PDB Structure Tracker" per tour-overlay.tsx
    const welcomeTitle = page.locator('h3:has-text("欢迎使用 PDB Structure Tracker")');
    await expect(welcomeTitle).toBeVisible({ timeout: 5_000 });

    // Step 0 also has a "下一步" button
    const nextBtn = page.locator('button:has-text("下一步")');
    await expect(nextBtn).toBeVisible();

    // Click Next to advance to step 1 (模式切换)
    await nextBtn.click();
    await page.waitForTimeout(500);

    const modeTitle = page.locator('h3:has-text("模式切换")');
    await expect(modeTitle).toBeVisible({ timeout: 3_000 });

    // Click the skip button (aria-label="跳过引导") — may be hidden if tour is gone
    const skipBtn = page.locator('button[aria-label="跳过引导"]').first();
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }

    // Verify localStorage flag was set
    const completed = await page.evaluate(() => localStorage.getItem('pdb-tracker:tour-completed'));
    expect(completed).toBeTruthy();
  });

  test('help button re-triggers tour after completion', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Wait for hydration + auto-tour, then skip it
    await page.waitForTimeout(3_000);
    const skipBtn = page.locator('button[aria-label="跳过引导"]').first();
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }

    // Click the Help button (v15 changed aria-label to "帮助 · 重新查看引导")
    const helpBtn = page.locator('button[aria-label*="帮助"]');
    await expect(helpBtn).toBeVisible({ timeout: 5_000 });
    await helpBtn.click();

    // Tour should re-appear at step 0
    const welcomeTitle = page.locator('h3:has-text("欢迎使用 PDB Structure Tracker")');
    await expect(welcomeTitle).toBeVisible({ timeout: 3_000 });
  });
});
