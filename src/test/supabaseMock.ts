import { vi } from 'vitest';

export interface QueryResult {
  data: unknown;
  error: unknown;
}

/**
 * A chainable, awaitable stand-in for a Supabase query builder. Every method
 * (`select`, `eq`, `order`, `insert`, `update`, `delete`, `single`,
 * `maybeSingle`, ...) returns the same proxy, and awaiting the proxy resolves to
 * the single configured result.
 */
function queryChain(result: QueryResult) {
  const promise = Promise.resolve(result);
  const proxy: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return promise.then.bind(promise);
        if (prop === 'catch') return promise.catch.bind(promise);
        if (prop === 'finally') return promise.finally.bind(promise);
        return () => proxy;
      },
    },
  );
  return proxy;
}

export interface MockOptions {
  /** Result returned for a `.from(table)` chain. */
  from?: (table: string) => QueryResult;
  auth?: Record<string, unknown>;
  functions?: Record<string, unknown>;
}

export function mockSupabase(opts: MockOptions = {}) {
  return {
    from: vi.fn((table: string) =>
      queryChain(opts.from ? opts.from(table) : { data: null, error: null }),
    ),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: {}, error: null })),
      ...(opts.auth ?? {}),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: {}, error: null })),
      ...(opts.functions ?? {}),
    },
  };
}
