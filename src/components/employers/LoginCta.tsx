import { Button } from "@/components/ui/button";

/**
 * Passiv login-CTA. Bevarer returveien via `?redirect=` (URL-encoded).
 * Bruker plain anchor fordi /login ikke har dynamiske segmenter eller
 * validateSearch — Link med search-prop ville krevd ekstra typing-jobb
 * uten praktisk gevinst.
 */
export function LoginCta({ label, redirectTo }: { label: string; redirectTo: string }) {
  const href = `/login?redirect=${encodeURIComponent(redirectTo)}`;
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href}>{label}</a>
    </Button>
  );
}
