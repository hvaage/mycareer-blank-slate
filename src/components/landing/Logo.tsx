import lockup from "@/assets/karrierenmin-lockup.svg";
import mark from "@/assets/karrierenmin-mark.svg";

interface LogoProps {
  variant?: "lockup" | "mark";
  className?: string;
}

export function Logo({ variant = "lockup", className }: LogoProps) {
  const src = variant === "mark" ? mark : lockup;
  return <img src={src} alt="Karrierenmin" className={className} />;
}
