'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZoomIn, ZoomOut, RotateCcw, X, ExternalLink, Network as NetIcon, Maximize2, Lightbulb } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;             // either "cluster-0" or paper pmid
  kind: 'cluster' | 'paper';
  label: string;          // cluster: topic name or paper title (truncated)
  pmid?: string;          // present if kind='paper'
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;           // radius
  color: string;          // primary fill
  methodColor?: string;   // for paper nodes
  IF?: number | null;
  year?: string;
  journal?: string;
  count?: number;         // for cluster: # of papers inside
  paperIds?: string[];    // for cluster: pmid list
}

interface GraphEdge {
  source: string;
  target: string;
  type: 'pdb' | 'structure' | 'method' | 'cluster-link';
  weight: number;
  sharedItems: string[];
  label?: string;
}

interface LiteratureCitationNetworkProps {
  papers: LitPaper[];
  onClose?: () => void;
  onSelectPaper?: (pmid: string) => void;
}

const EDGE_COLORS = {
  pdb:     '#2d8f8f',          // teal — strongest signal (same PDB ID)
  structure: '#c96442',        // burnt orange — same biological structure
  method:   '#7c5cbf',         // purple — same experimental method (cryo/xray/nmr)
  'cluster-link': '#8a8a8a',   // grey — cluster-to-cluster link
};

