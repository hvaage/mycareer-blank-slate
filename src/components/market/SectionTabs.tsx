// ============================================================
// SectionTabs — sticky seksjonsnavigasjon
// ============================================================
//
// Brukes rett under filterkortet i CareerExplorer. Items er bygget
// dynamisk basert på hvilke seksjoner som rendres i gjeldende visning
// (oversikt eller yrkesdetalj).

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SectionTabItem = {
  id: string;
  label: string;
};

export function SectionTabs({
  items,
  className,
}: {
  items: SectionTabItem[];
  className?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const chipRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Observe sections to derive active tab.
  useEffect(() => {
    if (items.length === 0) return;
    const nodes = items
      .map((it) => document.getElementById(it.id))
      .filter((n): n is HTMLElement => !!n);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first entry currently in the focus band, falling back
        // to the closest above viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-35% 0px -55% 0px",
        threshold: [0, 0.1, 0.5, 1],
      },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [items]);

  // Scroll active chip into view on mobile.
  useEffect(() => {
    if (!activeId) return;
    const chip = chipRefs.current[activeId];
    const scroller = scrollerRef.current;
    if (!chip || !scroller) return;
    const chipRect = chip.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    if (chipRect.left < scRect.left || chipRect.right > scRect.right) {
      chip.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeId]);

  if (items.length === 0) return null;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <nav
      aria-label="Seksjoner"
      className={cn(
        "sticky top-0 z-30",
        "bg-[var(--km-paper)]/95 backdrop-blur-[2px] border-b border-rule",
        className,
      )}
    >
      <div
        ref={scrollerRef}
        className="mx-auto max-w-6xl px-4 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        <ul className="flex w-full justify-between gap-2 md:gap-4 h-12 md:h-14 items-stretch whitespace-nowrap">
          {items.map((it) => {
            const isActive = it.id === activeId;
            return (
              <li key={it.id} className="flex">
                <a
                  ref={(el) => {
                    chipRefs.current[it.id] = el;
                  }}
                  href={`#${it.id}`}
                  onClick={(e) => handleClick(e, it.id)}
                  aria-current={isActive ? "location" : undefined}
                  className={cn(
                    "inline-flex items-center px-2 md:px-3 text-[15px] md:text-base font-medium",
                    "border-b-2 -mb-px transition-colors",
                    isActive
                      ? "border-[var(--km-blue)] text-[var(--km-ink)]"
                      : "border-transparent text-[var(--km-ink-soft)] hover:text-[var(--km-ink)]",
                  )}
                >
                  {it.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
