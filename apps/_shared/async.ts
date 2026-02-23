export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message ?? `Operation timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timer))
  })
}
