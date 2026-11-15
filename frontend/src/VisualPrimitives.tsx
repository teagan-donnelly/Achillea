import type { ReactNode } from "react";
import {
  Activity,
  CheckSquare,
  ClipboardList,
  FileClock,
  Heart,
  Radio,
  Thermometer,
  UserRound,
  Wind,
  ChevronRight,
} from "lucide-react";

export function PageHero({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-hero">
      <HeroShape />
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
export function HeroShape() {
  return (
    <svg
      className="hero-shape"
      viewBox="0 0 600 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M110 0C280 0 300 100 470 45S600 30 600 30V0Z" fill="#2e6b57" />
      <path
        d="M190 0C330 40 340 5 440 70S560 60 600 100V0Z"
        fill="#50795d"
        opacity=".25"
      />
    </svg>
  );
}
export function PatientAvatar({ attention = false }: { attention?: boolean }) {
  return (
    <span className={`patient-avatar ${attention ? "attention-avatar" : ""}`}>
      <UserRound size={21} aria-hidden="true" />
    </span>
  );
}
export function MetricIcon({
  metric,
  size = 17,
}: {
  metric: string;
  size?: number;
}) {
  const Icon =
    metric === "HEART_RATE"
      ? Heart
      : metric === "SPO2"
        ? Wind
        : metric === "TEMPERATURE"
          ? Thermometer
          : Activity;
  return <Icon size={size} aria-hidden="true" />;
}
export function CareIcon({ title }: { title: string }) {
  const Icon = title.includes("tasks")
    ? CheckSquare
    : title.includes("Sensor")
      ? Radio
      : title.includes("history")
        ? FileClock
        : ClipboardList;
  return (
    <span
      className={`care-card-icon ${title.includes("tasks") ? "warm-icon" : ""}`}
    >
      <Icon size={20} aria-hidden="true" />
    </span>
  );
}
export function PatientAction({
  name,
  room,
  task,
  detail,
  due,
}: {
  name: string;
  room: string;
  task: string;
  detail: string;
  due: string;
}) {
  return (
    <>
      <div className="attention-patient">
        <PatientAvatar attention />
        <span>
          <strong>{name}</strong>
          <small>Room {room}</small>
        </span>
        <span className="priority-pill">{due}</span>
      </div>
      <div className="attention-content">
        <strong>{task}</strong>
        <small>{detail}</small>
      </div>
      <ChevronRight className="attention-chevron" size={18} />
    </>
  );
}
