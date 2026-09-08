import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Whether the code running right now is a queue worker (14-17.0).
 *
 * The rule "every outbound fetch runs inside a queue worker, never inside a request handler"
 * is only a rule if something can tell the difference. This is that something: the queue wraps
 * each handler in `runInWorker`, and `OutboundFetchService` refuses outright when the flag is
 * absent. Without it, the first person to call the guard from a controller — because a "test
 * this feed" button felt harmless — hands a slow remote host one of our HTTP threads.
 */
const WORKER = new AsyncLocalStorage<true>();

export function runInWorker<T>(work: () => Promise<T>): Promise<T> {
  return WORKER.run(true, work);
}

export function isInsideWorker(): boolean {
  return WORKER.getStore() === true;
}
