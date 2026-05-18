import { Link } from "@tanstack/react-router";

type NavItem =
  | { label: string; to: "/"; hash?: string }
  | { label: string; to: "/signup" };

const navItems: NavItem[] = [
  { label: "Hva", to: "/", hash: "hva" },
  { label: "Annerledes", to: "/", hash: "annerledes" },
  { label: "Hvordan", to: "/", hash: "hvordan" },
  { label: "Kom i gang", to: "/signup" },
];

export function Footer() {
  return (
    <footer className="bg-background">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-serif text-xl text-foreground">Karrierenmin</p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Et system for å forstå og styre egen karriere.
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Navigasjon
            </p>
            <ul className="mt-4 space-y-2">
              {navItems.map((item) => (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    hash={"hash" in item ? item.hash : undefined}
                    className="text-sm text-foreground transition-colors hover:text-accent"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Kontakt
            </p>
            <a
              href="mailto:hei@karrierenmin.no"
              className="mt-4 inline-block text-sm text-foreground transition-colors hover:text-accent"
            >
              hei@karrierenmin.no
            </a>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} Karrierenmin. Alle rettigheter forbeholdt.</p>
          <p>Bygget i Norge.</p>
        </div>
      </div>
    </footer>
  );
}
