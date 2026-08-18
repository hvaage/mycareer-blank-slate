// @ts-nocheck
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/documentation" as const, label: "Oversikt", exact: true },
  { to: "/documentation/resultater" as const, label: "Resultater", exact: false },
  { to: "/documentation/kompetanse" as const, label: "Kompetanser", exact: false },
  { to: "/documentation/cases" as const, label: "Case", exact: false },
  { to: "/documentation/library" as const, label: "Dokumenter", exact: false },
  { to: "/documentation/packages" as const, label: "Dokumentpakker", exact: false },
] as const;


function navIsActive(pathname: string, href: string, exact: boolean) {
  if (exact) {
    return pathname === "/documentation" || pathname === "/documentation/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DocumentationLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Min dokumentasjon</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Profesjonell dokumentasjon, case og dokumentpakker samlet på ett sted.
        </p>
      </div>

      <nav
        className="flex flex-wrap gap-1 border-b border-border pb-px"
        aria-label="Min dokumentasjon"
      >
        {NAV.map((item) => {
          const active = navIsActive(pathname, item.to, item.exact);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "inline-flex items-center rounded-t-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm border border-b-0 border-border -mb-px z-[1]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
