import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  BookOpen,
  Building2,
  Search,
  Send,
  Settings,
  Shield,
  LogOut,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";
import { isAdmin } from "@/lib/admin-guard";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/karrierenmin-mark.svg";
import logoLockup from "@/assets/karrierenmin-lockup.svg";

type SubItem = {
  label: string;
  to: string;
  indent?: boolean;
  search?: Record<string, unknown>;
};

type GroupNode = {
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
  to?: string;
  items?: SubItem[];
  matchPrefixes?: string[];
};

const RAIL_WIDTH = 64;
const SUBPANEL_WIDTH = 220;

const primaryGroups: GroupNode[] = [
  {
    id: "home",
    label: "Hjem",
    title: "Dashboard",
    icon: LayoutDashboard,
    to: "/dashboard",
    matchPrefixes: ["/dashboard"],
  },
  {
    id: "career",
    label: "Min karriere",
    title: "Min karriere",
    icon: BookOpen,
    items: [
      { label: "Min profil", to: "/min-profil" },
      { label: "Om meg", to: "/about-me", indent: true },
      { label: "Karriereoversikt", to: "/karriere/erfaring", indent: true },
      { label: "Importer eksisterende CV", to: "/min-profil/importer-cv", indent: true },
      { label: "Min dokumentasjon", to: "/documentation" },
      { label: "AI-forslag", to: "/career/atom-review" },
    ],
    matchPrefixes: [
      "/about-me",
      "/min-profil",
      "/preferences",
      "/career",
      "/karriere",
      "/documentation",
      "/documents",
    ],

  },
  {
    id: "market",
    label: "Marked",
    title: "Marked og arbeidsgivere",
    icon: Building2,
    items: [
      { label: "Markedsinnsikt", to: "/marked" },
      { label: "Arbeidsgivere", to: "/employers" },
    ],
    matchPrefixes: ["/marked", "/employers"],
  },
  {
    id: "jobs",
    label: "Jobber",
    title: "Jobbmuligheter",
    icon: Search,
    to: "/job-leads",
    matchPrefixes: ["/job-leads"],
  },
  {
    id: "apply",
    label: "Søknader",
    title: "Søknader",
    icon: Send,
    items: [
      { label: "Lag søknadsdokumenter", to: "/soknadsdokumenter" },
      { label: "Generell CV", to: "/cv-builder", search: { type: "general" }, indent: true },
      { label: "Stillingstilpasset CV", to: "/cv-builder", search: { type: "tailored" }, indent: true },
      { label: "Søknadsbrev", to: "/cover-letters", indent: true },
      { label: "Mine søknader", to: "/my-applications" },
      { label: "Søknadsstatus", to: "/applications" },
      { label: "Neste steg", to: "/next-steps" },
    ],
    matchPrefixes: [
      "/soknadsdokumenter",
      "/cv-builder",
      "/cover-letters",
      "/my-applications",
      "/applications",
      "/next-steps",
    ],
  },
];


const adminGroup: GroupNode = {
  id: "admin",
  label: "Admin",
  title: "Admin",
  icon: Shield,
  items: [
    { label: "Admin", to: "/admin" },
    { label: "Sync", to: "/admin/sync" },
  ],
  matchPrefixes: ["/admin"],
};

const settingsGroup: GroupNode = {
  id: "settings",
  label: "Innstillinger",
  title: "Innstillinger",
  icon: Settings,
  items: [
    { label: "Integrasjoner", to: "/innstillinger/integrasjoner" },
    { label: "Konto", to: "/innstillinger/konto" },
  ],
  matchPrefixes: ["/innstillinger", "/integrations"],
};


function matchesGroup(pathname: string, group: GroupNode): boolean {
  const prefixes =
    group.matchPrefixes ??
    (group.to ? [group.to] : group.items?.map((i) => i.to) ?? []);
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function groupForPath(pathname: string, groups: GroupNode[]): string | null {
  for (const g of groups) {
    if (g.items && matchesGroup(pathname, g)) return g.id;
  }
  return null;
}

function isSubItemActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + "/");
}

