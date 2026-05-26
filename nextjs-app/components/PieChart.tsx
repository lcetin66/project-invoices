"use client";
// PieChart.tsx — 3D perspective pie chart using SVG ellipse + depth walls
import React, { useState } from "react";

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieSlice[];
  radius?: number;
  innerRadius?: number; // kept for API compat, unused in 3D mode
}

/** Convert polar angle to cartesian on a tilted ellipse */
function toXY(cx: number, cy: number, rx: number, ry: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + rx * Math.cos(rad), y: cy + ry * Math.sin(rad) };
}

/** Darken a hex color by `factor` (0–1) */
function darken(color: string, factor = 0.38): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const r = Math.round(parseInt(hex.slice(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(hex.slice(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(hex.slice(4, 6), 16) * (1 - factor));
  return `rgb(${r},${g},${b})`;
}

export const PieChart: React.FC<PieChartProps> = ({ data, radius = 100 }) => {
  const [hovIdx, setHovIdx] = useState<number | null>(null);

  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0 || data.length === 0) return <div style={{ height: radius }} />;

  // ── Filter zero-value slices (they break arc math and add no info) ────────
  const activeData = data.filter((d) => d.value > 0);
  const activeTotal = activeData.reduce((s, d) => s + d.value, 0);

  // ── Layout constants ──────────────────────────────────────────────────────
  const pad  = 10;
  const rx   = radius * 0.86;          // horizontal radius of ellipse
  const ry   = rx * 0.36;              // vertical radius  (tilt / perspective)
  const dep  = radius * 0.24;          // 3-D depth (pie thickness)
  const cx   = rx + pad;               // ellipse center X
  const cy   = ry + pad;               // ellipse center Y
  const svgW = rx * 2 + pad * 2;
  const svgH = cy + ry + dep + pad * 2;

  // ── Compute slice angles ─────────────────────────────────────────────────
  let cum = 0;
  const slices = activeData.map((d, idx) => {
    const start = cum;
    cum += (d.value / activeTotal) * 360;
    return { ...d, start, end: cum, idx };
  });

  // ── Path builders ────────────────────────────────────────────────────────

  /** Top elliptical face of one slice.
   *  Special case: a 360° (full-circle) slice can't be drawn with a single arc
   *  because start == end point. Use two half-arcs instead. */
  function topPath(s: number, e: number): string {
    const span = e - s;
    if (span >= 359.9) {
      // Full ellipse: two 180° arcs
      const left  = toXY(cx, cy, rx, ry, 0);
      const right = toXY(cx, cy, rx, ry, 180);
      return (
        `M ${left.x} ${left.y}` +
        ` A ${rx} ${ry} 0 1 1 ${right.x} ${right.y}` +
        ` A ${rx} ${ry} 0 1 1 ${left.x} ${left.y} Z`
      );
    }
    const p1 = toXY(cx, cy, rx, ry, s);
    const p2 = toXY(cx, cy, rx, ry, e);
    const la = span > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${rx} ${ry} 0 ${la} 1 ${p2.x} ${p2.y} Z`;
  }

  /**
   * Side-wall path for the "front half" of the pie (angles 90–270).
   * Only this portion is visible to the viewer; the back half is hidden.
   */
  function sidePath(s: number, e: number): string {
    // Full-circle: draw the complete front-half arc (90° → 270°)
    if (e - s >= 359.9) {
      const p1 = toXY(cx, cy, rx, ry, 90);
      const p2 = toXY(cx, cy, rx, ry, 270);
      return (
        `M ${p1.x} ${p1.y + dep}` +
        ` A ${rx} ${ry} 0 1 1 ${p2.x} ${p2.y + dep}` +
        ` L ${p2.x} ${p2.y}` +
        ` A ${rx} ${ry} 0 1 0 ${p1.x} ${p1.y} Z`
      );
    }
    const cs = Math.max(s, 90);
    const ce = Math.min(e, 270);
    if (cs >= ce) return "";
    const p1 = toXY(cx, cy, rx, ry, cs);
    const p2 = toXY(cx, cy, rx, ry, ce);
    const la = ce - cs > 180 ? 1 : 0;
    return (
      `M ${p1.x} ${p1.y + dep}` +
      ` A ${rx} ${ry} 0 ${la} 1 ${p2.x} ${p2.y + dep}` +
      ` L ${p2.x} ${p2.y}` +
      ` A ${rx} ${ry} 0 ${la} 0 ${p1.x} ${p1.y} Z`
    );
  }

  // Sort back-to-front by mid-point Y (painter's algorithm)
  const sorted = [...slices].sort((a, b) => {
    const ya = Math.sin((((a.start + a.end) / 2 - 90) * Math.PI) / 180);
    const yb = Math.sin((((b.start + b.end) / 2 - 90) * Math.PI) / 180);
    return ya - yb;
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "18px", justifyContent: "center", flexWrap: "wrap" }}>
      {/* ── 3-D Pie ── */}
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ overflow: "visible", flexShrink: 0 }}
      >
        {/* 1. Side arc walls (back → front) */}
        {sorted.map((sl) => {
          const sp = sidePath(sl.start, sl.end);
          if (!sp) return null;
          return (
            <path
              key={`sw-${sl.idx}`}
              d={sp}
              fill={darken(sl.color, 0.40)}
              stroke="#fff"
              strokeWidth={0.6}
              opacity={hovIdx === sl.idx ? 0.75 : 1}
            />
          );
        })}

        {/* 2. Top faces (back → front, on top of everything) */}
        {sorted.map((sl) => {
          const isHov = hovIdx === sl.idx;
          return (
            <path
              key={`top-${sl.idx}`}
              d={topPath(sl.start, sl.end)}
              fill={sl.color}
              stroke="#fff"
              strokeWidth={1}
              style={{
                cursor: "pointer",
                filter: isHov
                  ? "brightness(1.14) drop-shadow(0 3px 8px rgba(0,0,0,0.22))"
                  : "none",
                transition: "filter 0.15s",
              }}
              onMouseEnter={() => setHovIdx(sl.idx)}
              onMouseLeave={() => setHovIdx(null)}
            >
              <title>
                {sl.label}: {sl.value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
                {" "}({((sl.value / total) * 100).toFixed(1)}%)
              </title>
            </path>
          );
        })}
      </svg>

      {/* ── Legend (all original items, zeros shown greyed-out) ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", fontSize: "0.78rem", minWidth: 0 }}>
        {data.map((d, idx) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const isEmpty = d.value === 0;
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                cursor: "default",
                fontWeight: hovIdx === idx ? 700 : 400,
                color: isEmpty ? "#cbd5e1" : hovIdx === idx ? "#1e293b" : "#64748b",
                transition: "color 0.12s",
              }}
              onMouseEnter={() => !isEmpty && setHovIdx(idx)}
              onMouseLeave={() => setHovIdx(null)}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "3px",
                  background: isEmpty ? "#e2e8f0" : d.color,
                  flexShrink: 0,
                  boxShadow: isEmpty ? "none" : "0 1px 3px rgba(0,0,0,0.18)",
                }}
              />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.label}
              </span>
              <strong style={{ color: isEmpty ? "#cbd5e1" : "#1e293b", marginLeft: 4 }}>
                {pct.toFixed(1)}%
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PieChart;
