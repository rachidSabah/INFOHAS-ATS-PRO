const { chromium } = require("playwright");
const path = require("path");

async function runTest() {
  console.log("=== STARTING BROWSER E2E TEST ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Route console logs from browser to terminal
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" || text.toLowerCase().includes("fail") || text.toLowerCase().includes("error")) {
      console.log(`[BROWSER CONSOLE ERROR] [${msg.type()}] ${text}`);
    } else {
      console.log(`[BROWSER CONSOLE] [${msg.type()}] ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    console.error("[BROWSER UNCAUGHT EXCEPTION]", err.stack);
  });

  // Inject mock session with complete user fields to avoid TopBar crash
  await page.addInitScript(() => {
    localStorage.setItem(
      "resumeai-session",
      JSON.stringify({
        user: {
          id: "u_test",
          email: "test@example.com",
          name: "Test User",
          status: "approved",
          role: "user",
          provider: "local",
        },
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      })
    );
  });

  try {
    console.log("Navigating directly to http://localhost:3000 ...");
    await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 45000 });

    console.log("Page title:", await page.title());
    
    // Wait 12 seconds for hydration, provider synchronization, and potential Fast Refresh reload to settle
    console.log("Waiting for page to settle and stabilize...");
    await page.waitForTimeout(12000); 

    await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_0_dashboard.png" });

    // Navigate to Optimizer module if needed
    console.log("Checking if on Optimizer view...");
    const optimizerTab = page.locator('button:has-text("Optimizer"), a:has-text("Optimizer")').first();
    if (await optimizerTab.isVisible()) {
      console.log("Clicking Optimizer menu/tab...");
      await optimizerTab.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_0_optimizer_view.png" });
    }

    // Locate upload input and upload the resume with retry resilience
    console.log("Locating upload file input...");
    let fileInput = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        fileInput = page.locator('input[type="file"]').first();
        await fileInput.waitFor({ state: "attached", timeout: 8000 });
        console.log("File input located!");
        break;
      } catch (err) {
        console.warn(`File input not located on attempt ${attempt}. Waiting for page reload stabilization...`);
        await page.waitForTimeout(6000);
      }
    }

    const resumePath = "C:\\Users\\InGodWeTrust\\Downloads\\ZAKARIYA_NADIF_resume.pdf";
    console.log(`Uploading resume from: ${resumePath}`);
    await fileInput.setInputFiles(resumePath);

    // Wait for the parsing and transition to step 2 (JD input) dynamically
    console.log("Waiting dynamically for AI resume parsing and transition to Job Description step...");
    const jdHeader = page.locator('div:has-text("Target job description"), h3:has-text("Target job description")').first();
    await jdHeader.waitFor({ state: "visible", timeout: 60000 });
    console.log("Job Description step loaded successfully!");
    await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_1_upload_complete.png" });

    // Paste the Job Description text
    console.log("Switching to Paste Text tab for Job Description...");
    const pasteTab = page.locator('button:has-text("Paste Text")').last(); // Use .last() to get the Job Description tab
    await pasteTab.click();
    await page.waitForTimeout(2000);
    
    console.log("Entering Job Description...");
    const jdTextarea = page.locator('textarea[placeholder*="Paste the full job description"]').first();
    await jdTextarea.fill(
      "Looking for a Hospitality receptionist. Must have customer service skills, handle guest check-ins, reservations, and front desk operations. English, French, and Arabic are required."
    );
    await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_2_jd_entered.png" });

    console.log("Clicking 'Parse with AI'...");
    const parseJdButton = page.locator('button:has-text("Parse with AI")').first();
    await parseJdButton.click();

    console.log("Waiting dynamically for JD parsing and transition to Analyze step...");
    const analyzeHeader = page.locator('div:has-text("Extracted job description"), h3:has-text("Extracted job description")').first();
    await analyzeHeader.waitFor({ state: "visible", timeout: 60000 });
    console.log("Analyze step loaded successfully!");
    await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_3_jd_parsed.png" });

    console.log("Clicking 'Analyze resume'...");
    const analyzeButton = page.locator('button:has-text("Analyze resume")').first();
    await analyzeButton.click();

    console.log("Waiting dynamically for local analysis and transition to Optimize step...");
    const optimizeButton = page.locator('button:has-text("Run AI optimizer")').first();
    await optimizeButton.waitFor({ state: "visible", timeout: 15000 });
    console.log("Optimize step loaded successfully!");
    await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_4_analysis_complete.png" });

    console.log("Clicking 'Run AI optimizer'...");
    await optimizeButton.click();

    console.log("Waiting dynamically for AI Optimization to complete...");
    let success = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_5_optimizing_progress_${i}.png` });
      
      const finishedElement = page.locator('div:has-text("Optimization Complete")').first();
      const scoreElement = page.locator('div:has-text("ATS Match Score")').first();
      const exportButton = page.locator('button:has-text("Export")').first();
      
      if (await finishedElement.isVisible() || await scoreElement.isVisible() || await exportButton.isVisible()) {
        console.log("Optimization completed successfully!");
        success = true;
        break;
      }
      
      const errorElement = page.locator('div:has-text("Error")').first();
      if (await errorElement.isVisible()) {
        console.error("Optimization failed with error:", await errorElement.innerText());
        break;
      }
    }

    if (success) {
      console.log("Capturing final screenshot of completed dashboard...");
      await page.screenshot({ path: "C:\\Users\\InGodWeTrust\\.gemini\\antigravity-cli\\brain\\1cdbe9ce-407f-47ae-a23b-441695dd5013\\scratch\\step_6_final_result.png", fullPage: true });
    } else {
      console.warn("Optimization did not finish in time or failed.");
    }

  } catch (err) {
    console.error("Test encountered an exception:", err);
  } finally {
    console.log("Closing browser.");
    await browser.close();
    console.log("=== E2E TEST RUN COMPLETED ===");
  }
}

runTest();