function initialsFor(name: string | null | undefined, email: string | null | undefined) {
  const src = (name && name.trim()) || (email && email.trim()) || "";
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AppSidebar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: admin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: () => isAdmin(user!.id),
  });

  // «CV-gjennomgang» vises bare når en import pågår eller trenger oppfølging.
  const { data: reviewPending } = useQuery({
    queryKey: ["sidebar-cv-review-pending", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { supabase } = await import("@/lib/supabase");
      const [imports, candidates] = await Promise.all([
        supabase
          .from("cv_imports")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .is("committed_at", null)
          .in("status", ["pending", "processing", "parsed"]),
        supabase
          .from("cv_parse_candidates")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("status", "ubehandlet"),
      ]);
      return (imports.count ?? 0) + (candidates.count ?? 0) > 0;
    },
  });

  const allGroups = useMemo(() => {
    const groups = primaryGroups.map((g) => {
      if (g.id !== "career" || !reviewPending || !g.items) return g;
      const items = [...g.items];
      const at = items.findIndex((i) => i.to === "/min-profil/importer-cv");
      items.splice(at + 1, 0, {
        label: "CV-gjennomgang",
        to: "/career/cv-review",
        indent: true,
      });
      return { ...g, items };
    });
    if (admin) groups.push(adminGroup);
    return groups;
  }, [admin, reviewPending]);

  // Innstillinger ligger i bunnområdet, men må være søkbar for aktiv-gruppe og undermeny.
  const lookupGroups = useMemo(() => [...allGroups, settingsGroup], [allGroups]);

  // K3: openGroup tracks pathname, but user-toggles persist until pathname changes.
  const routeGroup = useMemo(
    () => groupForPath(pathname, lookupGroups),
    [pathname, lookupGroups],
  );
  const [openGroup, setOpenGroup] = useState<string | null>(routeGroup);
  const [lastSyncedPath, setLastSyncedPath] = useState(pathname);

  useEffect(() => {
    if (pathname !== lastSyncedPath) {
      setOpenGroup(routeGroup);
      setLastSyncedPath(pathname);
    }
  }, [pathname, lastSyncedPath, routeGroup]);

  const handleRailClick = useCallback(
    (group: GroupNode) => {
      if (group.to) {
        setOpenGroup(null);
        navigate({ to: group.to });
        return;
      }
      // Et klikk på en hovedmenylinje er også et valg: åpne undermenyen og
      // gå rett til den øverste siden, med mindre du allerede står i gruppen.
      const first = group.items?.[0]?.to;
      const alreadyInside = routeGroup === group.id;
      if (openGroup === group.id && alreadyInside) {
        setOpenGroup(null);
        return;
      }
      setOpenGroup(group.id);
      if (first && !alreadyInside) navigate({ to: first });
    },
    [navigate, openGroup, routeGroup],
  );


  const handleLogout = useCallback(async () => {
    try {
      await signOut();
    } catch {
      /* ignore */
    }
    qc.clear();
    await navigate({ to: "/", replace: true });
  }, [navigate, qc, signOut]);

  const handleProfileClick = useCallback(() => {
    setOpenGroup(null);
    setOpenMobile(false);
    navigate({ to: "/about-me" });
  }, [navigate, setOpenMobile]);

  // Profile (K4 — only useAuth().user, no profile query)
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.given_name === "string" && meta.given_name) ||
    null;
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;
  const email = user?.email ?? null;
  const profileLabel = displayName || email || "Min profil";
  const profileInitials = initialsFor(displayName, email);

  const activeGroupId = openGroup;
  const activeGroup = lookupGroups.find((g) => g.id === activeGroupId) ?? null;
  const subPanelOpen = !!activeGroup && !!activeGroup.items;

  // ----- Desktop render -----
  const desktopRail = (
    <div
      className="flex shrink-0 flex-col items-stretch border-r bg-sidebar text-sidebar-foreground"
      style={{ width: RAIL_WIDTH }}
    >
      {/* Brand mark — K4 */}
      <Link
        to="/dashboard"
        aria-label="Karrierenmin — Dashboard"
        className="flex h-14 items-center justify-center border-b hover:bg-sidebar-accent/40"
      >
        <img src={logoMark} alt="" className="h-7 w-7" />
      </Link>

      <nav aria-label="Hovedmeny" className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col items-stretch gap-1 px-2">
          {allGroups.map((g) => {
            const isActive = matchesGroup(pathname, g);
            const isOpen = activeGroupId === g.id && !!g.items;
            return (
              <li key={g.id}>
                <RailButton
                  group={g}
                  active={isActive}
                  expanded={isOpen}
                  onClick={() => handleRailClick(g)}
                />
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom area */}
      <div className="flex flex-col items-stretch gap-1 border-t p-2">
        <RailButton
          group={settingsGroup}
          active={matchesGroup(pathname, settingsGroup)}
          expanded={activeGroupId === settingsGroup.id}
          onClick={() => handleRailClick(settingsGroup)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleProfileClick}
              aria-label={`Min profil — ${profileLabel}`}
              className="mx-auto grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/80"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{profileInitials}</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{profileLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="mx-auto h-10 w-10"
              onClick={handleLogout}
              aria-label="Logg ut"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Logg ut</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );

  const desktopSubPanel = subPanelOpen && activeGroup ? (
    <div
      className="hidden shrink-0 flex-col border-r bg-sidebar/60 text-sidebar-foreground sm:flex"
      style={{ width: SUBPANEL_WIDTH }}
      id={`subpanel-${activeGroup.id}`}
      role="region"
      aria-label={activeGroup.title}
    >
      <div className="flex h-14 items-center border-b px-4">
        <h2 className="truncate text-sm font-semibold">{activeGroup.title}</h2>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {activeGroup.items!.map((item) => {
            const active = isSubItemActive(pathname, item.to);
            return (
              <li key={`${item.to}-${item.label}`}>
                <Link
                  to={item.to}
                  search={item.search as never}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm transition-colors",
                    item.indent && "ml-3 border-l pl-3",
                    active
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  )}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpenMobile(false)}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  ) : null;

  // ----- Mobile drawer (K2 — explicit Sheet using openMobile state) -----
  const [mobileGroupId, setMobileGroupId] = useState<string | null>(null);
  useEffect(() => {
    if (!openMobile) setMobileGroupId(null);
  }, [openMobile]);

  const mobileGroup = mobileGroupId
    ? lookupGroups.find((g) => g.id === mobileGroupId) ?? null
    : null;

  const mobileNavigate = useCallback(
    (to: string, search?: Record<string, unknown>) => {
      setOpenMobile(false);
      navigate({ to, search: search as never });
    },
    [navigate, setOpenMobile],
  );

  const mobileDrawer = (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SheetTitle className="sr-only">
          {mobileGroup ? mobileGroup.title : "Hovedmeny"}
        </SheetTitle>

        <div className="flex h-14 items-center gap-2 border-b px-3">
          {mobileGroup ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileGroupId(null)}
                aria-label="Tilbake til hovedmeny"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <span className="truncate text-sm font-semibold">
                {mobileGroup.title}
              </span>
            </>
          ) : (
            <Link
              to="/dashboard"
              onClick={() => setOpenMobile(false)}
              aria-label="Karrierenmin — Dashboard"
              className="flex items-center"
            >
              <img src={logoLockup} alt="Karrierenmin" className="h-7" />
            </Link>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {mobileGroup && mobileGroup.items ? (
            <ul className="flex flex-col gap-1">
              {mobileGroup.items.map((item) => {
                const active = isSubItemActive(pathname, item.to);
                return (
                  <li key={`${item.to}-${item.label}`}>
                    <button
                      type="button"
                      onClick={() => mobileNavigate(item.to, item.search)}
                      className={cn(
                        "block w-full rounded-md px-3 py-3 text-left text-base transition-colors",
                        item.indent && "ml-3 border-l pl-3",
                        active
                          ? "bg-primary/10 font-semibold text-primary"
                          : "hover:bg-accent/50",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="flex flex-col gap-1">
              {allGroups.map((g) => {
                const Icon = g.icon;
                const active = matchesGroup(pathname, g);
                if (g.to) {
                  return (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => mobileNavigate(g.to!)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base transition-colors",
                          active
                            ? "bg-primary/10 font-semibold text-primary"
                            : "hover:bg-accent/50",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{g.title}</span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => setMobileGroupId(g.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base transition-colors",
                        active
                          ? "bg-primary/10 font-semibold text-primary"
                          : "hover:bg-accent/50",
                      )}
                      aria-haspopup="true"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate">{g.title}</span>
                      <span aria-hidden className="text-muted-foreground">›</span>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  onClick={() => setMobileGroupId(settingsGroup.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base transition-colors",
                    matchesGroup(pathname, settingsGroup)
                      ? "bg-primary/10 font-semibold text-primary"
                      : "hover:bg-accent/50",
                  )}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">Innstillinger</span>
                  <span aria-hidden className="text-muted-foreground">›</span>
                </button>
              </li>
            </ul>
          )}
        </nav>

        <div className="border-t p-3">
          {!mobileGroup && (
            <button
              type="button"
              onClick={handleProfileClick}
              className="mb-2 flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent/50"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-xs font-semibold">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  profileInitials
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{profileLabel}</span>
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Logg ut</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );

  // Desktop-chrome styres kun av CSS-breakpointet (md), slik at den aldri kan
  // falle bort i gråsonen der JS-bredden avrundes annerledes enn media query.
  return (
    <>
      <div className="hidden sm:flex">
        {desktopRail}
        {desktopSubPanel}
      </div>
      {mobileDrawer}
    </>

  );
}

function RailButton({
  group,
  active,
  expanded,
  onClick,
}: {
  group: GroupNode;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const Icon = group.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={group.title}
          aria-expanded={group.items ? expanded : undefined}
          aria-controls={group.items ? `subpanel-${group.id}` : undefined}
          className={cn(
            "mx-auto flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] font-medium transition-colors",
            active
              ? "bg-primary/10 text-primary"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50",
          )}
        >
          <Icon className="h-5 w-5" />
          <span className="leading-none">{group.label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{group.title}</TooltipContent>
    </Tooltip>
  );
}
