import { useCallback, useRef, useState } from "react";

/** Longest a burst of edits can be folded into one undo step. */
const COALESCE_MS = 700;
const HISTORY_LIMIT = 60;

/* Clock reads live outside the hook so the compiler can see they only run from
   event handlers, never from render. */
function clockNow() {
  return Date.now();
}

/**
 * Undo and redo over whole documents. A deck is a small plain object, so keeping
 * sixty of them costs less than the machinery to diff them would.
 *
 * `commit` takes an optional key. Text fields pass a stable key so a sentence typed
 * straight through undoes as a sentence: edits that share a key and land within
 * COALESCE_MS fold into the step already recorded, keeping the state from before the
 * burst rather than from the middle of it. Discrete choices pass nothing so each is
 * its own step.
 */
export function useHistory<T>(initial: T, frozen = false) {
  const [value, setValue] = useState(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const lastMark = useRef({ key: "", at: 0 });

  function commit(next: T, key = "") {
    if (frozen) return;
    // This runs only in user and async callbacks, never while rendering.
    const now = clockNow();
    const continuing = key !== "" && key === lastMark.current.key && now - lastMark.current.at < COALESCE_MS;
    if (!continuing) past.current = [...past.current, value].slice(-HISTORY_LIMIT);
    lastMark.current = { key, at: now };
    future.current = [];
    setDepth({ past: past.current.length, future: 0 });
    setValue(next);
  }

  /** Moves one step and returns the restored value, or null when there is none. */
  const step = useCallback((from: "past" | "future") => {
    if (frozen) return null;
    const source = from === "past" ? past : future;
    const target = from === "past" ? future : past;
    const next = source.current.at(-1);
    if (!next) return null;
    source.current = source.current.slice(0, -1);
    target.current = [...target.current, value].slice(-HISTORY_LIMIT);
    setValue(next);
    lastMark.current = { key: "", at: 0 };
    setDepth({ past: past.current.length, future: future.current.length });
    return next;
  }, [value, frozen]);

  return {
    value,
    /** Replace the value without recording a step, for derived data such as media metadata. */
    setValue,
    commit,
    step,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
  };
}
