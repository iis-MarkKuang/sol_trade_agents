export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "operation timed out"
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries: number; baseDelayMs: number; maxDelayMs?: number; jitter?: boolean }
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= options.retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) {
        break;
      }

      const exponentialDelay = options.baseDelayMs * 2 ** attempt;
      const boundedDelay = Math.min(exponentialDelay, options.maxDelayMs ?? exponentialDelay);
      const delay = options.jitter ? Math.round(boundedDelay * (0.75 + Math.random() * 0.5)) : boundedDelay;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
