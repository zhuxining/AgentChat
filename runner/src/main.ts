import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";

import { createNativeStdio } from "./communication/native.js";
import { serveStdio } from "./communication/stdio.js";
import { openRunner } from "./harness/open.js";

const index = process.argv.indexOf("--data-dir");
const dataDir = index >= 0 ? process.argv[index + 1] : undefined;
if (!dataDir) {
  process.stderr.write("Runner requires --data-dir\n");
  process.exit(2);
}
registerBunOAuthFlows();
const transport = createNativeStdio();
const useNative = process.argv.includes("--native-rpc");
serveStdio(
  await openRunner({
    dataDir,
    ...(useNative ? { native: transport.adapter, migrateCredentials: true } : {}),
  }),
  transport,
);
