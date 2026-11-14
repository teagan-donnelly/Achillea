import { useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
const pages = ["/", "/patients", "/rounds"];
export function SwipeNavigation({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const location = useLocation(),
    navigate = useNavigate(),
    start = useRef<{ x: number; y: number } | null>(null);
  function move(direction: number) {
    const index = pages.indexOf(
      location.pathname === "/activity" ? "/" : location.pathname,
    );
    if (!disabled && index >= 0 && pages[index + direction])
      navigate(pages[index + direction]);
  }
  return (
    <div
      className="swipe-workspace"
      onTouchStart={(e) => {
        const target = e.target as HTMLElement;
        start.current =
          !disabled &&
          e.touches.length === 1 &&
          !target.closest(
            'button,input,textarea,select,summary,[role="slider"],[data-no-swipe],.trend',
          )
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : null;
      }}
      onTouchMove={(e) => {
        if (
          start.current &&
          Math.abs(e.touches[0].clientY - start.current.y) > 24
        )
          start.current = null;
      }}
      onTouchCancel={() => {
        start.current = null;
      }}
      onTouchEnd={(e) => {
        const origin = start.current;
        start.current = null;
        if (!origin || !e.changedTouches.length) return;
        const dx = e.changedTouches[0].clientX - origin.x,
          dy = e.changedTouches[0].clientY - origin.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2.5)
          move(dx < 0 ? 1 : -1);
      }}
      onKeyDown={(e) => {
        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          move(e.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      {children}
    </div>
  );
}
