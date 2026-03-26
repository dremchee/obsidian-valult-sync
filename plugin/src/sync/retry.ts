import { ApiError } from "../api";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (label: string, delayMs: number, error: unknown) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const shouldRetry = options.shouldRetry ?? isRetryableError;
      if (!shouldRetry(error) || attempt >= options.maxAttempts) {
        throw error;
      }

      const delayMs = options.baseDelayMs * 2 ** (attempt - 1);
      options.onRetry?.(label, delayMs, error);
      await options.sleep(delayMs);
    }
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 408
      || error.status === 429
      || error.status >= 500;
  }

  return error instanceof Error;
}
