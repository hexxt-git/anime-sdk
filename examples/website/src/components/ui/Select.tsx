import { Select } from '@base-ui/react/select';

interface SelectOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  className?: string;
}

export function Combobox({ value, onValueChange, options, className = '' }: ComboboxProps) {
  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Select.Root value={value} onValueChange={(v) => onValueChange(v ?? '')}>
      <Select.Trigger
        className={`border-base-250 bg-base-100 text-base-700 hover:border-base-400 hover:text-base-850 inline-flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 text-[10px] tracking-widest ${className}`}
      >
        <Select.Value>{label}</Select.Value>
        <Select.Icon className="text-base-450 text-[8px]">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4}>
          <Select.Popup className="border-base-250 bg-base-150 z-50 min-w-[120px] border py-1 shadow-lg">
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="text-base-600 data-[highlighted]:bg-base-250 data-[highlighted]:text-base-900 data-[selected]:text-base-900 flex cursor-pointer items-center justify-between px-3 py-2 text-[10px] tracking-widest"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator className="text-base-500">✓</Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
