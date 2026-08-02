'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Check, Download, FileText, BookOpen, Quote, Braces } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { generateAPA, generateMLA, generateVancouver, generateBibTeX, downloadFile } from '@/lib/citation-utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { toast } from 'sonner';

export type CitationFormat = 'apa' | 'mla' | 'vancouver' | 'bibtex';

interface CitationFormatOption {
  value: CitationFormat;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  description: string;
}

const CITATION_FORMATS: CitationFormatOption[] = [
  {
    value: 'apa',
    label: 'APA 7th Edition',
    shortLabel: 'APA',
    icon: <Quote className="h-3 w-3" />,
    description: 'Author, A. A., & Author, B. B. (Year). Title. Journal.',
  },
  {
    value: 'mla',
    label: 'MLA 9th Edition',
    shortLabel: 'MLA',
    icon: <BookOpen className="h-3 w-3" />,
    description: 'Author, A. A., and B. B. Author. "Title." Journal, Year.',
  },
  {
    value: 'vancouver',
    label: 'Vancouver / ICMJE',
    shortLabel: 'Vancouver',
    icon: <FileText className="h-3 w-3" />,
    description: 'Author AA, Author BB. Title. Journal. Year;',
  },
  {
    value: 'bibtex',
    label: 'BibTeX',
    shortLabel: 'BibTeX',
    icon: <Braces className="h-3 w-3" />,
    description: '@article{key, author = {}, title = {}, ...}',
  },
];

const STORAGE_KEY = 'pdb-citation-format';

function getStoredFormat(): CitationFormat {
  if (typeof window === 'undefined') return 'apa';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['apa', 'mla', 'vancouver', 'bibtex'].includes(stored)) {
      return stored as CitationFormat;
    }
  } catch {
    // ignore
  }
  return 'apa';
}

function generateCitation(paper: LitPaper, format: CitationFormat): string {
  switch (format) {
    case 'apa': return generateAPA(paper);
    case 'mla': return generateMLA(paper);
    case 'vancouver': return generateVancouver(paper);
    case 'bibtex': return generateBibTeX(paper);
  }
}

function getFileExtension(format: CitationFormat): string {
  switch (format) {
    case 'bibtex': return '.bib';
    case 'vancouver': return '.txt';
    default: return '.txt';
  }
}

function getMimeType(format: CitationFormat): string {
  switch (format) {
    case 'bibtex': return 'application/x-bibtex';
    default: return 'text/plain';
  }
}

// ─── Single-paper CitationFormatSelector ─────────────────────────────────────────

interface CitationFormatSelectorProps {
  paper: LitPaper;
}

export function CitationFormatSelector({ paper }: CitationFormatSelectorProps) {
  const [format, setFormat] = useState<CitationFormat>(getStoredFormat);
  const [copied, setCopied] = useState(false);

  // Persist format to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch {
      // ignore
    }
  }, [format]);

  const citation = generateCitation(paper, format);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      toast.success(`${CITATION_FORMATS.find(f => f.value === format)?.shortLabel} citation copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy citation');
    }
  }, [citation, format]);

  const handleDownload = useCallback(() => {
    const ext = getFileExtension(format);
    const mime = getMimeType(format);
    downloadFile(citation, `${paper.pmid}${ext}`, mime);
    toast.success(`${CITATION_FORMATS.find(f => f.value === format)?.shortLabel} citation exported`);
  }, [citation, format, paper.pmid]);

  return (
    <div className="citation-selector-enter space-y-2">
      {/* Format selector row */}
      <div className="flex items-center gap-2">
        <Select
          value={format}
          onValueChange={(v) => setFormat(v as CitationFormat)}
        >
          <SelectTrigger
            size="sm"
            className="h-7 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] text-claude-text-secondary w-[140px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832]">
            {CITATION_FORMATS.map((fmt) => (
              <SelectItem
                key={fmt.value}
                value={fmt.value}
                className="text-xs text-claude-text-secondary focus:bg-claude-border-light dark:focus:bg-[#2b2926] focus:text-claude-text"
              >
                <span className="flex items-center gap-1.5">
                  {fmt.icon}
                  {fmt.shortLabel}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy formatted citation</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="h-7 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              <Download className="h-3 w-3" />
              Export
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download citation file</TooltipContent>
        </Tooltip>
      </div>

      {/* Citation preview */}
      <div className="p-2.5 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
        <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1">
          {CITATION_FORMATS.find(f => f.value === format)?.label}
        </div>
        <div className="text-[11px] text-claude-text-secondary leading-relaxed font-mono break-words whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar">
          {citation}
        </div>
      </div>
    </div>
  );
}

// ─── Batch Citation Export ───────────────────────────────────────────────────────

interface BatchCitationExportProps {
  papers: LitPaper[];
  selectedPmids?: Set<string>;
  onClearSelection?: () => void;
}

export function BatchCitationExport({ papers, selectedPmids, onClearSelection }: BatchCitationExportProps) {
  const [format, setFormat] = useState<CitationFormat>(getStoredFormat);
  const [copied, setCopied] = useState(false);

  // Persist format to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, format);
    } catch {
      // ignore
    }
  }, [format]);

  const selectedPapers = selectedPmids
    ? papers.filter(p => selectedPmids.has(p.pmid))
    : papers;

  const handleBatchCopy = useCallback(async () => {
    const citations = selectedPapers.map(p => generateCitation(p, format)).join('\n\n');
    try {
      await navigator.clipboard.writeText(citations);
      setCopied(true);
      toast.success(`${selectedPapers.length} ${format.toUpperCase()} citations copied`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy citations');
    }
  }, [selectedPapers, format]);

  const handleBatchExport = useCallback(() => {
    const citations = selectedPapers.map(p => generateCitation(p, format)).join('\n\n');
    const ext = getFileExtension(format);
    const mime = getMimeType(format);
    downloadFile(citations, `citations-${selectedPapers.length}-papers${ext}`, mime);
    toast.success(`${selectedPapers.length} citations exported as ${format.toUpperCase()}`);
  }, [selectedPapers, format]);

  if (selectedPapers.length === 0) return null;

  return (
    <div className="batch-citation-bar-enter flex items-center gap-2 px-3 py-2 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30">
      <span className="text-[10px] font-medium text-claude-text-muted">
        {selectedPapers.length} paper{selectedPapers.length !== 1 ? 's' : ''} selected
      </span>

      <Select
        value={format}
        onValueChange={(v) => setFormat(v as CitationFormat)}
      >
        <SelectTrigger
          size="sm"
          className="h-6 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] text-claude-text-secondary w-[110px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832]">
          {CITATION_FORMATS.map((fmt) => (
            <SelectItem
              key={fmt.value}
              value={fmt.value}
              className="text-xs text-claude-text-secondary focus:bg-claude-border-light dark:focus:bg-[#2b2926] focus:text-claude-text"
            >
              {fmt.shortLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={handleBatchCopy}
        className="h-6 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy All'}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleBatchExport}
        className="h-6 px-2 text-[10px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
      >
        <Download className="h-3 w-3" />
        Export
      </Button>

      {onClearSelection && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          className="h-6 px-1.5 text-[10px] text-claude-text-muted hover:text-claude-text ml-auto"
        >
          Clear
        </Button>
      )}
    </div>
  );
}

export { CITATION_FORMATS, STORAGE_KEY };
