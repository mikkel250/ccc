import fs from "node:fs";
import path from "node:path";

/** True when gitignored eval-results/ has at least one JD subdirectory. */
export function evalResultsArtifactsPresent(evalResultsDir: string): boolean {
  if (!fs.existsSync(evalResultsDir)) {
    return false;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(evalResultsDir);
  } catch {
    return false;
  }
  return entries.some((name) => {
    if (name.startsWith(".")) {
      return false;
    }
    try {
      return fs.statSync(path.join(evalResultsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
