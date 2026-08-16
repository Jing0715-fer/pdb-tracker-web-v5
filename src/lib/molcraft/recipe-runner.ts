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
const CIF_URL = (id: string) =>
  `https://files.rcsb.org/download/${id.toUpperCase()}.cif`;

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
  const isCif = inputPath.endsWith(".cif");

  const chainMap = new Map<string, { atoms: number; residues: Set<string>; hasCA: boolean }>();

  if (isCif) {
    // mmCIF format: parse atom_site loop
    // Lines look like: ATOM 1 N MET A 1 11.104 6.223 -5.378 1.00 35.76 N N
    // or: HETATM 1234 FE HEM A 1 11.104 6.223 -5.378 1.00 35.76 FE HEM
    // The chain is typically the 5th column (auth_asym_id) in the atom_site loop
    let inAtomSite = false;
    let chainCol = -1;
    let resSeqCol = -1;
    let atomNameCol = -1;
    let groupPdbCol = -1;
    for (const line of lines) {
      if (line.startsWith("_atom_site.")) {
        if (line.includes("auth_asym_id")) chainCol = line.indexOf("auth_asym_id");
        // We'll parse columns by splitting
        continue;
      }
      if (line.startsWith("loop_")) {
        inAtomSite = false;
        continue;
      }
      // Detect start of atom_site loop
      if (line.includes("_atom_site.group_PDB")) {
        inAtomSite = true;
        // Parse column headers
        const headers = lines.slice(lines.indexOf(line)).filter(l => l.startsWith("_atom_site.")).map(l => l.trim());
        chainCol = headers.findIndex(h => h.includes("auth_asym_id"));
        resSeqCol = headers.findIndex(h => h.includes("auth_seq_id"));
        atomNameCol = headers.findIndex(h => h.includes("label_atom_id"));
        groupPdbCol = headers.findIndex(h => h.includes("group_PDB"));
        continue;
      }
      if (inAtomSite && line.trim() && !line.startsWith("_") && !line.startsWith("#")) {
        const cols = line.trim().split(/\s+/);
        if (cols.length > Math.max(chainCol, resSeqCol, atomNameCol)) {
          const chainId = cols[chainCol >= 0 ? chainCol : 1] || "?";
          const entry = chainMap.get(chainId) || { atoms: 0, residues: new Set<string>(), hasCA: false };
          entry.atoms++;
          const resSeq = cols[resSeqCol >= 0 ? resSeqCol : 3];
          if (resSeq) entry.residues.add(resSeq);
          const atomName = cols[atomNameCol >= 0 ? atomNameCol : 2];
          if (atomName === "CA") entry.hasCA = true;
          chainMap.set(chainId, entry);
        }
      }
    }
  } else {
    // PDB format
    for (const line of lines) {
      if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
      const chainId = line[21] || "?";
      const entry = chainMap.get(chainId) || { atoms: 0, residues: new Set<string>(), hasCA: false };
      entry.atoms++;
      const resSeq = line.substring(22, 26).trim();
      if (resSeq) entry.residues.add(resSeq);
      const atomName = line.substring(12, 16).trim();
      if (atomName === "CA") entry.hasCA = true;
      chainMap.set(chainId, entry);
    }
  }

  const chains: ChainInfo[] = [];
  for (const [chainId, info] of chainMap.entries()) {
    chains.push({
      chainId,
      atomCount: info.atoms,
      residueCount: info.residues.size,
      isPolymer: info.hasCA,
    });
  }

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
    const isCif = inputPath.endsWith(".cif");

    // Priority list of biologically-relevant ligands (common cofactors/substrates)
    const PRIORITY_LIGANDS = new Set([
      "ATP", "ADP", "AMP", "GTP", "GDP", "GMP",
      "NAD", "NAP", "NDP", "FAD", "FMN",
      "HEM", "HEC", "HEA", "HEB", "MLA",
      "PLP", "PQQ", "TPP",
      "REA", "RET", "BCL", "BPH",
      "SAH", "SAM", "ACP",
    ]);

    // Round 40: Blocklist of ions and small molecules that are not biologically
    // relevant for drug design. These are common crystallization additives or
    // buffer components that should not be used as binding pocket centers.
    const ION_BLOCKLIST = new Set([
      // Common ions
      "SO4", "PO4", "SEP", "TPO", "PTR", "CSO",
      "MG", "ZN", "CA", "FE", "CU", "MN", "NI", "CO", "CD", "HG", "PB",
      "NA", "CL", "K", "LI", "RB", "CS", "BA", "SR",
      "BR", "I", "F",
      // Common buffer/crystallization additives
      "GOL", "PEG", "EDO", "DMS", "ACT", "FMT", "CIT", "MAL", "FUM", "SUC",
      "MES", "TRS", "HEPES", "PIPES", "MOPS", "EPE", "TRS",
      "DOD", "EOH", "MBO", "MRD", "PG4", "PGE",
      // Small detergents/salts
      "CIT", "CL", "ACY", "ACY", "AZI", "BH3", "BEN", "BME", "BOG",
      "C2E", "CAC", "CHX", "DAH", "DIO", "DPG", "DTT", "EPE",
      // Lipids and detergents (not drug targets)
      "LDA", "LMT", "LMG", "OLC", "OLE", "PCW", "PEU", "PLM", "PGV",
      // Common covalent modifiers (not drug targets)
      "MES", "MSE",
    ]);

    const hetatmCounts = new Map<string, number>();
    const WATER_CODES = new Set(["HOH", "WAT", "DOD"]);

    if (isCif) {
      // mmCIF format: parse atom_site loop for HETATM records
      let inAtomSite = false;
      let compIdCol = -1;
      let groupPdbCol = -1;
      for (const line of lines) {
        if (line.includes("_atom_site.group_PDB")) {
          inAtomSite = true;
          const headers = lines.slice(lines.indexOf(line)).filter(l => l.startsWith("_atom_site.")).map(l => l.trim());
          compIdCol = headers.findIndex(h => h.includes("auth_comp_id"));
          groupPdbCol = headers.findIndex(h => h.includes("group_PDB"));
          continue;
        }
        if (inAtomSite && line.trim() && !line.startsWith("_") && !line.startsWith("#")) {
          const cols = line.trim().split(/\s+/);
          const group = groupPdbCol >= 0 ? cols[groupPdbCol] : cols[0];
          if (group !== "HETATM") continue;
          const compId = compIdCol >= 0 ? cols[compIdCol] : cols[3];
          if (!compId || WATER_CODES.has(compId)) continue;
          hetatmCounts.set(compId, (hetatmCounts.get(compId) || 0) + 1);
        }
      }
    } else {
      // PDB format
      for (const line of lines) {
        if (!line.startsWith("HETATM")) continue;
        const compId = line.substring(17, 20).trim();
        if (!compId || WATER_CODES.has(compId)) continue;
        hetatmCounts.set(compId, (hetatmCounts.get(compId) || 0) + 1);
      }
    }

    // First check for priority ligands (bypasses blocklist)
    for (const [compId] of hetatmCounts) {
      if (PRIORITY_LIGANDS.has(compId)) return compId;
    }

    // Round 40: Fall back to the most common HETATM that is NOT in the ion blocklist.
    // This skips SO4, PO4, MG, ZN, etc. and picks the next real ligand.
    let bestLigand: string | null = null;
    let bestCount = 0;
    for (const [compId, count] of hetatmCounts) {
      if (ION_BLOCKLIST.has(compId)) continue;
      if (count > bestCount) {
        bestCount = count;
        bestLigand = compId;
      }
    }

    // If all HETATM are ions/blocked, fall back to the most common one
    // (better to have an ion than nothing — the recipe will still run)
    if (!bestLigand && hetatmCounts.size > 0) {
      let fallbackCount = 0;
      for (const [compId, count] of hetatmCounts) {
        if (count > fallbackCount) {
          fallbackCount = count;
          bestLigand = compId;
        }
      }
    }

    return bestLigand;
  } catch {
    return null;
  }
}

