import { useEffect, useRef, useState, type ReactNode } from "react";

import { runnerClient } from "@/app/runner-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function RuntimeGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"checking" | "installing" | "starting" | "ready" | "failed">(
    "checking",
  );
  const [message, setMessage] = useState("");
  const initialization = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      setPhase("checking");
      setMessage("");
      let runtime = await runnerClient.runtimeStatus();
      if (runtime.status !== "ready") {
        setPhase("installing");
        setMessage(
          runtime.status === "missing"
            ? "正在尝试通过本机包管理器安装 Node；若安装失败，会从 Node 发行源下载到 AgentChat 数据目录。首次初始化需要网络，包管理器可能请求系统授权。"
            : "检测到的 Node 不满足要求；不会替换它，正在下载独立 Node 到 AgentChat 数据目录。",
        );
        runtime = await runnerClient.installRuntime();
        if (runtime.status !== "ready") {
          throw new Error(runtime.detail ?? "Node runtime 安装后仍未就绪。");
        }
      }
      setPhase("starting");
      setMessage("Node 已就绪，正在启动后台 Runner…");
      await runnerClient.startRunner();
      await runnerClient.initialize();
    }

    const task = initialization.current ?? (initialization.current = initialize());
    void task.then(
      () => {
        if (mounted) setPhase("ready");
      },
      (cause: unknown) => {
        if (!mounted) return;
        setMessage(cause instanceof Error ? cause.message : String(cause));
        setPhase("failed");
      },
    );
    return () => {
      mounted = false;
    };
  }, [attempt]);

  if (phase === "ready") return <>{children}</>;

  return (
    <main className="bg-background text-foreground grid h-full min-h-0 place-items-center p-8">
      <section className="bg-card text-card-foreground flex w-full max-w-lg flex-col gap-4 rounded-xl border p-6 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold">首次启动设置</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            AgentChat 需要 Node 24
            或更新版本。已有合格版本会直接复用；找不到可用版本时会先尝试本机包管理器，再从 Node
            发行源下载到 AgentChat 数据目录。包管理器可能请求系统授权；直连回退不会修改 PATH。
          </p>
        </div>
        {phase !== "failed" ? (
          <div className="text-muted-foreground flex items-center gap-3 text-sm" aria-live="polite">
            <Spinner />
            <span>{message || "正在检查 Node 运行环境…"}</span>
          </div>
        ) : (
          <div className="bg-muted rounded-md p-3 text-sm leading-6" role="alert">
            {message}
          </div>
        )}
        {phase === "failed" && (
          <div className="flex justify-end">
            <Button
              onClick={() => {
                initialization.current = null;
                setAttempt((value) => value + 1);
              }}
            >
              重试
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
