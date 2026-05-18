import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Hva", href: "#hva" },
  { label: "Annerledes", href: "#annerledes" },
  { label: "Hvordan", href: "#hvordan" },
  { label: "Kom i gang", href: "#kom-i-gang" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="font-serif text-xl text-foreground">
          Karrierenmin
        </a>
        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
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

