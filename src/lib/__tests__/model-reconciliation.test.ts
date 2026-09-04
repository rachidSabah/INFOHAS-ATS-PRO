import { describe, it, expect } from "vitest";
import { reconcileModelLists } from "../model-discovery";

// Fetch-button reconciliation: live API list amends stored models and
// drops retired ones; a retired current-default is flagged, never lost.
describe("reconcileModelLists", () => {
  it("adds new models and removes retired ones", () => {
    const rec = reconcileModelLists(
      ["a", "b", "old-model"],
      ["a", "b", "c"],
    );
    expect(rec.merged).toEqual(["a", "b", "c"]);
    expect(rec.added).toEqual(["c"]);
    expect(rec.retired).toEqual(["old-model"]);
    expect(rec.defaultRetired).toBeNull();
  });

  it("flags a retired current-default model", () => {
    const rec = reconcileModelLists(["gone-model", "b"], ["b", "c"], "gone-model");
    expect(rec.retired).toEqual(["gone-model"]);
    expect(rec.defaultRetired).toBe("gone-model");
  });

  it("trims, dedupes and sorts the live list", () => {
    const rec = reconcileModelLists([], ["  z  ", "a", "a", "m"]);
    expect(rec.merged).toEqual(["a", "m", "z"]);
    expect(rec.added).toEqual(["a", "m", "z"]);
    expect(rec.retired).toEqual([]);
  });

  it("reports no changes when lists already match", () => {
    const rec = reconcileModelLists(["a", "b"], ["b", "a"], "a");
    expect(rec.added).toEqual([]);
    expect(rec.retired).toEqual([]);
    expect(rec.defaultRetired).toBeNull();
  });
});
