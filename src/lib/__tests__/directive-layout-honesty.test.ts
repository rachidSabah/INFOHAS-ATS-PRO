import { describe, it, expect, afterEach } from "vitest";
import { useApp } from "../store";
import { SEED_OPTIMIZER_DIRECTIVE } from "../mock-data";
import { getLayoutForTemplate, getDefaultResumeLayout } from "../exporter";
import { resolveSectionAlignment } from "../types";

function setDirective(patch: Record<string, unknown>) {
  useApp.setState({
    optimizerDirective: { ...SEED_OPTIMIZER_DIRECTIVE, ...patch },
  } as never);
}

afterEach(() => {
  useApp.setState({ optimizerDirective: SEED_OPTIMIZER_DIRECTIVE } as never);
});

describe("template honors explicit user customizations", () => {
  it("keeps a user-set 11pt body size instead of the template hardcode", () => {
    setDirective({ bodyFontSizePt: 11 });
    const L = getLayoutForTemplate("modern");
    expect(L.bodyFontSizePt).toBe(11);
  });

  it("preserves the template look when the user never customized", () => {
    setDirective({});
    const L = getLayoutForTemplate("modern");
    expect(L.bodyFontSizePt).toBe(9.5);
    expect(L.fontFamily).toBe("Helvetica");
  });

  it("recomputes line height from the winning size", () => {
    setDirective({ bodyFontSizePt: 11 });
    const L = getLayoutForTemplate("modern");
    expect(L.lineHeightMm).toBeCloseTo(11 * 0.352778 * 1.3, 2);
  });

  it("honors user font family and colors over template hardcodes", () => {
    setDirective({ fontFamily: "Arial", bodyTextColor: "#111111" });
    const L = getLayoutForTemplate("modern");
    expect(L.fontFamily).toBe("Arial");
    expect(L.bodyTextColor).toBe("#111111");
  });
});

describe("text alignment plumbing", () => {
  it("seeds justify-by-default with no overrides", () => {
    expect(SEED_OPTIMIZER_DIRECTIVE.bodyAlignment).toBe("justify");
    expect(SEED_OPTIMIZER_DIRECTIVE.sectionAlignment).toEqual({});
  });

  it("passes alignment through the default layout", () => {
    setDirective({ bodyAlignment: "left", sectionAlignment: { skills: "center" } });
    const L = getDefaultResumeLayout();
    expect(L.bodyAlignment).toBe("left");
    expect(L.sectionAlignment).toEqual({ skills: "center" });
  });

  it("carries alignment through template layouts", () => {
    setDirective({ bodyAlignment: "left" });
    expect(getLayoutForTemplate("modern").bodyAlignment).toBe("left");
  });

  it("resolves per-section override over body over default", () => {
    expect(resolveSectionAlignment({ bodyAlignment: "left", sectionAlignment: { skills: "center" } }, "skills")).toBe("center");
    expect(resolveSectionAlignment({ bodyAlignment: "left", sectionAlignment: {} }, "education")).toBe("left");
    expect(resolveSectionAlignment(null, "education")).toBe("justify");
    expect(resolveSectionAlignment(undefined, "education")).toBe("justify");
  });
});
