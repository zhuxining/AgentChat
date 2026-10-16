import type { HarnessSettings } from "@earendil-works/pi-durable";

// Like durable's configuration example: getters read the currently accepted policy.
// JSON reload does not configure or replace any persisted Agent choices.
export function harnessSettings(current: () => HarnessSettings | undefined): HarnessSettings {
  return {
    get stream() {
      return current()?.stream;
    },
    get retry() {
      return current()?.retry;
    },
    get compaction() {
      return current()?.compaction;
    },
    get toolExecution() {
      return current()?.toolExecution;
    },
    get steeringMode() {
      return current()?.steeringMode;
    },
    get followUpMode() {
      return current()?.followUpMode;
    },
  };
}
