import { MonitorSmartphone } from "lucide-react";

export function MobileClient() {
  return (
    <main className="bg-background text-foreground grid h-full min-h-0 place-items-center overflow-y-auto p-6">
      <section className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <MonitorSmartphone className="text-muted-foreground size-12" aria-hidden="true" />
        <div>
          <p className="text-muted-foreground mb-3 text-sm">AgentChat</p>
          <h1 className="text-xl font-semibold">尚未连接到工作台</h1>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            手机端用于连接桌面工作台，查看对话与发送消息。设备配对与同步功能尚未开放，请先在桌面端使用
            AgentChat。
          </p>
        </div>
      </section>
    </main>
  );
}
