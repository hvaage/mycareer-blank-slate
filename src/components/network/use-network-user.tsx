// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { networkGraphQuery } from "@/lib/queries/network";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bruker-id fra gjeldende sesjon. Alle lesinger er bruker-scopet via RLS.
 * Returnerer kun en gyldig UUID; tomme eller halvhydrerte verdier gir
 * `undefined` slik at ingen spørring aktiveres som `anon`.
 */
export function useAuthUserId(): string | undefined {
  return useNetworkAuth().userId;
}

/**
 * Autentiseringstilstand for nettverksflatene.
 * `isAuthPending` er sann både mens økten hydreres og når det ikke finnes en
 * bruker ennå — da vises lastetilstand, aldri tomtilstand.
 */
export function useNetworkAuth(): { userId: string | undefined; isAuthPending: boolean } {
  const { user, loading } = useAuth();
  const raw = typeof user?.id === "string" ? user.id.trim() : "";
  const userId = UUID.test(raw) ? raw : undefined;
  return { userId, isAuthPending: loading || !userId };
}

/**
 * Felles lesing av nettverksgrafen. Spørringen opprettes aldri før økten er
 * hydrert, og tilgangsfeil bobler opp som feiltilstand — ikke som tom liste.
 */
export function useNetworkGraph() {
  const { userId, isAuthPending } = useNetworkAuth();
  const query = useQuery(networkGraphQuery(userId));
  return {
    userId,
    isAuthPending,
    graph: query.data,
    isLoading: isAuthPending || (Boolean(userId) && query.isPending),
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
