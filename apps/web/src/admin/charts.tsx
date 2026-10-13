import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Small dependency-free chart kit for the admin analytics page.
 * Palette (validated with the data-viz checker against the white card surface):
 *   series-1 #8f621a (SAC gold-brown), series-2 #2a78d6 (blue).
 * Marks are thin with 4px rounded data ends and 2px gaps; grid/axes are recessive;
 * text uses ink colours, never the series colour; every chart has a hover/focus
 * tooltip and a table view.
 */
export const VIZ = {
  series1: '#8f621a',
  series2: '#2a78d6',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#6b6966',
  ink: '#2a1714',
};

export function ChartCard({
  title,
  subtitle,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  table: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <section className="card p-4" aria-labelledby={id}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id={id} className="font-bold text-ink-900">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-ink-800">{subtitle}</p>}
        </div>
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-ink-800 underline-offset-2 hover:underline"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr>
                {table.headers.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="border-b border-ink-900/10 px-2 py-1 text-xs font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-ink-900/5">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1 tabular-nums">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(
      ([entry]) => entry && setWidth(Math.max(240, entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  tooltip: string[];
}

/** Vertical columns (single series) with a recessive grid, hover/focus tooltip and sparse axis labels. */
export function ColumnChart({
  data,
  ariaLabel,
  max,
  format = (v) => String(v),
  height = 220,
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  max?: number;
  format?: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  if (data.length === 0)
    return <p className="py-8 text-center text-sm text-ink-800">No data in this range.</p>;

  const pad = { top: 12, right: 8, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const yMax = max ?? niceMax(Math.max(...data.map((d) => d.value)));
  const slot = innerW / data.length;
  const barW = Math.max(3, Math.min(28, slot - 2)); // 2px surface gap between bars
  const ticks = [0, 0.5, 1].map((f) => f * yMax);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)));
  const y = (v: number) => pad.top + innerH - (Math.min(v, yMax) / yMax) * innerH;
  const a = active !== null ? data[active] : null;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? VIZ.axis : VIZ.grid}
              strokeWidth={1}
            />
            <text
              x={pad.left - 6}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              fontSize={11}
              fill={VIZ.muted}
            >
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const top = y(d.value);
          const h = pad.top + innerH - top;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                  fill={VIZ.series1}
                  opacity={active === null || active === i ? 1 : 0.45}
                />
              )}
              {/* Hit target larger than the mark. */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${d.tooltip.join(', ')}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill={VIZ.muted}
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {a && active !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-xs shadow-lg"
          style={{
            left: Math.min(width - 180, Math.max(0, pad.left + active * slot + slot / 2 - 90)),
            top: Math.max(0, y(a.value) - 70),
            width: 180,
          }}
        >
          <p className="font-semibold text-ink-900">{a.label}</p>
          {a.tooltip.map((t) => (
            <p key={t} className="text-ink-800">
              {t}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Text shown at the end of the bar (direct label). */
  valueLabel: string;
  sublabel?: string;
}

/** Horizontal bars with direct value labels — readable on phones and screen readers. */
export function BarList({
  data,
  max,
  ariaLabel,
}: {
  data: BarDatum[];
  max?: number;
  ariaLabel: string;
}) {
  if (data.length === 0)
    return <p className="py-8 text-center text-sm text-ink-800">No data in this range.</p>;
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2" aria-label={ariaLabel}>
      {data.map((d) => (
        <li
          key={d.key}
          className="grid grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3"
          title={`${d.label}: ${d.valueLabel}`}
        >
          <span className="text-xs leading-tight text-ink-900">
            {d.label}
            {d.sublabel && <span className="block text-[11px] text-ink-800">{d.sublabel}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 flex-1 overflow-hidden rounded-r bg-transparent">
              <span
                className="block h-full rounded-r-[4px]"
                style={{
                  width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / top) * 100)}%`,
                  background: VIZ.series1,
                }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-900">
              {d.valueLabel}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Two-part share bar (legend + direct labels, so identity is never colour-alone). */
export function SplitBar({
  parts,
  ariaLabel,
}: {
  parts: [{ label: string; value: number }, { label: string; value: number }];
  ariaLabel: string;
}) {
  const total = parts[0].value + parts[1].value;
  const colors = [VIZ.series1, VIZ.series2];
  if (total === 0)
    return <p className="py-8 text-center text-sm text-ink-800">No bookings in this range.</p>;
  return (
    <div aria-label={ariaLabel} role="img">
      <div className="flex h-6 gap-[2px] overflow-hidden rounded-[4px]">
        {parts.map((p, i) =>
          p.value > 0 ? (
            <div
              key={p.label}
              style={{ flexGrow: p.value, background: colors[i] }}
              title={`${p.label}: ${p.value}`}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2 text-ink-900">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: colors[i] }}
            />
            {p.label}: <strong className="tabular-nums">{p.value}</strong>
            <span className="text-ink-800">({Math.round((p.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
