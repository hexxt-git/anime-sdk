import { Button as BaseButton } from '@base-ui/react/button';
import { type ReactNode } from 'react';

type Variant = 'ghost' | 'outline' | 'solid' | 'tab';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: Variant;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  title?: string;
  href?: string;
  target?: string;
  rel?: string;
}

const base =
  'cursor-pointer inline-flex items-center gap-1.5 text-[10px] tracking-widest uppercase transition-colors disabled:opacity-30 disabled:cursor-default';

const variants: Record<Variant, (active?: boolean) => string> = {
  ghost: (a) => (a ? 'text-base-900' : 'text-base-450 hover:text-base-700'),
  outline: (a) =>
    a
      ? 'border border-base-450 bg-base-200 text-base-900'
      : 'border border-base-250 text-base-550 hover:border-base-400 hover:text-base-750',
  solid: (_) => 'border border-base-450 text-base-900 hover:bg-base-200',
  tab: (a) =>
    a ? 'border-b border-base-450 text-base-900 pb-2' : 'text-base-450 hover:text-base-700 pb-2',
};

export function Button({
  children,
  onClick,
  disabled,
  active,
  variant = 'ghost',
  type = 'button',
  className = '',
  title,
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`${base} ${variants[variant](active)} ${className}`}
    >
      {children}
    </BaseButton>
  );
}
