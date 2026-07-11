-- Add columns for previously unsupported section types.
-- Without these, dynamicSections and additionalInfo were silently
-- dropped during D1 writes, causing data loss in the export pipeline.

ALTER TABLE resumes ADD COLUMN additional_info_json TEXT;
ALTER TABLE resumes ADD COLUMN dynamic_sections_json TEXT;
