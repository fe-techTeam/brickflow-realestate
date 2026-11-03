"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface Tower {
  x: number;
  w: number;
  top: number;
  crown?: "setback" | "spire" | "flat";
  mullions?: number;
  lit?: number[];
}

const BASE = 560;

const TOWERS: Tower[] = [
  { x: 30, w: 74, top: 372, crown: "flat", mullions: 2, lit: [3, 6] },
  { x: 118, w: 92, top: 214, crown: "setback", mullions: 3, lit: [2, 9, 13] },
  { x: 226, w: 112, top: 96, crown: "spire", mullions: 4, lit: [4, 11, 17, 21] },
  { x: 354, w: 80, top: 262, crown: "setback", mullions: 2, lit: [5, 10] },
  { x: 450, w: 104, top: 330, crown: "flat", mullions: 3, lit: [2, 7] },
];

const FLOOR = 19;

function TowerShape({ t, index }: { t: Tower; index: number }) {
  const floors: number[] = [];
  for (let y = t.top + 26; y < BASE - 8; y += FLOOR) floors.push(y);
  const cols = t.mullions ?? 2;
  const step = t.w / (cols + 1);
  const delay = { "--d": `${0.25 + index * 0.18}s` } as CSSProperties;

  return (
    <g style={delay}>
      <rect x={t.x} y={t.top} width={t.w} height={BASE - t.top} fill="url(#bf-tower)" className="bf-rise" />
      <path
        d={`M${t.x} ${BASE}V${t.top}H${t.x + t.w}V${BASE}`}
        stroke="#a89a84"
        strokeOpacity="0.75"
        strokeWidth="1.1"
        pathLength={1}
        className="bf-draw"
      />
      {t.crown === "setback" && (
        <path
          d={`M${t.x + t.w * 0.18} ${t.top}V${t.top - 22}H${t.x + t.w * 0.82}V${t.top}`}
          stroke="#a89a84"
          strokeOpacity="0.6"
          strokeWidth="1"
          pathLength={1}
          className="bf-draw"
        />
      )}
      {t.crown === "spire" && (
        <>
          <path
            d={`M${t.x + t.w * 0.22} ${t.top}V${t.top - 30}H${t.x + t.w * 0.78}V${t.top}M${t.x + t.w / 2} ${t.top - 30}V${t.top - 74}`}
            stroke="#a89a84"
            strokeOpacity="0.7"
            strokeWidth="1"
            pathLength={1}
            className="bf-draw"
          />
          <circle cx={t.x + t.w / 2} cy={t.top - 76} r="2.2" fill="#c4b9a7" className="bf-glint" />
        </>
      )}
      <g stroke="#a89a84" strokeOpacity="0.16" strokeWidth="0.75" className="bf-fade">
        {floors.map((y) => (
          <path key={y} d={`M${t.x} ${y}H${t.x + t.w}`} />
        ))}
        {Array.from({ length: cols }, (_, i) => (
          <path key={i} d={`M${t.x + step * (i + 1)} ${t.top + 10}V${BASE}`} />
        ))}
      </g>
      {t.lit?.map((n) => {
        const y = floors[n];
        if (y === undefined) return null;
        const col = n % (cols + 1);
        return (
          <rect
            key={n}
            x={t.x + step * col + 3}
            y={y + 4}
            width={step - 6}
            height={FLOOR - 8}
            fill="#c4b9a7"
            fillOpacity="0.55"
            className="bf-lit"
            style={{ "--t": `${(n % 5) * 1.3}s` } as CSSProperties}
          />
        );
      })}
    </g>
  );
}

/**
 * Original architectural elevation drawing in basalt and stone linework.
 * Towers draw themselves in on load; layers drift with the pointer for a subtle parallax.
 * Both effects are disabled under prefers-reduced-motion.
 */
