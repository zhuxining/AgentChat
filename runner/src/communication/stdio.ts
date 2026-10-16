import type { Runner } from "../harness/open.js";
import { createRequestHandler } from "./handlers.js";

export function serveStdio(runner: Runner) {
  const handle = createRequestHandler(runner);
  const maxMessageBytes = 1_048_576;
  let buffered = "";
  let closing = false;
  let terminating = false;
  const pendingDispatches = new Set<Promise<void>>();

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    if (terminating) return;
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const rawLine = buffered.slice(0, newline);
      const line = rawLine.replace(/\r$/, "");
      buffered = buffered.slice(newline + 1);
      if (Buffer.byteLength(rawLine, "utf8") + 1 > maxMessageBytes) {
        terminateProtocol("Runner protocol message exceeded the byte limit");
        return;
      }
      trackDispatch(line);
      newline = buffered.indexOf("\n");
    }
    if (Buffer.byteLength(buffered, "utf8") > maxMessageBytes) {
      terminateProtocol("Runner protocol message exceeded the byte limit");
    }
  });

  process.stdin.on("end", () => {
    if (buffered.length > 0) {
      terminateProtocol("Runner input ended with an incomplete protocol message");
      return;
    }
    if (terminating) return;
    const shouldCloseHarness = !closing;
    closing = true;
    void Promise.allSettled([...pendingDispatches]).then(
      async () => {
        if (shouldCloseHarness) await handle({ op: "close" });
        process.exit(0);
      },
      () => process.exit(1),
    );
  });

  function trackDispatch(line: string) {
    const operation = dispatch(line);
    pendingDispatches.add(operation);
    void operation.then(
      () => pendingDispatches.delete(operation),
      () => pendingDispatches.delete(operation),
    );
  }

  function terminateProtocol(reason: string) {
    if (terminating) return;
    terminating = true;
    const shouldCloseHarness = !closing;
    closing = true;
    process.stdin.pause();
    process.stderr.write(`${reason}\n`);
    void Promise.allSettled([...pendingDispatches]).then(
      async () => {
        if (shouldCloseHarness) await handle({ op: "close" });
        process.exit(1);
      },
      () => process.exit(1),
    );
  }

  async function dispatch(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      terminateProtocol("Runner received malformed JSON");
      return;
    }
    if (!message || typeof message !== "object") {
      terminateProtocol("Runner received an invalid request");
      return;
    }
    const record = message as Record<string, unknown>;
    if (typeof record.id !== "number" || !Number.isSafeInteger(record.id) || record.id <= 0) {
      terminateProtocol("Runner request ID is invalid");
      return;
    }
    const id = record.id;
    if (closing) {
      send({ id, ok: false, error: "Runner is closing" });
      return;
    }
    if (record.op === "close") {
      closing = true;
      await Promise.allSettled([...pendingDispatches]);
    }
    try {
      const result = await handle(record);
      send({ id, ok: true, result }, record.op === "close");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runner operation failed";
      send({ id, ok: false, error: safeError(message) });
    }
  }

  function safeError(message: string): string {
    if (/api.?key|token|authorization|credential|secret/i.test(message)) {
      return "Provider request failed; check the Runner configuration";
    }
    return message.slice(0, 500);
  }

  function send(
    response: { id: number; ok: boolean; result?: unknown; error?: string },
    exit = false,
  ) {
    const serialized = JSON.stringify(response);
    const line =
      Buffer.byteLength(serialized, "utf8") + 1 <= maxMessageBytes
        ? serialized
        : JSON.stringify({
            id: response.id,
            ok: false,
            error: "Runner response exceeded the size limit",
          });
    process.stdout.write(`${line}\n`, () => {
      if (exit) process.exit(0);
    });
  }
}
