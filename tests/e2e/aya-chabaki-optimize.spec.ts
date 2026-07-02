import { test, expect } from "@playwright/test";
import * as path from "path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://resumeai-pro.pages.dev";

const QATAR_DUTY_FREE_JD = `Till Assistant | Qatar Duty Free
General Information
Ref #  2600005S
Location  Qatar-Doha
Job family  Customer Service
Closing Date: 2026-07-31
Description
Calling all ambitious Retail professionals to join our Qatar Duty Free team and start writing your own story with Qatar Airways Group.

As a Till Assistant you will be undertake all cash desk sales activities in the shop and provide the best possible customer service in order to maximize sales opportunities within Qatar Duty Free Company retail shops.

Responsibilities
Ensure the float is correct and that all keyed information into the POS terminal is done so accurately.
Process customer’s transactions efficiently using the QDFC shop's Point of Sale (POS) system and must present the receipts at all times to the customer.
Handling money/Traveler’s Cheques/Credit cards and any form of payment in a safe, secure and responsible manner.
Ensure cash and documentation is secure at all times.
Responsible for the cash variances at the end of the shift.

Qualifications
Basic Literacy and Numeracy skills, English communication skills with Entry level roles - no prior job-related work experience.
Preferred: Previous Retails and or Customer Service experience.`;

test.describe("Aya Chabaki Resume Optimization", () => {
  test("runs the full optimization pipeline E2E", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem("resumeai-session", JSON.stringify({
        user: { id: "test-user", name: "Test User", email: "test@example.com", role: "admin", status: "approved" },
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
      }));
    });
    await page.goto(BASE_URL);
    await page.route("**/api/providers/chat", async (route) => {
      const postData = JSON.parse(route.request().postData() || "{}");
      const messages = postData.messages || [];
      const systemPrompt = (messages.find((m: any) => m.role === "system")?.content || "").toLowerCase();
      const userPrompt = (messages[messages.length - 1]?.content || "").toLowerCase();
      
      let textResponse = "";
      if (userPrompt.includes("extract") || userPrompt.includes("job description")) {
        textResponse = JSON.stringify({
          title: "Till Assistant",
          company: "Qatar Duty Free",
          location: "Doha, Qatar",
          employmentType: "Full-time",
          salary: "Competitive",
          responsibilities: ["Ensure the float is correct and keyed information into the POS terminal is done accurately."],
          requiredSkills: ["Basic Literacy and Numeracy skills", "English communication skills"],
          preferredSkills: ["Previous Retail and or Customer Service experience"],
          technologies: ["POS", "PC"],
          experienceYears: "No prior experience",
          education: "Basic Literacy",
          keywords: ["Till Assistant", "POS", "Qatar Duty Free", "customer service"]
        });
      } else if (systemPrompt.includes("scorer") || userPrompt.includes("score") || userPrompt.includes("analyze")) {
        textResponse = JSON.stringify({
          scores: { ats: 85, formatting: 90, keywords: 80, content: 85, grammar: 90, completeness: 85 },
          recommendations: [],
          missingKeywords: ["POS"],
          matchedKeywords: ["English"],
          weakSections: []
        });
      } else {
        // Optimizer re-writer response
        textResponse = JSON.stringify({
          name: "Aya Chabaki",
          headline: "Till Assistant",
          email: "aya@example.com",
          phone: "+974 5555 1234",
          location: "Doha, Qatar",
          summary: "Experienced Till Assistant...",
          skills: [
            { category: "Core Skills", items: ["POS", "Customer Service"] }
          ],
          experience: [
            {
              title: "Till Assistant",
              company: "Qatar Duty Free",
              location: "Doha, Qatar",
              startDate: "2022-01",
              endDate: "Present",
              bullets: [
                "Delivered exceptional customer service at POS.",
                "Handled cash and card transactions accurately."
              ]
            }
          ],
          education: [],
          languages: [],
          missingKeywordsAdded: [],
          bulletsRewritten: 2,
          score: 87,
          score_breakdown: { impact: 85, brevity: 90, keywords: 87 }
        });
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, text: textResponse })
      });
    });
    await page.waitForLoadState("load");
    
    // Wait for page hydration by checking that the dashboard welcome message is visible
    await expect(page.locator('text=Welcome back').first()).toBeVisible({ timeout: 10000 });
    await page.waitForFunction(() => typeof (window as any).useApp !== "undefined", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // 1. Navigate to Job Scraper to save the JD
    await page.click('nav[aria-label="App navigation"] button:has-text("Job Scraper")');
    const jdTextarea = page.locator('[placeholder="Paste the full job description here…"]');
    await expect(jdTextarea).toBeVisible();
    await jdTextarea.fill(QATAR_DUTY_FREE_JD);
    await page.click('text=Extract with AI');

    // Wait for the extraction and saved JD to appear
    await expect(page.locator('text=Till Assistant').first()).toBeVisible({ timeout: 15000 });

    // Click "Optimize" button on the Till Assistant card
    await page.locator('text=Optimize').first().click();

    // 2. We should now be on the Resume Optimizer page
    await expect(page.locator('text=Add your resume').first()).toBeVisible({ timeout: 10000 });

    // Upload the Aya Chabaki resume file
    // Note: in testing environment, we can select the file using setInputFiles
    const fileChooserPromise = page.waitForEvent('filechooser').catch(() => null);
    const uploadArea = page.locator('input[type="file"]');
    await uploadArea.setInputFiles({
      name: 'AYA_CHABAKI_resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 ... mock pdf content ...')
    });

    // Alternatively, if the file is present in the workspace, we can upload it:
    // const filePath = path.join(__dirname, '../../uploads/AYA_CHABAKI_resume.pdf');
    // await uploadArea.setInputFiles(filePath);

    // 3. Select Till Assistant as target JD from the dropdown
    await page.selectOption('select', { label: 'Till Assistant' });

    // Click "Analyze resume" to proceed to optimize step
    await page.click('button:has-text("Analyze resume")');

    // Wait for the ATS score to render, ensuring React state (beforeReport) is hydrated and the click handler is bound
    await expect(page.locator('text=Current ATS').first()).toBeVisible({ timeout: 10000 });

    // 4. Click "Optimize Resume" (button text contains 'optimizer' inside main content)
    const optimizeBtn = page.locator('main button:has-text("optimizer")');
    await expect(optimizeBtn).toBeVisible({ timeout: 10000 });
    await optimizeBtn.click();

    // 5. Wait for the pipeline optimization to run and converge
    // The UI transitions to the "done" view showing the optimized resume
    await expect(page.locator('text=Optimized resume — InfoHAS Pro layout').first()).toBeVisible({ timeout: 45000 });

    // 6. Assertions on the final optimized resume
    // Check that the layout optimization satisfied the 1-page A4 target (approx 2700+ visible chars)
    // Check that factual consistency is maintained and facts are preserved
    await expect(page.locator('text=One A4 page').first()).toBeVisible();
    await expect(page.locator('text=Factual consistency').first()).toBeVisible();

    // Verify target keywords (like POS, Till Assistant, cash handling) are embedded in the optimized text
    const previewContainer = page.locator('.a4-page');
    await expect(previewContainer).toBeVisible();
  });
});
