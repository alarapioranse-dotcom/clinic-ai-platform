import { cn } from '@/lib/utils';

export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      {eyebrow ? (
        <p className="text-pine font-mono text-sm font-medium tracking-wide uppercase">{eyebrow}</p>
      ) : null}
      <h2 className="font-display mt-2 text-3xl font-bold text-balance sm:text-4xl">{title}</h2>
      {description ? <p className="text-muted mt-3 text-base">{description}</p> : null}
    </div>
  );
}