/**
 * Round 50: Detect ALL valid (non-ion) ligands in a PDB structure.
 * Returns an array of compIds, sorted by priority then atom count descending.
 * Used for multi-ligand analysis.
 */
export async function detectAllLigands(pdbId: string): Promise<string[]> {
  try {
    const inputPath = await ensurePdbCached(pdbId);
    const content = await readFile(inputPath, "utf-8");
    const lines = content.split("\n");
    const isCif = inputPath.endsWith(".cif");
    const PRIORITY_LIGANDS = new Set(["ATP","ADP","AMP","GTP","GDP","GMP","NAD","NAP","NDP","FAD","FMN","HEM","HEC","HEA","HEB","MLA","PLP","PQQ","TPP","REA","RET","BCL","BPH","SAH","SAM","ACP"]);
    const ION_BLOCKLIST = new Set(["SO4","PO4","SEP","TPO","PTR","CSO","MG","ZN","CA","FE","CU","MN","NI","CO","CD","HG","PB","NA","CL","K","LI","RB","CS","BA","SR","BR","I","F","GOL","PEG","EDO","DMS","ACT","FMT","CIT","MAL","FUM","SUC","MES","TRS","HEPES","PIPES","MOPS","EPE","DOD","EOH","MBO","MRD","PG4","PGE","ACY","AZI","BH3","BEN","BME","BOG","C2E","CAC","CHX","DAH","DIO","DPG","DTT","LDA","LMT","LMG","OLC","OLE","PCW","PEU","PLM","PGV","MSE"]);
    const WATER_CODES = new Set(["HOH","WAT","DOD"]);
    const hetatmCounts = new Map<string, number>();
    if (isCif) {
      let inAtomSite = false; let compIdCol = -1; let groupPdbCol = -1;
      for (const line of lines) {
        if (line.includes("_atom_site.group_PDB")) {
          inAtomSite = true;
          const headers = lines.slice(lines.indexOf(line)).filter(l => l.startsWith("_atom_site.")).map(l => l.trim());
          compIdCol = headers.findIndex(h => h.includes("auth_comp_id"));
          groupPdbCol = headers.findIndex(h => h.includes("group_PDB"));
          continue;
        }
        if (inAtomSite && line.trim() && !line.startsWith("_") && !line.startsWith("#")) {
          const cols = line.trim().split(/\s+/);
          const group = groupPdbCol >= 0 ? cols[groupPdbCol] : cols[0];
          if (group !== "HETATM") continue;
          const compId = compIdCol >= 0 ? cols[compIdCol] : cols[3];
          if (!compId || WATER_CODES.has(compId)) continue;
          hetatmCounts.set(compId, (hetatmCounts.get(compId) || 0) + 1);
        }
      }
    } else {
      for (const line of lines) {
        if (!line.startsWith("HETATM")) continue;
        const compId = line.substring(17, 20).trim();
        if (!compId || WATER_CODES.has(compId)) continue;
        hetatmCounts.set(compId, (hetatmCounts.get(compId) || 0) + 1);
      }
    }
    const validLigands: Array<{ compId: string; count: number; isPriority: boolean }> = [];
    for (const [compId, count] of hetatmCounts) {
      if (PRIORITY_LIGANDS.has(compId)) { validLigands.push({ compId, count, isPriority: true }); }
      else if (!ION_BLOCKLIST.has(compId)) { validLigands.push({ compId, count, isPriority: false }); }
    }
    validLigands.sort((a, b) => {
      if (a.isPriority && !b.isPriority) return -1;
      if (!a.isPriority && b.isPriority) return 1;
      return b.count - a.count;
    });
    return validLigands.slice(0, 3).map(l => l.compId);
  } catch { return []; }
}

