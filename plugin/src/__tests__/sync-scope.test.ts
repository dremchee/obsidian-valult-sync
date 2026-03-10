import { describe, expect, it } from "vitest";

import {
  describeSyncScope,
  matchesSyncPattern,
  normalizePatternList,
  shouldSyncPath,
} from "../sync-scope";

describe("sync-scope", () => {
  it("normalizes pattern lists from textarea input", () => {
    expect(normalizePatternList(" Notes/\n\n*.md \n")).toEqual(["Notes/", "*.md"]);
  });

  it("matches folder prefixes and globs", () => {
    expect(matchesSyncPattern("Notes/test.md", "Notes/")).toBe(true);
    expect(matchesSyncPattern("Notes/test.md", "*.md")).toBe(true);
    expect(matchesSyncPattern("Notes/test.md", "Note?/test.md")).toBe(true);
    expect(matchesSyncPattern("Templates/test.md", "Notes/")).toBe(false);
  });

  it("applies includes before ignores", () => {
    expect(shouldSyncPath("Notes/test.md", ["Notes/"], [])).toBe(true);
    expect(shouldSyncPath("Templates/test.md", ["Notes/"], [])).toBe(false);
    expect(shouldSyncPath("Notes/secret.md", ["Notes/"], ["*secret*"])).toBe(false);
  });

  it("describes sync scope in human-readable form", () => {
    expect(describeSyncScope([], [])).toEqual([
      "All vault paths are included.",
      "No ignore rules are configured.",
    ]);
    expect(describeSyncScope(["Notes/"], ["Templates/"])).toEqual([
      "Only paths matching 1 include pattern(s) are synced.",
      "Ignore rules exclude 1 pattern(s) after includes are applied.",
    ]);
  });
});
