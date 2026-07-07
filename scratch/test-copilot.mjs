import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message, err.stack));

  console.log("Navigating to application root...");
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");

  console.log("Waiting for window.useApp to be hydrated...");
  await page.waitForFunction(() => typeof window.useApp !== 'undefined', { timeout: 20000 });

  console.log("Authenticating and setting active resume...");
  await page.evaluate(() => {
    const blank = {
      id: "r_test",
      name: "Alex Morgan",
      headline: "Senior Software Engineer",
      contact: { email: "alex@example.com", phone: "+1-555-0199", location: "San Francisco, CA" },
      summary: "Experienced software engineer specializing in frontend engineering.",
      experience: [
        { id: "e_1", company: "Google", title: "Frontend Engineer", startDate: "2020-01", endDate: "2023-01", bullets: ["Led project X", "Optimized Y"] }
      ],
      education: [],
      skills: [{ id: "s_1", name: "React", category: "Libraries" }],
      projects: [],
      certifications: [],
      languages: [],
      template: "professional",
      accentColor: "#1154A3"
    };

    window.useApp.setState({
      isAuthed: true,
      user: { id: "test-user", name: "Test User", email: "test@example.com", role: "admin", status: "approved" },
      resumes: [blank],
      activeResumeId: "r_test",
      view: "builder"
    });
  });

  await page.waitForTimeout(3000);
  console.log("Taking initial screenshot (step_0_dashboard.png)...");
  await page.screenshot({ path: "scratch/step_0_dashboard.png" });

  console.log("Clicking AI Copilot tab...");
  const copilotBtn = page.locator('button:has-text("AI Copilot")').first();
  await copilotBtn.click();
  
  await page.waitForTimeout(2000);
  console.log("Taking screenshot after clicking AI Copilot (step_1_copilot_clicked.png)...");
  await page.screenshot({ path: "scratch/step_1_copilot_clicked.png", fullPage: true });

  await browser.close();
  console.log("Test finished successfully.");
}

main().catch(console.error);
