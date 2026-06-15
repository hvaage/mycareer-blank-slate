import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/**
 * Passiv login-CTA. Bevarer returveien via redirect-param.
 */
export function LoginCta({ label, redirectTo }: { label: string; redirectTo: string }) {
  const search = { redirect: redirectTo } as const;
  return (
    <Button asChild variant="outline" size="sm">
      <Link to="/login" search={search as never}>
        {label}
      </Link>
    </Button>
  );
}
