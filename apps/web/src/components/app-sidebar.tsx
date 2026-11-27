import {
  ArrowLeftRightIcon,
  ClockIcon,
  HouseIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Avatar } from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Skeleton } from "@workspace/ui/components/skeleton";
import * as Option from "effect/Option";

import { BrandLogo } from "@/components/brand-logo";
import { useTheme } from "@/components/theme-provider";
import { FlowerAvatar } from "@/components/flower-avatar";
import { m } from "@/paraglide/messages";
import { useSavedUsername } from "@/wallet/use-saved-username";

function SidebarIdentity() {
  const { read, username } = useSavedUsername();

  if (!read)
    return (
      <>
        <Skeleton variant="avatar" className="size-10" />
        <Skeleton
          aria-label={m.settings_loading_username()}
          className="h-4 w-24"
        />
      </>
    );

  return Option.match(username, {
    onNone: () => (
      <>
        <Avatar />
        <span>{m.nav_profile()}</span>
      </>
    ),
    onSome: (name) => (
      <>
        <FlowerAvatar username={name} />
        <span data-testid="sidebar-username">@{name}</span>
      </>
    ),
  });
}

function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={m.nav_toggle_theme()}
      onClick={() =>
        setTheme(
          document.documentElement.classList.contains("dark")
            ? "light"
            : "dark",
        )
      }
    >
      <MoonIcon className="text-icon-muted dark:hidden" />
      <SunIcon className="hidden text-icon-muted dark:block" />
    </Button>
  );
}

export function AppSidebar() {
  return (
    <Sidebar collapsible="none" className="sticky top-0 hidden h-svh md:flex">
      <SidebarHeader>
        <Link
          to="/home"
          aria-label={m.nav_home_link()}
          className="w-fit rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BrandLogo />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <nav aria-label={m.nav_main()}>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/home" />}>
                  <HouseIcon />
                  <span>{m.nav_home()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <ArrowLeftRightIcon />
                  <span>{m.nav_swap()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/activity" />}>
                  <ClockIcon />
                  <span>{m.nav_activity()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link to="/settings" />}>
                  <SettingsIcon />
                  <span>{m.settings_title()}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <SidebarIdentity />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
