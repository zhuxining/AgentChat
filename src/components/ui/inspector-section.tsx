import type { ReactNode } from "react";

export function InspectorSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex min-h-7 items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words">{value}</span>
    </div>
  );
}
