// @ts-nocheck
import { useAuth } from "@/lib/auth-context";

/** Bruker-id fra gjeldende sesjon. Alle lesinger er bruker-scopet via RLS. */
export function useAuthUserId(): string | undefined {
  const { user } = useAuth();
  return user?.id;
}
