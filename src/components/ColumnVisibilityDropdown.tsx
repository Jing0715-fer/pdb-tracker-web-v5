'use client';

import React from 'react';
import { Columns3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { WEEKLY_TABLE_COLUMNS } from '@/lib/pdb-utils';
import type { ColumnVisibility } from '@/hooks/use-column-visibility';

interface ColumnVisibilityDropdownProps {
  columnVisibility: ColumnVisibility;
  onToggleColumn: (field: string) => void;
  onResetToDefault: () => void;
}

export function ColumnVisibilityDropdown({
  columnVisibility,
  onToggleColumn,
  onResetToDefault,
}: ColumnVisibilityDropdownProps) {
  const hiddenCount = WEEKLY_TABLE_COLUMNS.filter(
    col => col.field !== 'pdbId' && columnVisibility[col.field] === false
  ).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 px-2.5 text-[11px] ${hiddenCount > 0 ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Columns3 className="h-3 w-3 mr-1" />
          <span className="hidden sm:inline">Columns</span>
          {hiddenCount > 0 && (
            <span className="ml-1 text-[9px] font-bold bg-claude-accent/20 text-claude-accent rounded-full px-1.5 py-px">
              {hiddenCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[11px] text-claude-text-muted">
          Toggle Columns
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {WEEKLY_TABLE_COLUMNS.map(col => {
          const isPdbId = col.field === 'pdbId';
          return (
            <DropdownMenuCheckboxItem
              key={col.field}
              checked={columnVisibility[col.field] !== false}
              onCheckedChange={() => {
                if (!isPdbId) onToggleColumn(col.field);
              }}
              disabled={isPdbId}
              className="text-[11px] py-1.5"
            >
              {col.label}
              {isPdbId && (
                <span className="ml-auto text-[9px] text-claude-text-muted">Required</span>
              )}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onResetToDefault}
          className="text-[11px] py-1.5 text-claude-text-muted focus:text-claude-accent"
        >
          <RotateCcw className="h-3 w-3 mr-2" />
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