export function ArchitecturalScene({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const host = el.parentElement ?? el;
    let frame = 0;
    function onMove(e: PointerEvent) {
      const rect = host.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el!.style.setProperty("--px", px.toFixed(3));
        el!.style.setProperty("--py", py.toFixed(3));
      });
    }
    function onLeave() {
      el!.style.setProperty("--px", "0");
      el!.style.setProperty("--py", "0");
    }
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [interactive]);

  return (
    <div ref={ref} aria-hidden="true" className={cn("bf-scene pointer-events-none select-none", className)}>
      <svg viewBox="0 0 600 700" preserveAspectRatio="xMidYMax meet" className="h-full w-full overflow-visible" fill="none">
        <defs>
          <linearGradient id="bf-tower" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f3d3a" stopOpacity="0.95" />
            <stop offset="1" stopColor="#1a2321" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id="bf-water" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#a89a84" stopOpacity="0" />
            <stop offset="0.35" stopColor="#c4b9a7" stopOpacity="0.95" />
            <stop offset="0.75" stopColor="#a89a84" stopOpacity="0.7" />
            <stop offset="1" stopColor="#a89a84" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="bf-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#a89a84" stopOpacity="0.22" />
            <stop offset="1" stopColor="#a89a84" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="bf-layer-back">
          <circle cx="300" cy="250" r="230" fill="url(#bf-glow)" />
          <circle cx="300" cy="250" r="196" stroke="#a89a84" strokeOpacity="0.2" strokeWidth="0.8" pathLength={1} className="bf-draw" style={{ "--d": "0s" } as CSSProperties} />
          <circle cx="300" cy="250" r="150" stroke="#a89a84" strokeOpacity="0.1" strokeWidth="0.6" strokeDasharray="2 6" />
          <g stroke="#a89a84" strokeOpacity="0.28" strokeWidth="0.8">
            {Array.from({ length: 48 }, (_, i) => {
              const a = (i / 48) * Math.PI * 2;
              const r1 = 196;
              const r2 = i % 4 === 0 ? 186 : 191;
              return (
                <path
                  key={i}
                  d={`M${(300 + Math.cos(a) * r1).toFixed(1)} ${(250 + Math.sin(a) * r1).toFixed(1)}L${(300 + Math.cos(a) * r2).toFixed(1)} ${(250 + Math.sin(a) * r2).toFixed(1)}`}
                />
              );
            })}
          </g>
          <path d="M300 30V560M60 250H540" stroke="#a89a84" strokeOpacity="0.08" strokeWidth="0.6" />
        </g>

        <g className="bf-layer-mid">
          {TOWERS.map((t, i) => (
            <TowerShape key={t.x} t={t} index={i} />
          ))}
          <g className="bf-fade" style={{ "--d": "1.6s" } as CSSProperties}>
            <path d="M346 96V560M341 96H351M341 560H351" stroke="#a89a84" strokeOpacity="0.45" strokeWidth="0.75" />
            <text x="342" y="330" transform="rotate(-90 342 330)" textAnchor="middle" fill="#a89a84" fillOpacity="0.65" fontSize="8.5" letterSpacing="1.6" fontFamily="var(--font-inter), sans-serif">
              ELEV. +142.00
            </text>
            <text x="30" y="586" fill="#a89a84" fillOpacity="0.45" fontSize="8" letterSpacing="1.8" fontFamily="var(--font-inter), sans-serif">
              SOUTH ELEVATION · 1:500
            </text>
          </g>
        </g>

        <g className="bf-layer-front">
          <path d={`M0 ${BASE + 0.5}H600`} stroke="url(#bf-water)" strokeWidth="1.6" pathLength={1} className="bf-draw" style={{ "--d": "0.1s" } as CSSProperties} />
          <g className="bf-ripple" stroke="url(#bf-water)">
            <path d={`M70 ${BASE + 16}H520`} strokeWidth="1" strokeOpacity="0.55" />
            <path d={`M130 ${BASE + 30}H460`} strokeWidth="0.9" strokeOpacity="0.38" />
            <path d={`M190 ${BASE + 44}H400`} strokeWidth="0.8" strokeOpacity="0.24" />
            <path d={`M240 ${BASE + 58}H350`} strokeWidth="0.7" strokeOpacity="0.14" />
          </g>
        </g>
      </svg>
    </div>
  );
}
