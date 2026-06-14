/**
 * Minimal ambient declarations for the client's external dependencies so the
 * engine-facing logic type-checks WITHOUT a network install. On a connected
 * machine, `pnpm install` brings the real packages and their bundled types,
 * and this file is deleted. These shims declare only the surface this client
 * actually uses — they are intentionally narrow, not full type definitions.
 */

declare module "react" {
  export type ReactNode = unknown;
  export interface FC<P = Record<string, never>> {
    (props: P): ReactNode;
  }
  export function useState<S>(initial: S | (() => S)): [S, (s: S | ((p: S) => S)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useReducer<S, A>(
    reducer: (s: S, a: A) => S,
    initial: S,
    init?: (s: S) => S,
  ): [S, (a: A) => void];
  export function useCallback<T>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  const React: { createElement: (...args: unknown[]) => ReactNode };
  export default React;
}

declare module "react-dom/client" {
  export function createRoot(container: unknown): { render(node: unknown): void };
}

declare module "react/jsx-runtime" {
  export const jsx: (...args: unknown[]) => unknown;
  export const jsxs: (...args: unknown[]) => unknown;
  export const Fragment: unknown;
}

declare module "pixi.js" {
  export class Application {
    stage: Container;
    canvas: HTMLCanvasElement;
    init(opts: Record<string, unknown>): Promise<void>;
    destroy(removeView?: boolean): void;
  }
  export class Container {
    addChild(child: unknown): void;
    removeChildren(): void;
    on(event: string, fn: (e: unknown) => void): void;
    eventMode: string;
    x: number;
    y: number;
  }
  export class Graphics extends Container {
    poly(points: number[]): this;
    circle(x: number, y: number, r: number): this;
    fill(color: number | { color: number; alpha?: number }): this;
    stroke(opts: { color: number; width: number; alpha?: number }): this;
    clear(): this;
  }
  export class Text extends Container {
    constructor(opts: { text: string; style: Record<string, unknown> });
    text: string;
    anchor: { set(x: number, y?: number): void };
  }
}

declare module "@supabase/supabase-js" {
  export interface RealtimeChannel {
    on(type: string, filter: Record<string, unknown>, cb: (payload: unknown) => void): RealtimeChannel;
    subscribe(cb?: (status: string) => void): RealtimeChannel;
    track(state: Record<string, unknown>): Promise<unknown>;
    send(args: Record<string, unknown>): Promise<unknown>;
    presenceState(): Record<string, unknown[]>;
    unsubscribe(): Promise<unknown>;
  }
  export interface SupabaseClient {
    channel(name: string, opts?: Record<string, unknown>): RealtimeChannel;
    functions: {
      invoke(name: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }>;
    };
    from(table: string): {
      select(cols: string): { eq(c: string, v: unknown): { single(): Promise<{ data: unknown; error: unknown }> } };
    };
    rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
    auth: {
      getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
      getSession(): Promise<{ data: { session: unknown | null }; error: unknown }>;
      signInAnonymously(): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  }
  export function createClient(url: string, key: string, opts?: Record<string, unknown>): SupabaseClient;
}
