import { Collapsible } from '@base-ui/react/collapsible';
import { type ReactNode, useState } from 'react';

interface SectionCollapsibleProps {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SectionCollapsible({
  label,
  count,
  defaultOpen = true,
  children,
}: SectionCollapsibleProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="border-base-200 border-t">
      <Collapsible.Trigger className="group flex w-full cursor-pointer items-center justify-between px-0 py-3 text-left">
        <span className="text-base-400 text-[10px] tracking-widest uppercase">
          {label}
          {count != null && <span className="text-base-350 ml-1.5">({count})</span>}
        </span>
        <span className="text-base-400 text-[10px] transition-transform duration-200 group-data-[open]:rotate-180">
          ▾
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div className="pb-5">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

interface ExpandableProps {
  children: ReactNode[];
  limit?: number;
  label?: string;
}

export function Expandable({ children, limit = 12, label = 'items' }: ExpandableProps) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? children : children.slice(0, limit);
  const hidden = children.length - limit;
  return (
    <div>
      {shown}
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-base-450 hover:text-base-700 mt-3 text-[10px] tracking-widest uppercase transition-colors"
        >
          View all {children.length} {label}
        </button>
      )}
    </div>
  );
}
