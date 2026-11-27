import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SidebarProvider } from "@workspace/ui/components/sidebar";

import { AppSidebar } from "@/components/app-sidebar";
import { ShellScreens } from "@/components/screen";
import { TabBar } from "@/components/tab-bar";

export const Route = createFileRoute("/_wallet/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col md:bg-sidebar md:py-2 md:pr-2">
        <div className="flex flex-1 flex-col md:rounded-xl md:bg-background md:shadow-surface md:ring-1 md:ring-foreground/5">
          <ShellScreens>
            <Outlet />
          </ShellScreens>
        </div>
      </div>
      <TabBar />
    </SidebarProvider>
  );
}
