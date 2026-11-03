import { cn } from "@/lib/utils";

const TOWERS = [
  { x: 8, w: 34, h: 74 },
  { x: 48, w: 46, h: 128 },
  { x: 100, w: 30, h: 96 },
  { x: 136, w: 54, h: 168 },
  { x: 196, w: 38, h: 118 },
  { x: 240, w: 60, h: 146 },
  { x: 306, w: 32, h: 84 },
  { x: 344, w: 48, h: 132 },
  { x: 398, w: 36, h: 104 },
  { x: 440, w: 58, h: 156 },
  { x: 504, w: 30, h: 70 },
];

const BASE = 196;
const FLOOR = 9;

/** Line-drawn elevation of towers used as a quiet backdrop on the overview hero. */
export function Skyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 540 200" fill="none" aria-hidden="true" className={cn("pointer-events-none", className)} preserveAspectRatio="xMaxYMax meet">
      <g stroke="currentColor" strokeWidth="0.75" vectorEffect="non-scaling-stroke">
        {TOWERS.map((t) => {
          const top = BASE - t.h;
          const floors = Math.floor((t.h - 12) / FLOOR);
          return (
            <g key={t.x}>
              <rect x={t.x} y={top} width={t.w} height={t.h} />
              <line x1={t.x + t.w / 2} y1={top + 6} x2={t.x + t.w / 2} y2={BASE} strokeOpacity="0.5" />
              {Array.from({ length: floors }, (_, i) => (
                <line key={i} x1={t.x + 4} y1={top + 10 + i * FLOOR} x2={t.x + t.w - 4} y2={top + 10 + i * FLOOR} strokeOpacity="0.45" />
              ))}
            </g>
          );
        })}
        <line x1="0" y1={BASE} x2="540" y2={BASE} />
      </g>
    </svg>
  );
}
