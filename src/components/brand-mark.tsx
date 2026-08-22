import { Link } from "@tanstack/react-router";
import logoMark from "@/assets/karrierenmin-mark.svg";

/**
 * Fast merkeplass øverst til venstre. Vises på alle sider, både innlogget og
 * utlogget, slik at K-en alltid står på samme plass i løsningen.
 */
export function BrandMark() {
  return (
    <Link
      to="/"
      aria-label="Karrierenmin — forsiden"
      className="fixed left-2 top-1.5 z-50 flex h-12 w-12 items-center justify-center rounded-md transition-colors hover:bg-accent/40 sm:left-3 sm:top-2 sm:h-14 sm:w-14"
    >
      <img src={logoMark} alt="Karrierenmin" className="h-10 w-10 sm:h-12 sm:w-12" />
    </Link>
  );
}
