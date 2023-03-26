import {
  Accessor,
  batch,
  createMemo,
  createSignal,
  getListener,
  getOwner,
  onMount,
  runWithOwner,
  sharedConfig,
  Signal,
  untrack,
} from "solid-js";
import { accessWith, AnyStatic, isObject, isServer, SetterParam } from "@solid-primitives/utils";

export type StaticStoreSetter<T extends Readonly<AnyStatic>> = {
  (setter: (prev: T) => Partial<T>): T;
  (state: Partial<T>): T;
  <K extends keyof T>(key: K, state: SetterParam<T[K]>): T;
};

/**
 * A shallowly wrapped reactive store object. It behaves similarly to the createStore, but with limited features to keep it simple. Designed to be used for reactive objects with static keys, but dynamic values, like reactive Event State, location, etc.
 * @param init initial value of the store
 * @returns
 * ```ts
 * [access: Readonly<T>, write: StaticStoreSetter<T>]
 * ```
 */
export function createStaticStore<T extends Readonly<AnyStatic>>(
  init: T,
): [access: T, write: StaticStoreSetter<T>] {
  const copy = { ...init };
  const store = { ...init };
  const cache = new Map<PropertyKey, Signal<any>>();

  const getValue = <K extends keyof T>(key: K): T[K] => {
    const saved = cache.get(key);
    if (saved) return saved[0]();
    const signal = createSignal<any>(copy[key], {
      internal: true,
    });
    cache.set(key, signal);
    delete copy[key];
    return signal[0]();
  };

  const setValue = <K extends keyof T>(key: K, value: SetterParam<any>): void => {
    const saved = cache.get(key);
    if (saved) return saved[1](value);
    if (key in copy) copy[key] = accessWith(value, [copy[key]]);
  };

  for (const key in init) {
    Object.defineProperty(store, key, { get: getValue.bind(void 0, key) });
  }

  const setter = (a: ((prev: T) => Partial<T>) | Partial<T> | keyof T, b?: SetterParam<any>) => {
    if (isObject(a)) {
      const entries = untrack(
        () => Object.entries(accessWith(a, store) as Partial<T>) as [any, any][],
      );
      batch(() => {
        for (const [key, value] of entries) setValue(key, () => value);
      });
    } else setValue(a, b);
    return store;
  };

  return [store, setter];
}

/**
 * A hydratable version of the {@link createStaticStore}. It will use the serverValue on the server and the update function on the client. If initialized during hydration it will use serverValue as the initial value and update it once hydration is complete.
 *
 * @param serverValue initial value of the state on the server
 * @param update called once on the client or on hydration to initialize the value
 * @returns
 * ```ts
 * [access: Readonly<T>, write: StaticStoreSetter<T>]
 * ```
 */
export function createHydratableStaticStore<T extends Readonly<AnyStatic>>(
  serverValue: T,
  update: () => T,
): ReturnType<typeof createStaticStore<T>> {
  if (isServer) return createStaticStore(serverValue);
  if (sharedConfig.context) {
    const [state, setState] = createStaticStore(serverValue);
    onMount(() => setState(update()));
    return [state, setState];
  }
  return createStaticStore(update());
}

export function createDerivedStaticStore<T extends object>(fn: () => T): T {
  const cache = new Map<keyof T, Accessor<any>>(),
    o = getOwner(),
    fnMemo = createMemo(fn),
    store = { ...untrack(fnMemo) };

  for (const key in store) {
    Object.defineProperty(store, key, {
      get() {
        let propMemo = cache.get(key);
        if (!propMemo) {
          if (!getListener()) return fnMemo()[key];
          runWithOwner(o, () => cache.set(key, (propMemo = createMemo(() => fnMemo()[key]))));
        }
        return propMemo!();
      },
      enumerable: true,
    });
  }

  return store;
}