const EDGE_LABELS: Record<keyof typeof EDGE_COLORS, string> = {
  pdb:     'Shared PDB',
  structure: 'Shared Sub-topic',
  method:  'Same Method',
  'cluster-link': 'Cluster Link',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNodeMethodColor(paper: LitPaper): string {
  const methods = paper.pdbs.map(p => p.method || '');
  if (methods.some(m => m.toLowerCase().includes('cryo'))) return '#2d8f8f';
  if (methods.some(m => m.toLowerCase().includes('x-ray') || m.toLowerCase().includes('xray'))) return '#7c5cbf';
  if (methods.some(m => m.toLowerCase().includes('nmr'))) return '#c9872e';
  return '#c96442';
}

function getYear(pubdate: string | undefined): string {
  if (!pubdate) return '????';
  const m = String(pubdate).match(/(\d{4})/);
  return m ? m[1] : '????';
}

// ─── Structure / method extraction ───────────────────────────────────────────
//
// KEY INSIGHT: Two papers should be connected only when they share a
// MEANINGFUL relationship BEYOND just being in the same cluster.
//
// In the old algorithm, within a "ribosome" cluster, ALL papers shared the
// "ribosome" keyword, so ALL papers got connected → hairball.
//
// New algorithm: Within a cluster, we EXCLUDE the cluster's primary keyword
// from the shared-structure check. We only connect papers when they share
// SECONDARY structure keywords, PDB IDs, or compound signals.

const STRUCTURE_KEYWORDS: { pattern: RegExp; canonical: string }[] = [
  // Ribosome / translation
  { pattern: /\b(ribosome|ribosomal|ribosom)\b/i, canonical: 'ribosome' },
  { pattern: /\b(translation\s+(?:factor|machinery|process|cycle))\b/i, canonical: 'translation' },
  { pattern: /\b(60S|40S|50S|30S|70S|80S)\b/i, canonical: 'ribosome' },
  { pattern: /\b(EF-?[GTuP]|eIF|release\s+factor|tRNA)\b/i, canonical: 'translation' },
  // Proteasome / protein degradation
  { pattern: /\b(proteasome|proteasomal|proteolysis|ubiquitin|SCF|FBXO|E3\s+ligase|degron)\b/i, canonical: 'proteasome' },
  // Membrane proteins
  { pattern: /\b(GPCR|G-?protein[- ]coupled)\b/i, canonical: 'GPCR' },
  { pattern: /\b(ion\s+channel|potassium\s+channel|sodium\s+channel|calcium\s+channel|chloride\s+channel|TRP\w*|TRPC\w*|TRPV\w*)\b/i, canonical: 'ion-channel' },
  { pattern: /\b(transporter|ABC\s+transporter|symporter|antiporter|pump|ATPase)\b/i, canonical: 'transporter' },
  { pattern: /\b(receptor|kinase|phosphatase)\b/i, canonical: 'receptor-kinase' },
  // Cytoskeleton / motors / kinetochore
  { pattern: /\b(microtubule|actin|myosin|kinesin|dynein|tubulin|kinetochore|centromere|spindle)\b/i, canonical: 'cytoskeleton' },
  // Chromatin / DNA / RNA / gene regulation
  { pattern: /\b(chromatin|nucleosome|histone|DNA[- ]histone|epigenetic)\b/i, canonical: 'chromatin' },
  { pattern: /\b(DNA\s+repair|homologous\s+recombination|non-?homologous|replication\s+fork|DNA\s+damage)\b/i, canonical: 'DNA-repair' },
  { pattern: /\b(transcription|RNA\s+polymerase|TFIIB|TFIID|Mediator|Pol\s+II)\b/i, canonical: 'transcription' },
  { pattern: /\b(CRISPR|Cas\d|sgRNA|tracrRNA|anti[- ]CRISPR|acrs)\b/i, canonical: 'CRISPR' },
  { pattern: /\b(telomerase|telomere)\b/i, canonical: 'telomere' },
  { pattern: /\b(spliceosome|splicing|splice|U\d+snRNP|U1|U2|U4|U5|U6)\b/i, canonical: 'spliceosome' },
  { pattern: /\b(ribozyme|RNase\s+P|riboswitch)\b/i, canonical: 'RNA-enzyme' },
  // Virus
  { pattern: /\b(virus|viral|capsid|envelope|spike|polymerase.*virus|reverse\s+transcriptase|integrase|bacteriophage|phage|anti-?phage)\b/i, canonical: 'virus' },
  // Antibodies / immune
  { pattern: /\b(antibody|antibodies|immunoglobulin|IgG|Fab|antigen|immune|cytokine|T[- ]cell\s+receptor|MHC|TCR|BCR)\b/i, canonical: 'immune' },
  // Channels/pores
  { pattern: /\b(porin|alpha-?hemolysin|aerolysin|toxin\s+pore|injection\s+system|contractile\s+injection)\b/i, canonical: 'pore-toxin' },
  // Photosynthesis
  { pattern: /\b(photosystem|photosynthesis|chloroplast|PSI|PSII)\b/i, canonical: 'photosynthesis' },
  // Chaperones
  { pattern: /\b(chaperone|chaperonin|GroEL|Hsp\d)\b/i, canonical: 'chaperone' },
  // Mitochondria / metabolism
  { pattern: /\b(mitochondri|respiratory\s+complex|electron\s+transport\s+chain)\b/i, canonical: 'mitochondria' },
  // Signaling / mTOR / kinases
  { pattern: /\b(mTOR|mTORC1|mTORC2|PI3K|Akt|Ras|Raf|ERK|MAPK|signaling\s+pathway)\b/i, canonical: 'signaling' },
  // Common enzyme classes
  { pattern: /\b(dehydrogenase|synthase|polymerase|isomerase|ligase|demethylase|methyltransferase|acetyltransferase)\b/i, canonical: 'enzyme' },
];

// Method extraction
const METHOD_KEYWORDS: { pattern: RegExp; canonical: string }[] = [
  { pattern: /\b(cryo-?em|cryoem|cryo-?electron\s+microscopy|single[- ]particle\s+cryo)\b/i, canonical: 'cryo-EM' },
  { pattern: /\b(x-?ray|xray|x-?ray\s+diffraction|crystallography|crystal\s+structure)\b/i, canonical: 'X-ray' },
  { pattern: /\b(NMR|nuclear\s+magnetic\s+resonance)\b/i, canonical: 'NMR' },
  { pattern: /\b(cryo-?ET|tomograph)\b/i, canonical: 'cryo-ET' },
  { pattern: /\b(EMSA|electron\s+microscopy.*negative\s+stain)\b/i, canonical: 'EM-other' },
];

// Extract structure + method tags from a paper's text
function extractTags(paper: LitPaper): { structures: Set<string>; methods: Set<string> } {
  const text = `${paper.title || ''} ${(paper.abstract || '').slice(0, 200)}`.toLowerCase();
  const structures = new Set<string>();
  const methods = new Set<string>();
  for (const { pattern, canonical } of STRUCTURE_KEYWORDS) {
    if (pattern.test(text)) structures.add(canonical);
  }
  for (const { pattern, canonical } of METHOD_KEYWORDS) {
    if (pattern.test(text)) methods.add(canonical);
  }
  // PDB method as fallback for method
  for (const pdb of paper.pdbs || []) {
    if (pdb.method) {
      const m = pdb.method.toLowerCase();
      if (m.includes('cryo')) methods.add('cryo-EM');
      else if (m.includes('x-ray') || m.includes('xray')) methods.add('X-ray');
      else if (m.includes('nmr')) methods.add('NMR');
      else if (m.includes('epr')) methods.add('EPR');
    }
  }
  return { structures, methods };
}

// ─── OPTIMIZED Graph Builder ─────────────────────────────────────────────────
//
// KEY CHANGES from old algorithm:
//
// 1. NO DATA CAP: Use ALL papers (removed MAX_PAPERS_FOR_FULL = 150 cap)
//
// 2. EXCLUDE CLUSTER PRIMARY KEYWORD: Within a cluster, we don't create edges
//    based on the cluster's own topic keyword. The fact that all papers in a
//    "ribosome" cluster mention "ribosome" is WHY they're in the same cluster,
//    not an additional relationship signal.
//
// 3. MULTI-SIGNAL COMPOSITE SCORING: Instead of using `continue` to pick only
//    the first matching signal, we compute ALL signals and sum them into a
//    composite weight. A paper pair sharing both a PDB ID AND a secondary
//    structure keyword gets a much stronger connection than one sharing only
//    a method.
//
// 4. MINIMUM WEIGHT THRESHOLD: Only create edges above a minimum weight to
//    filter out noise (e.g., two papers that only share "cryo-EM" method).
//
// 5. PER-NODE DEGREE CAP: Limit the max number of edges per node to keep
//    the graph readable. Keep only the strongest connections per node.

// Weight multipliers for each signal type
const WEIGHT_PDB = 10;           // Shared PDB ID — strongest signal (same structure)
const WEIGHT_SECONDARY_STRUCT = 5; // Shared secondary structure keyword
const WEIGHT_METHOD = 1;         // Shared method — weak alone, boosts compound edges
const MIN_EDGE_WEIGHT = 3;       // Minimum composite weight to create an edge
const MAX_EDGES_PER_NODE = 8;    // Max edges per node (keep graph sparse)

function buildGraph(papers: LitPaper[]): {
  clusters: GraphNode[];
  papers: GraphNode[];
  edges: GraphEdge[];
  clusterLinks: GraphEdge[];
  clusterOfPaper: Map<string, number>;
} {
  // Sort by IF desc; nulls last; ties → most recent first
  const sorted = [...papers].sort((a, b) => {
    const ai = a.IF ?? -1;
    const bi = b.IF ?? -1;
    if (bi !== ai) return bi - ai;
    return (b.pubdate || '').localeCompare(a.pubdate || '');
  });

  // USE ALL PAPERS — no cap
  const top = sorted;
  const n = top.length;
  if (n === 0) return { clusters: [], papers: [], edges: [], clusterLinks: [], clusterOfPaper: new Map() };

  // ── Cluster by EXTRACTED STRUCTURE KEYWORD ──────────────────────────────
  // A paper goes into the first structure that matches.
  // If no structure matches → "Other" cluster.
  const clusterMap = new Map<string, { id: number; topic: string; pmids: string[]; papers: LitPaper[]; color: string; topicKeyword: string }>();
  let clusterCounter = 0;
  const clusterOfPaper = new Map<string, number>();
  // Also store each paper's PRIMARY keyword for later exclusion in edge building
  const primaryKeywordOfPaper = new Map<string, string>();

  for (const p of top) {
    const { structures } = extractTags(p);
    const topic = structures.size > 0 ? [...structures][0] : '__other__';
    const key = topic;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, { id: clusterCounter++, topic, pmids: [], papers: [], color: '', topicKeyword: topic });
    }
    const c = clusterMap.get(key)!;
    c.pmids.push(p.pmid);
    c.papers.push(p);
    clusterOfPaper.set(p.pmid, c.id);
    primaryKeywordOfPaper.set(p.pmid, topic);
  }

  // Sort clusters by size, then by avg IF
  const clustersRaw = Array.from(clusterMap.values()).sort((a, b) => {
    if (b.pmids.length !== a.pmids.length) return b.pmids.length - a.pmids.length;
    const aIF = a.papers.reduce((s, p) => s + (p.IF ?? 0), 0) / a.papers.length;
    const bIF = b.papers.reduce((s, p) => s + (p.IF ?? 0), 0) / b.papers.length;
    return bIF - aIF;
  });

  // Merge tiny clusters (< 2 papers) into "Other"
  const minClusterSize = 2;
  const big = clustersRaw.filter(c => c.pmids.length >= minClusterSize);
  const small = clustersRaw.filter(c => c.pmids.length < minClusterSize);
  if (small.length > 0) {
    const other = { id: clustersRaw.length, topic: 'Other', pmids: [] as string[], papers: [] as LitPaper[], color: '', topicKeyword: '__other__' };
    for (const s of small) {
      other.pmids.push(...s.pmids);
      other.papers.push(...s.papers);
      for (const pmid of s.pmids) clusterOfPaper.set(pmid, other.id);
    }
    big.push(other);
  }

  // Assign colors to clusters
  const palette = ['#c96442', '#2d8f8f', '#c9872e', '#7c5cbf', '#5a8c4e', '#b85c8e', '#3d6e9c', '#a05a3c', '#6b8e23'];
  big.forEach((c, i) => { c.color = palette[i % palette.length]; });

  // ── Build cluster super-nodes ───────────────────────────────────────────
  const cN = big.length;
  const centerX = 400, centerY = 300;
  const clusterRadius = Math.min(260, 100 + cN * 18);
  const clusters: GraphNode[] = big.map((c, i) => {
    const angle = (2 * Math.PI * i) / cN;
    const avgIF = c.papers.reduce((s, p) => s + (p.IF ?? 0), 0) / c.papers.length;
    const r = Math.max(20, 18 + Math.sqrt(c.pmids.length) * 8);
    return {
      id: `cluster-${c.id}`,
      kind: 'cluster',
      label: c.topic,
      x: centerX + clusterRadius * Math.cos(angle),
      y: centerY + clusterRadius * Math.sin(angle),
      vx: 0, vy: 0,
      size: r,
      color: c.color,
      count: c.pmids.length,
      paperIds: c.pmids,
      IF: avgIF,
    };
  });

  // ── Build inter-cluster edges ──────────────────────────────────────────
  // Only when clusters share a SECONDARY structure keyword
  const clusterLinks: GraphEdge[] = [];
  for (let i = 0; i < cN; i++) {
    for (let j = i + 1; j < cN; j++) {
      const a = big[i], b = big[j];
      const aStructs = new Set<string>();
      const bStructs = new Set<string>();
      for (const p of a.papers) for (const s of extractTags(p).structures) aStructs.add(s);
      for (const p of b.papers) for (const s of extractTags(p).structures) bStructs.add(s);
      const sharedStructures = [...aStructs].filter(s => bStructs.has(s));
      if (sharedStructures.length > 0) {
        clusterLinks.push({
          source: `cluster-${a.id}`,
          target: `cluster-${b.id}`,
          type: 'cluster-link',
          weight: sharedStructures.length,
          sharedItems: sharedStructures,
          label: sharedStructures.slice(0, 2).join('+'),
        });
      }
    }
  }

  // ── Build paper-level nodes ─────────────────────────────────────────────
  const paperNodes: GraphNode[] = [];
  for (const p of top) {
    paperNodes.push({
      id: p.pmid,
      kind: 'paper',
      label: p.title || '(untitled)',
      pmid: p.pmid,
      x: 0, y: 0, vx: 0, vy: 0,
      size: 8,
      color: getNodeMethodColor(p),
      methodColor: getNodeMethodColor(p),
      IF: p.IF,
      year: getYear(p.pubdate),
      journal: p.journal,
    });
  }

  // ── Build paper-level edges (OPTIMIZED ALGORITHM) ──────────────────────
  //
  // KEY CHANGE: Use MULTI-SIGNAL COMPOSITE SCORING and EXCLUDE cluster
  // primary keyword from shared-structure check.
  //
  // Old: if both papers in "ribosome" cluster → shared structure = "ribosome"
  //      → edge created → ALL pairs connected → hairball
  //
  // New: within "ribosome" cluster, "ribosome" is EXCLUDED from shared
  //      structures. Only SECONDARY keywords like "translation", "60S"
  //      count. Plus we require minimum weight and cap degree per node.

  // Pre-compute: map from cluster ID → cluster's primary keyword
  const clusterTopicKeyword = new Map<number, string>();
  for (const c of big) {
    clusterTopicKeyword.set(c.id, c.topicKeyword);
  }

  // Pre-extract tags once (O(n) preprocessing)
  const tagsPerPaper = top.map(p => extractTags(p));
  const pdbIdsPerPaper = top.map(p =>
    new Set((p.pdbs || []).filter(x => !x.isBlast).map(x => x.pdbId).filter(Boolean))
  );

  // Group paper indices by cluster
  const papersByCluster = new Map<number, number[]>();
  top.forEach((_, i) => {
    const cId = clusterOfPaper.get(top[i].pmid);
    if (cId !== undefined) {
      if (!papersByCluster.has(cId)) papersByCluster.set(cId, []);
      papersByCluster.get(cId)!.push(i);
    }
  });

  // Collect ALL candidate edges with composite weights
  const rawEdges: { source: string; target: string; weight: number; type: GraphEdge['type']; sharedItems: string[]; label: string }[] = [];

  for (const [cId, indices] of papersByCluster) {
    const clusterKeyword = clusterTopicKeyword.get(cId) || '__other__';
    const cLen = indices.length;

    for (let ii = 0; ii < cLen; ii++) {
      const i = indices[ii];
      const aTags = tagsPerPaper[i];
      const aPdbs = pdbIdsPerPaper[i];

      for (let jj = ii + 1; jj < cLen; jj++) {
        const j = indices[jj];
        const bTags = tagsPerPaper[j];
        const bPdbs = pdbIdsPerPaper[j];

        // ── Signal 1: Shared PDB IDs (strongest) ──
        const sharedPdb = [...aPdbs].filter(x => bPdbs.has(x));
        const pdbWeight = sharedPdb.length * WEIGHT_PDB;

        // ── Signal 2: Shared SECONDARY structure keywords ──
        // EXCLUDE the cluster's primary keyword — it's tautological
        const sharedStructures = [...aTags.structures].filter(s =>
          bTags.structures.has(s) && s !== clusterKeyword
        );
        const structWeight = sharedStructures.length * WEIGHT_SECONDARY_STRUCT;

        // ── Signal 3: Shared experimental method ──
        let methodWeight = 0;
        const sharedMethods: string[] = [];
        if (aTags.methods.size > 0 && bTags.methods.size > 0) {
          for (const m of aTags.methods) {
            if (bTags.methods.has(m)) sharedMethods.push(m);
          }
          methodWeight = sharedMethods.length * WEIGHT_METHOD;
        }

        // ── Composite weight ──
        const totalWeight = pdbWeight + structWeight + methodWeight;

        // ── Minimum threshold: skip edges that are too weak ──
        // A pure method edge (weight=1) is noise; a PDB edge (weight≥10) is signal
        if (totalWeight < MIN_EDGE_WEIGHT) continue;

        // ── Determine edge type (by strongest signal) ──
        let type: GraphEdge['type'];
        let label: string;
        let sharedItems: string[];

        if (pdbWeight >= structWeight && pdbWeight >= methodWeight && sharedPdb.length > 0) {
          type = 'pdb';
          label = sharedPdb.slice(0, 2).join(', ');
          sharedItems = sharedPdb;
        } else if (structWeight >= methodWeight && sharedStructures.length > 0) {
          type = 'structure';
          label = sharedStructures.slice(0, 2).join(', ');
          sharedItems = sharedStructures;
        } else {
          type = 'method';
          label = sharedMethods.slice(0, 2).join(', ');
          sharedItems = sharedMethods;
        }

        // If compound signals exist, enhance the label
        const signals: string[] = [];
        if (sharedPdb.length > 0) signals.push(`PDB:${sharedPdb.length}`);
        if (sharedStructures.length > 0) signals.push(sharedStructures.join('+'));
        if (sharedMethods.length > 0 && sharedPdb.length === 0 && sharedStructures.length === 0) signals.push(sharedMethods.join('+'));
        if (signals.length > 1) label = signals.join(' | ');

        rawEdges.push({
          source: top[i].pmid,
          target: top[j].pmid,
          weight: totalWeight,
          type,
          sharedItems,
          label,
        });
      }
    }
  }

  // ── Per-node degree cap: keep only the strongest MAX_EDGES_PER_NODE edges per node ──
  // This prevents hub nodes from being connected to too many nodes
  const edgesByNode = new Map<string, typeof rawEdges>();
  for (const e of rawEdges) {
    for (const nodeId of [e.source, e.target]) {
      if (!edgesByNode.has(nodeId)) edgesByNode.set(nodeId, []);
      edgesByNode.get(nodeId)!.push(e);
    }
  }

  // For each node, sort its edges by weight (desc) and keep top-K
  const keptEdgeKeys = new Set<string>();
  for (const [, nodeEdges] of edgesByNode) {
    nodeEdges.sort((a, b) => b.weight - a.weight);
    const topEdges = nodeEdges.slice(0, MAX_EDGES_PER_NODE);
    for (const e of topEdges) {
      // Create a stable key for dedup
      const key = e.source < e.target ? `${e.source}→${e.target}` : `${e.target}→${e.source}`;
      keptEdgeKeys.add(key);
    }
  }

  // Filter edges: keep only edges that are in the top-K for BOTH endpoints
  const edges: GraphEdge[] = rawEdges.filter(e => {
    const key = e.source < e.target ? `${e.source}→${e.target}` : `${e.target}→${e.source}`;
    return keptEdgeKeys.has(key);
  });

  // ── Compute node degree & size ──
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  for (const node of paperNodes) {
    const d = degree.get(node.id) || 0;
    node.size = 6 + Math.min(8, Math.log2(1 + d) * 2);
  }

  return { clusters, papers: paperNodes, edges, clusterLinks, clusterOfPaper };
}

