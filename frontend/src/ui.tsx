/**
 * Shared Achillea UI kit (Apple x Instagram), derived from the approved Monitoring tab.
 * Styles live in ui.css under the `.ach` scope. Use these in every tab so screens stay consistent:
 *   <Screen>            page wrapper (white, 16px gutters, max-width column)
 *   <ScreenHeader>      branded feed masthead or compact patient header, with working actions
 *   <Segmented>         one white capsule with a sliding light-green pill (200ms)
 *   <Section>           section heading (+ optional count / action) and content
 *   <ListRow>           Instagram-inbox style row (avatar, title, subtitle, trailing), as link or button
 *   <Avatar>            48px circle: bed icon or initials, tinted by tone
 *   <Pill>              small status pill (neutral | green | amber | red | grey)
 *   <BottomSheet>       native-feeling modal sheet (focus-trapped, Esc / backdrop closes)
 *   <EmptyState>        quiet centered empty message
 */
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Leaf,
  SlidersHorizontal,
  X,
} from "lucide-react";

export type Tone = "neutral" | "green" | "amber" | "red" | "grey";

export function Screen({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`ach ach-screen ${className}`}>{children}</div>;
}

/** Sticky header. Pass `back` (a route) for a back chevron in the left slot. */
export function ScreenHeader({
  title,
  left,
  right,
  back,
  backLabel = "Back",
  subtitle,
}: {
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  back?: string;
  backLabel?: string;
  subtitle?: ReactNode;
}) {
  const masthead = !back && !left;
  return (
    <header
      className={`ach-header${masthead ? " ach-masthead" : " ach-detail-header"}`}
    >
      {masthead ? (
        <span className="ach-brand-mark" aria-hidden="true">
          <Leaf strokeWidth={1.65} />
        </span>
      ) : (
        <div className="ach-header-slot start">
          {back ? (
            <Link to={back} className="ach-icon-button" aria-label={backLabel}>
              <ChevronLeft aria-hidden strokeWidth={2} />
            </Link>
          ) : (
            left
          )}
        </div>
      )}
      <div className="ach-header-title">
        {masthead && (
          <span className="ach-wordmark" aria-hidden="true">
            Achillea<span>.</span>
          </span>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="ach-header-slot end">
        {right ??
          (masthead && title !== "Settings" ? (
            <Link
              to="/settings"
              className="ach-icon-button"
              aria-label="Open workspace settings"
            >
              <SlidersHorizontal aria-hidden strokeWidth={1.75} />
            </Link>
          ) : null)}
      </div>
    </header>
  );
}

/** One continuous capsule with a sliding light-green selection. Scrolls if options overflow. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className="ach-segmented"
      role="tablist"
      aria-label={label}
      data-no-swipe
      style={
        { "--seg-count": options.length, "--seg-index": index } as CSSProperties
      }
    >
      <span className="ach-segmented-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onKeyDown={(event) => {
            const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      options.length) %
                    options.length;
            onChange(options[next]!.value);
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              );
            buttons?.[next]?.focus();
          }}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Section({
  title,
  count,
  action,
  children,
  tone,
}: {
  title: ReactNode;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  tone?: Tone;
}) {
  const id = useId();
  return (
    <section className="ach-section" aria-labelledby={id}>
      <div className="ach-section-head">
        <h2 id={id} className={tone ? `tone-${tone}` : undefined}>
          {title}
          {count !== undefined && <span className="ach-count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Avatar({
  name,
  tone = "green",
  icon,
}: {
  name?: string;
  tone?: Tone;
  icon?: ReactNode;
}) {
  const initials = name
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className={`ach-avatar tone-${tone}`} aria-hidden>
      {icon ?? (initials ? initials : <BedDouble strokeWidth={1.6} />)}
    </span>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`ach-pill tone-${tone}`}>{children}</span>;
}

/** Inbox-style row. Renders a Link when `to` is set, a button when `onClick` is set. */
export function ListRow({
  to,
  onClick,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  chevron = true,
  label,
  state,
}: {
  to?: string;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  label?: string;
  state?: unknown;
}) {
  const body = (
    <>
      {leading && <span className="ach-row-leading">{leading}</span>}
      <span className="ach-row-main">
        <span className="ach-row-title">{title}</span>
        {subtitle && <span className="ach-row-subtitle">{subtitle}</span>}
        {meta && <span className="ach-row-meta">{meta}</span>}
      </span>
      {(trailing || chevron) && (
        <span className="ach-row-trailing">
          {trailing}
          {chevron && (
            <ChevronRight className="ach-chevron" aria-hidden strokeWidth={2} />
          )}
        </span>
      )}
    </>
  );
  if (to)
    return (
      <Link to={to} state={state} className="ach-row" aria-label={label}>
        {body}
      </Link>
    );
  return (
    <button
      type="button"
      className="ach-row"
      onClick={onClick}
      aria-label={label}
    >
      {body}
    </button>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ach-empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

/**
 * Modal bottom sheet. Closes on Esc, backdrop tap, or the close button; returns focus to the
 * element that opened it. Content scrolls inside the sheet.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const viewport = window.visualViewport;
    const updateViewport = () => {
      if (!viewport || !layer.current) return;
      layer.current.style.setProperty(
        "--ach-viewport-height",
        `${viewport.height}px`,
      );
      layer.current.style.setProperty(
        "--ach-viewport-top",
        `${viewport.offsetTop}px`,
      );
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
      }
      if (e.key === "Tab" && sheet.current) {
        const items = sheet.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        );
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const first = items[0]!,
          last = items[items.length - 1]!;
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === sheet.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(document.body.children).filter(
      (child) => child !== layer.current,
    ) as HTMLElement[];
    const previous = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      background.forEach((element, index) => {
        element.inert = previous[index]!;
      });
      opener?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div
      ref={layer}
      className="mockup-design ach-modal-theme"
      style={{ display: "contents" }}
    >
      <div className="ach ach-sheet-layer" data-no-swipe>
        <div className="ach-sheet-backdrop" onClick={onClose} aria-hidden />
        <div
          ref={sheet}
          className="ach-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <span className="ach-sheet-grabber" aria-hidden />
          <div className="ach-sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="ach-icon-button"
              onClick={onClose}
              aria-label="Close"
            >
              <X aria-hidden strokeWidth={2} />
            </button>
          </div>
          <div className="ach-sheet-body">{children}</div>
          {footer && <div className="ach-sheet-footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
