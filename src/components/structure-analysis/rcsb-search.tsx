"use client";

/**
 * RCSB Structure Search — search the RCSB PDB database by keyword.
 *
 * Uses the RCSB Search API (https://search.rcsb.org/rcsbsearch/v2/query)
 * to find structures matching a text query. Results show PDB ID, title,
 * method, resolution, and organism. Clicking a result loads the structure.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Search,
  Loader2,
  X,
  ChevronRight,
  Box,
  MapPin,
  Microscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RcsbSearchHit {
  pdbId: string;
  title: string;
  method: string;
  resolution: number | null;
  organism: string;
  releaseDate: string;
}

interface RcsbSearchProps {
  onLoadPdb: (pdbId: string) => void;
  disabled?: boolean;
}

export function RcsbSearch({ onLoadPdb, disabled }: RcsbSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RcsbSearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // RCSB Search API v2 — text query
      const searchBody = {
        query: {
          type: "group",
          logical_operator: "and",
          nodes: [
            {
              type: "terminal",
              service: "full_text",
              parameters: {
                value: q.trim(),
              },
            },
          ],
        },
        return_type: "entry",
        request_options: {
          paginate: { start: 0, rows: 15 },
          sort: [
            {
              sort_by: "score",
              direction: "desc",
            },
          ],
          return_all_hits: false,
        },
      };

      const res = await fetch("https://search.rcsb.org/rcsbsearch/v2/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(searchBody),
      });

      if (!res.ok) {
        if (res.status === 204) {
          setResults([]);
          setError("No structures found");
        } else {
          setError(`Search failed (HTTP ${res.status})`);
        }
        return;
      }

      const data = await res.json();
      const identifiers: string[] = (data.result_set || []).map(
        (r: any) => r.identifier
      );

      if (identifiers.length === 0) {
        setResults([]);
        return;
      }

      // Fetch detailed metadata for each result via the RCSB Data API
      // (individual GET requests — the batch endpoint doesn't exist)
      const metadataResults = await Promise.allSettled(
        identifiers.map(async (id) => {
          const r = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${id}`, {
            headers: { Accept: "application/json" },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const entry = await r.json();
          const methods: string[] =
            entry.rcsb_entry_info?.experimental_method || [];
          const resArr: number[] =
            entry.rcsb_entry_info?.resolution_combined || [];
          const organisms: string[] =
            entry.rcsb_entry_info?.source_organism_taxonomy_names || [];
          const hostOrganisms: string[] =
            entry.rcsb_entry_info?.host_organism_taxonomy_names || [];
          return {
            pdbId: id,
            title: entry.struct?.title || id,
            method: methods[0] || "Unknown",
            resolution: resArr[0] ?? null,
            organism: organisms[0] || hostOrganisms[0] || "Unknown",
            releaseDate: entry.rcsb_accession_info?.initial_release_date || "",
          } as RcsbSearchHit;
        })
      );
      let hits: RcsbSearchHit[] = metadataResults
        .filter(
          (r): r is PromiseFulfilledResult<RcsbSearchHit> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);
      // For any that failed, add a minimal entry
      for (let i = 0; i < identifiers.length; i++) {
        if (!hits.some((h) => h.pdbId === identifiers[i])) {
          hits.push({
            pdbId: identifiers[i],
            title: identifiers[i],
            method: "Unknown",
            resolution: null,
            organism: "Unknown",
            releaseDate: "",
          });
        }
      }
      setResults(hits);
    } catch (err) {
      setError(`Search error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    debounceRef.current = setTimeout(() => search(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const handleResultClick = (pdbId: string) => {
    onLoadPdb(pdbId);
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled}
          title="Search RCSB PDB"
        >
          <Search className="h-3.5 w-3.5" />
          Search
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] p-0"
        align="start"
        sideOffset={4}
      >
        <div className="border-b border-claude-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-claude-text-muted" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length > 0) {
                  handleResultClick(results[0].pdbId);
                }
              }}
              placeholder="Search RCSB by keyword (e.g. hemoglobin, kinase)..."
              className="h-8 pl-8 pr-8 text-xs"
              autoFocus
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-claude-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="sa-scroll max-h-[400px]">
          <div className="p-1">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-claude-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-claude-accent" />
                Searching RCSB...
              </div>
            )}

            {error && !loading && (
              <div className="py-6 text-center text-xs text-claude-text-muted">
                {error}
              </div>
            )}

            {!loading && !error && results.length === 0 && query.trim() && (
              <div className="py-6 text-center text-xs text-claude-text-muted">
                {query.trim().length < 2
                  ? "Type at least 2 characters"
                  : "No results yet"}
              </div>
            )}

            {!loading && !error && results.length === 0 && !query.trim() && (
              <div className="py-6 text-center">
                <Box className="mx-auto mb-2 h-8 w-8 text-claude-text-muted" />
                <p className="text-xs text-claude-text-secondary">
                  Search the RCSB PDB database
                </p>
                <p className="mt-1 text-[10px] text-claude-text-muted">
                  Try: hemoglobin, kinase, antibody, insulin
                </p>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-claude-text-muted">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                </div>
                {results.map((hit) => (
                  <button
                    key={hit.pdbId}
                    onClick={() => handleResultClick(hit.pdbId)}
                    className="group flex w-full items-start gap-2 rounded-md p-2 text-left hover:bg-claude-accent-light transition-colors"
                  >
                    <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded bg-claude-accent/10 font-mono text-[10px] font-bold text-claude-accent">
                      {hit.pdbId}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-claude-text line-clamp-2 group-hover:text-claude-accent">
                        {hit.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px] text-claude-text-muted">
                        <span className="flex items-center gap-0.5">
                          <Microscope className="h-2.5 w-2.5" />
                          {hit.method}
                        </span>
                        {hit.resolution != null && (
                          <Badge variant="outline" className="px-1 py-0 text-[8px]">
                            {hit.resolution.toFixed(2)} Å
                          </Badge>
                        )}
                        <span className="flex items-center gap-0.5">
                          <MapPin className="h-2.5 w-2.5" />
                          {hit.organism}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-claude-text-muted group-hover:text-claude-accent" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
