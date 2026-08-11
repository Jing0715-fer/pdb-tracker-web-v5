/**
 * Recipe runner — executes a Python analysis recipe and returns parsed JSON.
 *
 * This is a lightweight reusable version of the logic in
 * src/app/api/analyze/run/route.ts, extracted so that server-side routes
 * (like /api/evaluations/run) can run analyses without making an internal
 * HTTP call.
 *
 * Round 34: Created for the Run Center ↔ Analysis module integration.
 * Round 35: Added chain detection, in-memory result caching, and
 *           parallel PDB download support.
 */

import { writeFile, mkdir, unlink, access, readFile } from "node:fs/promises";
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

// ── In-memory result cache (Round 35) ────────────────────────────────────────
// Key: `${pdbId}:${recipeId}:${JSON.stringify(params)}`
// Value: { result, ts }
// TTL: 30 minutes (structure analysis doesn't change)
const RESULT_CACHE = new Map<string, { result: unknown | null; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(pdbId: string, recipeId: string, params?: Record<string, unknown>): unknown | null | undefined {
  const key = `${pdbId}:${recipeId}:${params ? JSON.stringify(params) : ""}`;
  const entry = RESULT_CACHE.get(key);
  if (!entry) return undefined; // cache miss
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    RESULT_CACHE.delete(key); // expired
    return undefined;
  }
  return entry.result;
}

function setCached(pdbId: string, recipeId: string, params: unknown | undefined, result: unknown | null): void {
  const key = `${pdbId}:${recipeId}:${params ? JSON.stringify(params) : ""}`;
  RESULT_CACHE.set(key, { result, ts: Date.now() });
  // Cap cache size to prevent memory bloat
  if (RESULT_CACHE.size > 100) {
    // Delete oldest entry
    const oldest = RESULT_CACHE.keys().next().value;
    if (oldest) RESULT_CACHE.delete(oldest);
  }
}

// ── Chain detection (Round 35) ───────────────────────────────────────────────

export interface ChainInfo {
  chainId: string;
  atomCount: number;
  residueCount: number;
  isPolymer: boolean;
}

/**
 * Parse a cached PDB file and detect all chains with their atom/residue counts.
 * Used to pick the most relevant chains for inter-chain interaction analysis
 * (instead of hardcoding A/B).
 *
 * @param pdbId - PDB ID (must already be cached or will be downloaded)
 * @returns Array of ChainInfo sorted by atom count descending
 */
export async function detectChains(pdbId: string): Promise<ChainInfo[]> {
  const inputPath = await ensurePdbCached(pdbId);
  const content = await readFile(inputPath, "utf-8");
  const lines = content.split("\n");

  const chainMap = new Map<string, { atoms: number; residues: Set<string>; hasCA: boolean }>();

  for (const line of lines) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
    // PDB format: columns 1-6 = record name, 22 = chain ID (1-indexed)
    // In JS string indexing (0-indexed), chain ID is at position 21
    const chainId = line[21] || "?";
    const entry = chainMap.get(chainId) || { atoms: 0, residues: new Set<string>(), hasCA: false };
    entry.atoms++;
    // Residue sequence number is at columns 23-26 (1-indexed) = positions 22-25
    const resSeq = line.substring(22, 26).trim();
    if (resSeq) entry.residues.add(resSeq);
    // Check for CA atom (protein backbone) at columns 13-16
    const atomName = line.substring(12, 16).trim();
    if (atomName === "CA") entry.hasCA = true;
    chainMap.set(chainId, entry);
  }

  const chains: ChainInfo[] = [];
  for (const [chainId, info] of chainMap.entries()) {
    chains.push({
      chainId,
      atomCount: info.atoms,
      residueCount: info.residues.size,
      isPolymer: info.hasCA, // chains with CA atoms are polymers (protein/nucleic acid)
    });
  }

  // Sort by atom count descending (largest chains first)
  chains.sort((a, b) => b.atomCount - a.atomCount);
  return chains;
}

