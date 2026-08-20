// Varsler i appen. Leses direkte med brukerens egen tilgang; brukeren kan
// kun markere et varsel som lest — innholdet kan aldri endres fra nettleseren.
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/lib/supabase";

type Notification = {
  id: string;
  title: string;
  body: string;
  deep_link: string;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const notifications = useQuery({
    queryKey: ["user-notifications"],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("id, title, body, deep_link, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("user_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
  });

  const items = notifications.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Varsler">
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-semibold">Varsler</div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Ingen varsler ennå.
          </p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                    n.read_at ? "opacity-60" : ""
                  }`}
                  onClick={() => {
                    if (!n.read_at) markRead.mutate(n.id);
                    navigate({ to: n.deep_link });
                  }}
                >
                  <span className="block font-medium">{n.title}</span>
                  <span className="block text-xs text-muted-foreground">{n.body}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
