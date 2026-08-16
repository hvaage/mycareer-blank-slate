// ============================================================
// PageSectionNav — horisontal, klebrig seksjonsmeny med antall.
// Fungerer som innholdsfortegnelse for lange undersider.
// Seksjoner uten innhold vises ikke.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { StatusMark, type SectionStatus } from "@/components/form/form-section";

export type PageSection = {
  id: string;
  label: string;
  count?: number;
  /** Fremdrift for skjemaseksjoner. Vises som merke i stedet for antall. */
  status?: SectionStatus;
  /** Sett false for å skjule seksjonen fra menyen. Default: count !== 0 */
  show?: boolean;
};


export function PageSectionNav({
  sections,
  className,
  /** Offset i px for klebrig topp (f.eks. under en header). */
  top = 0,
}: {
  sections: PageSection[];
  className?: string;
  top?: number;
}) {
  const items = sections.filter((s) => (s.show ?? (s.count ?? 1) > 0));
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const ids = items.map((i) => i.id).join("|");

  useEffect(() => {
    const nodes = ids
      .split("|")
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => !!n);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: [0, 0.05, 0.3, 1] },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [ids]);

  useEffect(() => {
    if (!activeId) return;
    const chip = chipRefs.current[activeId];
    const scroller = scrollerRef.current;
    if (!chip || !scroller) return;
    const c = chip.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    if (c.left < s.left || c.right > s.right) {
      chip.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeId]);

  if (items.length < 2) return null;

  const jump = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      aria-label="Seksjoner på siden"
      className={cn(
        "sticky z-30 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur",
        "sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        className,
      )}
      style={{ top }}
    >
      <div ref={scrollerRef} className="overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <ul className="flex items-stretch gap-1 whitespace-nowrap">
          {items.map((it) => {
            const active = it.id === activeId;
            return (
              <li key={it.id} className="flex">
                <a
                  ref={(el) => {
                    chipRefs.current[it.id] = el;
                  }}
                  href={`#${it.id}`}
                  onClick={(e) => jump(e, it.id)}
                  aria-current={active ? "location" : undefined}
                  className={cn(
                    "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {it.status ? <StatusMark status={it.status} /> : null}
                  {it.label}
                  {typeof it.count === "number" ? (
                    <span className="tabular-nums text-xs text-muted-foreground">({it.count})</span>
                  ) : null}

                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
