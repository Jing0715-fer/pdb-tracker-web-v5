/**
 * Recipe runner — executes a Python analysis recipe and returns parsed JSON.
 *
 * This is a lightweight reusable version of the logic in
 * src/app/api/analyze/run/route.ts, extracted so that server-side routes
 * (like /api/evaluations/run) can run analyses without making an internal
 * HTTP call.
 *
 * Round 34: Created for the Run Center ↔ Analysis module integration.
 */

import { writeFile, mkdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { getRecipe, probeAllClis } from "./cli-registry";

const execFileAsync = promisify(execFile);

const TMP_DIR = join(tmpdir(), "molcraft-analysis");
const PDB_CACHE_DIR = join(TMP_DIR, "pdb");

const PDB_URL = (id: string) =>
  `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`;

/**
 * Ensure a PDB file is downloaded to the cache. Returns the local file path.
 * If the file is already cached, returns immediately.
 */
async function ensurePdbCached(pdbId: string): Promise<string> {
  const id = pdbId.toLowerCase();
  const path = join(PDB_CACHE_DIR, `pdb${id}.ent`);
  try {
    await access(path);
    return path; // already cached
  } catch {
    // not cached — download it
  }
  await mkdir(PDB_CACHE_DIR, { recursive: true });
  const res = await fetch(PDB_URL(id));
  if (!res.ok) {
    throw new Error(`Failed to download PDB ${pdbId}: HTTP ${res.status}`);
  }
  const content = await res.text();
  await writeFile(path, content, "utf-8");
  return path;
}

/**
 * Run an analysis recipe on a PDB structure and return the parsed JSON result.
 *
 * @param recipeId - Recipe ID (e.g. "all_interactions", "binding_pocket")
 * @param pdbId - PDB ID (e.g. "4HHB")
 * @param params - Recipe parameters (e.g. { chain1: "A", chain2: "B" })
 * @returns Parsed JSON result from the recipe, or null if parsing failed.
 * @throws Error if the recipe is unknown, dependencies are missing, or
 *         execution fails.
 */
export async function runAnalysisRecipe(
  recipeId: string,
  pdbId: string,
  params?: Record<string, unknown>,
): Promise<unknown | null> {
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    throw new Error(`Unknown recipe: ${recipeId}`);
  }

  // Check dependencies
  const clis = await probeAllClis();
  const available = new Set(
    clis.filter((c) => c.available).map((c) => c.id)
  );
  const missing = recipe.requires.filter((r) => !available.has(r));
  if (missing.length > 0) {
    throw new Error(
      `Recipe ${recipeId} requires ${missing.join(", ")} but not available`
    );
  }

  // Ensure PDB is cached
  await mkdir(TMP_DIR, { recursive: true });
  const inputPath = await ensurePdbCached(pdbId);

  // Build the Python script
  const script = recipe.buildScript(inputPath, params || {});
  const scriptPath = join(TMP_DIR, `recipe-${recipeId}-${Date.now()}.py`);
  await writeFile(scriptPath, script, "utf-8");

  try {
    // Execute the Python script
    const { stdout, stderr } = await execFileAsync("python3", [scriptPath], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      cwd: TMP_DIR,
    });

    // Parse JSON from stdout (the recipe prints JSON to stdout)
    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Try to find and parse the JSON block
    try {
      // The recipe may print other text before the JSON; find the first {
      const jsonStart = trimmed.indexOf("\n{");
      const startIdx =
        jsonStart >= 0 ? jsonStart + 1 : trimmed.startsWith("{") ? 0 : -1;
      if (startIdx >= 0) {
        const jsonStr = trimmed.slice(startIdx);
        return JSON.parse(jsonStr);
      }
      // Try parsing the whole stdout as JSON
      return JSON.parse(trimmed);
    } catch {
      // JSON parsing failed — return null (caller handles gracefully)
      console.warn(
        `[recipe-runner] ${recipeId} on ${pdbId}: JSON parse failed. stderr: ${stderr.slice(0, 200)}`
      );
      return null;
    }
  } finally {
    // Cleanup script file
    try {
      await unlink(scriptPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Run multiple analysis recipes on a PDB structure in parallel.
 * Returns an object mapping recipe IDs to their results (or null on failure).
 *
 * @param pdbId - PDB ID to analyze
 * @param recipes - Array of { recipeId, params } objects
 * @returns Record<string, unknown | null> mapping recipeId → result
 */
export async function runMultipleAnalyses(
  pdbId: string,
  recipes: Array<{ recipeId: string; params?: Record<string, unknown> }>,
): Promise<Record<string, unknown | null>> {
  const entries = await Promise.all(
    recipes.map(async ({ recipeId, params }) => {
      try {
        const result = await runAnalysisRecipe(recipeId, pdbId, params);
        return [recipeId, result] as const;
      } catch (err) {
        console.warn(
          `[recipe-runner] ${recipeId} on ${pdbId} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return [recipeId, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}
