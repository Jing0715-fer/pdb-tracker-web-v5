import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { getRecipe, probeAllClis, CHILD_ENV } from "@/lib/molcraft/cli-registry";
import { normalizeRecipeName } from "@/lib/molcraft/recipe-aliases";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 60;

const TMP_DIR = join(tmpdir(), "molcraft-analysis");
const PDB_CACHE_DIR = join(TMP_DIR, "pdb");

interface RunBody {
  /** PDB ID to fetch + analyze (e.g. "9ehs"). Required unless `fileContent` is given. */
  pdbId?: string;
  /** Raw structure file content (PDB or mmCIF). */
  fileContent?: string;
  /** Format of fileContent: "pdb" or "cif". Defaults to "pdb". */
  fileFormat?: "pdb" | "cif";
  /** Second structure file content (for cross-structure recipes like per_residue_rmsd_two). */
  fileContent2?: string;
  /** Format of fileContent2. */
  fileFormat2?: "pdb" | "cif";
  /** Recipe id from ANALYSIS_RECIPES. */
  recipe: string;
  /** Recipe parameters. */
  params?: Record<string, unknown>;
}

/** R169 (PY-006): throttle — the cache GC sweep runs at most once per hour. */
let lastCacheSweep = 0;

async function ensureDirs() {
  await mkdir(PDB_CACHE_DIR, { recursive: true });
  // R169 (PY-006): GC the PDB cache — files (downloaded structures + staged
  // uploads) were NEVER garbage-collected and accumulated forever. Sweep at
  // most hourly (fire-and-forget); delete files older than 7 days.
  const now = Date.now();
  if (now - lastCacheSweep > 60 * 60 * 1000) {
    lastCacheSweep = now;
    void (async () => {
      try {
        const entries = await readdir(PDB_CACHE_DIR);
        const cutoff = now - 7 * 24 * 60 * 60 * 1000;
        let removed = 0;
        for (const name of entries) {
          const p = join(PDB_CACHE_DIR, name);
          try {
            const st = await stat(p);
            if (st.isFile() && st.mtimeMs < cutoff) {
              await unlink(p);
              removed++;
            }
          } catch {
            /* racing deletion — ignore */
          }
        }
        if (removed > 0) {
          console.log(`[analyze/run] cache GC: removed ${removed} files older than 7 days`);
        }
      } catch {
        /* best-effort */
      }
    })();
  }
}

/**
 * Download a structure file from RCSB. Tries PDB format first, falls back to
 * mmCIF (most EM / large structures are mmCIF-only). Returns the local path
 * and the actual format downloaded.
 */
async function getStructureFilePath(
  pdbId: string
): Promise<{ path: string; format: "pdb" | "cif" }> {
  const id = pdbId.toLowerCase();
  const upper = id.toUpperCase();
  const pdbPath = join(PDB_CACHE_DIR, `${id}.pdb`);
  const cifPath = join(PDB_CACHE_DIR, `${id}.cif`);

  if (existsSync(pdbPath)) return { path: pdbPath, format: "pdb" };
  if (existsSync(cifPath)) return { path: cifPath, format: "cif" };

  // Try PDB format first (small molecules, X-ray)
  const pdbRes = await fetch(
    `https://files.rcsb.org/download/${upper}.pdb`
  );
  if (pdbRes.ok) {
    const text = await pdbRes.text();
    if (text && !text.includes("404 Not Found") && text.length > 100) {
      await writeFile(pdbPath, text, "utf8");
      return { path: pdbPath, format: "pdb" };
    }
  }

  // Fall back to mmCIF (covers EM and large structures)
  const cifRes = await fetch(
    `https://files.rcsb.org/download/${upper}.cif`
  );
  if (cifRes.ok) {
    const text = await cifRes.text();
    if (text && text.length > 100) {
      await writeFile(cifPath, text, "utf8");
      return { path: cifPath, format: "cif" };
    }
  }

  throw new Error(
    `Failed to download structure ${upper}: neither PDB nor mmCIF available`
  );
}

