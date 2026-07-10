import { test, expect } from '@playwright/test';

const FAKE_USER = { id: 1, email: 'qa@example.com', role: 'admin' as const };
const GROUP = {
  id: 99, name: 'bilibili-测试账号组', valid: true,
  authorizations: [{ id: 7, platform: 'bilibili', cookie_file: '/cookies/bilibili-test.json', valid: true, created: '2025-01-01T00:00:00Z' }],
  created: '2025-01-01T00:00:00Z',
};

test('DEBUG: opt-3g step-by-step inspection', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  const MOCKED = ['/api/auth/me', '/api/account-groups', '/api/tasks', '/api/accounts'];

  await page.route((url: URL) => url.pathname === '/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { user: FAKE_USER } }) }));
  await page.route((url: URL) => url.pathname === '/api/account-groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [GROUP] }) }));
  await page.route((url: URL) => url.pathname === '/api/tasks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));
  await page.route((url: URL) => url.pathname === '/api/accounts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));
  await page.route((url: URL) => url.pathname.startsWith('/api/') && !MOCKED.includes(url.pathname), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }) }));

  await page.goto('http://localhost:5180/dashboard/publish', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(4000);

  console.log('=== ERRORS:', JSON.stringify([...new Set(errors)]));

  // Step 1: What's on the page initially?
  const comboboxCount = await page.getByRole('combobox').count();
  console.log('=== COMBODOX COUNT:', comboboxCount);

  const allButtons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => ({
      aria: b.getAttribute('aria-label'), text: b.textContent?.trim()?.substring(0, 50),
      testid: b.getAttribute('data-testid'),
    })).filter(x => x.aria || x.text).slice(0, 25)
  );
  console.log('=== BUTTONS:', JSON.stringify(allButtons, null, 2));

  const allLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label')).map(l => ({
      for: l.getAttribute('for'), text: l.textContent?.trim()?.substring(0, 50),
    })).slice(0, 15)
  );
  console.log('=== LABELS:', JSON.stringify(allLabels, null, 2));

  // Step 2: Click combobox and look at options
  if (comboboxCount > 0) {
    await page.getByRole('combobox').first().click();
    await page.waitForTimeout(500);

    const optionTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="option"]')).map(o => o.textContent?.trim())
    );
    console.log('=== OPTIONS:', JSON.stringify(optionTexts));

    // Step 3: Select bilibili group
    const bilibiliOpt = page.getByRole('option', { name: /bilibili-测试账号组/ });
    const optCount = await bilibiliOpt.count();
    console.log('=== BILIBILI OPTION EXISTS:', optCount > 0);

    if (optCount > 0) {
      await bilibiliOpt.click();
      await page.waitForTimeout(500);

      // Step 4: Look for auth rows
      const authRowTexts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.auth-row')).map(r => ({
          text: r.textContent?.trim()?.substring(0, 120),
          hasBilibili: r.textContent?.includes('Bilibili'),
        }))
      );
      console.log('=== AUTH ROWS:', JSON.stringify(authRowTexts, null, 2));

      // Step 5: Click bilibili row
      const bilibiliRow = page.locator('.auth-row', { has: page.locator('text=Bilibili') });
      const rowCount = await bilibiliRow.count();
      console.log('=== BILIBILI AUTH ROW COUNT:', rowCount);

      if (rowCount > 0) {
        await bilibiliRow.first().click();
        await page.waitForTimeout(500);

        // Step 6: Check for chip
        const chip = page.getByTestId('pending-platform-configs-chip');
        const chipCount = await chip.count();
        const chipVisible = await chip.isVisible().catch(() => false);
        console.log('=== CHIP:', { count: chipCount, visible: chipVisible });
        
        if (chipCount > 0) {
          const chipText = await chip.textContent();
          console.log('=== CHIP TEXT:', chipText);
        }

        // List ALL data-testids on page
        const allTestids = await page.evaluate(() =>
          [...new Set(Array.from(document.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')))]
        );
        console.log('=== ALL TESTIDS:', JSON.stringify(allTestids));

        // Show all interactive elements after chip click
        const afterButtons = await page.evaluate(() =>
          Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
            aria: b.getAttribute('aria-label'),
            text: b.textContent?.trim()?.substring(0, 50),
            testid: b.getAttribute('data-testid'),
          })).filter(x => x.aria || x.text).slice(0, 30)
        );
        console.log('=== AFTER BUTTONS:', JSON.stringify(afterButtons, null, 2));
      }
    }
  }

  await page.screenshot({ path: '/Users/a123/Notes/02-project/projecke/github/social-auto-upload/tests/e2e/debug-opt3g.png', fullPage: true });
});
