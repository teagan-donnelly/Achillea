import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Activity,
  ClipboardCheck,
  FileText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavTab {
  /** Route the tab opens. */
  path: string;
  /** Accessible name (the bar shows icons only). */
  label: string;
  icon: LucideIcon;
  /** Other routes that keep this tab highlighted. */
  also?: (pathname: string) => boolean;
}

/**
 * Primary destinations, left to right. Routes are unchanged from before the redesign:
 * Tasks is the rounds queue, Monitoring the repositioning command center (and sensor
 * monitoring), Handoff the activity history.
 */
export const TABS: NavTab[] = [
  {
    path: "/patients",
    label: "Patients",
    icon: Users,
    also: (p) => p.startsWith("/patients/"),
  },
  { path: "/rounds", label: "Tasks", icon: ClipboardCheck },
  {
    path: "/",
    label: "Monitoring",
    icon: Activity,
    also: (p) => p === "/sensors" || p === "/repositioning" || p.startsWith("/monitoring/"),
  },
  { path: "/activity", label: "Handoff", icon: FileText },
  { path: "/settings", label: "Settings", icon: Settings },
];
export const TAB_PATHS = TABS.map((t) => t.path);
/** Center tab, selected on launch ("/" is the app's root route). */
export const CENTER_TAB = "/";

/** Index of the tab that owns a route, or -1 for routes outside the tab bar. */
export function tabIndexFor(pathname: string, tabs: NavTab[] = TABS) {
  return tabs.findIndex((t) => t.path === pathname || !!t.also?.(pathname));
}

/**
 * Reusable bottom navigation: a floating, centered white capsule with icon-only tabs and a
 * mint pill behind the selected tab that slides (200ms) when the route changes.
 */
export function BottomNav({
  tabs = TABS,
  label = "Main navigation",
}: {
  tabs?: NavTab[];
  label?: string;
}) {
  const location = useLocation(),
    links = useRef<(HTMLAnchorElement | null)[]>([]);
  const active = tabIndexFor(location.pathname, tabs);

  // Arrow keys move focus between tabs (Home/End jump); Enter activates the link.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const current = links.current.findIndex((a) => a === document.activeElement);
    if (current < 0) return;
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? current === last ? 0 : current + 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? current === 0 ? last : current - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    links.current[next]?.focus();
  }

  return (
    <nav
      aria-label={label}
      className="bottom-nav"
      style={{ "--tab-count": tabs.length, "--tab-index": Math.max(active, 0) } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span
        className={`bottom-nav-highlight${active < 0 ? " is-hidden" : ""}`}
        aria-hidden="true"
      />
      {tabs.map(({ path, label: name, icon: Icon }, i) => {
        const selected = i === active;
        return (
          <Link
            key={path}
            to={path}
            ref={(el) => {
              links.current[i] = el;
            }}
            className={selected ? "active" : undefined}
            aria-current={selected ? "page" : undefined}
            aria-label={name}
            draggable={false}
          >
            <Icon size={24} strokeWidth={2} aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}

/** Kept for existing imports. */
export const TabBar = BottomNav;
