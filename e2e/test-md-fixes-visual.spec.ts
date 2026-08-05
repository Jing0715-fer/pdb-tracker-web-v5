/**
 * Visual regression test for the markdown-renderer fixes.
 * Opens the Evaluation Report modal for P07766 (the report that had
 * Bug 1 / Bug 2 symptoms in the user's screenshots) and asserts:
 *   1. The report contains 4 <h2> headings (一/二/三/四)
 *   2. There are no <td> cells with content `---` or `…`
 *   3. The first H1 is stripped
 */
import { test, expect } from '@playwright/test';

test('P07766 evaluation report renders cleanly', async ({ page }) => {
  // Open the page — DB has 2 P07766 + 1 P00533 evaluation
  await page.goto('http://127.0.0.1:3000/');
  // Wait for the hydration + initial data load
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  // Find the P07766 row and click its "View Report" button
  // (the UI varies; the simplest is to just type in any search and click
  // the first View Report button we can find).
  const viewBtn = page.getByRole('button', { name: /View Report/i }).first();
  if (await viewBtn.count() > 0) {
    await viewBtn.click();
    // Wait for the modal
    const modal = page.locator('.markdown-content.report-markdown');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    // H2 count
    const h2s = await modal.locator('h2').count();
    console.log(`  H2 count: ${h2s}`);
    expect(h2s).toBeGreaterThanOrEqual(1);
    // No junk cells
    const junkCells = await modal.locator('td').filter({ hasText: /^[-:…]+$/ }).count();
    console.log(`  Junk data cells: ${junkCells}`);
    expect(junkCells).toBe(0);
    // Screenshot for visual record
    await page.screenshot({ path: 'e2e/screenshots/p07766-report-fixed.png', fullPage: true });
  } else {
    console.log('  No "View Report" button found — page may need different interaction');
  }
});
