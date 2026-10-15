export type TimeoutArgs<T> = { work: Promise<T>; ms: number; message: string }

/** Rejects with `message` when `work` does not settle in `ms`; the late result is ignored. */
export const withTimeout = <T>({ work, ms, message }: TimeoutArgs<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
