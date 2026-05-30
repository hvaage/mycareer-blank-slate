import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Search,
  Send,
  FileText,
  BookOpen,
  Building2,
  FileEdit,
  Sparkles,
  Settings,
  LogOut,
  Shield,
  MessageSquare,
  FileSignature,
  UserRound,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { isAdmin } from "@/lib/admin-guard";
import logoMark from "@/assets/karrierenmin-mark.svg";
import logoLockup from "@/assets/karrierenmin-lockup.svg";

type NavItem = {
  title: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
};

const primaryNav: NavItem[] = [
  { title: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { title: "Jobb-leads", to: "/job-leads", icon: Search },
  { title: "Søknader", to: "/applications", icon: Send },
  { title: "Dokumenter", to: "/documents", icon: FileText },
  { title: "Dokumentasjon", to: "/documentation", icon: BookOpen },
  { title: "Arbeidsgivere", to: "/employers", icon: Building2 },
  { title: "CV-bygger", to: "/cv-builder", icon: FileEdit },
  { title: "Karriereprofil", to: "/career/atom-review", icon: Sparkles },
  { title: "Preferanser", to: "/preferences", icon: Settings },
  { title: "Min profil", to: "/about-me", icon: UserRound },
];

const upcomingNav: NavItem[] = [
  { title: "Intervjuforberedelse", to: "/interview-prep", icon: MessageSquare, soon: true },
  { title: "Tilbudsanalyse", to: "/offer-analysis", icon: FileSignature, soon: true },
];

const adminNav: NavItem[] = [
  { title: "Admin", to: "/admin", icon: Shield },
];

export function AppSidebar() {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { user, signOut } = useAuth();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });

  const { data: admin } = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: () => isAdmin(user!.id),
  });

  const isActive = (path: string) =>
    currentPath === path || currentPath.startsWith(path + "/");

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.to}>
      <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.title}>
        <Link
          to={item.to}
          onClick={() => setOpenMobile(false)}
          className="flex items-center gap-2"
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <span className="flex-1 truncate">
              {item.title}
              {item.soon && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  snart
                </span>
              )}
            </span>
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <Link
          to="/dashboard"
          onClick={() => setOpenMobile(false)}
          className="flex items-center gap-2 px-1 py-1.5"
        >
          {collapsed ? (
            <img src={logoMark} alt="Karrierenmin" className="h-7 w-7" />
          ) : (
            <img src={logoLockup} alt="Karrierenmin" className="h-7" />
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Hovedmeny</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{primaryNav.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Kommer snart</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{upcomingNav.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {admin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{adminNav.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        {!collapsed && user?.email && (
          <div className="px-2 pb-1 text-xs text-muted-foreground truncate">
            {user.email}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => signOut()}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Logg ut</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
