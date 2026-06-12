/**
 * Minimal ambient declarations for the Node built-ins used by the test
 * suite, because this engine has zero dependencies (no @types/node).
 * If you add @types/node at the workspace root, delete this file.
 */
declare module "node:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
