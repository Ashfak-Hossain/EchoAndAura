/** Keep the existing ten-second bound without letting optional telemetry turn a clean close into exit 1. */
export function startShutdownDeadline(exit: (code: 0 | 1) => void, timeoutMs = 10_000): () => void {
  let code: 0 | 1 = 1;
  const deadline = setTimeout(() => exit(code), timeoutMs);
  deadline.unref();
  // Call only after all workers, queues and Redis have closed successfully.
  return () => {
    code = 0;
  };
}
