// Serializing application mutations protects idle-only configure from racing submit.
// Harness still owns admission, queues, scheduling and execution recovery.
export function createMutationQueue() {
  let queue = Promise.resolve();
  return function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export type Mutate = ReturnType<typeof createMutationQueue>;
