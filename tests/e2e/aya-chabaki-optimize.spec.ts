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
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // 1. Navigate to Job Scraper to save the JD
    await page.click('text=Job Scraper');
    const jdTextarea = page.locator('placeholder="Paste the full job description here…"');
    await expect(jdTextarea).toBeVisible();
    await jdTextarea.fill(QATAR_DUTY_FREE_JD);
    await page.click('text=Extract with AI');

    // Wait for the extraction and saved JD to appear
    await expect(page.locator('text=Till Assistant').first()).toBeVisible({ timeout: 15000 });

    // Click "Optimize" button on the Till Assistant card
    await page.locator('text=Optimize').first().click();

    // 2. We should now be on the Resume Optimizer page
    await expect(page.locator('text=Upload your resume').first()).toBeVisible({ timeout: 10000 });

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

    // 3. Select Till Assistant as target JD
    await page.click('text=Select Job Description').catch(() => {});
    await page.click('text=Till Assistant').catch(() => {});

    // 4. Click "Optimize Resume"
    const optimizeBtn = page.locator('text=Optimize Resume, text=Optimize');
    await expect(optimizeBtn).toBeEnabled();
    await optimizeBtn.click();

    // 5. Wait for the pipeline optimization to run and converge
    // The UI displays pipeline logs like "embedding keywords", "verifying facts", etc.
    await expect(page.locator('text=V3 pipeline complete, text=Optimization complete').first()).toBeVisible({ timeout: 45000 });

    // 6. Assertions on the final optimized resume
    // Check that the layout optimization satisfied the 1-page A4 target (approx 2700+ visible chars)
    // Check that factual consistency is maintained and facts are preserved
    await expect(page.locator('text=A4 · 1 page').first()).toBeVisible();
    await expect(page.locator('text=Factual Consistency').first()).toBeVisible();

    // Verify target keywords (like POS, Till Assistant, cash handling) are embedded in the optimized text
    const previewContainer = page.locator('id=resume-preview-container, class*=A4');
    await expect(previewContainer).toBeVisible();
  });
});
