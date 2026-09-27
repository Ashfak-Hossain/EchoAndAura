'use client';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ToggleableColumn {
  id: string;
  label: string;
  visible: boolean;
  toggle: () => void;
}

/** "Columns" menu: tick to show, untick to hide; remembered per browser. */
export function DataTableColumnsMenu({ columns }: { columns: ToggleableColumn[] }) {
  if (columns.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3.5 text-[13px] font-semibold hover:bg-secondary">
        Columns
        <span aria-hidden="true" className="text-[10px]">
          ▾
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {/* Base UI: a GroupLabel must live inside a Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show columns</DropdownMenuLabel>
          {columns.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={c.visible}
              onCheckedChange={() => c.toggle()}
              data-testid={`column-toggle-${c.id}`}
            >
              {c.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
