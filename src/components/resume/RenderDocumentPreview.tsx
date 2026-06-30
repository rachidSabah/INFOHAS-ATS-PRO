// ============================================================================
// RenderDocumentPreview — renders RenderDocument (SSOT) as React A4 preview
// ============================================================================
// This is the SINGLE SOURCE OF TRUTH preview component. It consumes the same
// RenderDocument that the DOCX and PDF export paths consume, ensuring EXACT
// parity between what the user sees and what they export.
//
// ALL renderers (Preview, DOCX, PDF) now share:
//   1. toRenderDocument(resume) → RenderDocument
//   2. RenderDocumentPreview | exportResumeDOCXRenderDoc | exportResumePDFRenderDoc
//
// No template-specific rendering logic. No per-template section ordering.
// ============================================================================

"use client";

import React from "react";
import type {
  RenderDocument,
  RenderContentItem,
  RenderDocumentSection,
  ResumeLayoutModel,
} from "@/lib/types";

// ── Props ─────────────────────────────────────────────────────────────────
export interface RenderDocumentPreviewProps {
  rd: RenderDocument;
  scale?: number;
  className?: string;
}

// ── Root Component ────────────────────────────────────────────────────────
export function RenderDocumentPreview({
  rd,
  scale = 1,
  className,
}: RenderDocumentPreviewProps) {
  const L = rd.layout;
  const accentColor = L.sectionTitleColor || "#8B0000";
  const bodyColor = L.bodyTextColor || "#000000";

  const scaledWidthMm = 210 * scale;
  const scaledHeightMm = 297 * scale;

  return (
    <div
      style={{
        width: `${scaledWidthMm}mm`,
        height: `${scaledHeightMm}mm`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        className={`origin-top-left ${className ?? ""}`}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
          width: "210mm",
          minHeight: "297mm",
          fontFamily: L.fontFamily || "'Times New Roman', serif",
          fontSize: `${L.bodyFontSizePt}pt`,
          lineHeight: L.lineHeight || 1.2,
          color: bodyColor,
          padding: `${L.marginTopMm}mm ${L.marginRightMm}mm ${L.marginBottomMm}mm ${L.marginLeftMm}mm`,
          backgroundColor: "#fff",
        }}
      >
        {/* ============ CONTACT BLOCK ============ */}
        <RenderContactBlock contact={rd.contact} layout={L} />

        {/* ============ SECTIONS ============ */}
        {rd.sections.map((section, idx) => (
          <RenderSection
            key={`${section.type}-${idx}`}
            section={section}
            layout={L}
            accentColor={accentColor}
          />
        ))}
      </div>
    </div>
  );
}

// ── Contact Block ─────────────────────────────────────────────────────────
function RenderContactBlock({
  contact,
  layout: L,
}: {
  contact: RenderDocument["contact"];
  layout: ResumeLayoutModel;
}) {
  const nameColor = L.nameColor || "#8B0000";
  const contactColor = L.contactColor || "#000000";
  const bodyColor = L.bodyTextColor || "#000000";
  const sectionGapMm = L.sectionGapMm ?? 3;

  return (
    <div style={{ marginBottom: `${sectionGapMm}mm` }}>
      {/* Name */}
      <h1
        style={{
          fontSize: `${L.nameSizePt}pt`,
          fontWeight: "bold",
          color: nameColor,
          textTransform: "uppercase",
          margin: 0,
          marginBottom: "2mm",
          letterSpacing: "0.5pt",
        }}
      >
        {contact.name || "YOUR NAME"}
      </h1>

      {/* Headline */}
      {contact.headline && (
        <p
          style={{
            margin: 0,
            marginBottom: "1mm",
            fontSize: `${L.bodyFontSizePt}pt`,
            color: bodyColor,
          }}
        >
          {contact.headline}
        </p>
      )}

      {/* Contact line */}
      <ContactLine contact={contact} color={contactColor} fontSize={L.bodyFontSizePt} />

      {/* Date of birth */}
      {contact.dateOfBirth && (
        <p
          style={{
            margin: 0,
            marginBottom: "0.5mm",
            fontSize: `${L.bodyFontSizePt}pt`,
            color: bodyColor,
          }}
        >
          Date Of Birth: {contact.dateOfBirth}
        </p>
      )}

      {/* Personal details */}
      {contact.personalDetails && renderPersonalDetails(contact.personalDetails, L.bodyFontSizePt, bodyColor)}
    </div>
  );
}

