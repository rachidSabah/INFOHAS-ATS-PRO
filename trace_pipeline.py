from docx import Document
import json

doc = Document(r'C:\Users\InGodWeTrust\Downloads\EL HILALI AROUA Resume (1).docx')

# Simulate what the locked pipeline/assembler does:
# 1. Extract all text paragraphs
paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
print("=== ALL PARAGRAPHS ===")
for i, p in enumerate(paragraphs):
    print(f"P{i}: {p[:120]}")

# 2. Simulate section detection
current_section = "header"
section_lines = {"header": [], "summary": [], "experience": [], "education": [], "skills": [], "languages": [], "certifications": []}

for p in paragraphs:
    pu = p.upper()
    if any(pat in pu for pat in ["PROFESSIONAL SUMMARY", "PROFESSIONAL PROFILE", "SUMMARY", "PROFILE"]):
        current_section = "summary"
    elif any(pat in pu for pat in ["PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE", "EMPLOYMENT"]):
        current_section = "experience"
    elif any(pat in pu for pat in ["EDUCATION"]):
        current_section = "education"
    elif any(pat in pu for pat in ["SKILLS", "COMPETENCIES", "KEY COMPETENCIES"]):
        current_section = "skills"
    elif any(pat in pu for pat in ["LANGUAGES"]):
        current_section = "languages"
    elif any(pat in pu for pat in ["CERTIFICATION"]):
        current_section = "certifications"
    
    if current_section != "header":
        section_lines.setdefault(current_section, []).append(p)
    else:
        section_lines["header"].append(p)

print("\n=== SECTION: EDUCATION ===")
for p in section_lines.get("education", []):
    print(f"  '{p}'")

print("\n=== SECTION: LANGUAGES ===")
for p in section_lines.get("languages", []):
    print(f"  '{p}'")

print("\n=== SECTION: SKILLS (for inline language detection) ===")
for p in section_lines.get("skills", []):
    if 'language' in p.lower():
        print(f"  '{p}'")
