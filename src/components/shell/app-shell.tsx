"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS } from "./nav-items";

/**
 * Two-column working surface: a persistent rail on the left, content on the right.
 * The rail stays narrow and quiet — the content is what the operator reads.
 * Below 768px the rail collapses to a horizontal scroller above the content.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="surface-grain shrink-0 border-b border-rule bg-paper-sunk md:w-60 md:border-r md:border-b-0">
        <div className="flex items-baseline gap-2 px-4 pt-5 pb-4 md:px-6">
          <span className="font-display text-xl leading-none">LeadGen</span>
          <span className="label-micro">Autotech</span>
        </div>

        <nav
          aria-label="Main navigation"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:px-3"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative shrink-0 rounded-md px-3 py-2 text-sm transition-colors duration-150 md:shrink ${
                  active
                    ? "bg-paper-raised font-medium text-ink shadow-[0_1px_2px_oklch(0%_0_0/0.06)]"
                    : "text-ink-muted hover:bg-paper-raised/60 hover:text-ink"
                }`}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute top-2 bottom-2 -left-3 hidden w-[2px] rounded-full bg-accent md:block"
                  />
                )}
                <span className="block leading-tight">{item.label}</span>
                <span className="hidden text-[11px] text-ink-faint md:block">
                  {item.hint}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-8 md:px-10 md:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
