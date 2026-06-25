import { Input as BaseInput } from '@base-ui/react/input';

interface InputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
}

export function Input({ value, onChange, onSubmit, placeholder, className = '' }: InputProps) {
  return (
    <BaseInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit?.();
      }}
      placeholder={placeholder}
      className={`border-base-300 text-base-850 placeholder-base-350 focus:border-base-450 flex-1 border bg-transparent px-3 py-2 text-sm outline-none ${className}`}
    />
  );
}
