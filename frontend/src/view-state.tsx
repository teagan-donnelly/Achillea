import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
// Interaction preferences only: never cache clinical snapshots, server results or verification.
const ViewState = createContext<Map<string, unknown> | null>(null);
export function ViewStateProvider({ children }: { children: ReactNode }) {
  const store = useRef(new Map<string, unknown>());
  return (
    <ViewState.Provider value={store.current}>{children}</ViewState.Provider>
  );
}
export function useViewState<T>(
  key: string,
  initial: T | (() => T),
): [T, (value: SetStateAction<T>) => void] {
  const shared = useContext(ViewState),
    local = useRef(new Map<string, unknown>()),
    store = shared ?? local.current;
  function read(): T {
    return store.has(key)
      ? (store.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial;
  }
  const [record, setRecord] = useState(() => ({ key, value: read() }));
  const value = record.key === key ? record.value : read();
  const current = useRef(value);
  current.current = value;
  const update = useCallback(
    (next: SetStateAction<T>) => {
      // Read the latest preference so rapid updates do not close over an old render.
      const previous = store.has(key) ? (store.get(key) as T) : current.current;
      const result =
        typeof next === "function" ? (next as (value: T) => T)(previous) : next;
      store.set(key, result);
      setRecord({ key, value: result });
    },
    [store, key],
  );
  return [value, update];
}
