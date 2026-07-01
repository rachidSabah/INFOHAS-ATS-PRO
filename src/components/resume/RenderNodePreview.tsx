"use client";

// ============================================================================
// RenderNodePreview — renders RenderNode[] as A4 preview
// ============================================================================
// Consumes the RenderNode tree (the SSOT) directly. Every renderer uses the
// same tree — Preview, DOCX, PDF, HTML, TXT all see identical content.

import React from "react";
import type { RenderNode } from "@/lib/document-render-tree/types";

interface RenderNodePreviewProps {
  nodes: RenderNode[];
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Render a single RenderNode to its visual representation.
 */
function RenderNodeElement({
  node,
  depth = 0,
}: {
  node: RenderNode;
  depth?: number;
}) {
  if (node.visibility === "hidden" || node.visibility === "collapsed") {
    return null;
  }

  const baseStyle: React.CSSProperties = {
    fontFamily: node.style.fontFamily || undefined,
    fontSize: node.style.fontSizePt ? `${node.style.fontSizePt}pt` : undefined,
    fontWeight: node.style.bold ? "bold" : undefined,
    fontStyle: node.style.italic ? "italic" : undefined,
    color: node.style.color || undefined,
    backgroundColor: node.style.backgroundColor || undefined,
    textAlign: node.style.textAlign || undefined,
    paddingTop: node.style.paddingTopMm ? `${node.style.paddingTopMm}mm` : undefined,
    paddingBottom: node.style.paddingBottomMm ? `${node.style.paddingBottomMm}mm` : undefined,
    paddingLeft: node.style.paddingLeftMm ? `${node.style.paddingLeftMm}mm` : undefined,
    paddingRight: node.style.paddingRightMm ? `${node.style.paddingRightMm}mm` : undefined,
    marginTop: node.style.marginTopMm ? `${node.style.marginTopMm}mm` : undefined,
    marginBottom: node.style.marginBottomMm ? `${node.style.marginBottomMm}mm` : undefined,
    marginLeft: node.style.marginLeftMm ? `${node.style.marginLeftMm}mm` : undefined,
    marginRight: node.style.marginRightMm ? `${node.style.marginRightMm}mm` : undefined,
  };

  switch (node.type) {
    case "document":
      return (
        <div
          style={{
            ...baseStyle,
            width: "210mm",
            minHeight: "297mm",
            padding: "6.35mm 8.89mm",
          }}
        >
          {node.children.length > 0
            ? node.children.map((child) => (
                <RenderNodeElement key={child.id} node={child} depth={depth} />
              ))
            : null}
        </div>
      );

    case "section-title":
      return (
        <div
          style={{
            ...baseStyle,
            fontSize: "11pt",
            fontWeight: "bold",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            borderBottom: "1px solid #2c3e50",
            paddingBottom: "0.5mm",
            marginTop: "3mm",
            marginBottom: "1mm",
          }}
        >
          {node.content}
        </div>
      );

    case "contact-line":
      return (
        <div style={baseStyle}>
          {node.content}
        </div>
      );

    case "text-line":
      return (
        <p style={{ ...baseStyle, margin: 0 }}>
          {node.content}
        </p>
      );

    case "bullet-item":
      return (
        <div
          style={{
            ...baseStyle,
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: "3mm",
            paddingLeft: node.style.paddingLeftMm
              ? `${node.style.paddingLeftMm}mm`
              : "6.4mm",
          }}
        >
          <span style={{ flexShrink: 0 }}>•</span>
          <span>{node.content}</span>
        </div>
      );

    case "table-row":
    case "table-cell":
      // Table cells from the same row are grouped by parentId
      return (
        <div style={baseStyle}>
          {node.content}
        </div>
      );

    case "nested-group-label":
      return (
        <div
          style={{
            ...baseStyle,
            fontWeight: "bold",
            marginTop: "1mm",
            marginBottom: "0.5mm",
          }}
        >
          {node.content}
        </div>
      );

    case "nested-group-item":
      return (
        <div
          style={{
            ...baseStyle,
            paddingLeft: node.style.paddingLeftMm
              ? `${node.style.paddingLeftMm}mm`
              : "6.4mm",
          }}
        >
          • {node.content}
        </div>
      );

    case "divider":
      return (
        <div
          style={{
            ...baseStyle,
            borderTop: node.style.borderBottom || "0.5px solid #ccc",
            marginTop: baseStyle.marginTop || "1.5mm",
            marginBottom: baseStyle.marginBottom || "1.5mm",
          }}
        />
      );

    default:
      return (
        <div style={baseStyle}>
          {node.content}
          {node.children.length > 0
            ? node.children.map((child) => (
                <RenderNodeElement key={child.id} node={child} depth={depth + 1} />
              ))
            : null}
        </div>
      );
  }
}

/**
 * RenderNodePreview — renders the full RenderNode tree as an A4 preview.
 */
export function RenderNodePreview({
  nodes,
  className,
  style,
}: RenderNodePreviewProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div className={className} style={{ padding: "20px", color: "#999" }}>
        No content to render
      </div>
    );
  }

  // Find document root or render all nodes as a document
  const docRoot = nodes.find((n) => n.type === "document");

  if (docRoot) {
    // Render children of document root
    return (
      <div className={className} style={style}>
        <div
          style={{
            width: "210mm",
            minHeight: "297mm",
            padding: `${docRoot.style.marginTopMm || 6.35}mm ${docRoot.style.marginRightMm || 8.89}mm`,
            backgroundColor: docRoot.style.backgroundColor || "#fff",
            fontFamily: docRoot.style.fontFamily || "Calibri, sans-serif",
            fontSize: docRoot.style.fontSizePt ? `${docRoot.style.fontSizePt}pt` : "10pt",
            color: docRoot.style.color || "#000",
            lineHeight: 1.15,
            margin: "0 auto",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}
        >
          {docRoot.children.map((child) => (
            <RenderNodeElement key={child.id} node={child} />
          ))}
        </div>
      </div>
    );
  }

  // Fallback: render all nodes flat
  return (
    <div className={className} style={style}>
      <div
        style={{
          width: "210mm",
          minHeight: "297mm",
          padding: "6.35mm 8.89mm",
          backgroundColor: "#fff",
          fontFamily: "Calibri, sans-serif",
          fontSize: "10pt",
          lineHeight: 1.15,
          margin: "0 auto",
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        {nodes.map((node) => (
          <RenderNodeElement key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}