/**
 * Ensure a PDB file is downloaded to the cache. Returns the local file path.
 * If the file is already cached, returns immediately.
 * Round 38: Falls back to mmCIF format if PDB format returns 404 (some newer
 * structures are only available as mmCIF).
 */
async function ensurePdbCached(pdbId: string): Promise<string> {
  const id = pdbId.toLowerCase();
  const pdbPath = join(PDB_CACHE_DIR, `pdb${id}.ent`);
  const cifPath = join(PDB_CACHE_DIR, `${id}.cif`);
  try {
    await access(pdbPath);
    return pdbPath; // PDB already cached
  } catch {
    // PDB not cached — try downloading
  }
  // Also check if CIF is cached (from a previous fallback)
  try {
    await access(cifPath);
    return cifPath;
  } catch {
    // CIF not cached either
  }
  await mkdir(PDB_CACHE_DIR, { recursive: true });

  // Try PDB format first
  try {
    const res = await fetch(PDB_URL(id));
    if (res.ok) {
      const content = await res.text();
      // Verify it's actually PDB format (starts with ATOM/HETATM/HEADER)
      if (content.length > 100 && /^(ATOM|HETATM|HEADER|REMARK)/m.test(content)) {
        await writeFile(pdbPath, content, "utf-8");
        return pdbPath;
      }
    }
  } catch {
    // PDB download failed — try CIF
  }

  // Fall back to mmCIF format
  // Note: Biopython can parse mmCIF, but the recipe scripts use PDBParser.
  // We download the CIF but recipes may fail — this is a best-effort approach.
  // The /api/analyze/run route has its own download logic that handles this
  // more robustly with format conversion.
  const res = await fetch(CIF_URL(id));
  if (res.ok) {
    const content = await res.text();
    await writeFile(cifPath, content, "utf-8");
    return cifPath;
  }
  throw new Error(`Failed to download PDB ${pdbId}: HTTP ${res.status} (tried both .pdb and .cif)`);
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
    // Round 51: Cross-platform — Windows uses 'python', POSIX uses 'python3'
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath], {
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
          `[recipe-runner] ${recipeId} on ${pdbId}: JSON parse failed. stdout: ${trimmed.slice(0, 200)}, stderr: ${stderr.slice(0, 200)}`
        );
      }
    }

    // Round 35/48: Cache the result — but ONLY if it's non-null.
    // Null results (failed recipes) should NOT be cached, otherwise
    // subsequent runs will skip the actual computation and return null
    // immediately from cache, making it impossible to recover from
    // transient failures (e.g., PDB download timeout, Python error).
    if (result !== null) {
      setCached(pdbId, recipeId, params, result);
    }
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
 * Round 37: Run multiple analysis recipes and return results with cache info.
 * Each result includes a `__cached: boolean` flag indicating whether the
 * result came from the cache or was freshly computed.
 *
 * @param pdbId - PDB ID to analyze
 * @param recipes - Array of { recipeId, params } objects
 * @returns Object with `results` (recipeId → result) and `cacheHits` (count)
 */
export async function runMultipleAnalysesWithCacheInfo(
  pdbId: string,
  recipes: Array<{ recipeId: string; params?: Record<string, unknown> }>,
): Promise<{ results: Record<string, unknown | null>; cacheHits: number; cacheMisses: number }> {
  let cacheHits = 0;
  let cacheMisses = 0;
  const entries = await Promise.all(
    recipes.map(async ({ recipeId, params }) => {
      // Check cache before running
      const cached = getCached(pdbId, recipeId, params);
      if (cached !== undefined) {
        cacheHits++;
        return [recipeId, cached] as const;
      }
      try {
        const result = await runAnalysisRecipe(recipeId, pdbId, params);
        cacheMisses++;
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
  return {
    results: Object.fromEntries(entries),
    cacheHits,
    cacheMisses,
  };
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
