/**
 * VLM Client — Shared VLM (Vision Language Model) screenshot analysis.
 *
 * Extracted from chat-tab.tsx (Round 98) so both the legacy ReAct loop and
 * the tool-calling agent loop can invoke VLM analysis with the same logic.
 *
 * Flow:
 *   1. capture_multi_angle returns screenshots[]
 *   2. Store images immediately (without VLM) so user sees them right away
 *   3. Call /api/vlm/select-best in the background (with retry)
 *   4. On success: update images with best/score/confidence/comments/quality
 *   5. On quality='degraded'|'unacceptable': trigger recapture feedback
 */

import type { AnalysisImage } from "./store";

/**
 * Normalize interaction data from different recipe schemas to a unified format.
 *
 * Different recipes return interactions in different shapes:
 * - all_interactions: { interactions: [{chain1, resno1, atom1, chain2, resno2, atom2}] }
 * - hbonds: { hbonds: [{donor_chain, donor_resno, donor_atom, acceptor_chain, acceptor_resno, acceptor_atom, donor_resname, acceptor_resname}] }
 * - salt_bridges: { salt_bridges: [{pos_chain, pos_resno, pos_atom, neg_chain, neg_resno, neg_atom, pos_resname, neg_resname}] }
 * - hydrophobic_contacts: { hydrophobic_contacts: [{chain1, resno1, chain2, resno2}] } (no atom-level data)
 *
 * This normalizer converts all of them to: [{chain1, resno1, atom1, chain2, resno2, atom2}]
 * so that applyRecipeVisualization can draw side chains + dashed lines consistently.
 */
export function normalizeInteractions(analysisData: Record<string, unknown> | undefined): Array<{
  chain1: string;
  resno1: number;
  atom1?: string;
  chain2: string;
  resno2: number;
  atom2?: string;
  resname1?: string;
  resname2?: string;
}> {
  if (!analysisData) return [];
  const result: Array<Record<string, unknown>> = [];

  // all_interactions: already in the right format
  const interactions = analysisData.interactions as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(interactions)) {
    for (const i of interactions) {
      if (i.chain1 && i.resno1 && i.chain2 && i.resno2) {
        result.push({
          chain1: i.chain1, resno1: i.resno1, atom1: i.atom1,
          chain2: i.chain2, resno2: i.resno2, atom2: i.atom2,
          resname1: i.resname1, resname2: i.resname2,
        });
      }
    }
  }

  // hbonds: donor_* / acceptor_* → chain1/chain2
  const hbonds = analysisData.hbonds as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hbonds)) {
    for (const h of hbonds) {
      const dChain = h.donor_chain as string | undefined;
      const dResno = h.donor_resno as number | undefined;
      const aChain = h.acceptor_chain as string | undefined;
      const aResno = h.acceptor_resno as number | undefined;
      if (dChain && dResno && aChain && aResno) {
        result.push({
          chain1: dChain, resno1: dResno, atom1: h.donor_atom,
          resname1: h.donor_resname,
          chain2: aChain, resno2: aResno, atom2: h.acceptor_atom,
          resname2: h.acceptor_resname,
        });
      }
    }
  }

  // salt_bridges: pos_* / neg_* → chain1/chain2
  const saltBridges = analysisData.salt_bridges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(saltBridges)) {
    for (const s of saltBridges) {
      const pChain = s.pos_chain as string | undefined;
      const pResno = s.pos_resno as number | undefined;
      const nChain = s.neg_chain as string | undefined;
      const nResno = s.neg_resno as number | undefined;
      if (pChain && pResno && nChain && nResno) {
        result.push({
          chain1: pChain, resno1: pResno, atom1: s.pos_atom,
          resname1: s.pos_resname,
          chain2: nChain, resno2: nResno, atom2: s.neg_atom,
          resname2: s.neg_resname,
        });
      }
    }
  }

  // hydrophobic_contacts: may have chain1/resno1/chain2/resno2 directly
  const hydrophobic = analysisData.hydrophobic_contacts as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(hydrophobic)) {
    for (const h of hydrophobic) {
      if (h.chain1 && h.resno1 && h.chain2 && h.resno2) {
        result.push({
          chain1: h.chain1, resno1: h.resno1,
          chain2: h.chain2, resno2: h.resno2,
          resname1: h.resname1, resname2: h.resname2,
        });
      }
    }
  }

  // all_interactions fallback: also check allInteractions nested object
  const ai = analysisData.allInteractions as Record<string, unknown> | undefined;
  if (ai?.interactions && Array.isArray(ai.interactions)) {
    for (const i of ai.interactions as Array<Record<string, unknown>>) {
      if (i.chain1 && i.resno1 && i.chain2 && i.resno2) {
        result.push({
          chain1: i.chain1, resno1: i.resno1, atom1: i.atom1,
          chain2: i.chain2, resno2: i.resno2, atom2: i.atom2,
        });
      }
    }
  }

  return result as Array<{ chain1: string; resno1: number; atom1?: string; chain2: string; resno2: number; atom2?: string; resname1?: string; resname2?: string; }>;
}

/**
 * Extract residue labels from analysis data for screenshot annotation.
 * Uses one-letter amino acid codes (C145 instead of CYS145).
 */
