import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, CpuIcon, InfoIcon, KeyRoundIcon, PaletteIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useWorkspaceContext } from "@/app/workspace-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const settingsSections = [
  { id: "general", label: "通用", icon: PaletteIcon },
  { id: "provider", label: "模型与 Provider", icon: KeyRoundIcon },
  { id: "runner", label: "Runner", icon: CpuIcon },
  { id: "about", label: "关于", icon: InfoIcon },
] as const;

export function SettingsLayout() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const sectionMatch = matchRoute({ to: "/settings/$section", fuzzy: true });
  const activeSection =
    sectionMatch && typeof sectionMatch === "object" && "section" in sectionMatch
      ? (sectionMatch.section as string)
      : null;
  const active = settingsSections.find((item) => item.id === activeSection);
  const { feedback } = useWorkspaceContext();
  return (
    <section aria-label="设置" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <Button
          aria-label="返回"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={() => void navigate(active ? { to: "/settings" } : { to: "/" })}
        >
          <ChevronLeftIcon />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" data-tauri-drag-region>
          {active ? active.label : "设置"}
        </h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="设置分类"
          className={cn(
            "min-h-0 flex-1 overflow-y-auto p-3 md:block md:w-56 md:shrink-0 md:flex-none md:border-r",
            active && "hidden",
          )}
        >
          <ul className="space-y-1">
            {settingsSections.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    "hover:bg-accent flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                    active?.id === item.id && "bg-accent",
                  )}
                  onClick={() =>
                    void navigate({ to: "/settings/$section", params: { section: item.id } })
                  }
                >
                  <item.icon className="size-4" />
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 md:block",
            !active && "hidden",
          )}
        >
          <div className="mx-auto max-w-3xl">
            {feedback.notice && (
              <p role="status" className="text-muted-foreground mb-3 text-xs">
                {feedback.notice}
              </p>
            )}
            <Outlet />
          </div>
        </div>
      </div>
    </section>
  );
}

export function SettingsSectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
