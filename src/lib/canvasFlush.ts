const flushers = new Set<() => Promise<void>>()

/** Lets the window-close path wait for every open canvas to save, the way it waits for the note editors. */
export function registerCanvasFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush)
  return () => void flushers.delete(flush)
}

export async function flushAllCanvases(): Promise<void> {
  await Promise.allSettled([...flushers].map((flush) => flush()))
}
