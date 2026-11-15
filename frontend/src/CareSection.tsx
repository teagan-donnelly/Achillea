import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { CareIcon } from "./VisualPrimitives";

export function CareSection({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      data-care={title}
      className={`care-section ${open ? "is-open" : ""}`}
    >
      <h2>
        <button
          className="care-section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
        >
          <CareIcon title={title} />
          <span>
            <strong>{title}</strong>
            <small>{summary}</small>
          </span>
          <ChevronDown size={20} />
        </button>
      </h2>
      <div id={id} hidden={!open} className="care-section-content">
        {children}
      </div>
    </section>
  );
}
