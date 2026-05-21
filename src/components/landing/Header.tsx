import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";

type NavItem =
  | { label: string; to: "/"; hash?: string }
  | { label: string; to: "/signup" }
  | { label: string; to: "/selskapsanalyse" }
  | { label: string; to: "/selskapsanalyse/analysedatabase" };

const navItems: NavItem[] = [
  { label: "Hva", to: "/", hash: "hva" },
  { label: "Annerledes", to: "/", hash: "annerledes" },
  { label: "Hvordan", to: "/", hash: "hvordan" },
  { label: "Arbeidsgiveranalysen", to: "/selskapsanalyse" },
  { label: "Analysedatabase", to: "/selskapsanalyse/analysedatabase" },
  { label: "Kom i gang", to: "/signup" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" aria-label="Karrierenmin">
          <Logo className="h-8 w-auto" />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              hash={"hash" in item ? item.hash : undefined}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 sm:flex">
          <Button asChild size="sm" variant="ghost">
            <Link to="/login">Logg inn</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Kom i gang</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
