import { retry } from "../kernel/policy"

export const withOneTransientRetry = async <T>({
  operation,
  isTransient,
}: {
  operation: () => Promise<T>
  isTransient: (error: unknown) => boolean
}): Promise<T> => retry({ operation, shouldRetry: isTransient, attempts: 2, initialMs: 25, maxMs: 100 })
