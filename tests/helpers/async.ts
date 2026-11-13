/**
 * Bound one observation without retrying a rejection. The caller still owns cleanup
 * of the underlying work; timing out does not cancel a process, socket or parser.
 */
export async function within<T>(pending: Promise<T>, milliseconds = 2000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${milliseconds} ms waiting for test evidence.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