// ─── Force Layout (optimized with node index map) ────────────────────────────

function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerX: number,
  centerY: number,
  iterations: number = 60
): GraphNode[] {
  const n = nodes.length;
  if (n === 0) return nodes;

  // Build index map for O(1) lookups instead of O(n) find()
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) nodeIndex.set(nodes[i].id, i);

  const MIN_DIST = 4.0;
  const REPULSION_K = 12000;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = Math.max(0.05, 1 - iter / iterations) * (1 - iter / (iterations * 1.2));

    // Repulsion (O(n²))
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST) continue;
        const distSq = Math.max(dist * dist, 0.01);
        const force = (REPULSION_K * alpha) / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }

    // Attraction along edges — O(E) with index map
    for (const e of edges) {
      const si = nodeIndex.get(e.source);
      const ti = nodeIndex.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const src = nodes[si];
      const tgt = nodes[ti];
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MIN_DIST) continue;
      const ideal = 160;
      const force = (dist - ideal) * 0.015 * alpha * Math.min(1.5, Math.sqrt(e.weight));
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      src.vx += fx; src.vy += fy;
      tgt.vx -= fx; tgt.vy -= fy;
    }

    // Centering
    for (const nd of nodes) {
      nd.vx += (centerX - nd.x) * 0.005 * alpha;
      nd.vy += (centerY - nd.y) * 0.005 * alpha;
    }

    // Integrate
    for (const nd of nodes) {
      nd.vx *= 0.55;
      nd.vy *= 0.55;
      nd.x += nd.vx;
      nd.y += nd.vy;
      if (!isFinite(nd.x) || !isFinite(nd.y)) {
        nd.x = centerX; nd.y = centerY; nd.vx = 0; nd.vy = 0; continue;
      }
      nd.x = Math.max(50, Math.min(750, nd.x));
      nd.y = Math.max(50, Math.min(550, nd.y));
    }
  }
  return nodes;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LiteratureCitationNetwork({ papers, onClose, onSelectPaper }: LiteratureCitationNetworkProps) {
  const { locale } = useI18n();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [activeCluster, setActiveCluster] = useState<string | null>(null);

  // View state
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<keyof typeof EDGE_COLORS>>(
    new Set<keyof typeof EDGE_COLORS>(['pdb', 'structure', 'method', 'cluster-link'])
  );

  // Build graph
  const { clusters, papers: paperNodes, edges, clusterLinks, clusterOfPaper } = useMemo(() => buildGraph(papers), [papers]);

  // Run force layout on clusters
  const laidOutClusters = useMemo(() => {
    const cN = clusters.length;
    if (cN === 0) return [] as GraphNode[];
    const cx = 400, cy = 300;
    const clusterRadiusX = Math.min(330, 180 + cN * 12);
    const clusterRadiusY = Math.min(230, 130 + cN * 9);
    const seeded = clusters.map((c, i) => {
      const angle = (2 * Math.PI * i) / cN;
      return {
        ...c,
        x: cx + clusterRadiusX * Math.cos(angle),
        y: cy + clusterRadiusY * Math.sin(angle),
        vx: 0, vy: 0,
      };
    });
    return runForceLayout(seeded, clusterLinks, cx, cy, 150);
  }, [clusters, clusterLinks]);

  // Run force layout on papers within the active cluster
  const laidOutPapers = useMemo(() => {
    if (!activeCluster) return [] as GraphNode[];
    const clusterNode = laidOutClusters.find(c => c.id === activeCluster);
    if (!clusterNode) return [];
    const pmidsInCluster = new Set(clusterNode.paperIds || []);
    const pNodes = paperNodes
      .filter(p => pmidsInCluster.has(p.id))
      .map(p => ({
        ...p,
        x: clusterNode.x + (Math.random() - 0.5) * 80,
        y: clusterNode.y + (Math.random() - 0.5) * 80,
        vx: 0, vy: 0,
      }));
    // Sub-edges (only within cluster)
    const subEdges = edges.filter(e => pmidsInCluster.has(e.source) && pmidsInCluster.has(e.target));
    // Use more iterations for larger clusters for better convergence
    const iters = Math.min(200, 80 + pNodes.length);
    return runForceLayout(pNodes, subEdges, clusterNode.x, clusterNode.y, iters);
  }, [activeCluster, laidOutClusters, paperNodes, edges]);

  // Stats
  const stats = useMemo(() => {
    const pdb = edges.filter(e => e.type === 'pdb').length;
    const structure = edges.filter(e => e.type === 'structure').length;
    const method = edges.filter(e => e.type === 'method').length;
    return { pdb, structure, method, total: edges.length };
  }, [edges]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.tagName === 'circle' || target.tagName === 'text' || target.closest('[data-no-pan]')) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // Wheel zoom (cursor-anchored)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const svgX = (mouseX / rect.width) * 800;
      const svgY = (mouseY / rect.height) * 600;
      const delta = -e.deltaY * 0.0018;
      setZoom(prev => {
        const next = Math.max(0.3, Math.min(4, prev * (1 + delta)));
        setPan(() => ({
          x: mouseX - svgX * next,
          y: mouseY - svgY * next,
        }));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNode(null);
    setHoveredNode(null);
    setActiveCluster(null);
  }, []);

  const handleZoomIn = useCallback(() => setZoom(z => Math.min(4, z + 0.25)), []);
  const handleZoomOut = useCallback(() => setZoom(z => Math.max(0.3, z - 0.25)), []);

  const handleClusterClick = useCallback((clusterId: string) => {
    const cluster = laidOutClusters.find(c => c.id === clusterId);
    if (!cluster) return;
    setActiveCluster(clusterId);
    setSelectedNode(null);
    setHoveredNode(null);
    setZoom(1.6);
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      setPan({
        x: rect.width / 2 - cluster.x * 1.6,
        y: rect.height / 2 - cluster.y * 1.6,
      });
    }
  }, [laidOutClusters]);

  const toggleEdgeType = useCallback((type: keyof typeof EDGE_COLORS) => {
    setVisibleEdgeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (node.kind === 'cluster') {
      handleClusterClick(node.id);
    } else {
      setSelectedNode(prev => (prev === node.id ? null : node.id));
    }
  }, [handleClusterClick]);

  const hoveredPaper = useMemo(() => {
    if (!hoveredNode) return null;
    const nd = paperNodes.find(p => p.id === hoveredNode);
    if (!nd) return null;
    return papers.find(p => p.pmid === nd.pmid);
  }, [hoveredNode, paperNodes, papers]);

  const selectedPaper = useMemo(() => {
    if (!selectedNode) return null;
    const nd = paperNodes.find(p => p.id === selectedNode);
    if (!nd) return null;
    return papers.find(p => p.pmid === nd.pmid);
  }, [selectedNode, paperNodes, papers]);

  // Compute connected edges for the selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => e.source === selectedNode || e.target === selectedNode);
  }, [selectedNode, edges]);

  // Determine what to render
  const showOverview = !activeCluster;
  const visibleNodes = showOverview ? laidOutClusters : laidOutPapers;
  const visibleNodeEdges = showOverview ? clusterLinks : edges.filter(e => {
    const pmids = new Set(laidOutPapers.map(n => n.id));
    return pmids.has(e.source) && pmids.has(e.target);
  });
  const visibleEdgeList = visibleNodeEdges.filter(e => visibleEdgeTypes.has(e.type));

  if (clusters.length === 0) {
    return (
      <div className="flex items-center justify-center h-80 text-claude-text-muted text-sm">
        Need at least 2 papers to build citation network
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="relative rounded-xl border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <NetIcon className="h-3.5 w-3.5 text-claude-text-secondary flex-shrink-0" />
          <span className="text-sm font-semibold text-claude-text">{locale === 'zh' ? '引文网络' : 'Citation Network'}</span>
          <span className="text-[10px] text-claude-text-muted truncate">
            {showOverview
              ? `${clusters.length} clusters · ${paperNodes.length} papers · ${stats.pdb} pdb · ${stats.structure} sub-topic · ${stats.method} method`
              : `${laidOutPapers.length} papers · ${visibleEdgeList.length} connections`
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          {activeCluster && (
            <button
              onClick={() => { setActiveCluster(null); setZoom(1); setPan({x:0,y:0}); }}
              data-no-pan
              className="px-2 py-0.5 text-[10px] rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-secondary hover:text-claude-text transition-colors"
              title={locale === "zh" ? "返回概览" : "Back to overview"}
            >
              ← Overview
            </button>
          )}
          <button onClick={handleZoomOut} data-no-pan className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors" title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-claude-text-muted font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} data-no-pan className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors" title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleReset} data-no-pan className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors" title="Reset view">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          {onClose && (
            <button onClick={onClose} data-no-pan className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Hint */}
      <div className="px-4 py-1.5 text-[10px] text-claude-text-muted border-b border-claude-border-light dark:border-[#2b2926] bg-claude-bg-secondary/40 dark:bg-[#0f0e0d]/50">
        <Lightbulb className="h-3 w-3 inline mr-1" /> {showOverview
          ? (locale === 'zh' ? '点击集群探索论文关系。拖拽平移，滚轮缩放。' : 'Click a cluster to explore its paper relationships. Drag to pan, scroll to zoom.')
          : 'Edges show shared PDB IDs (teal), sub-topic keywords (orange), or methods (purple). Click a paper for details.'}
      </div>

      {/* Edge type legend */}
      <div className="px-4 py-1 border-b border-claude-border-light dark:border-[#2b2926] bg-claude-bg-secondary/20 dark:bg-[#0f0e0d]/30 flex items-center gap-3 flex-wrap">
        {(Object.keys(EDGE_COLORS) as (keyof typeof EDGE_COLORS)[]).map(type => (
          <button
            key={type}
            onClick={() => toggleEdgeType(type)}
            data-no-pan
            className={`flex items-center gap-1 text-[9px] transition-opacity ${visibleEdgeTypes.has(type) ? 'opacity-100' : 'opacity-30'}`}
          >
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{
                backgroundColor: EDGE_COLORS[type],
                borderStyle: type === 'cluster-link' ? 'dashed' : 'solid',
              }}
            />
            <span className="text-claude-text-secondary">{EDGE_LABELS[type]}</span>
          </button>
        ))}
      </div>

      {/* SVG Graph */}
      <div
        ref={containerRef}
        className="relative bg-claude-bg-secondary/30 dark:bg-[#0f0e0d]"
        style={{ height: 540 }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox="0 0 800 600"
          className={`${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            {/* Arrow marker for directed hints */}
            <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="#8a8a8a" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {visibleEdgeList.map((edge, i) => {
              const src = visibleNodes.find(n => n.id === edge.source);
              const tgt = visibleNodes.find(n => n.id === edge.target);
              if (!src || !tgt) return null;
              const isHighlighted = selectedNode != null && (edge.source === selectedNode || edge.target === selectedNode);
              const isDimmed = selectedNode != null && !isHighlighted;
              const isClusterEdge = edge.type === 'cluster-link';
              return (
                <line
                  key={`edge-${i}`}
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke={EDGE_COLORS[edge.type]}
                  strokeWidth={isClusterEdge ? Math.max(0.5, Math.min(2, edge.weight * 0.5)) : Math.max(0.5, Math.min(3, Math.sqrt(edge.weight) * 0.8))}
                  strokeOpacity={isDimmed ? 0.04 : isHighlighted ? 0.9 : isClusterEdge ? 0.18 : 0.4}
                  strokeDasharray={isClusterEdge ? '3 3' : undefined}
                  className="transition-all duration-200"
                />
              );
            })}

            {/* Edge labels for selected node */}
            {selectedNode && !showOverview && visibleEdgeList.map((edge, i) => {
              if (edge.source !== selectedNode && edge.target !== selectedNode) return null;
              const src = visibleNodes.find(n => n.id === edge.source);
              const tgt = visibleNodes.find(n => n.id === edge.target);
              if (!src || !tgt) return null;
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              return (
                <text
                  key={`elabel-${i}`}
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  className="pointer-events-none select-none fill-claude-text"
                  style={{ fontSize: '6px', opacity: 0.7 }}
                >
                  {edge.label}
                </text>
              );
            })}

            {/* Nodes */}
            {visibleNodes.map((node) => {
              const isSelected = selectedNode === node.id;
              const isHovered = hoveredNode === node.id;
              const isDimmed = selectedNode != null && selectedNode !== node.id;
              const r = node.size + (isHovered ? 3 : isSelected ? 2 : 0);
              const isCluster = node.kind === 'cluster';
              return (
                <g key={node.id}>
                  {/* Glow ring for clusters */}
                  {isCluster && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={r + 6}
                      fill="none"
                      stroke={node.color}
                      strokeWidth={0.5}
                      strokeOpacity={isHovered ? 0.5 : 0.2}
                      strokeDasharray="2 4"
                    />
                  )}
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={r}
                    fill={node.color}
                    fillOpacity={isDimmed ? 0.15 : isHovered || isSelected ? 0.95 : isCluster ? 0.85 : 0.75}
                    stroke={isSelected ? '#c96442' : isHovered ? '#fff' : isCluster ? node.color : 'none'}
                    strokeWidth={isSelected ? 2.5 : isHovered ? 1.5 : isCluster ? 1 : 0}
                    strokeOpacity={isDimmed ? 0.1 : 1}
                    className="cursor-pointer transition-all duration-200"
                    onClick={() => handleNodeClick(node)}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                  />
                  {/* Label */}
                  {!isDimmed && (
                    <text
                      x={node.x}
                      y={node.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={`pointer-events-none select-none ${isCluster ? 'fill-white font-bold' : 'fill-white font-medium'}`}
                      style={{ fontSize: isCluster ? `${Math.max(9, Math.min(12, r * 0.7))}px` : '7px' }}
                    >
                      {isCluster ? `${node.count}` : node.IF != null ? node.IF.toFixed(0) : ''}
                    </text>
                  )}
                  {/* Cluster name label below */}
                  {isCluster && !isDimmed && (
                    <text
                      x={node.x}
                      y={node.y + r + 10}
                      textAnchor="middle"
                      className="fill-claude-text font-medium pointer-events-none select-none"
                      style={{ fontSize: '9px' }}
                    >
                      {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
                    </text>
                  )}
                  {/* Paper title label for selected/hovered paper */}
                  {!isCluster && !isDimmed && (isSelected || isHovered) && (
                    <text
                      x={node.x}
                      y={node.y + r + 8}
                      textAnchor="middle"
                      className="fill-claude-text pointer-events-none select-none"
                      style={{ fontSize: '6px' }}
                    >
                      {node.label.length > 40 ? node.label.slice(0, 38) + '…' : node.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Hover tooltip */}
        <AnimatePresence>
          {hoveredNode && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute z-10 pointer-events-none"
              style={{
                left: `min(calc(100% - 280px), ${(visibleNodes.find(n => n.id === hoveredNode)?.x ?? 0) * zoom + pan.x + 20}px)`,
                top: `${(visibleNodes.find(n => n.id === hoveredNode)?.y ?? 0) * zoom + pan.y - 60}px`,
              }}
            >
              {(() => {
                const node = visibleNodes.find(n => n.id === hoveredNode);
                if (!node) return null;
                if (node.kind === 'cluster') {
                  return (
                    <div className="bg-white dark:bg-[#1a1917] border border-claude-border dark:border-[#3d3832] rounded-lg shadow-lg px-3 py-2 text-[11px] max-w-[240px]">
                      <div className="font-semibold text-claude-text">{node.label}</div>
                      <div className="text-claude-text-muted mt-1">
                        {node.count} paper{node.count !== 1 ? 's' : ''} · avg IF {node.IF?.toFixed(1)}
                      </div>
                      <div className="text-claude-text-secondary mt-1 italic">{locale === 'zh' ? '点击探索 →' : 'Click to explore →'}</div>
                    </div>
                  );
                }
                const paper = papers.find(p => p.pmid === node.pmid);
                if (!paper) return null;
                // Find edges connected to this node
                const connEdges = edges.filter(e => e.source === node.id || e.target === node.id);
                const pdbConns = connEdges.filter(e => e.type === 'pdb').length;
                const structConns = connEdges.filter(e => e.type === 'structure').length;
                const methodConns = connEdges.filter(e => e.type === 'method').length;
                return (
                  <div className="bg-white dark:bg-[#1a1917] border border-claude-border dark:border-[#3d3832] rounded-lg shadow-lg px-3 py-2 text-[11px] max-w-[260px]">
                    <div className="font-semibold text-claude-text line-clamp-2">{paper.title}</div>
                    <div className="text-claude-text-muted mt-1">
                      {paper.journal} · {node.year} {paper.IF != null ? `· IF ${paper.IF}` : ''}
                    </div>
                    {connEdges.length > 0 && (
                      <div className="text-claude-text-secondary mt-1 flex gap-2">
                        {pdbConns > 0 && <span style={{ color: EDGE_COLORS.pdb }}>PDB:{pdbConns}</span>}
                        {structConns > 0 && <span style={{ color: EDGE_COLORS.structure }}>Sub-topic:{structConns}</span>}
                        {methodConns > 0 && <span style={{ color: EDGE_COLORS.method }}>Method:{methodConns}</span>}
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected paper side panel (when in cluster view) */}
        <AnimatePresence>
          {selectedPaper && !showOverview && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="absolute top-2 right-2 w-72 bg-white dark:bg-[#1a1917] border border-claude-border dark:border-[#3d3832] rounded-lg shadow-lg p-3 text-[11px] z-20 max-h-[90%] overflow-y-auto"
              data-no-pan
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-semibold text-claude-text line-clamp-2 flex-1">{selectedPaper.title}</div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-0.5 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="space-y-1 text-claude-text-secondary">
                <div><span className="text-claude-text-muted">{locale === 'zh' ? '期刊：' : 'Journal:'}</span> {selectedPaper.journal}</div>
                <div><span className="text-claude-text-muted">{locale === 'zh' ? '年份：' : 'Year:'}</span> {getYear(selectedPaper.pubdate)}</div>
                {selectedPaper.IF != null && <div><span className="text-claude-text-muted">IF:</span> {selectedPaper.IF.toFixed(1)}</div>}
                <div><span className="text-claude-text-muted">{locale === 'zh' ? 'PDB：' : 'PDB:'}</span> {selectedPaper.pdbs.length}</div>
              </div>

              {/* Connection details */}
              {selectedNodeEdges.length > 0 && (
                <div className="mt-2 pt-2 border-t border-claude-border-light dark:border-[#2b2926]">
                  <div className="font-medium text-claude-text mb-1">Connections ({selectedNodeEdges.length})</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedNodeEdges.map((e, i) => {
                      const otherPmid = e.source === selectedNode ? e.target : e.source;
                      const otherPaper = papers.find(p => p.pmid === otherPmid);
                      return (
                        <div key={i} className="flex items-start gap-1.5">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0"
                            style={{ backgroundColor: EDGE_COLORS[e.type] }}
                          />
                          <div className="min-w-0">
                            <div className="text-claude-text line-clamp-1">{otherPaper?.title || otherPmid}</div>
                            <div className="text-[9px] text-claude-text-muted">{e.label} (w={e.weight})</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {onSelectPaper && (
                <button
                  onClick={() => onSelectPaper(selectedPaper.pmid)}
                  className="mt-2 w-full px-2 py-1 text-[10px] rounded bg-claude-accent text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  View Paper
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