export function extractResidueLabels(
  analysisData: Record<string, unknown> | undefined,
  maxLabels: number = 12,
): Array<{ text: string; chain?: string; resno?: number }> {
  if (!analysisData) return [];
  const THREE_TO_ONE: Record<string, string> = {
    ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E",
    GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F",
    PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V",
  };
  const formatLabel = (resname: string, resno: number) => {
    const one = THREE_TO_ONE[resname] || "?";
    return `${one}${resno}`;
  };
  const labels: Array<{ text: string; chain?: string; resno?: number }> = [];
  const seen = new Set<string>();

  // From binding_pocket residues
  const residues = analysisData.residues as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(residues)) {
    for (const r of residues.slice(0, maxLabels)) {
      const chain = r.chain as string | undefined;
      const resno = r.resno as number | undefined;
      const resname = r.resname as string | undefined;
      if (chain && resno && resname) {
        const key = `${chain}:${resno}`;
        if (!seen.has(key)) {
          seen.add(key);
          labels.push({ text: formatLabel(resname, resno), chain, resno });
        }
      }
    }
  }

  // From normalized interactions (covers hbonds, salt_bridges, all_interactions)
  const interactions = normalizeInteractions(analysisData);
  for (const i of interactions.slice(0, 20)) {
    if (labels.length >= maxLabels) break;
    const key1 = `${i.chain1}:${i.resno1}`;
    if (!seen.has(key1) && i.resname1) {
      seen.add(key1);
      labels.push({ text: formatLabel(i.resname1, i.resno1), chain: i.chain1, resno: i.resno1 });
    }
    const key2 = `${i.chain2}:${i.resno2}`;
    if (!seen.has(key2) && i.resname2) {
      seen.add(key2);
      labels.push({ text: formatLabel(i.resname2, i.resno2), chain: i.chain2, resno: i.resno2 });
    }
  }

  return labels.slice(0, maxLabels);
}

export interface VlmResult {
  bestIndex: number;
  commentary: string;
  scores?: number[];
  confidence?: "high" | "medium" | "low";
  comments?: string[];
  /** Round 98: Overall quality assessment */
  quality?: "acceptable" | "degraded" | "unacceptable";
  /** Round 98: Per-image issues (e.g. "侧链未显示", "氢键连线缺失") */
  issues?: string[];
  /** Round 98: Recapture hints when quality is degraded/unacceptable */
  recaptureHints?: {
    angles?: string[];
    focus?: string;
    zoom?: "in" | "out";
  };
  recipe?: string;
}

export interface ScreenshotData {
  dataUri: string;
  angle: string;
  label: string;
}

/**
 * Call /api/vlm/select-best to analyze screenshots.
 * Returns null on failure (caller can retry).
 */
export async function selectBestScreenshot(
  screenshots: ScreenshotData[],
  recipe: string,
  analysisSummary: string,
): Promise<VlmResult | null> {
  try {
    const vlmResponse = await fetch("/api/vlm/select-best", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshots,
        recipe,
        analysisSummary,
      }),
    });
    if (vlmResponse.ok) {
      return (await vlmResponse.json()) as VlmResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run VLM selection with retry. Calls selectBestScreenshot, retries once
 * after 5s if the first attempt fails.
 */
export async function selectBestWithRetry(
  screenshots: ScreenshotData[],
  recipe: string,
  analysisSummary: string,
): Promise<VlmResult | null> {
  let result = await selectBestScreenshot(screenshots, recipe, analysisSummary);
  if (!result) {
    console.warn("[vlm-client] First attempt failed, retrying in 5s…");
    await new Promise((r) => setTimeout(r, 5000));
    result = await selectBestScreenshot(screenshots, recipe, analysisSummary);
  }
  return result;
}

/**
 * Apply VLM result to a list of AnalysisImages for a specific recipe.
 * Returns the updated images (with best/score/confidence/comments/quality).
 */
export function applyVlmResultToImages(
  images: AnalysisImage[],
  recipe: string,
  vlm: VlmResult,
): AnalysisImage[] {
  return images.map((img) => {
    if (img.recipe !== recipe) return img;
    // Find the index of this image within the recipe's images
    const recipeImages = images.filter((i) => i.recipe === recipe);
    const idx = recipeImages.indexOf(img);
    return {
      ...img,
      best: idx === vlm.bestIndex,
      vlmComment:
        vlm.comments && idx < vlm.comments.length
          ? vlm.comments[idx]
          : idx === vlm.bestIndex
            ? vlm.commentary
            : undefined,
      score: vlm.scores && idx < vlm.scores.length ? vlm.scores[idx] : undefined,
      confidence: vlm.confidence,
      // R100.3: Set quality + issues from VLM result
      quality: vlm.quality,
      issues:
        vlm.issues && idx < vlm.issues.length
          ? [vlm.issues[idx]]
          : undefined,
    };
  });
}

/**
 * Check if VLM quality indicates the screenshots need to be recaptured.
 */
export function needsRecapture(vlm: VlmResult | null): boolean {
  if (!vlm?.quality) return false;
  return vlm.quality === "degraded" || vlm.quality === "unacceptable";
}

/**
 * Build a recapture instruction message for the agent loop.
 * This is appended to the tool result so the LLM knows to call recapture_screenshot.
 */
export function buildRecaptureInstruction(vlm: VlmResult, recipe: string): string {
  const issues = vlm.issues?.filter((i) => i.length > 0).slice(0, 5) || [];
  const hints = vlm.recaptureHints || {};
  const parts: string[] = [
    `VLM评估: 截图质量为 "${vlm.quality}"`,
  ];
  if (issues.length > 0) {
    parts.push(`问题: ${issues.join("; ")}`);
  }
  if (hints.angles && hints.angles.length > 0) {
    parts.push(`建议角度: ${hints.angles.join(", ")}`);
  }
  if (hints.focus) {
    parts.push(`建议聚焦: ${hints.focus}`);
  }
  if (hints.zoom) {
    parts.push(`建议缩放: ${hints.zoom === "in" ? "放大" : "缩小"}`);
  }
  parts.push(`请调用 recapture_screenshot 工具重新截图，传入 recipe="${recipe}" 和上述建议参数。`);
  return parts.join("\n");
}
