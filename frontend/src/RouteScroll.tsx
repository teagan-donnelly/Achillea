import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
export function RouteScroll({ unit, ready }: { unit: string; ready: boolean }) {
  const { pathname, search } = useLocation(),
    key = `${unit}:${pathname}${search}`;
  const positions = useRef(new Map<string, { x: number; y: number }>()),
    active = useRef(key);
  useEffect(() => {
    const save = () =>
      positions.current.set(active.current, {
        x: window.scrollX,
        y: window.scrollY,
      });
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    if (active.current !== key) {
      if (!positions.current.has(active.current))
        positions.current.set(active.current, {
          x: window.scrollX,
          y: window.scrollY,
        });
      active.current = key;
    }
    if (!ready) return;
    const point = positions.current.get(key) ?? { x: 0, y: 0 };
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ left: point.x, top: point.y, behavior: "instant" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [key, ready]);
  return null;
}