function ContactLine({
  contact,
  color,
  fontSize,
}: {
  contact: RenderDocument["contact"];
  color: string;
  fontSize: number;
}) {
  const parts: string[] = [];
  if (contact.phone) parts.push(contact.phone);
  if (contact.email) parts.push(contact.email);
  if (contact.location) parts.push(contact.location);
  if (parts.length === 0) return null;

  return (
    <p
      style={{
        margin: 0,
        marginBottom: "0.5mm",
        fontSize: `${fontSize}pt`,
        color,
      }}
    >
      {parts.join(" | ")}
    </p>
  );
}

function renderPersonalDetails(
  pd: Record<string, string>,
  fontSize: number,
  color: string,
): React.ReactNode {
  const entries = Object.entries(pd).filter(([, v]) => v?.trim());
  if (entries.length === 0) return null;

  return (
    <div>
      {entries.map(([label, value]) => (
        <p
          key={label}
          style={{
            margin: 0,
            marginBottom: "0.3mm",
            fontSize: `${fontSize}pt`,
            color,
          }}
        >
          {`${label.charAt(0).toUpperCase() + label.slice(1)} : ${value}`}
        </p>
      ))}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────
function RenderSection({
  section,
  layout: L,
  accentColor,
}: {
  section: RenderDocumentSection;
  layout: ResumeLayoutModel;
  accentColor: string;
}) {
  const sectionGapMm = L.sectionGapMm ?? 3;
  const bodyColor = L.bodyTextColor || "#000000";

  return (
    <div style={{ marginBottom: `${sectionGapMm}mm` }}>
      {/* Section title */}
      {section.title && (
        <>
          <h2
            style={{
              fontSize: `${L.sectionTitleSizePt}pt`,
              fontWeight: "bold",
              color: accentColor,
              textTransform: "uppercase",
              margin: 0,
              marginBottom: "1mm",
              letterSpacing: "0.3pt",
            }}
          >
            {section.title}
          </h2>
          <hr
            style={{
              border: "none",
              borderTop: `1pt solid ${accentColor}`,
              margin: 0,
              marginBottom: "2mm",
            }}
          />
        </>
      )}

      {/* Section items */}
      {section.items.map((item, idx) => (
        <RenderContentItem
          key={idx}
          item={item}
          fontSize={L.bodyFontSizePt}
          color={bodyColor}
          accentColor={accentColor}
        />
      ))}
    </div>
  );
}

// ── Content Item Renderer ─────────────────────────────────────────────────
function RenderContentItem({
  item,
  fontSize,
  color,
  accentColor,
}: {
  item: RenderContentItem;
  fontSize: number;
  color: string;
  accentColor: string;
}) {
  switch (item.kind) {
    case "text":
      return (
        <p
          style={{
            margin: 0,
            marginBottom: "0.8mm",
            fontSize: `${fontSize}pt`,
            color,
            fontWeight: item.bold ? "bold" : "normal",
          }}
        >
          {item.text}
        </p>
      );

    case "bullets":
      return (
        <ul
          style={{
            margin: 0,
            marginBottom: "0.8mm",
            paddingLeft: `${fontSize * 1.2}pt`,
            listStyle: item.level > 0 ? "circle" : "disc",
          }}
        >
          {item.bullets.map((b, i) => (
            <li
              key={i}
              style={{
                fontSize: `${fontSize}pt`,
                color,
                marginBottom: "0.5mm",
                lineHeight: 1.3,
              }}
            >
              {b}
            </li>
          ))}
        </ul>
      );

    case "table-row":
      return (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "0.5mm",
            width: "100%",
          }}
        >
          <span
            style={{
              fontWeight: item.cells?.[0]?.bold ? "bold" : "normal",
              fontSize: `${fontSize}pt`,
              color,
              textAlign: item.cells?.[0]?.align || "left",
            }}
          >
            {item.cells?.[0]?.text || ""}
          </span>
          <span
            style={{
              fontWeight: item.cells?.[1]?.bold ? "bold" : "normal",
              fontSize: `${fontSize}pt`,
              color,
              textAlign: item.cells?.[1]?.align || "right",
              whiteSpace: "nowrap",
              marginLeft: "4mm",
            }}
          >
            {item.cells?.[1]?.text || ""}
          </span>
        </div>
      );

    case "nested-bullets":
      return (
        <div style={{ marginBottom: "0.8mm" }}>
          {item.groups.map((group, gi) => (
            <p
              key={gi}
              style={{
                margin: 0,
                marginBottom: "0.5mm",
                fontSize: `${fontSize}pt`,
                color,
              }}
            >
              <span style={{ fontWeight: "bold" }}>{group.label}: </span>
              {group.items.join(", ")}
            </p>
          ))}
        </div>
      );

    default:
      return null;
  }
}
