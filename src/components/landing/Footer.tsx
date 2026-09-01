import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-[var(--km-rule)] bg-[var(--km-paper-warm)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
        <Link to="/" aria-label="karrierenmin.no" className="flex items-center">
          <Logo className="block h-[18px] w-auto" />
        </Link>
        <div className="flex items-center gap-4 text-xs text-[var(--km-ink-faint)]">
          <Link to="/personvern" className="transition-colors hover:text-[var(--km-ink)]">
            Personvern
          </Link>
          <p>© 2026 karrierenmin.no</p>
        </div>
      </div>
    </footer>
  );
}
