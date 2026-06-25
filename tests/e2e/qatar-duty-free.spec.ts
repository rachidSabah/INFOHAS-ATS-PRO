import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://resumeai-pro.pages.dev";

const QATAR_DUTY_FREE_JD = `Till Assistant | Qatar Duty Free
General Information
Ref #  2600005S
Location  Qatar-Doha
Job family  Customer Service
Closing Date: 2026-07-31
Description
Calling all ambitious Retail professionals to join our Qatar Duty Free team and start writing your own story with Qatar Airways Group.

Qatar Duty Free Company – A world of exclusives awaits you at one of the largest duty-free areas in the world, Qatar Duty Free. The award-winning shopping emporium boasts of more than 90 elegant boutiques and affordable retail stores, as well as more than 30 restaurants and cafés covering over 40,000 square meters at the world's best airport, Hamad International Airport.

As a Till Assistant you will be undertake all cash desk sales activities in the shop and provide the best possible customer service in order to maximize sales opportunities within Qatar Duty Free Company retail shops

 

Responsibilities

Ensure the float is correct and that all keyed information into the POS terminal is done so accurately.
Process customer’s transactions efficiently using the QDFC shop's Point of Sale (POS) system and must present the receipts at all times to the customer.
Handling money/Traveler’s Cheques/Credit cards and any form of payment in a safe, secure and responsible manner.
Ensure cash and documentation is secure at all times.
Responsible for the cash variances at the end of the shift.
Perform other department duties related to his/her position as directed by the Head of the Department
Providing the highest levels of customer service to both customers of QDFC/QR group and passengers travelling through DIA, ensuring both customers and passengers leave the Duty Free shop feeling that they have been treated in a friendly and courteous manner.
Ensure that any customer complaints or problems are dealt with properly as they arise
Process customer’s transactions efficiently, ensuring minimum time spent processing and packing.
Ensure the highest level of confidentiality with regards to all company documentation, information and statistics.
Ensure that Supervisor /Duty Manager are notified of any breach of security.
Ensure that a high degree of security on stocks and cash prevails at all times.
Ensure that you are aware of the “HOT SPOT or Theft prone areas”.

Be part of an extraordinary story 
Your skills. Your imagination. Your ambition. Here, there are no boundaries to your potential and the impact you can make. You’ll find infinite opportunities to grow and work on the biggest, most rewarding challenges that will build your skills and experience. You have the chance to be a part of our future, and build the life you want while being part of an international community.

Our best is here and still to come. To us, impossible is only a challenge. Join us as we dare to achieve what’s never been done before.

Together, everything is possible.

Qualification
About you

The successful candidate will have the following qualifications and skills:

Basic Literacy and Numeracy skills, English communication skills with Entry level roles - no prior job-related work experience

Preferred

Previous Retails and or Customer Service experience

Job Specific Skills:

Command of English language
Basic PC skills
Good interpersonal/customer service skills.
Basic product knowledge.
Be pleasant and approachable
About Qatar Airways Group
Our story started with four aircraft. Today, we deliver excellence across 12 different businesses coming together as one. We’ve grown fast, broken records and set trends that others follow. We don’t slow down by the fear of failure. Instead, we dare to achieve what’s never been done before. So, whether you’re creating a unique experience for our customers or innovating behind the scenes, every person contributes to our proud story. A story of spectacular growth and determination.

Now is the time to bring your best ideas and passion to a place where your ambition will know no boundaries, and be part of a truly global community.`;

test.describe("Qatar Duty Free JD parsing", () => {
  test("successfully navigates to Job Scraper and extracts the pasted JD", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Navigate to Job Scraper tab
    await page.click('text=Job Scraper');
    
    // Fill the text paste area with the Qatar Duty Free JD
    const textarea = page.locator('placeholder="Paste the full job description here…"');
    await expect(textarea).toBeVisible();
    await textarea.fill(QATAR_DUTY_FREE_JD);

    // Click on "Extract with AI"
    const extractButton = page.locator('text=Extract with AI');
    await expect(extractButton).toBeEnabled();
    await extractButton.click();

    // Check for success log/toast or new entry in "Saved job descriptions" list
    // The list should show "Till Assistant" and "Qatar Duty Free"
    await expect(page.locator('text=Saved job descriptions').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Till Assistant').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Qatar Duty Free').first()).toBeVisible({ timeout: 15000 });
  });
});
