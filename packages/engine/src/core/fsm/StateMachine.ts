/**
 * Generic nested finite state machine (Titan engine, module: core/fsm).
 *
 * Design constraints (from the project charter):
 *  - Exactly ONE active state at a time. The active state is always a LEAF;
 *    entering a compound state resolves through `initial` chains to a leaf.
 *  - Transitions are EXPLICIT. There are no wildcards. An event not present
 *    in the table for the active state (or one of its ancestor scopes) is a
 *    rejected transition, never a silent no-op.
 *  - Machine STATE is plain JSON ({ path, returnStack }) because it is
 *    persisted in PostgreSQL and shipped over Realtime. The machine
 *    DEFINITION is static code shared by client and server.
 *
 * Two behaviors beyond a flat FSM, both needed by Titan:
 *
 *  1. Bubbling with shadowing — a transition may be declared on a compound
 *     state ("scope") and then applies to every descendant leaf, unless a
 *     deeper scope declares the same event (deepest match wins). Titan uses
 *     this for "from anywhere in the battle round: BATTLE_CONCLUDED" and the
 *     root-scoped GAME_ENDED.
 *
 *  2. Interrupt / resume — a transition marked `interrupt: true` pushes the
 *     current leaf path onto a return stack; a transition targeting RESUME
 *     pops it. Titan uses this for the Angel-summon window, which seizes
 *     control mid-strike-phase and must return exactly where it interrupted.
 *     A NORMAL (non-interrupt, non-resume) transition CLEARS the stack: the
 *     stack is only meaningful to the interrupt it belongs to, so leaving by
 *     any other door abandons it.
 *
 * Deliberately OUT of scope here: guards and context. Whether an event is
 * legal given the game situation (whose turn, which battle round, has the
 * summon already been used) is the Command layer's job — commands validate
 * against GameState and only then fire events. The FSM enforces topology:
 * which phase can follow which.
 */

/** Sentinel transition target: pop the return stack. */
export const RESUME = "@resume";

/** A state node. Leaf if `states` is absent/empty; compound otherwise. */
export interface StateNodeDef {
  /** Required for compound nodes: the child entered by default. */
  readonly initial?: string;
  readonly states?: Readonly<Record<string, StateNodeDef>>;
}

export interface TransitionDef {
  /**
   * Source scope as a dotted path ("Turn.Engagement.Battle.Round"), or ""
   * for the root scope (applies to every state in the machine unless
   * shadowed by a deeper declaration of the same event).
   */
  readonly from: string;
  readonly event: string;
  /** Target dotted path (leaf or compound), or RESUME. */
  readonly to: string;
  /** Push the current leaf path onto the return stack when taken. */
  readonly interrupt?: boolean;
}

export interface MachineDef {
  readonly id: string;
  /** Top-level initial state name. */
  readonly initial: string;
  readonly states: Readonly<Record<string, StateNodeDef>>;
  readonly transitions: readonly TransitionDef[];
}

/** The serializable runtime state of a machine instance. Plain JSON. */
export interface FsmState {
  /** Active LEAF path, e.g. "Turn.Engagement.Battle.Round.Strike". */
  readonly path: string;
  /** LIFO of leaf paths to resume to; outermost interrupt first. */
  readonly returnStack: readonly string[];
}

export type TransitionError =
  | { readonly kind: "UNHANDLED_EVENT"; readonly path: string; readonly event: string }
  | { readonly kind: "EMPTY_RETURN_STACK"; readonly path: string; readonly event: string };

export type TransitionResult =
  | { readonly ok: true; readonly state: FsmState }
  | { readonly ok: false; readonly error: TransitionError };

export class MachineDefinitionError extends Error {
  constructor(machineId: string, problem: string) {
    super(`Invalid machine definition "${machineId}": ${problem}`);
    this.name = "MachineDefinitionError";
  }
}

export class IllegalTransitionError extends Error {
  readonly detail: TransitionError;
  constructor(machineId: string, detail: TransitionError) {
    super(
      detail.kind === "UNHANDLED_EVENT"
        ? `Machine "${machineId}": event "${detail.event}" is not legal in state "${detail.path}"`
        : `Machine "${machineId}": cannot resume from "${detail.path}" on "${detail.event}" — return stack is empty`,
    );
    this.name = "IllegalTransitionError";
    this.detail = detail;
  }
}

