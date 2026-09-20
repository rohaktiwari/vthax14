import type { ReactNode } from "react";
import { BADGE_TONE, type Tone } from "../lib/ui";

interface BadgeProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

/** Status pill. Always carries text, so meaning never depends on color alone. */
export default function Badge({ tone = "neutral", title, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}
