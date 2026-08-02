// ─── Color Helper Functions ──────────────────────────────────────────────────

export function getMethodColor(method: string | null): { bg: string; text: string; border: string } {
  const m = method?.toUpperCase() || '';
  if (m.includes('CRYO') || m.includes('ELECTRON MICROSCOPY')) {
    return { bg: 'bg-claude-cryoem-bg', text: 'text-claude-cryoem', border: 'border-claude-cryoem/30' };
  }
  if (m.includes('X-RAY') || m.includes('XRAY')) {
    return { bg: 'bg-claude-xray-bg', text: 'text-claude-xray', border: 'border-claude-xray/30' };
  }
  if (m.includes('NMR')) {
    return { bg: 'bg-claude-nmr-bg', text: 'text-claude-nmr', border: 'border-claude-nmr/30' };
  }
  return { bg: 'bg-claude-other-bg', text: 'text-claude-other', border: 'border-claude-other/30' };
}

export function getMethodLabel(method: string | null): string {
  const m = method?.toUpperCase() || '';
  if (m.includes('CRYO') || m.includes('ELECTRON MICROSCOPY')) return 'Cryo-EM';
  if (m.includes('X-RAY') || m.includes('XRAY')) return 'X-ray';
  if (m.includes('NMR')) return 'NMR';
  if (m.includes('ELECTRON CRYSTALLOGRAPHY')) return 'E. Cryst.';
  return m || 'Unknown';
}

export function getResolutionColor(res: number | null): string {
  if (res === null || res === undefined) return 'text-claude-text-muted';
  if (res <= 2.0) return 'text-green-600 dark:text-green-400';
  if (res <= 3.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

export function getIfTierStyle(tier: string): { bg: string; text: string } {
  switch (tier) {
    case 'top': return { bg: 'bg-claude-top-bg', text: 'text-claude-top' };
    case 'high': return { bg: 'bg-claude-high-bg', text: 'text-claude-high' };
    case 'mid': return { bg: 'bg-claude-mid-bg', text: 'text-claude-mid' };
    case 'low': return { bg: 'bg-claude-low-bg', text: 'text-claude-low' };
    default: return { bg: 'bg-claude-other-bg', text: 'text-claude-other' };
  }
}

export function getScoreColor(score: number): string {
  if (score < 4) return '#dc2626';
  if (score < 6) return '#ea580c';
  if (score < 8) return '#16a34a';
  return '#2d8f8f';
}

export function getIdentityColor(identity: number): string {
  if (identity >= 90) return 'text-green-600 dark:text-green-400';
  if (identity >= 70) return 'text-teal-600 dark:text-teal-400';
  if (identity >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500 dark:text-red-400';
}

// ─── Format Helper Functions ─────────────────────────────────────────────────

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  } catch {
    return dateStr;
  }
}

export function parseLigands(ligands: string | null): string[] {
  if (!ligands) return [];
  let parts: string[];
  if (ligands.includes('|')) {
    parts = ligands.split('|');
  } else if (ligands.includes(';')) {
    parts = ligands.split(/[;]+/);
  } else if (ligands.includes(',')) {
    parts = ligands.split(/[,]+/);
  } else {
    parts = [ligands];
  }
  return parts.map(l => {
    const colonParts = l.split(':');
    return colonParts[0].trim();
  }).filter(Boolean);
}

export function formatEvalue(evalue: number | null): string {
  if (evalue === null) return '—';
  if (evalue === 0) return '0';
  if (evalue < 0.001) return evalue.toExponential(1);
  return evalue.toFixed(2);
}

export function truncateOrganism(organisms: string | null, maxLen: number = 24): string {
  if (!organisms) return '—';
  const first = organisms.split('|')[0]?.trim() || organisms;
  if (first.length <= maxLen) return first;
  return first.slice(0, maxLen - 1) + '…';
}
