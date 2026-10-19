import { Outlet, useMatchRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeftIcon, CpuIcon, InfoIcon, KeyRoundIcon, PaletteIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useRunnerCatalog } from "@/app/runner-queries";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

export const settingsSections = [
  { id: "general", label: "通用", icon: PaletteIcon },
  { id: "provider", label: "模型与 Provider", icon: KeyRoundIcon },
  { id: "runner", label: "Runner", icon: CpuIcon },
  { id: "about", label: "关于", icon: InfoIcon },
] as const;

// Settings is a standalone view: it replaces the workspace instead of sitting beside the
// Bot list, and the navigation back to the workspace lives at the bottom of its own rail.
export function SettingsLayout() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const sectionMatch = matchRoute({ to: "/settings/$section", fuzzy: true });
  const activeSection =
    sectionMatch && typeof sectionMatch === "object" && "section" in sectionMatch
      ? (sectionMatch.section as string)
      : null;
  const active = settingsSections.find((item) => item.id === activeSection);
  const { returnBotId } = useSearch({ from: "/settings" });
  const { data: catalog } = useRunnerCatalog();

  // Back always targets the workspace, not the previous settings page.
  function leaveSettings() {
    const botId = catalog?.bots.some((bot) => bot.id === returnBotId && !bot.archived)
      ? returnBotId
      : undefined;
    if (botId) void navigate({ to: "/bots/$botId", params: { botId } });
    else void navigate({ to: "/" });
  }

  return (
    <section aria-label="设置" className="animate-fade-in flex h-full min-h-0 min-w-0 flex-1">
      <aside
        aria-label="设置导航"
        className={cn(
          "bg-sidebar flex min-h-0 w-full shrink-0 flex-col border-r md:w-60",
          active && "hidden md:flex",
        )}
      >
        <header
          data-window-titlebar
          data-window-titlebar-leading
          className="flex h-14 shrink-0 items-center px-4"
        >
          <span className="font-semibold" data-window-drag-region>
            设置
          </span>
        </header>
        <nav aria-label="设置分类" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {settingsSections.map((item) => (
            <Item
              key={item.id}
              render={
                <button
                  type="button"
                  aria-current={active?.id === item.id ? "page" : undefined}
                  onClick={() =>
                    void navigate({
                      to: "/settings/$section",
                      params: { section: item.id },
                      search: { returnBotId },
                    })
                  }
                />
              }
              size="xs"
              className={cn(
                "text-left text-sm hover:bg-muted",
                active?.id === item.id && "bg-muted font-medium",
              )}
            >
              <ItemMedia variant="icon">
                <item.icon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="w-full justify-start">{item.label}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </nav>
        <footer className="shrink-0 border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={leaveSettings}
          >
            <ChevronLeftIcon />
            返回
          </Button>
        </footer>
      </aside>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", !active && "hidden md:flex")}>
        <header
          data-window-titlebar
          className="flex h-14 shrink-0 items-center gap-2 border-b px-4"
        >
          <Button
            aria-label="返回设置分类"
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={() => void navigate({ to: "/settings", search: { returnBotId } })}
          >
            <ChevronLeftIcon />
          </Button>
          <h1
            key={active?.id ?? "index"}
            className="animate-fade-in min-w-0 flex-1 truncate text-sm font-semibold"
            data-window-drag-region
          >
            {active ? active.label : "设置"}
          </h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="animate-fade-in mx-auto max-w-2xl space-y-6">
            {active ? (
              <Outlet />
            ) : (
              <p className="text-muted-foreground text-sm">从左侧选择一个分类查看设置。</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsSectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="bg-card space-y-3 rounded-xl border p-4">{children}</div>
    </section>
  );
}
