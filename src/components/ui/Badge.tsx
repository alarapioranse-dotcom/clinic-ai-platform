import { cn } from '@/lib/utils';

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'bg-mint text-pine-deep inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}
