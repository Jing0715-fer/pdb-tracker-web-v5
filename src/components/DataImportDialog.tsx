'use client';

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileText, FileJson, Download, Loader2, CheckCircle2, Check,
  AlertCircle, X, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  parseCsvFile,
  downloadFile,
  generatePdbCsvTemplate,
  generatePdbJsonTemplate,
  generatePubMedCsvTemplate,
  generatePubMedJsonTemplate,
} from '@/lib/import-utils';

// ─── Types ──────────────────────────────────────────────────────────────────────

type ImportType = 'pdb' | 'pubmed';

interface ImportSummary {
  imported: number;
  skipped: number;
  errors: string[];
}

interface DataImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Default import type based on current mode */
  defaultType?: ImportType;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function DataImportDialog({ open, onOpenChange, defaultType = 'pdb' }: DataImportDialogProps) {
  const [importType, setImportType] = useState<ImportType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, string>[] | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens/closes
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      // Small delay to let animation finish
      setTimeout(() => {
        setFile(null);
        setPreviewData(null);
        setIsImporting(false);
        setSummary(null);
        setIsDragOver(false);
      }, 200);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  // ─── File Handling ─────────────────────────────────────────────────────────

  const handleFile = useCallback((selectedFile: File) => {
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith('.csv') && !ext.endsWith('.json')) {
      toast.error('Unsupported format', { description: 'Please select a .csv or .json file' });
      return;
    }

    setFile(selectedFile);
    setSummary(null);

    // Read and preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (ext.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            const records = parsed.slice(0, 3).map((obj: Record<string, unknown>) => {
              const row: Record<string, string> = {};
              for (const [key, value] of Object.entries(obj)) {
                row[key] = value == null ? '' : String(value);
              }
              return row;
            });
            setPreviewData(records);
          } else {
            setPreviewData(null);
            toast.error('Invalid JSON', { description: 'JSON must be an array of objects' });
          }
        } catch {
          setPreviewData(null);
          toast.error('Invalid JSON', { description: 'Could not parse the JSON file' });
        }
      } else {
        const records = parseCsvFile(text).slice(0, 3);
        setPreviewData(records.length > 0 ? records : null);
      }
    };
    reader.readAsText(selectedFile);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFile(selectedFile);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [handleFile]);

  // ─── Drag and Drop ────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
  }, [handleFile]);

  // ─── Import Execution ─────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (!file) return;

    setIsImporting(true);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', importType);

      const res = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error('Import failed', { description: data.error || 'Unknown error' });
        setSummary({ imported: 0, skipped: 0, errors: [data.error || 'Unknown error'] });
      } else {
        setSummary(data);
        if (data.imported > 0) {
          toast.success('Import complete', {
            description: `${data.imported} record${data.imported !== 1 ? 's' : ''} imported, ${data.skipped} skipped`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      toast.error('Import failed', { description: msg });
      setSummary({ imported: 0, skipped: 0, errors: [msg] });
    } finally {
      setIsImporting(false);
    }
  }, [file, importType]);

  // ─── Template Downloads ───────────────────────────────────────────────────

  const handleDownloadTemplate = useCallback((format: 'csv' | 'json') => {
    if (importType === 'pdb') {
      if (format === 'csv') {
        downloadFile(generatePdbCsvTemplate(), 'pdb-structures-template.csv', 'text/csv');
      } else {
        downloadFile(generatePdbJsonTemplate(), 'pdb-structures-template.json', 'application/json');
      }
    } else {
      if (format === 'csv') {
        downloadFile(generatePubMedCsvTemplate(), 'pubmed-articles-template.csv', 'text/csv');
      } else {
        downloadFile(generatePubMedJsonTemplate(), 'pubmed-articles-template.json', 'application/json');
      }
    }
    toast.info('Template downloaded', { description: `${importType === 'pdb' ? 'PDB Structures' : 'PubMed Articles'} ${format.toUpperCase()} template` });
  }, [importType]);

  // ─── Preview Table Columns ────────────────────────────────────────────────

  const previewColumns = useMemo(() => {
    if (!previewData || previewData.length === 0) return [];
    return Object.keys(previewData[0]);
  }, [previewData]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4.5 w-4.5 text-claude-accent" />
            Import Data
          </DialogTitle>
          <DialogDescription>
            Import PDB structures or PubMed articles from CSV or JSON files.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Import Type Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-claude-text-secondary">
              Import Type
            </label>
            <Select
              value={importType}
              onValueChange={(v) => {
                setImportType(v as ImportType);
                setFile(null);
                setPreviewData(null);
                setSummary(null);
              }}
            >
              <SelectTrigger className="w-full h-9 text-sm border-claude-border dark:border-[#3d3832]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pdb">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#2d8f8f]" />
                    PDB Structures
                  </span>
                </SelectItem>
                <SelectItem value="pubmed">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#c9872e]" />
                    PubMed Articles
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Template Download Buttons */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
              Templates:
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadTemplate('csv')}
              className="h-7 px-2.5 text-[11px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              <Download className="h-3 w-3" />
              CSV Template
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownloadTemplate('json')}
              className="h-7 px-2.5 text-[11px] gap-1 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              <Download className="h-3 w-3" />
              JSON Template
            </Button>
          </div>

          {/* File Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-all duration-200
              ${isDragOver
                ? 'border-claude-accent bg-claude-accent/5 scale-[1.01]'
                : file
                  ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-900/10'
                  : 'border-claude-border dark:border-[#3d3832] hover:border-claude-accent/50 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFileInput}
              className="hidden"
            />

            <AnimatePresence mode="wait">
              {file ? (
                <motion.div
                  key="file-selected"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-claude-text">{file.name}</p>
                    <p className="text-[11px] text-claude-text-muted">
                      {(file.size / 1024).toFixed(1)} KB — Click to change file
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="no-file"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex flex-col items-center gap-2"
                >
                  <div className="h-10 w-10 rounded-lg bg-claude-border-light dark:bg-[#2b2926] flex items-center justify-center">
                    <Upload className="h-5 w-5 text-claude-text-muted" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-claude-text-secondary">
                      Drop a file here or click to browse
                    </p>
                    <p className="text-[11px] text-claude-text-muted mt-0.5">
                      Supports CSV and JSON formats
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Format badges */}
            <div className="flex items-center justify-center gap-2 mt-3">
              <Badge
                variant="secondary"
                className="text-[10px] font-medium bg-[#2d8f8f]/10 text-[#2d8f8f] border border-[#2d8f8f]/20 hover:bg-[#2d8f8f]/20"
              >
                <FileText className="h-2.5 w-2.5 mr-1" />
                CSV
              </Badge>
              <Badge
                variant="secondary"
                className="text-[10px] font-medium bg-[#c9872e]/10 text-[#c9872e] border border-[#c9872e]/20 hover:bg-[#c9872e]/20"
              >
                <FileJson className="h-2.5 w-2.5 mr-1" />
                JSON
              </Badge>
            </div>
          </div>

          {/* Preview Table */}
          <AnimatePresence>
            {previewData && previewData.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                      Preview (first {previewData.length} rows)
                    </span>
                    <span className="text-[10px] text-claude-text-muted">
                      {previewColumns.length} columns
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-claude-border dark:border-[#3d3832]">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-claude-border-light dark:bg-[#2b2926]">
                          {previewColumns.map(col => (
                            <th
                              key={col}
                              className="px-2 py-1.5 text-left font-medium text-claude-text-secondary whitespace-nowrap"
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((row, i) => (
                          <tr key={i} className="border-t border-claude-border/50 dark:border-[#3d3832]/50">
                            {previewColumns.map(col => (
                              <td
                                key={col}
                                className="px-2 py-1.5 text-claude-text whitespace-nowrap max-w-[120px] truncate"
                                title={row[col]}
                              >
                                {row[col] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Import Summary */}
          <AnimatePresence>
            {summary && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-lg border p-3 space-y-2"
                style={{
                  borderColor: summary.imported > 0 && summary.errors.length === 0
                    ? '#10b981'
                    : summary.errors.length > 0
                      ? '#ef4444'
                      : '#c96442',
                  backgroundColor: summary.imported > 0 && summary.errors.length === 0
                    ? 'rgba(16, 185, 129, 0.05)'
                    : summary.errors.length > 0
                      ? 'rgba(239, 68, 68, 0.05)'
                      : 'rgba(201, 100, 66, 0.05)',
                }}
              >
                <div className="flex items-center gap-2">
                  {summary.imported > 0 && summary.errors.length === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400" />
                  )}
                  <span className="text-sm font-medium text-claude-text">
                    Import {summary.imported > 0 ? 'Complete' : 'Failed'}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[11px]">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {summary.imported} imported
                  </span>
                  {summary.skipped > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      <AlertCircle className="h-3.5 w-3.5 inline" /> {summary.skipped} skipped
                    </span>
                  )}
                </div>

                {summary.errors.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto custom-scrollbar">
                    <ul className="space-y-0.5">
                      {summary.errors.slice(0, 10).map((err, i) => (
                        <li key={i} className="text-[10px] text-red-600 dark:text-red-400 font-mono">
                          • {err}
                        </li>
                      ))}
                      {summary.errors.length > 10 && (
                        <li className="text-[10px] text-claude-text-muted">
                          ... and {summary.errors.length - 10} more errors
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="h-8 px-3 text-xs border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              {summary ? 'Close' : 'Cancel'}
            </Button>
            {!summary && (
              <Button
                onClick={handleImport}
                disabled={!file || isImporting}
                className="h-8 px-4 text-xs bg-claude-accent hover:bg-claude-accent-hover text-white gap-1.5"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-3 w-3" />
                    Import {importType === 'pdb' ? 'Structures' : 'Articles'}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
