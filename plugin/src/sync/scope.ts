import { normalizePath } from "obsidian";

export function normalizePatternList(value: string): string[] {
  return value
    .split("\n")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

export function shouldSyncPath(
  path: string,
  includePatterns: string[],
  ignorePatterns: string[],
): boolean {
  return matchesIncludePath(path, includePatterns) && !matchesAnyPattern(path, ignorePatterns);
}

export function describeSyncScope(
  includePatterns: string[],
  ignorePatterns: string[],
): string[] {
  if (includePatterns.length === 0 && ignorePatterns.length === 0) {
    return [
      "All vault paths are included.",
      "No ignore rules are configured.",
    ];
  }

  const lines: string[] = [];
  if (includePatterns.length === 0) {
    lines.push("All paths are eligible for sync.");
  } else {
    lines.push(`Only paths matching ${includePatterns.length} include pattern(s) are synced.`);
  }

  if (ignorePatterns.length === 0) {
    lines.push("No ignore rules override the selection.");
  } else {
    lines.push(`Ignore rules exclude ${ignorePatterns.length} pattern(s) after includes are applied.`);
  }

  return lines;
}

export function matchesSyncPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern.trim());
  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.endsWith("/")) {
    return normalizedPath.startsWith(normalizedPattern);
  }

  const regex = globPatternToRegExp(normalizedPattern);
  return regex.test(normalizedPath);
}

function matchesIncludePath(path: string, includePatterns: string[]): boolean {
  if (includePatterns.length === 0) {
    return true;
  }

  return matchesAnyPattern(path, includePatterns);
}

function matchesAnyPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesSyncPattern(path, pattern));
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";

  for (const char of pattern) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegExp(char);
    }
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}