/** A validated, ready-to-use machine. Construct via createMachine. */
export interface Machine {
  readonly def: MachineDef;
  /** Initial FsmState: top-level initial resolved to a leaf, empty stack. */
  readonly initialState: FsmState;
  /** @internal precomputed `${from}|${event}` → TransitionDef */
  readonly lookup: ReadonlyMap<string, TransitionDef>;
  /** @internal set of every valid dotted path */
  readonly paths: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Definition walking
// ---------------------------------------------------------------------------

function isCompound(node: StateNodeDef): boolean {
  return node.states !== undefined && Object.keys(node.states).length > 0;
}

/** Collect every dotted path and its node. Root is represented by "". */
function collectPaths(def: MachineDef): Map<string, StateNodeDef> {
  const out = new Map<string, StateNodeDef>();
  const walk = (prefix: string, states: Readonly<Record<string, StateNodeDef>>) => {
    for (const [name, node] of Object.entries(states)) {
      if (name.includes(".") || name.length === 0) {
        throw new MachineDefinitionError(
          def.id,
          `state name "${name}" must be non-empty and must not contain "."`,
        );
      }
      const path = prefix === "" ? name : `${prefix}.${name}`;
      out.set(path, node);
      if (node.states) walk(path, node.states);
    }
  };
  walk("", def.states);
  return out;
}

/** Resolve a path (possibly compound) down its `initial` chain to a leaf. */
function resolveToLeaf(
  def: MachineDef,
  nodes: Map<string, StateNodeDef>,
  path: string,
): string {
  let current = path;
  let node = nodes.get(current);
  if (!node) {
    throw new MachineDefinitionError(def.id, `unknown state path "${path}"`);
  }
  while (isCompound(node)) {
    const init = node.initial;
    if (init === undefined) {
      throw new MachineDefinitionError(
        def.id,
        `compound state "${current}" has children but no "initial"`,
      );
    }
    if (!node.states || !(init in node.states)) {
      throw new MachineDefinitionError(
        def.id,
        `state "${current}" declares initial "${init}" which is not a child`,
      );
    }
    current = `${current}.${init}`;
    node = nodes.get(current)!;
  }
  return current;
}

/** Ancestor scopes of a leaf, deepest first, ending with root "". */
function scopesOf(path: string): string[] {
  const scopes: string[] = [path];
  let p = path;
  while (true) {
    const cut = p.lastIndexOf(".");
    if (cut < 0) break;
    p = p.slice(0, cut);
    scopes.push(p);
  }
  scopes.push("");
  return scopes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate a definition and build the machine. Throws MachineDefinitionError. */
export function createMachine(def: MachineDef): Machine {
  const nodes = collectPaths(def);

  // Every compound node's initial chain must resolve (validates root too).
  if (!(def.initial in def.states)) {
    throw new MachineDefinitionError(
      def.id,
      `machine initial "${def.initial}" is not a top-level state`,
    );
  }
  for (const [path, node] of nodes) {
    if (isCompound(node)) resolveToLeaf(def, nodes, path);
  }
  const initialLeaf = resolveToLeaf(def, nodes, def.initial);

  // Validate transitions.
  const lookup = new Map<string, TransitionDef>();
  for (const t of def.transitions) {
    if (t.from !== "" && !nodes.has(t.from)) {
      throw new MachineDefinitionError(
        def.id,
        `transition on "${t.event}" has unknown source "${t.from}"`,
      );
    }
    if (t.to === RESUME) {
      if (t.interrupt) {
        throw new MachineDefinitionError(
          def.id,
          `transition "${t.from}" --${t.event}--> ${RESUME} cannot itself be an interrupt`,
        );
      }
    } else if (!nodes.has(t.to)) {
      throw new MachineDefinitionError(
        def.id,
        `transition on "${t.event}" has unknown target "${t.to}"`,
      );
    } else {
      resolveToLeaf(def, nodes, t.to); // compound targets must resolve
    }
    const key = `${t.from}|${t.event}`;
    if (lookup.has(key)) {
      throw new MachineDefinitionError(
        def.id,
        `duplicate transition for event "${t.event}" from "${t.from || "<root>"}"`,
      );
    }
    lookup.set(key, t);
  }

  return {
    def,
    initialState: { path: initialLeaf, returnStack: [] },
    lookup,
    paths: new Set(nodes.keys()),
  };
}

/**
 * Attempt a transition. Pure: returns a new FsmState or a structured error;
 * never mutates. Deepest matching scope wins (child shadows ancestor).
 */
export function tryTransition(
  machine: Machine,
  state: FsmState,
  event: string,
): TransitionResult {
  let matched: TransitionDef | undefined;
  for (const scope of scopesOf(state.path)) {
    matched = machine.lookup.get(`${scope}|${event}`);
    if (matched) break;
  }
  if (!matched) {
    return {
      ok: false,
      error: { kind: "UNHANDLED_EVENT", path: state.path, event },
    };
  }

  if (matched.to === RESUME) {
    if (state.returnStack.length === 0) {
      return {
        ok: false,
        error: { kind: "EMPTY_RETURN_STACK", path: state.path, event },
      };
    }
    const stack = state.returnStack.slice();
    const target = stack.pop()!;
    return { ok: true, state: { path: target, returnStack: stack } };
  }

  const nodes = collectNodesCache(machine);
  const leaf = resolveToLeafCached(machine, nodes, matched.to);

  const returnStack = matched.interrupt
    ? [...state.returnStack, state.path] // push: remember where we were
    : []; // normal transition abandons any pending interrupts

  return { ok: true, state: { path: leaf, returnStack } };
}

/** Like tryTransition but throws IllegalTransitionError on failure. */
export function transition(
  machine: Machine,
  state: FsmState,
  event: string,
): FsmState {
  const result = tryTransition(machine, state, event);
  if (!result.ok) throw new IllegalTransitionError(machine.def.id, result.error);
  return result.state;
}

/** Would `event` be accepted in `state`? (Stack-aware: RESUME needs depth.) */
export function can(machine: Machine, state: FsmState, event: string): boolean {
  return tryTransition(machine, state, event).ok;
}

/**
 * Events currently accepted, in stable (definition) order. Useful for UIs
 * ("what can the player do now?") and for property tests.
 */
export function legalEvents(machine: Machine, state: FsmState): string[] {
  const scopes = scopesOf(state.path);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of machine.def.transitions) {
    if (seen.has(t.event)) continue;
    // deepest-scope shadowing: the matched def for this event must be t
    let matched: TransitionDef | undefined;
    for (const scope of scopes) {
      matched = machine.lookup.get(`${scope}|${t.event}`);
      if (matched) break;
    }
    if (matched !== t) continue;
    if (t.to === RESUME && state.returnStack.length === 0) continue;
    seen.add(t.event);
    out.push(t.event);
  }
  return out;
}

/** Is the active state at, or nested anywhere inside, `scope`? */
export function matches(state: FsmState, scope: string): boolean {
  if (scope === "") return true;
  return state.path === scope || state.path.startsWith(`${scope}.`);
}

// ---------------------------------------------------------------------------
// Tiny per-machine memoization (machines are static module-level singletons,
// so a WeakMap cache keeps tryTransition allocation-light without any global
// mutable state observable from outside).
// ---------------------------------------------------------------------------

const nodeCache = new WeakMap<MachineDef, Map<string, StateNodeDef>>();
const leafCache = new WeakMap<MachineDef, Map<string, string>>();

function collectNodesCache(machine: Machine): Map<string, StateNodeDef> {
  let nodes = nodeCache.get(machine.def);
  if (!nodes) {
    nodes = collectPaths(machine.def);
    nodeCache.set(machine.def, nodes);
  }
  return nodes;
}

function resolveToLeafCached(
  machine: Machine,
  nodes: Map<string, StateNodeDef>,
  path: string,
): string {
  let leaves = leafCache.get(machine.def);
  if (!leaves) {
    leaves = new Map();
    leafCache.set(machine.def, leaves);
  }
  let leaf = leaves.get(path);
  if (leaf === undefined) {
    leaf = resolveToLeaf(machine.def, nodes, path);
    leaves.set(path, leaf);
  }
  return leaf;
}
