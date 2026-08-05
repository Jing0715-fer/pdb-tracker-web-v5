import { test, expect } from '@playwright/test';

test('P00533 single-eval report: H2 styled, no junk cells, 8 H2 sections', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { localStorage.setItem('pdb-tracker:tour-completed', '1'); } catch {}
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Switch to Evaluation mode
  await page.getByRole('button', { name: /Evaluation|评估/ }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(6_000);

  // Scroll the eval list to find the P00533 row, then click it. The
  // eval list shows uniprot IDs in the left sidebar.
  const p00533Row = page.locator('aside, [class*="sidebar"], [class*="Sidebar"]')
    .locator('text=/^P00533$/').first();
  await p00533Row.scrollIntoViewIfNeeded();
  await p00533Row.click();
  await page.waitForTimeout(3_000);

  // Click the "View Report" button in the eval detail summary tab
  const viewBtn = page.getByRole('button', { name: /View Report/i }).first();
  await viewBtn.click();

  // Wait for modal
  const modal = page.locator('.markdown-content.report-markdown');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_500);

  // P00533 has 8 chapters: 执行摘要 + 1-7
  const h2s = await modal.locator('h2').count();
  const h2Texts = await modal.locator('h2').allInnerTexts();
  console.log(`  P00533 H2 count: ${h2s}, texts: ${JSON.stringify(h2Texts)}`);
  expect(h2s).toBe(8);

  // No junk cells
  const junkCells = await modal.locator('td').filter({ hasText: /^[-:…]+$/ }).count();
  console.log(`  junk cells: ${junkCells}`);
  expect(junkCells).toBe(0);

  // H1 must have been stripped (P00533 has none, so 0)
  const h1s = await modal.locator('h1').count();
  console.log(`  H1 count: ${h1s}`);
  expect(h1s).toBe(0);

  await page.screenshot({ path: 'e2e/screenshots/p00533-report-fixed.png', fullPage: true });
});

test('P07766 single-eval report: H2 styled, no junk cells, 4 H2 sections', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try { localStorage.setItem('pdb-tracker:tour-completed', '1'); } catch {}
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Evaluation|评估/ }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(6_000);

  const p07766Row = page.locator('aside, [class*="sidebar"], [class*="Sidebar"]')
    .locator('text=/^P07766$/').first();
  await p07766Row.scrollIntoViewIfNeeded();
  await p07766Row.click();
  await page.waitForTimeout(3_000);

  const viewBtn = page.getByRole('button', { name: /View Report/i }).first();
  await viewBtn.click();

  const modal = page.locator('.markdown-content.report-markdown');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_500);

  // P07766 has 4 H2 sections: 一/二/三/四
  const h2s = await modal.locator('h2').count();
  const h2Texts = await modal.locator('h2').allInnerTexts();
  console.log(`  P07766 H2 count: ${h2s}, texts: ${JSON.stringify(h2Texts)}`);
  expect(h2s).toBe(4);

  const junkCells = await modal.locator('td').filter({ hasText: /^[-:…]+$/ }).count();
  console.log(`  junk cells: ${junkCells}`);
  expect(junkCells).toBe(0);

  const h1s = await modal.locator('h1').count();
  console.log(`  H1 count: ${h1s}`);
  expect(h1s).toBe(0);

  await page.screenshot({ path: 'e2e/screenshots/p07766-report-fixed.png', fullPage: true });
});
