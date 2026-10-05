export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
      <div className="min-w-0">
        {eyebrow && <p className="label-micro mb-2">{eyebrow}</p>}
        <h1 className="font-display text-[length:var(--text-hero)] leading-[1.05]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-prose text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
