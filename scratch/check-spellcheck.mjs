import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to application root...");
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");

  console.log("Waiting for window.useApp to be hydrated...");
  await page.waitForFunction(() => typeof window.useApp !== 'undefined', { timeout: 20000 });

  console.log("Authenticating and switching view to Resume Builder...");
  await page.evaluate(() => {
    window.useApp.setState({
      isAuthed: true,
      user: { id: "test-user", name: "Test User", email: "test@example.com", role: "admin", status: "approved" },
      view: "builder"
    });
  });

  await page.waitForTimeout(3000);
  await page.screenshot({ path: "scratch/step_0_app_view.png" });

  console.log("Locating and clicking the Spelling action trigger...");
  const spellingBtn = page.locator('button:has-text("Spelling")').first();
  await spellingBtn.click();

  console.log("Waiting for SpellCheck panel to animate open...");
  await page.waitForTimeout(2000);

  console.log("Capturing full-page layout screenshot...");
  await page.screenshot({ path: "scratch/spellcheck-layout-resolved.png", fullPage: true });

  await browser.close();
  console.log("Layout screenshot captured successfully at scratch/spellcheck-layout-resolved.png!");
}

main().catch(console.error);