/**
 * Pick the two most relevant chains for inter-chain interaction analysis.
 * Prefers the two largest polymer chains.
 *
 * @param pdbId - PDB ID
 * @returns { chain1, chain2 } — the two best chains, or { chain1: "A", chain2: "A" } if only one chain
 */
export async function pickAnalysisChains(pdbId: string): Promise<{ chain1: string; chain2: string }> {
  try {
    const chains = await detectChains(pdbId);
    const polymers = chains.filter(c => c.isPolymer);
    if (polymers.length >= 2) {
      return { chain1: polymers[0].chainId, chain2: polymers[1].chainId };
    }
    if (polymers.length === 1) {
      return { chain1: polymers[0].chainId, chain2: polymers[0].chainId };
    }
    if (chains.length >= 2) {
      return { chain1: chains[0].chainId, chain2: chains[1].chainId };
    }
    if (chains.length === 1) {
      return { chain1: chains[0].chainId, chain2: chains[0].chainId };
    }
  } catch {
    // fall through to default
  }
  return { chain1: "A", chain2: "A" };
}

/**
 * Detect the primary ligand in a PDB structure by looking for common
 * biologically-relevant ligands. Falls back to the first HETATM non-water
 * molecule.
 *
 * @param pdbId - PDB ID
 * @returns The ligand compId (3-letter code), or null if none found
 */
export async function detectPrimaryLigand(pdbId: string): Promise<string | null> {
  try {
    const inputPath = await ensurePdbCached(pdbId);
    const content = await readFile(inputPath, "utf-8");
    const lines = content.split("\n");

    // Priority list of biologically-relevant ligands (common cofactors/substrates)
    const PRIORITY_LIGANDS = new Set([
      "ATP", "ADP", "AMP", "GTP", "GDP", "GMP",
      "NAD", "NAP", "NDP", "FAD", "FMN",
      "HEM", "HEC", "HEA", "HEB", "MLA",
      "PLP", "PQQ", "TPP",
      "REA", "RET", "BCL", "BPH",
      "SAH", "SAM", "ACP",
    ]);

    const hetatmCounts = new Map<string, number>();
    const WATER_CODES = new Set(["HOH", "WAT", "DOD"]);

    for (const line of lines) {
      if (!line.startsWith("HETATM")) continue;
      const compId = line.substring(17, 20).trim();
      if (!compId || WATER_CODES.has(compId)) continue;
      hetatmCounts.set(compId, (hetatmCounts.get(compId) || 0) + 1);
    }

    // First check for priority ligands
    for (const [compId] of hetatmCounts) {
      if (PRIORITY_LIGANDS.has(compId)) return compId;
    }

    // Fall back to the most common HETATM (by atom count)
    let bestLigand: string | null = null;
    let bestCount = 0;
    for (const [compId, count] of hetatmCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestLigand = compId;
      }
    }
    return bestLigand;
  } catch {
    return null;
  }
}

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
 * Results are cached for 30 minutes to speed up re-evaluations.
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
  // Round 35: Check cache first
  const cached = getCached(pdbId, recipeId, params);
  if (cached !== undefined) {
    return cached;
  }

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
    let result: unknown | null = null;
    if (trimmed) {
      // Try to find and parse the JSON block
      try {
        // The recipe may print other text before the JSON; find the first {
        const jsonStart = trimmed.indexOf("\n{");
        const startIdx =
          jsonStart >= 0 ? jsonStart + 1 : trimmed.startsWith("{") ? 0 : -1;
        if (startIdx >= 0) {
          const jsonStr = trimmed.slice(startIdx);
          result = JSON.parse(jsonStr);
        } else {
          // Try parsing the whole stdout as JSON
          result = JSON.parse(trimmed);
        }
      } catch {
        // JSON parsing failed — result stays null
        console.warn(
          `[recipe-runner] ${recipeId} on ${pdbId}: JSON parse failed. stderr: ${stderr.slice(0, 200)}`
        );
      }
    }

    // Round 35: Cache the result
    setCached(pdbId, recipeId, params, result);
    return result;
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
 * Uses the in-memory cache to skip re-computation.
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
