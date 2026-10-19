import { useLayoutEffect, useRef, useState } from "react";

// The entrance decision: a row animates only when it newly becomes the latest row of
// the Conversation already on screen. Switching Conversations or first load never
// replays entrances for existing history.
export function entranceTarget(
  previous: { conversationId: number | null; rowId: string | null },
  conversationId: number | null,
  latestRowId: string | null,
  snapshotReady: boolean,
): string | null {
  if (conversationId === null || !snapshotReady) return null;
  if (previous.conversationId !== conversationId) return null;
  return latestRowId && latestRowId !== previous.rowId ? latestRowId : null;
}

// Only a row that arrives while its Conversation is on screen animates; loading a
// transcript or switching Bots must not replay entrances for existing history.
export function useMessageEntrance(
  conversationId: number | null,
  latestRowId: string | null,
  snapshotReady: boolean,
): string | null {
  const [animatedRowId, setAnimatedRowId] = useState<string | null>(null);
  const previousLatestRef = useRef<{ conversationId: number | null; rowId: string | null }>({
    conversationId: null,
    rowId: null,
  });
  useLayoutEffect(() => {
    const previous = previousLatestRef.current;
    const target = entranceTarget(previous, conversationId, latestRowId, snapshotReady);
    if (conversationId !== null && snapshotReady) {
      setAnimatedRowId(target);
      previousLatestRef.current = { conversationId, rowId: latestRowId };
    }
  }, [latestRowId, conversationId, snapshotReady]);
  return animatedRowId;
}
