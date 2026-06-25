# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\e2e\aya-chabaki-optimize.spec.ts >> Aya Chabaki Resume Optimization >> runs the full optimization pipeline E2E
- Location: tests\e2e\aya-chabaki-optimize.spec.ts:29:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('text=Job Scraper')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - link "ResumeAI Pro" [ref=e5] [cursor=pointer]:
          - /url: /
          - generic [ref=e8]:
            - generic [ref=e9]: ResumeAI
            - text: PRO
        - navigation "Main" [ref=e10]:
          - link "Features" [ref=e11] [cursor=pointer]:
            - /url: "#features"
          - link "ATS Checker" [ref=e12] [cursor=pointer]:
            - /url: "#ats-demo"
          - link "Templates" [ref=e13] [cursor=pointer]:
            - /url: "#templates"
          - link "Testimonials" [ref=e14] [cursor=pointer]:
            - /url: "#testimonials"
          - link "FAQ" [ref=e15] [cursor=pointer]:
            - /url: "#faq"
          - link "Blog" [ref=e16] [cursor=pointer]:
            - /url: "#blog"
        - generic [ref=e17]:
          - button "Sign in" [ref=e18]
          - button "Launch app" [ref=e19]:
            - img
            - text: Launch app
    - main [ref=e20]:
      - generic [ref=e24]:
        - generic [ref=e25]:
          - generic [ref=e30]: 100% free forever — no paywalls, no watermarks
          - heading "Beat the bots. Land the offer." [level=1] [ref=e31]:
            - text: Beat the bots.
            - text: Land the offer.
          - paragraph [ref=e32]: ResumeAI Pro is a premium, completely free AI resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform — engineered to outperform Enhancv, without the paywall.
          - generic [ref=e33]:
            - button "Get started — it's free" [ref=e34]:
              - img
              - text: Get started — it's free
            - link "Try the ATS checker" [ref=e35] [cursor=pointer]:
              - /url: "#ats-demo"
              - button "Try the ATS checker" [ref=e36]:
                - img
                - text: Try the ATS checker
          - generic [ref=e37]:
            - generic [ref=e38]:
              - generic [ref=e39]: 120,000+
              - generic [ref=e40]: Users
            - generic [ref=e41]:
              - generic [ref=e42]: 1.4M+
              - generic [ref=e43]: Resumes built
            - generic [ref=e44]:
              - generic [ref=e45]: +27 pts
              - generic [ref=e46]: Avg ATS lift
            - generic [ref=e47]:
              - generic [ref=e48]: $0
              - generic [ref=e49]: Cost
        - generic [ref=e53]:
          - generic [ref=e54]:
            - generic [ref=e55]:
              - generic [ref=e56]:
                - img [ref=e58]
                - generic [ref=e63]:
                  - generic [ref=e64]: ATS Score
                  - generic [ref=e65]: live analysis
              - generic [ref=e66]: +27 pts
            - generic [ref=e67]:
              - generic [ref=e68]:
                - generic [ref=e71]: ATS
                - generic [ref=e72]: "92"
              - generic [ref=e73]:
                - generic [ref=e76]: Format
                - generic [ref=e77]: "95"
              - generic [ref=e78]:
                - generic [ref=e81]: Keywords
                - generic [ref=e82]: "78"
              - generic [ref=e83]:
                - generic [ref=e86]: Content
                - generic [ref=e87]: "90"
              - generic [ref=e88]:
                - generic [ref=e91]: Grammar
                - generic [ref=e92]: "96"
          - generic [ref=e93]:
            - generic [ref=e94]:
              - img [ref=e95]
              - generic [ref=e98]: One-page A4
            - generic [ref=e125]:
              - img [ref=e126]
              - text: Fits one A4 page
          - generic [ref=e129]:
            - generic [ref=e130]:
              - img [ref=e131]
              - generic [ref=e134]: Interview prep
            - generic [ref=e135]:
              - generic [ref=e136]:
                - generic [ref=e137]: Technical
                - generic [ref=e138]: Q3 · medium
              - generic [ref=e139]:
                - generic [ref=e140]: Behavioral
                - generic [ref=e141]: Q1 · easy
              - generic [ref=e142]:
                - generic [ref=e143]: Company
                - generic [ref=e144]: Q5 · hard
      - generic [ref=e146]:
        - generic [ref=e147]:
          - generic [ref=e148]: Everything you need
          - heading "One platform. Every tool." [level=2] [ref=e149]
          - paragraph [ref=e150]: Stop stitching together free trials. ResumeAI Pro gives you the full premium suite — completely free, forever.
        - generic [ref=e151]:
          - generic [ref=e152]:
            - img [ref=e154]
            - heading "ATS Resume Checker" [level=3] [ref=e159]
            - paragraph [ref=e160]: Six-axis scoring — ATS, formatting, keywords, content, grammar, completeness. Detailed recommendations, missing keywords, weak sections, and concrete fixes.
          - generic [ref=e161]:
            - img [ref=e163]
            - heading "AI Resume Builder" [level=3] [ref=e166]
            - paragraph [ref=e167]: Seven ATS-tested templates. Live A4 preview. Strict one-page enforcement — we never let your resume spill to a second page.
          - generic [ref=e168]:
            - img [ref=e170]
            - heading "Resume Optimizer" [level=3] [ref=e173]
            - paragraph [ref=e174]: Upload your resume, paste a job description, and let the AI rewrite your bullets, embed missing keywords, and rebalance the layout — all on one page.
          - generic [ref=e175]:
            - img [ref=e177]
            - heading "Cover Letter Generator" [level=3] [ref=e180]
            - paragraph [ref=e181]: Modern, traditional, executive, and short email templates. AI-drafted, fully editable, exported to PDF / DOCX / TXT in one click.
          - generic [ref=e182]:
            - img [ref=e184]
            - heading "Job Description Scraper" [level=3] [ref=e187]
            - paragraph [ref=e188]: Drop in any URL — LinkedIn, Indeed, Glassdoor, or a company careers page — and we extract title, company, skills, requirements, keywords, and salary.
          - generic [ref=e189]:
            - img [ref=e191]
            - heading "Interview Prep" [level=3] [ref=e194]
            - paragraph [ref=e195]: Technical, behavioral, situational, HR, and company-specific questions — each with a recommended answer, STAR example, talking points, and follow-ups.
          - generic [ref=e196]:
            - img [ref=e198]
            - heading "Multi-AI Provider System" [level=3] [ref=e201]
            - paragraph [ref=e202]: Puter.js, OpenAI, Claude, Gemini, DeepSeek, Groq, Mistral, Cohere, Perplexity, OpenRouter, Together, HuggingFace, Ollama, Azure, Bedrock, custom — with automatic failover.
          - generic [ref=e203]:
            - img [ref=e205]
            - heading "RBAC + Admin Dashboards" [level=3] [ref=e208]
            - paragraph [ref=e209]: User, Admin, and Super Admin roles. Manage AI providers, prompts, branding, feature flags, audit logs — all from a premium control panel.
          - generic [ref=e210]:
            - img [ref=e212]
            - heading "PWA + Cloudflare-Ready" [level=3] [ref=e214]
            - paragraph [ref=e215]: Installable on desktop and mobile, offline-friendly, and pre-wired for Cloudflare Pages + Workers + D1 + R2 + KV + Queues.
      - generic [ref=e218]:
        - generic [ref=e219]:
          - generic [ref=e220]: Live ATS checker
          - heading "See your score jump in seconds." [level=2] [ref=e221]
          - paragraph [ref=e222]: A real resume scored against a real job description. Toggle the optimizer and watch the numbers climb.
        - generic [ref=e223]:
          - generic [ref=e224]:
            - generic [ref=e225]:
              - generic [ref=e226]:
                - generic [ref=e227]:
                  - img [ref=e228]
                  - generic [ref=e231]:
                    - generic [ref=e232]: "92"
                    - generic [ref=e233]: ATS Score
                - generic [ref=e234]: Excellent
                - generic [ref=e235]: Before
              - generic [ref=e236]:
                - generic [ref=e238]:
                  - generic [ref=e239]: Formatting
                  - generic [ref=e240]: "95"
                - generic [ref=e244]:
                  - generic [ref=e245]: Keywords
                  - generic [ref=e246]: "90"
                - generic [ref=e250]:
                  - generic [ref=e251]: Content
                  - generic [ref=e252]: "90"
                - generic [ref=e256]:
                  - generic [ref=e257]: Grammar
                  - generic [ref=e258]: "100"
                - generic [ref=e262]:
                  - generic [ref=e263]: Completeness
                  - generic [ref=e264]: "90"
            - generic [ref=e267]:
              - button "Run AI optimizer" [ref=e268]:
                - img
                - text: Run AI optimizer
              - button "Try with my resume" [ref=e269]:
                - img
                - text: Try with my resume
          - generic [ref=e271]:
            - generic [ref=e272]:
              - img [ref=e273]
              - generic [ref=e275]:
                - generic [ref=e276]: 1 missing keywords from the job description
                - generic [ref=e277]: "Your resume doesn't mention: Mentor. ATS systems weight keyword density heavily."
                - generic [ref=e278]: "Fix: Weave these keywords naturally into your bullets and skills — never list them blankly."
            - generic [ref=e279]:
              - img [ref=e280]
              - generic [ref=e282]:
                - generic [ref=e283]: Standardize phone format
                - generic [ref=e284]: Parentheses can confuse some ATS parsers.
                - generic [ref=e285]: "Fix: Use +1-415-555-0182 format."
            - generic [ref=e286]:
              - img [ref=e287]
              - generic [ref=e290]:
                - generic [ref=e291]: Strong quantified achievements
                - generic [ref=e292]: 5 bullets have measurable outcomes — recruiters love this.
      - generic [ref=e294]:
        - generic [ref=e295]:
          - generic [ref=e296]: Resume templates
          - heading "ATS-tested templates, built to fit." [level=2] [ref=e297]
          - paragraph [ref=e298]: Every template fits on exactly one A4 page — no exceptions. Pick a look, we'll handle the layout.
        - generic [ref=e299]:
          - generic [ref=e300]:
            - generic [ref=e301]:
              - generic [ref=e302]:
                - generic [ref=e303]: Alex Morgan
                - generic [ref=e304]: Senior Frontend Engineer
                - generic [ref=e305]: alex@example.com • SF, CA • linkedin
                - generic [ref=e307]: SUMMARY
                - generic [ref=e311]:
                  - generic [ref=e312]: EXPERIENCE
                  - generic [ref=e313]: Vercel — Sr. Engineer
                - generic [ref=e319]: SKILLS
              - generic [ref=e322]: Preview template
            - generic [ref=e323]:
              - generic [ref=e324]:
                - heading "ATS Professional" [level=3] [ref=e325]
                - generic [ref=e326]: Free
              - paragraph [ref=e327]: Single-column, bot-friendly, parses 100% cleanly.
          - generic [ref=e328]:
            - generic [ref=e329]:
              - generic [ref=e330]:
                - generic [ref=e331]:
                  - generic [ref=e332]: ALEX MORGAN
                  - generic [ref=e333]: Senior Frontend Engineer
                  - generic [ref=e334]: alex@example.com • SF, CA
                - generic [ref=e336]: SUMMARY
              - generic [ref=e338]: Preview template
            - generic [ref=e339]:
              - generic [ref=e340]:
                - heading "Executive" [level=3] [ref=e341]
                - generic [ref=e342]: Free
              - paragraph [ref=e343]: Refined serif header, ideal for senior leadership.
          - generic [ref=e344]:
            - generic [ref=e345]:
              - generic [ref=e346]:
                - generic [ref=e347]:
                  - generic [ref=e348]: Alex Morgan
                  - generic [ref=e349]: Sr. Engineer
                  - generic [ref=e350]:
                    - generic [ref=e351]: CONTACT
                    - generic [ref=e352]: alex@example.com
                    - generic [ref=e353]: SF, CA
                  - generic [ref=e354]:
                    - generic [ref=e355]: SKILLS
                    - generic [ref=e356]: React
                    - generic [ref=e357]: TypeScript
                    - generic [ref=e358]: Next.js
                - generic [ref=e359]:
                  - generic [ref=e360]: SUMMARY
                  - generic [ref=e362]: EXPERIENCE
                  - generic [ref=e363]: Vercel — Sr. Engineer
              - generic [ref=e368]: Preview template
            - generic [ref=e369]:
              - generic [ref=e370]:
                - heading "Modern" [level=3] [ref=e371]
                - generic [ref=e372]: Free
              - paragraph [ref=e373]: Two-column with accent sidebar for skills & links.
          - generic [ref=e374]:
            - generic [ref=e375]:
              - generic [ref=e377]: Corporate
              - generic [ref=e383]: Preview template
            - generic [ref=e384]:
              - generic [ref=e385]:
                - heading "Corporate" [level=3] [ref=e386]
                - generic [ref=e387]: Free
              - paragraph [ref=e388]: Classic structure with strong section rules.
          - generic [ref=e389]:
            - generic [ref=e390]:
              - generic [ref=e392]: Europass
              - generic [ref=e398]: Preview template
            - generic [ref=e399]:
              - generic [ref=e400]:
                - heading "Europass" [level=3] [ref=e401]
                - generic [ref=e402]: Free
              - paragraph [ref=e403]: European-standard layout with photo placeholder.
          - generic [ref=e404]:
            - generic [ref=e405]:
              - generic [ref=e407]: Creative
              - generic [ref=e413]: Preview template
            - generic [ref=e414]:
              - generic [ref=e415]:
                - heading "Creative" [level=3] [ref=e416]
                - generic [ref=e417]: Free
              - paragraph [ref=e418]: Bold color blocks for design-forward roles.
          - generic [ref=e419]:
            - generic [ref=e420]:
              - generic [ref=e422]: Minimal
              - generic [ref=e428]: Preview template
            - generic [ref=e429]:
              - generic [ref=e430]:
                - heading "Minimal" [level=3] [ref=e431]
                - generic [ref=e432]: Free
              - paragraph [ref=e433]: Maximum whitespace, maximum focus.
          - generic [ref=e434]:
            - generic [ref=e435]:
              - generic [ref=e437]: Compact
              - generic [ref=e443]: Preview template
            - generic [ref=e444]:
              - generic [ref=e445]:
                - heading "Compact" [level=3] [ref=e446]
                - generic [ref=e447]: Free
              - paragraph [ref=e448]: Tight 9.5pt layout — maximum content per page.
          - generic [ref=e449]:
            - generic [ref=e450]:
              - generic [ref=e452]: Tech
              - generic [ref=e458]: Preview template
            - generic [ref=e459]:
              - generic [ref=e460]:
                - heading "Tech / Engineering" [level=3] [ref=e461]
                - generic [ref=e462]: Free
              - paragraph [ref=e463]: Monospace accents, skills grid, GitHub-friendly.
          - generic [ref=e464]:
            - generic [ref=e465]:
              - generic [ref=e467]: Academic
              - generic [ref=e473]: Preview template
            - generic [ref=e474]:
              - generic [ref=e475]:
                - heading "Academic" [level=3] [ref=e476]
                - generic [ref=e477]: Free
              - paragraph [ref=e478]: CV-style with publications, research, teaching.
          - generic [ref=e479]:
            - generic [ref=e480]:
              - generic [ref=e482]: Consulting
              - generic [ref=e488]: Preview template
            - generic [ref=e489]:
              - generic [ref=e490]:
                - heading "Consulting" [level=3] [ref=e491]
                - generic [ref=e492]: Free
              - paragraph [ref=e493]: Case-style bullets, impact-first, top-tier firms.
          - generic [ref=e494]:
            - generic [ref=e495]:
              - generic [ref=e497]: Startup
              - generic [ref=e503]: Preview template
            - generic [ref=e504]:
              - generic [ref=e505]:
                - heading "Startup" [level=3] [ref=e506]
                - generic [ref=e507]: Free
              - paragraph [ref=e508]: Bold sans-serif, growth metrics, entrepreneurial.
          - generic [ref=e509]:
            - generic [ref=e510]:
              - generic [ref=e512]: Classic
              - generic [ref=e518]: Preview template
            - generic [ref=e519]:
              - generic [ref=e520]:
                - heading "Classic" [level=3] [ref=e521]
                - generic [ref=e522]: Free
              - paragraph [ref=e523]: Traditional Garamond, centered header, timeless.
      - generic [ref=e525]:
        - generic [ref=e526]:
          - generic [ref=e527]: Loved by job seekers
          - heading "120,000+ offers and counting" [level=2] [ref=e528]
          - paragraph [ref=e529]: From bootcamp grads to senior leaders, people trust ResumeAI Pro to get past the bots and past the recruiters.
        - generic [ref=e530]:
          - figure "PS Priya Sharma Product Designer → Senior at Figma" [ref=e531]:
            - generic [ref=e532]:
              - img [ref=e533]
              - img [ref=e535]
              - img [ref=e537]
              - img [ref=e539]
              - img [ref=e541]
            - blockquote [ref=e543]: "\"I'd been using Enhancv for two years and paying $24.99/mo. ResumeAI Pro gave me a higher ATS score — for free. The one-page enforcement alone is worth switching for.\""
            - generic [ref=e544]:
              - generic [ref=e545]: PS
              - generic [ref=e546]:
                - generic [ref=e547]: Priya Sharma
                - generic [ref=e548]: Product Designer → Senior at Figma
          - figure "ML Marcus Lee Backend Engineer → Staff at Datadog" [ref=e549]:
            - generic [ref=e550]:
              - img [ref=e551]
              - img [ref=e553]
              - img [ref=e555]
              - img [ref=e557]
              - img [ref=e559]
            - blockquote [ref=e561]: "\"Three resume tools, three rejection emails. After running my resume through ResumeAI Pro's optimizer I got two onsite interviews within a week. The keyword gap analysis is unreal.\""
            - generic [ref=e562]:
              - generic [ref=e563]: ML
              - generic [ref=e564]:
                - generic [ref=e565]: Marcus Lee
                - generic [ref=e566]: Backend Engineer → Staff at Datadog
          - figure "DW Dana Williams Founder, SecondChance Careers" [ref=e567]:
            - generic [ref=e568]:
              - img [ref=e569]
              - img [ref=e571]
              - img [ref=e573]
              - img [ref=e575]
              - img [ref=e577]
            - blockquote [ref=e579]: "\"I run a career nonprofit for returning citizens. ResumeAI Pro lets us give every single person a premium resume, cover letter, and interview prep — completely free. It's a game-changer.\""
            - generic [ref=e580]:
              - generic [ref=e581]: DW
              - generic [ref=e582]:
                - generic [ref=e583]: Dana Williams
                - generic [ref=e584]: Founder, SecondChance Careers
          - figure "YT Yuki Tanaka Data Scientist → Airbnb" [ref=e585]:
            - generic [ref=e586]:
              - img [ref=e587]
              - img [ref=e589]
              - img [ref=e591]
              - img [ref=e593]
              - img [ref=e595]
            - blockquote [ref=e597]: "\"The interview prep package was the difference-maker. The STAR examples were so specific I literally used one verbatim in my final round. Got the offer.\""
            - generic [ref=e598]:
              - generic [ref=e599]: YT
              - generic [ref=e600]:
                - generic [ref=e601]: Yuki Tanaka
                - generic [ref=e602]: Data Scientist → Airbnb
          - figure "HA Hassan Ahmed Head of Talent, Vertex" [ref=e603]:
            - generic [ref=e604]:
              - img [ref=e605]
              - img [ref=e607]
              - img [ref=e609]
              - img [ref=e611]
              - img [ref=e613]
            - blockquote [ref=e615]: "\"I manage recruiting for a 200-person startup. I now recommend ResumeAI Pro to every candidate we reject — it makes our pipeline measurably stronger.\""
            - generic [ref=e616]:
              - generic [ref=e617]: HA
              - generic [ref=e618]:
                - generic [ref=e619]: Hassan Ahmed
                - generic [ref=e620]: Head of Talent, Vertex
          - figure "ER Elena Rodriguez Self-taught → Junior Engineer at Stripe" [ref=e621]:
            - generic [ref=e622]:
              - img [ref=e623]
              - img [ref=e625]
              - img [ref=e627]
              - img [ref=e629]
              - img [ref=e631]
            - blockquote [ref=e633]: "\"As a non-traditional candidate with no CS degree, the AI builder helped me reframe my self-taught experience into bullets that actually landed. I'm now a junior at Stripe.\""
            - generic [ref=e634]:
              - generic [ref=e635]: ER
              - generic [ref=e636]:
                - generic [ref=e637]: Elena Rodriguez
                - generic [ref=e638]: Self-taught → Junior Engineer at Stripe
        - generic [ref=e639]:
          - generic [ref=e640]:
            - img [ref=e641]
            - text: 4.9/5 average rating
          - generic [ref=e643]:
            - img [ref=e644]
            - text: +27 pts avg ATS lift
          - generic [ref=e647]:
            - img [ref=e648]
            - text: Used in 142 countries
      - generic [ref=e652]:
        - generic [ref=e653]:
          - generic [ref=e654]: From the blog
          - heading "Hiring intel, decoded." [level=2] [ref=e655]
          - paragraph [ref=e656]: Practical, data-backed advice for getting past the bots and past the recruiters.
        - generic [ref=e657]:
          - article [ref=e658] [cursor=pointer]:
            - generic [ref=e659]:
              - generic [ref=e661]: ATS
              - img [ref=e662]
            - generic [ref=e665]:
              - generic [ref=e666]:
                - generic [ref=e667]: Dec 1, 2025
                - generic [ref=e668]: •
                - generic [ref=e669]:
                  - img [ref=e670]
                  - text: 8 min
              - 'heading "The 2026 ATS cheat sheet: what bots actually scan for" [level=3] [ref=e673]'
              - paragraph [ref=e674]: We analyzed 1.4M resumes across 38 ATS systems. Here's exactly which sections, keywords, and formats move the needle — and which are myths.
              - generic [ref=e675]:
                - text: Read article
                - img [ref=e676]
          - article [ref=e678] [cursor=pointer]:
            - generic [ref=e679]:
              - generic [ref=e681]: Career
              - img [ref=e682]
            - generic [ref=e685]:
              - generic [ref=e686]:
                - generic [ref=e687]: Nov 22, 2025
                - generic [ref=e688]: •
                - generic [ref=e689]:
                  - img [ref=e690]
                  - text: 6 min
              - heading "How to write bullets that recruiters actually finish reading" [level=3] [ref=e693]
              - paragraph [ref=e694]: Recruiters spend 6.2 seconds on the first pass. Use the verb-number-impact framework to make every bullet earn its real estate.
              - generic [ref=e695]:
                - text: Read article
                - img [ref=e696]
          - article [ref=e698] [cursor=pointer]:
            - generic [ref=e699]:
              - generic [ref=e701]: Interview
              - img [ref=e702]
            - generic [ref=e705]:
              - generic [ref=e706]:
                - generic [ref=e707]: Nov 10, 2025
                - generic [ref=e708]: •
                - generic [ref=e709]:
                  - img [ref=e710]
                  - text: 7 min
              - 'heading "STAR method: 5 examples that aren''t ''I led a project''" [level=3] [ref=e713]'
              - paragraph [ref=e714]: Most STAR examples are vague filler. Here are five real ones that impressed hiring managers — and how to write yours with the same texture.
              - generic [ref=e715]:
                - text: Read article
                - img [ref=e716]
      - generic [ref=e719]:
        - generic [ref=e720]:
          - generic [ref=e721]: FAQ
          - heading "Everything you want to know" [level=2] [ref=e722]
          - paragraph [ref=e723]: Still have questions? Drop us a note — we reply within 24 hours.
        - generic [ref=e724]:
          - generic [ref=e725]:
            - button "Is ResumeAI Pro really completely free?" [expanded] [ref=e726]:
              - generic [ref=e727]: Is ResumeAI Pro really completely free?
              - img [ref=e728]
            - generic [ref=e731]: Yes. No subscriptions, no premium tiers, no paywalls, no watermarks, no feature restrictions. Unlimited resumes, ATS checks, downloads, templates, cover letters, and interview prep — forever. We're sustained by optional donations and non-intrusive sponsorships that never block features.
          - button "How does the AI work without me paying for an API key?" [ref=e733]:
            - generic [ref=e734]: How does the AI work without me paying for an API key?
            - img [ref=e735]
          - button "Will my resume really fit on one A4 page?" [ref=e738]:
            - generic [ref=e739]: Will my resume really fit on one A4 page?
            - img [ref=e740]
          - button "Which file formats are supported for upload and export?" [ref=e743]:
            - generic [ref=e744]: Which file formats are supported for upload and export?
            - img [ref=e745]
          - button "Can I use my own AI provider instead of Puter?" [ref=e748]:
            - generic [ref=e749]: Can I use my own AI provider instead of Puter?
            - img [ref=e750]
          - button "How is this deployed? Can I self-host?" [ref=e753]:
            - generic [ref=e754]: How is this deployed? Can I self-host?
            - img [ref=e755]
          - button "Is my data private and secure?" [ref=e758]:
            - generic [ref=e759]: Is my data private and secure?
            - img [ref=e760]
          - button "What about accessibility and international users?" [ref=e763]:
            - generic [ref=e764]: What about accessibility and international users?
            - img [ref=e765]
      - generic [ref=e773]:
        - heading "Your next offer is on the other side of one A4 page." [level=2] [ref=e774]
        - paragraph [ref=e775]: Launch ResumeAI Pro, drop in your resume, and watch your ATS score jump — completely free, forever.
        - generic [ref=e776]:
          - button "Launch the app" [ref=e777]:
            - img
            - text: Launch the app
          - link "See features" [ref=e778] [cursor=pointer]:
            - /url: "#features"
            - button "See features" [ref=e779]:
              - text: See features
              - img
        - generic [ref=e780]:
          - generic [ref=e781]:
            - img [ref=e782]
            - text: No credit card
          - generic [ref=e784]:
            - img [ref=e785]
            - text: No signup wall
          - generic [ref=e787]:
            - img [ref=e788]
            - text: No watermarks
          - generic [ref=e790]:
            - img [ref=e791]
            - text: Unlimited downloads
      - generic [ref=e795]:
        - generic [ref=e798]:
          - generic [ref=e799]:
            - img [ref=e800]
            - text: Newsletter
          - heading "Get hiring intel in your inbox" [level=3] [ref=e803]
          - paragraph [ref=e804]: One practical email every other week. No fluff, no spam. Unsubscribe in one click.
          - generic [ref=e805]:
            - textbox "you@example.com" [ref=e806]
            - button "Subscribe" [ref=e807]:
              - img
              - text: Subscribe
          - generic [ref=e808]:
            - generic [ref=e809]:
              - img [ref=e810]
              - text: 84,000+ subscribers
            - generic [ref=e815]:
              - img [ref=e816]
              - text: GDPR-compliant
        - generic [ref=e819]:
          - generic [ref=e820]:
            - img [ref=e821]
            - text: Contact
          - heading "Talk to a human" [level=3] [ref=e823]
          - paragraph [ref=e824]: Feature request, bug report, or partnership idea? We reply within 24 hours.
          - generic [ref=e825]:
            - textbox "you@example.com" [ref=e826]
            - textbox "What's on your mind?" [ref=e827]
            - button "Send message" [ref=e828]:
              - img
              - text: Send message
    - contentinfo [ref=e829]:
      - generic [ref=e830]:
        - generic [ref=e831]:
          - generic [ref=e832]:
            - generic [ref=e836]:
              - generic [ref=e837]: ResumeAI
              - text: PRO
            - paragraph [ref=e838]: Premium AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep — completely free, no paywalls, no watermarks.
            - generic [ref=e839]:
              - link "GitHub" [ref=e840] [cursor=pointer]:
                - /url: https://github.com/rachidSabah/INFOHAS-ATS-PRO
                - img [ref=e841]
              - link "Twitter" [ref=e844] [cursor=pointer]:
                - /url: https://twitter.com/resumeaipro
                - img [ref=e845]
              - button "Launch app" [ref=e847]:
                - img [ref=e848]
                - text: Launch app
          - generic [ref=e853]:
            - generic [ref=e854]:
              - heading "Product" [level=4] [ref=e855]
              - list [ref=e856]:
                - listitem [ref=e857]:
                  - link "ATS Checker" [ref=e858] [cursor=pointer]:
                    - /url: "#ats-demo"
                - listitem [ref=e859]:
                  - link "Resume Builder" [ref=e860] [cursor=pointer]:
                    - /url: "#templates"
                - listitem [ref=e861]:
                  - link "Resume Optimizer" [ref=e862] [cursor=pointer]:
                    - /url: "#features"
                - listitem [ref=e863]:
                  - link "Cover Letters" [ref=e864] [cursor=pointer]:
                    - /url: "#features"
                - listitem [ref=e865]:
                  - link "Interview Prep" [ref=e866] [cursor=pointer]:
                    - /url: "#features"
            - generic [ref=e867]:
              - heading "Resources" [level=4] [ref=e868]
              - list [ref=e869]:
                - listitem [ref=e870]:
                  - link "Blog" [ref=e871] [cursor=pointer]:
                    - /url: "#blog"
                - listitem [ref=e872]:
                  - link "FAQ" [ref=e873] [cursor=pointer]:
                    - /url: "#faq"
                - listitem [ref=e874]:
                  - link "ATS Guide" [ref=e875] [cursor=pointer]:
                    - /url: "#blog"
                - listitem [ref=e876]:
                  - link "Templates" [ref=e877] [cursor=pointer]:
                    - /url: "#templates"
                - listitem [ref=e878]:
                  - link "Testimonials" [ref=e879] [cursor=pointer]:
                    - /url: "#testimonials"
            - generic [ref=e880]:
              - heading "Company" [level=4] [ref=e881]
              - list [ref=e882]:
                - listitem [ref=e883]:
                  - link "About" [ref=e884] [cursor=pointer]:
                    - /url: "#"
                - listitem [ref=e885]:
                  - link "Contact" [ref=e886] [cursor=pointer]:
                    - /url: "#contact"
                - listitem [ref=e887]:
                  - link "Privacy" [ref=e888] [cursor=pointer]:
                    - /url: "#"
                - listitem [ref=e889]:
                  - link "Terms" [ref=e890] [cursor=pointer]:
                    - /url: "#"
                - listitem [ref=e891]:
                  - link "Security" [ref=e892] [cursor=pointer]:
                    - /url: "#"
        - generic [ref=e893]:
          - paragraph [ref=e894]: © 2026 ResumeAI Pro. Free forever. Built with ♥ for job seekers everywhere.
          - generic [ref=e895]:
            - button "Toggle theme" [ref=e896]:
              - img [ref=e897]
              - text: Dark mode
            - generic [ref=e899]: ·
            - generic [ref=e900]:
              - img [ref=e901]
              - text: 100% free
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - alert [ref=e904]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import * as path from "path";
  3  | 
  4  | const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "https://resumeai-pro.pages.dev";
  5  | 
  6  | const QATAR_DUTY_FREE_JD = `Till Assistant | Qatar Duty Free
  7  | General Information
  8  | Ref #  2600005S
  9  | Location  Qatar-Doha
  10 | Job family  Customer Service
  11 | Closing Date: 2026-07-31
  12 | Description
  13 | Calling all ambitious Retail professionals to join our Qatar Duty Free team and start writing your own story with Qatar Airways Group.
  14 | 
  15 | As a Till Assistant you will be undertake all cash desk sales activities in the shop and provide the best possible customer service in order to maximize sales opportunities within Qatar Duty Free Company retail shops.
  16 | 
  17 | Responsibilities
  18 | Ensure the float is correct and that all keyed information into the POS terminal is done so accurately.
  19 | Process customer’s transactions efficiently using the QDFC shop's Point of Sale (POS) system and must present the receipts at all times to the customer.
  20 | Handling money/Traveler’s Cheques/Credit cards and any form of payment in a safe, secure and responsible manner.
  21 | Ensure cash and documentation is secure at all times.
  22 | Responsible for the cash variances at the end of the shift.
  23 | 
  24 | Qualifications
  25 | Basic Literacy and Numeracy skills, English communication skills with Entry level roles - no prior job-related work experience.
  26 | Preferred: Previous Retails and or Customer Service experience.`;
  27 | 
  28 | test.describe("Aya Chabaki Resume Optimization", () => {
  29 |   test("runs the full optimization pipeline E2E", async ({ page }) => {
  30 |     await page.goto(BASE_URL);
  31 |     await page.waitForLoadState("networkidle");
  32 | 
  33 |     // 1. Navigate to Job Scraper to save the JD
> 34 |     await page.click('text=Job Scraper');
     |                ^ Error: page.click: Test timeout of 30000ms exceeded.
  35 |     const jdTextarea = page.locator('placeholder="Paste the full job description here…"');
  36 |     await expect(jdTextarea).toBeVisible();
  37 |     await jdTextarea.fill(QATAR_DUTY_FREE_JD);
  38 |     await page.click('text=Extract with AI');
  39 | 
  40 |     // Wait for the extraction and saved JD to appear
  41 |     await expect(page.locator('text=Till Assistant').first()).toBeVisible({ timeout: 15000 });
  42 | 
  43 |     // Click "Optimize" button on the Till Assistant card
  44 |     await page.locator('text=Optimize').first().click();
  45 | 
  46 |     // 2. We should now be on the Resume Optimizer page
  47 |     await expect(page.locator('text=Upload your resume').first()).toBeVisible({ timeout: 10000 });
  48 | 
  49 |     // Upload the Aya Chabaki resume file
  50 |     // Note: in testing environment, we can select the file using setInputFiles
  51 |     const fileChooserPromise = page.waitForEvent('filechooser').catch(() => null);
  52 |     const uploadArea = page.locator('input[type="file"]');
  53 |     await uploadArea.setInputFiles({
  54 |       name: 'AYA_CHABAKI_resume.pdf',
  55 |       mimeType: 'application/pdf',
  56 |       buffer: Buffer.from('%PDF-1.4 ... mock pdf content ...')
  57 |     });
  58 | 
  59 |     // Alternatively, if the file is present in the workspace, we can upload it:
  60 |     // const filePath = path.join(__dirname, '../../uploads/AYA_CHABAKI_resume.pdf');
  61 |     // await uploadArea.setInputFiles(filePath);
  62 | 
  63 |     // 3. Select Till Assistant as target JD
  64 |     await page.click('text=Select Job Description').catch(() => {});
  65 |     await page.click('text=Till Assistant').catch(() => {});
  66 | 
  67 |     // 4. Click "Optimize Resume"
  68 |     const optimizeBtn = page.locator('text=Optimize Resume, text=Optimize');
  69 |     await expect(optimizeBtn).toBeEnabled();
  70 |     await optimizeBtn.click();
  71 | 
  72 |     // 5. Wait for the pipeline optimization to run and converge
  73 |     // The UI displays pipeline logs like "embedding keywords", "verifying facts", etc.
  74 |     await expect(page.locator('text=V3 pipeline complete, text=Optimization complete').first()).toBeVisible({ timeout: 45000 });
  75 | 
  76 |     // 6. Assertions on the final optimized resume
  77 |     // Check that the layout optimization satisfied the 1-page A4 target (approx 2700+ visible chars)
  78 |     // Check that factual consistency is maintained and facts are preserved
  79 |     await expect(page.locator('text=A4 · 1 page').first()).toBeVisible();
  80 |     await expect(page.locator('text=Factual Consistency').first()).toBeVisible();
  81 | 
  82 |     // Verify target keywords (like POS, Till Assistant, cash handling) are embedded in the optimized text
  83 |     const previewContainer = page.locator('id=resume-preview-container, class*=A4');
  84 |     await expect(previewContainer).toBeVisible();
  85 |   });
  86 | });
  87 | 
```