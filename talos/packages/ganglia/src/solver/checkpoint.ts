/** Give cancellation events a turn between bounded solver stages. Never race a
 * still-running computation against a timer or reuse its state before it exits. */
export async function checkpoint(signal?: AbortSignal): Promise<void> {
  if (!signal) return;
  signal.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
}
