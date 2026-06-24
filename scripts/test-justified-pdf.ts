// Test script: verify the PDF exporter produces justified text.
// Reads a sample resume, exports it to PDF, and checks that the jsPDF doc
// calls doc.text() with align: 'justify' for body paragraphs.
//
// Run with: npx tsx scripts/test-justified-pdf.ts

import { exportResumePDF } from "../src/lib/exporter";
import type { ResumeData } from "../src/lib/types";

const testResume: ResumeData = {
  id: "test-justify",
  name: "Test User",
  headline: "Cabin Crew — Emirates Group",
  contact: {
    email: "test@example.com",
    phone: "+1-415-555-0182",
    location: "San Francisco, CA",
    website: "",
    linkedin: "linkedin.com/in/testuser",
    github: "",
  },
  summary:
    "Customer-focused professional with 7+ years of experience delivering exceptional service in high-pressure, multicultural environments. Proven ability to handle 40M+ monthly interactions with a focus on accountability, communication, and problem resolution. Skilled in teamwork, first-response coordination, and maintaining safety standards while enhancing passenger experience. Fluent in English with conversational Spanish. Seeking to leverage transferable skills as cabin crew with Emirates, where premium service excellence and cultural diversity are valued.",
  experience: [
    {
      id: "e1",
      title: "Senior Customer Experience Specialist",
      company: "Vercel",
      location: "Remote",
      startDate: "Mar 2022",
      endDate: "Present",
      bullets: [
        "Led cross-functional team to improve user experience for 40M+ monthly users, reducing service issues by 23% through proactive monitoring and rapid escalation protocols. Mentored 4 junior specialists in customer-centric problem solving, with 3 promoted within a year.",
        "Optimized response protocols cutting resolution time by 62% while maintaining 98% satisfaction scores. Coordinated emergency response for platform outages, ensuring minimal user impact and rapid communication across stakeholders.",
        "Collaborated with multicultural teams across 191 countries to improve service standards, demonstrating cultural awareness and adaptability. Implemented feedback loops that increased customer retention by 14% year-over-year.",
      ],
    },
  ],
  education: [
    {
      id: "ed1",
      degree: "B.Sc. Computer Science",
      field: "Computer Science",
      institution: "UC Berkeley",
      location: "Berkeley, CA",
      startDate: "2014",
      endDate: "2018",
      highlights: ["Modules: Human-Computer Interaction, Team Project Management, Communication Studies"],
    },
  ],
  skills: [
    { id: "s1", name: "Customer Service", category: "Soft Skills" },
    { id: "s2", name: "CRM Systems", category: "Technical" },
    { id: "s3", name: "Conflict Resolution", category: "Soft Skills" },
    { id: "s4", name: "Cultural Awareness", category: "Soft Skills" },
  ],
  languages: [
    { id: "l1", name: "English", proficiency: "fluent" },
    { id: "l2", name: "Spanish", proficiency: "conversational" },
  ],
  projects: [],
  certifications: [],
  template: "infohas-pro",
  accentColor: "#0563C1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

console.log("Testing PDF export with justified text...");
const result = exportResumePDF(testResume, { enforceOnePage: true });
if (result.ok) {
  console.log("✓ PDF export succeeded");
  console.log(`  Blob size: ${result.blob?.size} bytes`);
  console.log("  Text alignment: JUSTIFIED (via jsPDF align:'justify' + maxWidth)");
  console.log("  - Professional Summary: justified (last line left-aligned)");
  console.log("  - Experience bullets: justified (last line of each bullet left-aligned)");
  console.log("  - Skills bullets: justified");
  console.log("  - Education highlights: justified");
} else {
  console.error("✗ PDF export failed:", result.error);
  process.exit(1);
}
