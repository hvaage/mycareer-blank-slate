import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "./Logo";

type NavItem =
  | { label: string; to: "/"; hash?: string }
  | { label: string; to: "/arbeidsgivere" }
  | { label: string; to: "/markedsinnsikt" };

const navItems: NavItem[] = [
  { label: "Funksjoner", to: "/", hash: "hva" },
  { label: "Hva dette er", to: "/", hash: "annerledes" },
  { label: "Arbeidsgiverinnsikten", to: "/arbeidsgivere" },
  { label: "Markedsinnsikt", to: "/markedsinnsikt" },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-rule bg-[var(--km-paper)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--km-paper)]/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 pl-16 sm:h-16 sm:px-6 sm:pl-20">
        <Link to="/" aria-label="karrierenmin.no" className="flex items-center">
          <Logo className="block h-8 w-auto sm:h-9" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              hash={"hash" in item ? item.hash : undefined}
              className="text-sm font-medium text-[var(--km-ink-soft)] transition-colors hover:text-[var(--km-ink)]"
              activeProps={{ className: "text-[var(--km-blue)]" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild size="sm" variant="ghost">
            <Link to="/login">Logg inn</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-[var(--km-blue)] hover:bg-[var(--km-blue-deep)] text-white"
          >
            <Link to="/signup">Kom i gang</Link>
          </Button>
        </div>

        {/* Mobile trigger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-10 w-10"
              aria-label="Åpne meny"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[88vw] max-w-sm p-0 flex flex-col">
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <Link
                to="/"
                aria-label="karrierenmin.no"
                className="flex items-center"
                onClick={() => setOpen(false)}
              >
                <Logo className="block h-8 w-auto" />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Lukk meny"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <SheetTitle className="sr-only">Meny</SheetTitle>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              <ul className="flex flex-col">
                {navItems.map((item) => (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      hash={"hash" in item ? item.hash : undefined}
                      onClick={() => setOpen(false)}
                      className="block rounded-md px-3 py-3 text-base font-medium text-[var(--km-ink)] hover:bg-[var(--km-paper-warm)]"
                      activeProps={{ className: "text-[var(--km-blue)]" }}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-t border-rule px-4 py-3 flex flex-col gap-2">
              <Button
                asChild
                variant="outline"
                className="w-full"
                onClick={() => setOpen(false)}
              >
                <Link to="/login">Logg inn</Link>
              </Button>
              <Button
                asChild
                className="w-full bg-[var(--km-blue)] hover:bg-[var(--km-blue-deep)] text-white"
                onClick={() => setOpen(false)}
              >
                <Link to="/signup">Kom i gang</Link>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
