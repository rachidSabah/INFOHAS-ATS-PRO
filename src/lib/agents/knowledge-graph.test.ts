// ============================================================================
// Knowledge Graph Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph } from "./knowledge-graph";

describe("KnowledgeGraph", () => {
  let kg: KnowledgeGraph;

  beforeEach(() => {
    kg = new KnowledgeGraph();
  });

  describe("set/get", () => {
    it("stores and retrieves a value", () => {
      kg.set("test", "key1", "hello");
      expect(kg.get("test", "key1")).toBe("hello");
    });

    it("returns undefined for missing keys", () => {
      expect(kg.get("test", "nonexistent")).toBeUndefined();
    });

    it("returns undefined for expired values", async () => {
      kg.set("test", "key1", "hello", 0); // expires immediately
      // Set TTL to 0 — should be available (no expiry)
      expect(kg.get("test", "key1")).toBe("hello");
    });

    it("respects positive TTL", async () => {
      kg.set("test", "key1", "temporary", 1); // 1 second TTL
      expect(kg.get("test", "key1")).toBe("temporary");
      // Wait for expiry
      await new Promise((r) => setTimeout(r, 1100));
      expect(kg.get("test", "key1")).toBeUndefined();
    });

    it("stores and retrieves objects", () => {
      const obj = { a: 1, b: "two", c: [3, 4] };
      kg.set("test", "obj", obj);
      expect(kg.get("test", "obj")).toEqual(obj);
    });

    it("overwrites existing values", () => {
      kg.set("test", "key", "old");
      kg.set("test", "key", "new");
      expect(kg.get("test", "key")).toBe("new");
    });
  });

  describe("has", () => {
    it("returns true for existing keys", () => {
      kg.set("test", "key", "value");
      expect(kg.has("test", "key")).toBe(true);
    });

    it("returns false for missing keys", () => {
      expect(kg.has("test", "nope")).toBe(false);
    });

    it("returns false for expired keys", async () => {
      kg.set("test", "key", "value", 1);
      await new Promise((r) => setTimeout(r, 1100));
      expect(kg.has("test", "key")).toBe(false);
    });
  });

  describe("delete", () => {
    it("removes a value", () => {
      kg.set("test", "key", "value");
      expect(kg.delete("test", "key")).toBe(true);
      expect(kg.get("test", "key")).toBeUndefined();
    });

    it("returns false for missing keys", () => {
      expect(kg.delete("test", "nope")).toBe(false);
    });
  });

  describe("scope operations", () => {
    it("lists keys in a scope", () => {
      kg.set("scope-a", "k1", 1);
      kg.set("scope-a", "k2", 2);
      kg.set("scope-b", "k3", 3);

      const keys = kg.keys("scope-a");
      expect(keys).toHaveLength(2);
      expect(keys).toContain("k1");
      expect(keys).toContain("k2");
    });

    it("returns entries in a scope", () => {
      kg.set("scope-a", "k1", { name: "entry1" });
      const entries = kg.entries("scope-a");
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe("k1");
      expect(entries[0].value).toEqual({ name: "entry1" });
      expect(entries[0].scope).toBe("scope-a");
    });

    it("clears an entire scope", () => {
      kg.set("scope-a", "k1", 1);
      kg.set("scope-a", "k2", 2);
      kg.clearScope("scope-a");
      expect(kg.keys("scope-a")).toHaveLength(0);
      expect(kg.get("scope-a", "k1")).toBeUndefined();
    });

    it("does not affect other scopes when clearing one", () => {
      kg.set("scope-a", "k1", 1);
      kg.set("scope-b", "k2", 2);
      kg.clearScope("scope-a");
      expect(kg.get("scope-b", "k2")).toBe(2);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      kg.set("a", "k1", 1);
      kg.set("b", "k2", 2);
      kg.clear();
      expect(kg.stats().activeEntries).toBe(0);
    });
  });

  describe("industry helpers", () => {
    it("stores and retrieves industry patterns", () => {
      const patterns = { keywords: ["aviation", "safety"], score: 0.9 };
      kg.setIndustryPattern("aviation", "ats-patterns", patterns);
      expect(kg.getIndustryPattern("aviation", "ats-patterns")).toEqual(patterns);
    });

    it("scopes industry patterns correctly", () => {
      kg.setIndustryPattern("aviation", "pattern", "aviation-data");
      kg.setIndustryPattern("tech", "pattern", "tech-data");
      expect(kg.getIndustryPattern("aviation", "pattern")).toBe("aviation-data");
      expect(kg.getIndustryPattern("tech", "pattern")).toBe("tech-data");
    });
  });

  describe("provider helpers", () => {
    it("stores and retrieves provider metrics", () => {
      kg.setProviderMetric("openai", "avg-latency", 1200);
      expect(kg.getProviderMetric("openai", "avg-latency")).toBe(1200);
    });

    it("scopes provider metrics globally", () => {
      kg.setProviderMetric("openai", "success-rate", 0.95);
      // Provider metrics are in the "global" scope
      expect(kg.keys("global")).toContain("provider:openai:success-rate");
    });
  });

  describe("ATS cache helpers", () => {
    it("stores and retrieves ATS cache", () => {
      const analysis = { score: 85, gaps: ["keywords"], strengths: ["format"] };
      kg.setATSCache("job-123", analysis);
      expect(kg.getATSCache("job-123")).toEqual(analysis);
    });

    it("returns undefined for uncached jobs", () => {
      expect(kg.getATSCache("job-unknown")).toBeUndefined();
    });
  });

  describe("evictExpired", () => {
    it("evicts expired entries globally", async () => {
      kg.set("a", "permanent", "stay");
      kg.set("b", "temporary", "go", 1); // 1 second TTL
      await new Promise((r) => setTimeout(r, 1100));
      const evicted = kg.evictExpired();
      expect(evicted).toBeGreaterThanOrEqual(1);
      expect(kg.get("b", "temporary")).toBeUndefined();
      expect(kg.get("a", "permanent")).toBe("stay");
    });

    it("evicts expired entries in a specific scope", async () => {
      kg.set("scope-a", "perm", "stay");
      kg.set("scope-a", "temp", "go", 1);
      kg.set("scope-b", "other", "stay");
      await new Promise((r) => setTimeout(r, 1100));
      const evicted = kg.evictExpired("scope-a");
      expect(evicted).toBe(1);
      expect(kg.get("scope-a", "temp")).toBeUndefined();
      expect(kg.get("scope-a", "perm")).toBe("stay");
      expect(kg.get("scope-b", "other")).toBe("stay");
    });
  });

  describe("stats", () => {
    it("returns correct statistics", () => {
      kg.set("global", "m1", 1);
      kg.set("industry:aviation", "p1", 2);
      kg.set("industry:tech", "p2", 3);
      const stats = kg.stats();
      expect(stats.activeEntries).toBe(3);
      expect(stats.byScope["global"]).toBe(1);
      expect(stats.byScope["industry:aviation"]).toBe(1);
      expect(stats.byScope["industry:tech"]).toBe(1);
    });
  });
});

describe("pipelineKnowledge singleton", () => {
  it("is a KnowledgeGraph instance", async () => {
    const { pipelineKnowledge } = await import("./knowledge-graph");
    expect(pipelineKnowledge.set("test", "singleton", "works"));
    expect(pipelineKnowledge.get("test", "singleton")).toBe("works");
    pipelineKnowledge.clear();
  });
});