/**
 * POST /api/analyze/run
 *
 * Runs a named analysis recipe (Python script using biopython / freesasa /
 * pdb-tools) on a structure file. The structure is either downloaded from
 * RCSB by PDB ID or provided directly as `fileContent`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunBody;
    if (!body.recipe) {
      return NextResponse.json(
        { error: "`recipe` is required" },
        { status: 400 }
      );
    }

    // R103.1: Normalize recipe name (e.g. "interface" → "all_interactions")
    const normalizedRecipe = normalizeRecipeName(body.recipe);
    if (normalizedRecipe !== body.recipe) {
      console.warn(`[analyze/run] Normalized recipe "${body.recipe}" → "${normalizedRecipe}"`);
    }
    const recipe = getRecipe(normalizedRecipe);
    if (!recipe) {
      return NextResponse.json(
        { error: `Unknown recipe: ${body.recipe}. Tried normalized: ${normalizedRecipe}. Available recipes: hbonds, salt_bridges, hydrophobic_contacts, all_interactions, binding_pocket, interface_residues, sasa, etc.` },
        { status: 400 }
      );
    }

    // R164 (PY-002 / MOL-001): Upstream param allow-list validation.
    // The recipe scripts use pyStr()/pyNum() to safely interpolate params
    // into Python source (JSON.stringify-quoted strings + finite-number
    // checks), but defense-in-depth: reject obviously-malformed values
    // here so a misbehaving LLM can't even reach the Python side with a
    // 10KB chain id or a negative pH. Maps each known param name to its
    // validator. Unknown params are stripped (don't pass them through).
    const STRING_PARAM_RE = /^[A-Za-z0-9_.\- ]{0,16}$/; // chain ids, compIds, ff names, fragment sets
    const POSITIVE_NUM = (n: unknown): boolean =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10000;
    const SMALL_NUM = (n: unknown): boolean =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000;
    const PH_RE = /^[0-9]+(\.[0-9]+)?$/; // pH 0..14 string-or-number
    const isStringParam = (v: unknown): boolean =>
      typeof v === 'string' && STRING_PARAM_RE.test(v);
    const isStringArrayParam = (v: unknown): boolean =>
      Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string' && /^[A-Za-z0-9_.\- ]{0,32}$/.test(x));

    const STRING_PARAMS = new Set([
      'chain', 'chain1', 'chain2', 'chainFilter',
      'ligandCompId', 'ligand_filter_id',
      'ff', 'fragmentSet', 'fragment_set',
      'pdbId1', 'pdbId2',
    ]);
    const POSITIVE_NUM_PARAMS = new Set([
      'cutoff', 'radius', 'ligandRadius', 'ligand_cutoff',
      'distTol', 'dist_tolerance', 'angleTol', 'angle_tolerance',
      'windowSize', 'window',
      'gridSpacing', 'grid_spacing', 'probeRadius', 'probe_radius',
      'minVolume', 'min_volume',
      'evalue', 'evalue_threshold',
      'threshold', 'ionic', 'grid',
      'pH', // 0..14, validated separately as a string-or-number
    ]);

    if (body.params) {
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.params)) {
        if (key.startsWith('__')) {
          // Reserved internal keys (__secondPath__) — pass through.
          // (R169/MOL-L5: __format__ plumbing removed — never consumed.)
          cleaned[key] = value;
          continue;
        }
        if (STRING_PARAMS.has(key)) {
          if (value === null || value === undefined || value === '') {
            // Allow empty / null (recipe will use its own default).
            continue;
          }
          if (!isStringParam(value)) {
            return NextResponse.json(
              { error: `Param "${key}" must be a short alphanumeric string (max 16 chars, [A-Za-z0-9_.- ]), got: ${JSON.stringify(value).slice(0, 80)}` },
              { status: 400 },
            );
          }
          cleaned[key] = value;
          continue;
        }
        if (POSITIVE_NUM_PARAMS.has(key)) {
          if (value === null || value === undefined || value === '') continue;
          if (key === 'pH') {
            if (typeof value === 'string' && PH_RE.test(value)) {
              cleaned[key] = Number(value);
              continue;
            }
          }
          if (!SMALL_NUM(value)) {
            return NextResponse.json(
              { error: `Param "${key}" must be a finite number in [0, 1000], got: ${JSON.stringify(value).slice(0, 80)}` },
              { status: 400 },
            );
          }
          cleaned[key] = value;
          continue;
        }
        if (key === 'pairs' || key === 'pdbIds') {
          if (!isStringArrayParam(value)) {
            return NextResponse.json(
              { error: `Param "${key}" must be an array of short strings (max 200 entries, each ≤32 chars [A-Za-z0-9_.- ]), got: ${JSON.stringify(value).slice(0, 80)}` },
              { status: 400 },
            );
          }
          cleaned[key] = value;
          continue;
        }
        if (key === 'intraChain' || key === 'intra_chain') {
          cleaned[key] = value ? true : false;
          continue;
        }
        // Unknown param — drop silently (defense-in-depth).
        console.warn(`[/api/analyze/run] Dropping unknown param "${key}"`);
      }
      body.params = cleaned;
    }

    // Check recipe dependencies are installed.
    const clis = await probeAllClis();
    const available = new Set(
      clis.filter((c) => c.available).map((c) => c.id)
    );
    const missing = recipe.requires.filter((r) => !available.has(r));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Recipe requires ${missing.join(", ")} but not available`,
          missing,
          availableClis: Array.from(available),
        },
        { status: 400 }
      );
    }

    await ensureDirs();

    // Resolve the input file path.
    // Recipes that don't need a single input structure file — they download
    // their own structures internally (e.g. cross_pdb_rmsd).
    const NO_INPUT_RECIPES = new Set(["cross_pdb_rmsd", "cross_pdb_rmsd_aligned", "align_and_superpose", "align_save_transformed"]);

    let inputPath: string;
    let inputFormat: "pdb" | "cif" = body.fileFormat ?? "pdb";
    // R169 (MOL-L5): check the NORMALIZED recipe id (aliases like
    // "cross-pdb-rmsd" previously missed the NO_INPUT branch and fell
    // through to the "pdbId or fileContent required" error).
    if (NO_INPUT_RECIPES.has(normalizedRecipe)) {
      // Use a placeholder path; the recipe script handles its own downloads.
      inputPath = "/dev/null";
    } else if (body.fileContent) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      inputPath = join(PDB_CACHE_DIR, `upload-${uploadId}.${inputFormat}`);
      await writeFile(inputPath, body.fileContent, "utf8");
    } else if (body.pdbId) {
      if (!/^[a-zA-Z0-9]{4}$/.test(body.pdbId)) {
        return NextResponse.json(
          { error: "`pdbId` must be a 4-character PDB ID" },
          { status: 400 }
        );
      }
      const result = await getStructureFilePath(body.pdbId);
      inputPath = result.path;
      inputFormat = result.format;
    } else {
      return NextResponse.json(
        { error: "Either `pdbId` or `fileContent` is required" },
        { status: 400 }
      );
    }

    // If the recipe needs a second structure (e.g. per_residue_rmsd_two),
    // write it to a sibling file.
    let secondPath: string | null = null;
    if (body.fileContent2) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      // R169 (PY-007): validate fileFormat2 — an arbitrary value flowed into
      // the staged filename (path.join keeps it under PDB_CACHE_DIR, so no
      // traversal, but defense-in-depth: only pdb/cif are meaningful).
      const secondFormat = body.fileFormat2 ?? "pdb";
      if (secondFormat !== "pdb" && secondFormat !== "cif") {
        return NextResponse.json(
          { error: "`fileFormat2` must be 'pdb' or 'cif'" },
          { status: 400 }
        );
      }
      secondPath = join(PDB_CACHE_DIR, `upload2-${uploadId}.${secondFormat}`);
      await writeFile(secondPath, body.fileContent2, "utf8");
    }

    // Build the script. (R169/MOL-L5: the `__format__` param was removed —
    // zero recipes ever consumed it; every recipe sniffs the input file
    // extension instead. `__secondPath__` IS consumed by two-structure
    // recipes' buildScript validation.)
    const script = recipe.buildScript(inputPath, {
      ...(body.params ?? {}),
      __secondPath__: secondPath ?? "",
    });
    // Use a unique suffix (timestamp + random) to avoid collisions when
    // multiple parallel requests run the same millisecond (e.g. the
    // structure-overview-dashboard fires 8 recipes concurrently via Promise.all).
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const scriptPath = join(TMP_DIR, `recipe-${uniqueId}.py`);
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(scriptPath, script, "utf8");

    // Run it.
    try {
      // R164 (PY-001): reuse the shared CHILD_ENV exported from cli-registry
      // so this route's spawn and the recipe-runner's spawn agree on PATH
      // (prepends /home/z/.venv/bin + /home/z/.local/bin for biopython +
      // pdb2pqr/propka). Previously this route had its own duplicate env-
      // building block; if the venv location ever changes, both spawn
      // sites would silently diverge.
      // Cross-platform: Windows usually has "python" not "python3"
      const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
      const { stdout, stderr } = await execFileAsync(
        pythonBin,
        [scriptPath],
        { timeout: 45_000, maxBuffer: 10 * 1024 * 1024, env: CHILD_ENV }
      );

      // Try to parse stdout as JSON; recipes print pretty-printed JSON.
      let parsed: unknown = null;
      try {
        // Find the first '{' at column 0 and take everything from there to the
        // matching '}' (the last '}' in the output for our recipes).
        const trimmed = stdout.trim();
        const startIdx = trimmed.indexOf("\n{");
        const jsonStart = startIdx >= 0 ? startIdx + 1 : (trimmed.startsWith("{") ? 0 : -1);
        if (jsonStart >= 0) {
          const jsonStr = trimmed.slice(jsonStart);
          parsed = JSON.parse(jsonStr);
        }
      } catch {
        parsed = null;
      }

      return NextResponse.json({
        recipe: recipe.id,
        ok: true,
        pdbId: body.pdbId,
        format: inputFormat,
        data: parsed,
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 2000) || undefined,
      });
    } finally {
      // Cleanup script file (keep PDB cache).
      try {
        await unlink(scriptPath);
      } catch {
        // ignore
      }
      if (body.fileContent) {
        try {
          await unlink(inputPath);
        } catch {
          // ignore
        }
      }
      if (secondPath) {
        try {
          await unlink(secondPath);
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    // R167 (MOL-M7): execFile's timeout/maxBuffer kills produce a generic
    // "Command failed" message with `killed`/`signal`/`code` set — surface
    // them so the LLM can distinguish "structure too large (45s timeout)"
    // from a real crash and stop retrying the same over-budget recipe.
    const execErr = err as { killed?: boolean; signal?: string; code?: string | number };
    if (execErr?.killed) {
      msg += ` (process killed: ${execErr.signal === 'SIGTERM' ? 'timeout 45s' : `signal ${execErr.signal ?? 'unknown'}`})`;
    } else if (execErr?.code && typeof execErr.code === 'string') {
      msg += ` (exit code ${execErr.code})`;
    }
    console.error("[/api/analyze/run] error:", msg);
    return NextResponse.json(
      { error: "Analysis run failed", detail: msg },
      { status: 500 }
    );
  }
}
