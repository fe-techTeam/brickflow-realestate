import type { QrMatrix } from "@/server/auth/qr";

const QUIET_ZONE = 4;

/** Renders a server-encoded QR code. Always dark modules on white so every scanner can read it. */
export function QrCode({ matrix, label, className }: { matrix: QrMatrix; label: string; className?: string }) {
  const extent = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#ffffff" />
      <path d={matrix.path} fill="#141c28" />
    </svg>
  );
}
