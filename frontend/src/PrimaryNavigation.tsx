import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { House, Users, Radio, CalendarCheck } from "lucide-react";

const destinations = [
  { path: "/", label: "Home", Icon: House },
  { path: "/patients", label: "Patients", Icon: Users },
  { path: "/sensors", label: "Sensors", Icon: Radio },
  { path: "/rounds", label: "Rounds", Icon: CalendarCheck },
];
type Point = { x: number; y: number; size: number };
type Drag = {
  pointer: number;
  start: number;
  origin: number;
  x: number;
  moved: boolean;
};
export function PrimaryNavigation() {
  const { pathname } = useLocation(),
    navigate = useNavigate(),
    instructions = useId();
  const current = pathname.startsWith("/patients")
    ? 1
    : pathname.startsWith("/sensors")
      ? 2
      : pathname.startsWith("/rounds")
        ? 3
        : 0;
  const track = useRef<HTMLElement>(null),
    links = useRef<(HTMLAnchorElement | null)[]>([]);
  const drag = useRef<Drag | null>(null),
    suppressClick = useRef(false);
  const [centers, setCenters] = useState<Point[]>([]),
    [dragX, setDragX] = useState<number | null>(null);
  const [reduced, setReduced] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  const cancel = useCallback(() => {
    const captured = drag.current;
    if (captured) suppressClick.current = true;
    drag.current = null;
    setDragX(null);
    if (captured && track.current?.hasPointerCapture?.(captured.pointer))
      track.current.releasePointerCapture(captured.pointer);
  }, []);
  useLayoutEffect(() => {
    function measure() {
      cancel();
      const parent = track.current?.getBoundingClientRect();
      if (!parent) return;
      track.current
        ?.closest<HTMLElement>(".minimal-design")
        ?.style.setProperty("--measured-nav-height", `${parent.height}px`);
      const points = links.current.map((link) => {
        const box = link?.querySelector(".nav-icon")?.getBoundingClientRect();
        return box && box.width > 0
          ? {
              x: box.left + box.width / 2 - parent.left,
              y: box.top + box.height / 2 - parent.top,
              size: box.width,
            }
          : null;
      });
      setCenters(
        points.every((point): point is Point => point !== null) ? points : [],
      );
    }
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    if (track.current) observer?.observe(track.current);
    window.addEventListener("resize", measure);
    window.addEventListener("blur", cancel);
    function visibility() {
      if (document.hidden) cancel();
    }
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [cancel]);
  useLayoutEffect(() => {
    cancel();
  }, [pathname, cancel]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(query?.matches ?? false);
    query?.addEventListener?.("change", changed);
    return () => {
      query?.removeEventListener?.("change", changed);
    };
  }, []);
  function nearest(x: number) {
    return centers.reduce(
      (best, point, index) =>
        Math.abs(point.x - x) < Math.abs(centers[best].x - x) ? index : best,
      0,
    );
  }
  function down(e: ReactPointerEvent<HTMLElement>) {
    e.stopPropagation();
    if (!drag.current) suppressClick.current = false;
    if (
      e.button !== 0 ||
      e.isPrimary === false ||
      drag.current ||
      window.matchMedia?.("(min-width: 1024px)").matches
    )
      return;
    const center = centers[current],
      rect = track.current?.getBoundingClientRect();
    if (
      !center ||
      !rect ||
      Math.hypot(
        e.clientX - rect.left - center.x,
        e.clientY - rect.top - center.y,
      ) >
        center.size / 2
    )
      return;
    drag.current = {
      pointer: e.pointerId,
      start: e.clientX,
      origin: center.x,
      x: center.x,
      moved: false,
    };
    suppressClick.current = false;
    track.current?.setPointerCapture?.(e.pointerId);
    setDragX(center.x);
  }
  function move(e: ReactPointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || e.pointerId !== active.pointer) return;
    e.stopPropagation();
    const delta = e.clientX - active.start;
    active.x = Math.max(
      centers[0].x,
      Math.min(centers.at(-1)!.x, active.origin + delta),
    );
    active.moved ||= Math.abs(delta) > 4;
    if (active.moved) e.preventDefault();
    setDragX(active.x);
  }
  function up(e: ReactPointerEvent<HTMLElement>) {
    const active = drag.current;
    if (!active || active.pointer !== e.pointerId) return;
    e.stopPropagation();
    // Include the release coordinate even if the browser coalesced the last pointermove.
    const x = Math.max(
      centers[0].x,
      Math.min(centers.at(-1)!.x, active.origin + e.clientX - active.start),
    );
    const next = nearest(x);
    cancel();
    e.preventDefault();
    suppressClick.current = true;
    if (pathname !== destinations[next].path) navigate(destinations[next].path);
  }
  const candidate =
    dragX === null || !centers.length ? current : nearest(dragX);
  // Keep icons legible on white between destinations; whiten only the icon covered by the circle.
  const preview =
    dragX === null ||
    !centers.length ||
    Math.abs(centers[candidate].x - dragX) <= centers[candidate].size * 0.3
      ? candidate
      : -1;
  const selected = centers[current];
  return (
    <nav
      ref={track}
      className="primary-navigation"
      aria-label="Main navigation"
      aria-describedby={instructions}
      data-no-swipe
      data-dragging={dragX !== null}
      data-reduced-motion={reduced}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={(e) => {
        if (drag.current?.pointer === e.pointerId) cancel();
      }}
      onLostPointerCapture={(e) => {
        if (drag.current?.pointer === e.pointerId) cancel();
      }}
      onClickCapture={(e) => {
        if (suppressClick.current && e.detail !== 0) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onKeyDown={(e) => {
        const index = links.current.indexOf(e.target as HTMLAnchorElement);
        if (
          index < 0 ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
        )
          return;
        e.preventDefault();
        links.current[
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 3
              : (index + (e.key === "ArrowRight" ? 1 : 3)) % 4
        ]?.focus();
      }}
    >
      <span id={instructions} className="visually-hidden">
        Tap a destination, or drag the selected circle and release to choose.
        Arrow keys move between links; Enter opens a destination.
      </span>
      <span
        className="nav-indicator"
        aria-hidden="true"
        style={{
          visibility: selected ? "visible" : "hidden",
          width: selected?.size,
          height: selected?.size,
          transform: selected
            ? `translate3d(${(dragX ?? selected.x) - selected.size / 2}px, ${selected.y - selected.size / 2}px, 0)`
            : undefined,
        }}
      />
      {destinations.map(({ path, label, Icon }, index) => (
        <Link
          key={path}
          ref={(element) => {
            links.current[index] = element;
          }}
          to={path}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          aria-label={label}
          aria-current={current === index ? "page" : undefined}
          className={`primary-link ${current === index ? "is-current" : ""} ${preview === index ? "is-preview" : ""}`}
          onClick={(e) => {
            if (pathname === path) e.preventDefault();
          }}
        >
          <span className="nav-icon">
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="nav-label">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
