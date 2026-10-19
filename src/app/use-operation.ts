import {
  useIsMutating,
  useMutation,
  useQueryClient,
  type MutationKey,
} from "@tanstack/react-query";

import { errorMessage } from "@/app/runner-queries";

// Observers in the same feature share pending status; unrelated features stay usable.
export function useOperation(mutationKey: MutationKey) {
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationKey,
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    retry: false,
  });
  const pending = useIsMutating({ mutationKey, exact: true });
  async function runAction<T>(operation: () => Promise<T>): Promise<T | null> {
    if (cache.isMutating({ mutationKey, exact: true }) > 0) return null;
    let result: T | null = null;
    try {
      await mutation.mutateAsync(async () => {
        result = await operation();
      });
      return result;
    } catch {
      return null;
    }
  }
  return {
    runAction,
    clearError: mutation.reset,
    busy: pending > 0,
    error: mutation.error ? errorMessage(mutation.error) : "",
  };
}
