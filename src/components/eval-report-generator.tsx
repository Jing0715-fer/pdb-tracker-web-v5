'use client';
import { useI18n } from '@/lib/i18n';
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  X, FileText, Printer, Download, Eye, Edit3,
  CheckSquare, Square, ChevronRight, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Evaluation } from '@/lib/pdb-types';
import { renderMarkdownToFullPage } from '@/lib/markdown-renderer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportSection {
  id: string;
  label: string;
  enabled: boolean;
}

interface EvalReportGeneratorProps {
  evaluation: Evaluation;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Score Parsing ────────────────────────────────────────────────────────────

interface ScoreEntry {
  score: number;
  max?: number;
  description?: string;
}

function parseScores(scoresStr: string | null): Record<string, ScoreEntry> {
  if (!scoresStr) return {};
  try {
    const parsed = JSON.parse(scoresStr);
    const result: Record<string, ScoreEntry> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'object' && val !== null && 'score' in (val as Record<string, unknown>)) {
        result[key] = val as ScoreEntry;
      } else if (typeof val === 'number') {
        result[key] = { score: val };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** R197 bug 修复：阈值口径 —— Overall 评分是 0-10 制（服务端
 *  min(10, max(1, …))），旧版按 0-1 制（0.8/0.5）判定：1-4 分低分评估
 *  也会绿色 + 「High overall quality」。传入值需先归一化（score / 10）。 */
function getScoreColor(scoreNormalized: number): string {
  if (scoreNormalized >= 0.8) return '#16a34a';
  if (scoreNormalized >= 0.5) return '#c9872e';
  return '#dc2626';
}

/** R197 bug 修复：HTML 转义 —— reportHtml 用字符串拼接构建，动态字段
 * （用户输入的标题、UniProt/RCSB/BLAST 外部元数据、LLM 报告片段）未经
 * 转义直接插入；Print 按钮把结果 document.write 进同源新窗口（脚本可
 * 执行，可读 localStorage 的共享 LLM 配置），导出的 .html 同样携带载荷。 */
function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalReportGenerator({
  evaluation,
  isOpen,
  onClose,
}: EvalReportGeneratorProps) {
  const { locale } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const previewRef = useRef<HTMLDivElement>(null);

  const [reportTitle, setReportTitle] = useState(
    `Evaluation Report: ${evaluation.proteinName || evaluation.uniprotId}`
  );
  const [includeCharts, setIncludeCharts] = useState(true);

  const [sections, setSections] = useState<ReportSection[]>([
    { id: 'summary', label: 'Summary', enabled: true },
    { id: 'coverage', label: 'Coverage Analysis', enabled: true },
    { id: 'scores', label: 'Score Breakdown', enabled: true },
    { id: 'structures', label: 'PDB Structures', enabled: true },
    { id: 'blast', label: 'BLAST Results', enabled: true },
    { id: 'recommendations', label: 'Recommendations', enabled: true },
  ]);

  const [showPreview, setShowPreview] = useState(false);
  const [view, setView] = useState<'data' | 'llm'>('data');

  const toggleSection = useCallback((id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  }, []);

  const scores = useMemo(() => parseScores(evaluation.scores), [evaluation.scores]);
  const scoreEntries = useMemo(() => Object.entries(scores).filter(([key]) => key !== 'Overall'), [scores]);
  const overallScore = scores['Overall']?.score ?? 0;
  const coverage = evaluation.coverage ?? 0;
  const enabledSections = sections.filter(s => s.enabled);

  // ─── Build Report HTML ──────────────────────────────────────────────────

  const reportHtml = useMemo(() => {
    const eval_ = evaluation;
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const coverageColor = coverage >= 80 ? '#16a34a' : coverage >= 50 ? '#c9872e' : '#dc2626';

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(reportTitle)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2d2d2d; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 32px; }
    h1 { font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
    h2 { font-size: 18px; font-weight: 600; color: #c96442; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e8e4dd; }
    h3 { font-size: 14px; font-weight: 600; color: #4a4a4a; margin: 16px 0 8px; }
    p { margin-bottom: 12px; font-size: 14px; }
    .meta { color: #6b6560; font-size: 13px; margin-bottom: 24px; }
    .meta span { margin-right: 16px; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 16px 0; }
    .stat-card { background: #f5f0ea; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-card .value { font-size: 28px; font-weight: 700; }
    .stat-card .label { font-size: 11px; color: #6b6560; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .score-bar { margin: 8px 0; }
    .score-bar .bar-bg { height: 8px; background: #e8e4dd; border-radius: 4px; overflow: hidden; }
    .score-bar .bar-fill { height: 100%; border-radius: 4px; }
    .score-bar .bar-label { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px; }
    .score-bar .bar-label .name { color: #4a4a4a; }
    .score-bar .bar-label .val { font-family: monospace; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    th { background: #f5f0ea; font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 2px solid #e8e4dd; }
    td { padding: 8px 12px; border-bottom: 1px solid #f0ece6; }
    tr:nth-child(even) td { background: #faf8f5; }
    .method-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
    .method-cryoem { background: #e6f5f5; color: #2d8f8f; }
    .method-xray { background: #f0eaf8; color: #7c5cbf; }
    .method-nmr { background: #fdf3e6; color: #c9872e; }
    .coverage-ring { display: inline-flex; align-items: center; justify-content: center; }
    .recommendation { padding: 10px 14px; border-radius: 6px; margin: 8px 0; font-size: 13px; }
    .rec-success { background: #f0fdf4; color: #166534; border-left: 3px solid #16a34a; }
    .rec-warning { background: #fffbeb; color: #92400e; border-left: 3px solid #f59e0b; }
    .rec-info { background: #f0f9ff; color: #075985; border-left: 3px solid #0ea5e9; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e8e4dd; font-size: 11px; color: #9b9590; text-align: center; }
    @media print { body { padding: 20px; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
  </style>
</head>
<body>`;

    // Header（动态字段全部转义 —— R197 XSS 修复）
    html += `
  <h1>${escapeHtml(reportTitle)}</h1>
  <div class="meta">
    <span>Protein: ${escapeHtml(eval_.proteinName || '—')}</span>
    <span>UniProt: ${escapeHtml(eval_.uniprotId)}</span>
    ${eval_.organism ? `<span>Organism: ${escapeHtml(eval_.organism)}</span>` : ''}
    <span>Date: ${escapeHtml(date)}</span>
  </div>`;

    // Summary
    if (enabledSections.find(s => s.id === 'summary')?.enabled) {
      html += `
  <h2>Summary</h2>
  <div class="stat-grid">
    <div class="stat-card">
      <div class="value" style="color: ${coverageColor}">${coverage.toFixed(0)}%</div>
      <div class="label">Coverage</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color: ${getScoreColor(overallScore / 10)}">${overallScore.toFixed(1)}</div>
      <div class="label">Overall Score</div>
    </div>
    <div class="stat-card">
      <div class="value" style="color: #2d8f8f">${eval_.pdbStructures.length}</div>
      <div class="label">PDB Structures</div>
    </div>
  </div>`;

      if (includeCharts) {
        // SVG Coverage Ring
        const ringSize = 80;
        const radius = 32;
        const circumference = 2 * Math.PI * radius;
        const progress = coverage / 100;
        html += `
  <div style="text-align: center; margin: 16px 0;">
    <svg width="${ringSize}" height="${ringSize}" class="coverage-ring">
      <circle cx="${ringSize/2}" cy="${ringSize/2}" r="${radius}" fill="none" stroke="#e8e4dd" stroke-width="6" />
      <circle cx="${ringSize/2}" cy="${ringSize/2}" r="${radius}" fill="none" stroke="${coverageColor}" stroke-width="6"
        stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - progress)}"
        stroke-linecap="round" transform="rotate(-90 ${ringSize/2} ${ringSize/2})" />
      <text x="${ringSize/2}" y="${ringSize/2}" text-anchor="middle" dy="5" font-size="16" font-weight="bold" fill="${coverageColor}">${coverage.toFixed(0)}%</text>
    </svg>
  </div>`;
      }
    }

    // Coverage Analysis
    if (enabledSections.find(s => s.id === 'coverage')?.enabled) {
      html += `
  <h2>Coverage Analysis</h2>
  <p>Structural coverage of <strong>${escapeHtml(eval_.proteinName || eval_.uniprotId)}</strong> (${escapeHtml(eval_.uniprotId)}) is <strong style="color: ${coverageColor}">${coverage.toFixed(0)}%</strong>${eval_.sequenceLength ? ` across ${eval_.sequenceLength} residues` : ''}.</p>`;

      if (eval_.sequenceLength && eval_.pdbStructures.length > 0) {
        const ranges: [number, number][] = eval_.pdbStructures
          .filter(s => s.unpStart != null && s.unpEnd != null)
          .map(s => [s.unpStart!, s.unpEnd!] as [number, number])
          .sort((a, b) => a[0] - b[0]);

        if (ranges.length > 0) {
          const merged: [number, number][] = [ranges[0]];
          for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) {
              last[1] = Math.max(last[1], ranges[i][1]);
            } else {
              merged.push(ranges[i]);
            }
          }
          const coveredResidues = merged.reduce((acc, [start, end]) => acc + (end - start + 1), 0);

          if (includeCharts) {
            html += `<div style="position: relative; height: 20px; background: #e8e4dd; border-radius: 10px; margin: 12px 0; overflow: hidden;">`;
            merged.forEach(([start, end], idx) => {
              const leftPct = ((start - 1) / eval_.sequenceLength!) * 100;
              const widthPct = ((end - start + 1) / eval_.sequenceLength!) * 100;
              const color = idx % 2 === 0 ? '#2d8f8f' : '#7c5cbf';
              html += `<div style="position: absolute; top: 0; left: ${leftPct}%; width: ${widthPct}%; height: 100%; background: ${color}; opacity: 0.7; border-radius: ${idx === 0 ? '10px 0 0 10px' : idx === merged.length - 1 ? '0 10px 10px 0' : '0'};"></div>`;
            });
            html += `</div>`;
            html += `<div style="display: flex; justify-content: space-between; font-size: 11px; color: #9b9590; font-family: monospace;"><span>1</span><span>${eval_.sequenceLength}</span></div>`;
          }

          html += `<p>Covered residues: <strong>${coveredResidues}</strong> / ${eval_.sequenceLength} (${merged.length} segment${merged.length > 1 ? 's' : ''})</p>`;
        }
      }
    }

    // Score Breakdown
    if (enabledSections.find(s => s.id === 'scores')?.enabled && scoreEntries.length > 0) {
      html += `<h2>Score Breakdown</h2>`;
      scoreEntries.forEach(([key, val]) => {
        const max = val.max ?? 10;
        const pct = Math.min((val.score / max) * 100, 100);
        const color = val.score / max >= 0.8 ? '#16a34a' : val.score / max >= 0.5 ? '#c9872e' : '#dc2626';
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        html += `
  <div class="score-bar">
    <div class="bar-label">
      <span class="name">${label}</span>
      <span class="val" style="color: ${color}">${val.score.toFixed(2)} / ${max}</span>
    </div>
    <div class="bar-bg">
      <div class="bar-fill" style="width: ${pct}%; background: ${color};"></div>
    </div>
  </div>`;
      });
    }

    // PDB Structures Table
    if (enabledSections.find(s => s.id === 'structures')?.enabled && eval_.pdbStructures.length > 0) {
      html += `<h2>PDB Structures (${eval_.pdbStructures.length})</h2>`;
      html += `<table><thead><tr><th>PDB ID</th><th>Method</th><th>Resolution</th><th>Title</th><th>Organism</th></tr></thead><tbody>`;
      eval_.pdbStructures.forEach(s => {
        const methodClass = (s.method || '').toLowerCase().includes('cryo') ? 'method-cryoem'
          : (s.method || '').toLowerCase().includes('x-ray') || (s.method || '').toLowerCase().includes('xray') ? 'method-xray'
          : 'method-nmr';
        html += `<tr>
          <td><strong>${escapeHtml(s.pdbId)}</strong></td>
          <td><span class="method-badge ${methodClass}">${escapeHtml(s.method || '—')}</span></td>
          <td>${s.resolution != null ? `${s.resolution.toFixed(2)}Å` : '—'}</td>
          <td>${escapeHtml(s.title || '—')}</td>
          <td>${escapeHtml(s.organism || '—')}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }

    // BLAST Results Table
    if (enabledSections.find(s => s.id === 'blast')?.enabled && eval_.blastResults.length > 0) {
      html += `<h2>BLAST Results (${eval_.blastResults.length})</h2>`;
      html += `<table><thead><tr><th>PDB ID</th><th>Identity</th><th>E-value</th><th>Description</th></tr></thead><tbody>`;
      eval_.blastResults.forEach(b => {
        const evalueNum = b.evalue != null ? parseFloat(b.evalue) : null;
        const evalueStr = evalueNum != null
          ? evalueNum === 0 ? '0'
            : evalueNum < 0.001 ? evalueNum.toExponential(1)
            : evalueNum.toFixed(2)
          : '—';
        html += `<tr>
          <td><strong>${escapeHtml(b.pdbId)}</strong></td>
          <td>${b.identity != null ? `${b.identity.toFixed(1)}%` : '—'}</td>
          <td>${evalueStr}</td>
          <td>${escapeHtml(b.description || '—')}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }

    // Recommendations
    if (enabledSections.find(s => s.id === 'recommendations')?.enabled) {
      html += `<h2>Recommendations</h2>`;

      if (coverage >= 80) {
        html += `<div class="recommendation rec-success">Excellent structural coverage — most of the sequence is represented by experimental structures.</div>`;
      } else if (coverage >= 50) {
        html += `<div class="recommendation rec-warning">Moderate coverage — consider looking for additional structures to fill gaps in the sequence.</div>`;
      } else {
        html += `<div class="recommendation rec-warning">Low structural coverage — significant portions of the protein lack structural data. Consider homology modeling for uncovered regions.</div>`;
      }

      // R197: 0-10 制阈值归一化（旧版 1-4/10 低分也命中「高质量」分支）。
      if (overallScore / 10 >= 0.8) {
        html += `<div class="recommendation rec-success">High overall quality score — available structures are generally well-suited for analysis.</div>`;
      } else if (overallScore / 10 < 0.5) {
        html += `<div class="recommendation rec-warning">Low quality score — structures may have limited resolution or relevance. Exercise caution in interpretation.</div>`;
      }

      if (eval_.blastResults.length > 0) {
        html += `<div class="recommendation rec-info">${eval_.blastResults.length} homolog${eval_.blastResults.length > 1 ? 's' : ''} found via BLAST — useful for comparative modeling and filling structural gaps.</div>`;
      }

      if (eval_.pdbStructures.length === 0 && eval_.blastResults.length > 0) {
        html += `<div class="recommendation rec-info">No direct structures available — homologs can provide structural insights via modeling approaches.</div>`;
      }

      if (eval_.report) {
        // R197: LLM 输出原文同样过 escapeHtml（报告片段可能含任意字符）。
        html += `<div class="recommendation rec-info">${escapeHtml(eval_.report.slice(0, 500))}${eval_.report.length > 500 ? '...' : ''}</div>`;
      }
    }

    // Footer
    html += `
  <div class="footer">
    Generated by PDB Structure Tracker · ${escapeHtml(date)} · ${escapeHtml(eval_.uniprotId)}
  </div>
</body>
</html>`;

    return html;
  }, [evaluation, reportTitle, enabledSections, includeCharts, coverage, overallScore, scoreEntries]);

  // ─── LLM Report (markdown → HTML) ────────────────────────────────────────
  // The LLM chapter-mode generates full markdown with §N.M sub-sections, tables,
  // bold/italic, code spans, lists. We render it as a self-contained HTML page
  // (same shape as reportHtml) and toggle the iframe via `view` state.
  // Uses the shared renderer at src/lib/markdown-renderer.ts which handles
  // 4 table formats (pipe+sep, pipe-no-sep, tab, multi-space) and inline
  // markdown (bold/italic/code/URLs).
  const llmReportHtml = useMemo(() => {
    if (!evaluation.report) {
      return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:40px;color:#6b6560;text-align:center;"><p>该评估尚无 LLM 报告。先在 Run Center 重新生成报告。</p></body></html>`;
    }
    return renderMarkdownToFullPage(evaluation.report, { title: `LLM Report · ${evaluation.uniprotId}` }).html;
  }, [evaluation.report, evaluation.uniprotId]);

  // ─── Export as HTML ─────────────────────────────────────────────────────

  const handleExportHtml = useCallback(() => {
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eval-report-${evaluation.uniprotId}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [reportHtml, evaluation.uniprotId]);

  // ─── Print ──────────────────────────────────────────────────────────────

  const handlePrint = useCallback(() => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(reportHtml);
      printWindow.document.close();
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  }, [reportHtml]);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            className={`relative w-full max-w-4xl max-h-[85vh] mx-4 rounded-xl shadow-2xl border flex flex-col overflow-hidden ${
              isDark ? 'bg-[#242220] border-[#3d3832]' : 'bg-white border-claude-border'
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-3 border-b flex-shrink-0 ${
              isDark ? 'border-[#3d3832]' : 'border-claude-border'
            }`}>
              <div className="flex items-center gap-2.5">
                <FileText className="h-4.5 w-4.5 text-claude-accent" />
                <h2 className="text-sm font-bold text-claude-text">Generate Report</h2>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  isDark ? 'bg-[#1a1917] text-[#9b9590]' : 'bg-claude-border-light text-claude-text-muted'
                }`}>
                  {evaluation.uniprotId}
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Left: Configuration */}
              <div className={`w-[280px] flex-shrink-0 border-r overflow-y-auto custom-scrollbar p-4 space-y-5 ${
                isDark ? 'border-[#3d3832]' : 'border-claude-border'
              }`}>
                {/* Report Title */}
                <div>
                  <label className={`text-[10px] font-medium uppercase tracking-wider mb-1.5 block ${
                    isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'
                  }`}>
                    <Edit3 className="h-3 w-3 inline mr-1" />
                    Report Title
                  </label>
                  <Input
                    value={reportTitle}
                    onChange={e => setReportTitle(e.target.value)}
                    className={`h-8 text-xs ${
                      isDark ? 'bg-[#1a1917] border-[#3d3832]' : 'bg-claude-bg border-claude-border'
                    }`}
                  />
                </div>

                {/* Sections */}
                <div>
                  <label className={`text-[10px] font-medium uppercase tracking-wider mb-2 block ${
                    isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'
                  }`}>
                    Sections
                  </label>
                  <div className="space-y-1.5">
                    {sections.map(section => (
                      <button
                        key={section.id}
                        onClick={() => toggleSection(section.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
                          section.enabled
                            ? isDark
                              ? 'bg-claude-accent/10 text-claude-accent'
                              : 'bg-claude-accent/10 text-claude-accent'
                            : isDark
                              ? 'bg-[#1a1917] text-[#6b6560] hover:text-[#9b9590]'
                              : 'bg-claude-bg text-claude-text-muted hover:text-claude-text-secondary'
                        }`}
                      >
                        {section.enabled ? (
                          <CheckSquare className="h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <Square className="h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        <span className="font-medium">{section.label}</span>
                        <ChevronRight className={`h-3 w-3 ml-auto opacity-40 transition-transform ${
                          section.enabled ? 'rotate-90' : ''
                        }`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Include Charts */}
                <div>
                  <button
                    onClick={() => setIncludeCharts(!includeCharts)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
                      includeCharts
                        ? isDark
                          ? 'bg-claude-accent/10 text-claude-accent'
                          : 'bg-claude-accent/10 text-claude-accent'
                        : isDark
                          ? 'bg-[#1a1917] text-[#6b6560] hover:text-[#9b9590]'
                          : 'bg-claude-bg text-claude-text-muted hover:text-claude-text-secondary'
                    }`}
                  >
                    {includeCharts ? (
                      <CheckSquare className="h-3.5 w-3.5 flex-shrink-0" />
                    ) : (
                      <Square className="h-3.5 w-3.5 flex-shrink-0" />
                    )}
                    <span className="font-medium">Include Charts</span>
                    <Sparkles className="h-3 w-3 ml-auto opacity-40" />
                  </button>
                  <p className={`text-[10px] mt-1 px-3 ${
                    isDark ? 'text-[#6b6560]' : 'text-claude-text-muted'
                  }`}>
                    Adds SVG coverage ring and sequence coverage bar to the report
                  </p>
                </div>
              </div>

              {/* Right: Preview */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Preview toggle */}
                <div className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${
                  isDark ? 'border-[#3d3832]' : 'border-claude-border'
                }`}>
                  {/* View toggle: Data Report (static HTML from fields) vs LLM Report (markdown from chapter-mode generation) */}
                  <div className="flex items-center gap-0.5 rounded-md border border-claude-border dark:border-[#3d3832] overflow-hidden">
                    <button
                      onClick={() => setView('data')}
                      className={`h-7 px-2.5 text-[11px] transition-colors ${
                        view === 'data'
                          ? 'bg-claude-accent/10 text-claude-accent font-medium'
                          : isDark ? 'text-[#9b9590] hover:text-claude-text' : 'text-claude-text-muted hover:text-claude-text'
                      }`}
                    >
                      {locale === 'zh' ? '数据报告' : 'Data Report'}
                    </button>
                    <button
                      onClick={() => setView('llm')}
                      className={`h-7 px-2.5 text-[11px] transition-colors ${
                        view === 'llm'
                          ? 'bg-claude-accent/10 text-claude-accent font-medium'
                          : isDark ? 'text-[#9b9590] hover:text-claude-text' : 'text-claude-text-muted hover:text-claude-text'
                      }`}
                    >
                      {locale === 'zh' ? 'LLM 分析' : 'LLM Analysis'}
                    </button>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPreview(!showPreview)}
                    className={`h-7 px-2.5 text-[11px] ${
                      showPreview
                        ? 'bg-claude-accent/10 text-claude-accent'
                        : isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'
                    }`}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                  </Button>

                  <div className="flex-1" />

                  {/* Action buttons */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePrint}
                    className="h-7 px-3 text-[11px] text-claude-text-secondary hover:text-claude-text"
                  >
                    <Printer className="h-3 w-3 mr-1" />
                    Print
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleExportHtml}
                    className="h-7 px-3 text-[11px] bg-claude-accent text-white hover:bg-claude-accent-hover"
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Export HTML
                  </Button>
                </div>

                {/* Preview content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {showPreview ? (
                    <div ref={previewRef} className="p-4">
                      <iframe
                        srcDoc={view === 'llm' ? llmReportHtml : reportHtml}
                        className="w-full border-0 bg-white"
                        style={{ height: '600px', borderRadius: '8px' }}
                        title={view === 'llm' ? (locale === 'zh' ? 'LLM 报告预览' : 'LLM Report Preview') : (locale === "zh" ? "报告预览" : "Report Preview")}
                        sandbox="allow-same-origin"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] px-8">
                      <FileText className={`h-12 w-12 mb-3 ${
                        isDark ? 'text-[#3d3832]' : 'text-claude-border'
                      }`} />
                      <h3 className={`text-sm font-semibold mb-1 ${
                        isDark ? 'text-claude-text' : 'text-claude-text'
                      }`}>
                        Report Preview
                      </h3>
                      <p className={`text-xs text-center max-w-[300px] ${
                        isDark ? 'text-[#6b6560]' : 'text-claude-text-muted'
                      }`}>
                        Click &ldquo;Show Preview&rdquo; to see the generated report, or export directly as a self-contained HTML file.
                      </p>
                      <div className={`mt-4 flex items-center gap-4 text-[10px] ${
                        isDark ? 'text-[#6b6560]' : 'text-claude-text-muted'
                      }`}>
                        <span>{enabledSections.length} sections</span>
                        <span>·</span>
                        <span>{includeCharts ? 'Charts included' : 'No charts'}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
