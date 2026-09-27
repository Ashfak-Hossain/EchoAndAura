'use client';

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBDT } from '@/server/lib/money';
import type { CumulativePoint, DailyPoint } from '@/server/lib/sales-report';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

/**
 * B12.1 charts: Recharts through shadcn's `ChartContainer` (theme colours,
 * one tooltip style). The server computes every number; these components
 * only draw and answer hovers. Charcoal is "data", marigold is "today" or
 * "the peak" — the two colours the rest of the admin already uses.
 *
 * The bars keep `data-testid` / `data-tickets` on the SVG rect (custom
 * `shape`), so the e2e can still find today's bar.
 */

const INK = '#1c1a17';
const MARIGOLD = '#eda43c';
const MUTED = '#a8a29a';

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// --- Daily tickets -----------------------------------------------------------

const dailyConfig = { tickets: { label: 'Tickets', color: INK } } satisfies ChartConfig;

function DailyBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: DailyPoint;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const today = payload?.isToday ?? false;
  const empty = (payload?.tickets ?? 0) === 0;
  return (
    <rect
      x={x}
      y={empty ? y + height - 2 : y}
      width={Math.max(width, 1)}
      height={empty ? 2 : Math.max(height, 3)}
      rx={2}
      fill={today ? MARIGOLD : INK}
      fillOpacity={empty ? 0.25 : 1}
      data-testid={today ? 'bar-today' : undefined}
      data-tickets={payload?.tickets}
    />
  );
}

export function DailyBarsChart({ points }: { points: DailyPoint[] }) {
  const n = points.length;
  const every = n <= 14 ? 1 : n <= 31 ? 7 : n <= 92 ? 14 : 30;
  // Which ticks to label: both ends, and every N days clear of the ends so
  // labels never overlap. Keyed by label because the axis hands us values.
  const index = new Map(points.map((p, i) => [p.label, i]));
  const tick = (label: string): string => {
    const i = index.get(label);
    if (i === undefined) return '';
    const p = points[i]!;
    if (i === n - 1) return p.isToday ? 'today' : p.label.slice(4);
    const clear = i >= every / 2 && n - 1 - i >= every / 2;
    return i === 0 || (i % every === 0 && clear) ? p.label.slice(4) : '';
  };
  return (
    <ChartContainer config={dailyConfig} className="h-44 w-full">
      <BarChart
        data={points}
        margin={{ top: 8, right: 4, left: -20, bottom: 0 }}
        barCategoryGap="18%"
      >
        <CartesianGrid vertical={false} stroke="#edeae3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          tickFormatter={tick}
          fontSize={11}
        />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} width={40} />
        <ChartTooltip
          cursor={{ fill: '#edeae3', opacity: 0.6 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload as DailyPoint | undefined;
                return p ? `${p.label}${p.isToday ? ' · today' : ''}` : '';
              }}
              formatter={(_value, _name, item) => {
                const p = item.payload as DailyPoint;
                return (
                  <span className="flex w-full justify-between gap-4 tabular">
                    <span>{count(p.tickets, 'ticket', 'tickets')}</span>
                    <span className="font-medium">{formatBDT(p.paisa)}</span>
                  </span>
                );
              }}
            />
          }
        />
        <Bar dataKey="tickets" shape={<DailyBar />} isAnimationActive={n <= 92} />
      </BarChart>
    </ChartContainer>
  );
}

// --- Cumulative vs capacity --------------------------------------------------

const cumulativeConfig = {
  cumulative: { label: 'Verified to date', color: INK },
} satisfies ChartConfig;

export function CumulativeChart({
  points,
  capacity,
  markers,
}: {
  points: CumulativePoint[];
  capacity: number;
  /** Vertical reference lines by day label ("reg. closes", "event"). */
  markers: { label: string; day: string }[];
}) {
  const end = points.at(-1)?.cumulative ?? 0;
  const yMax = Math.max(capacity, end, 1);
  const n = points.length;
  return (
    <ChartContainer config={cumulativeConfig} className="h-44 w-full">
      <ComposedChart data={points} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="cumulativeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={INK} stopOpacity={0.16} />
            <stop offset="100%" stopColor={INK} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#edeae3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          interval={0}
          tickFormatter={(v: string) => {
            const last = points[n - 1];
            if (last && v === last.label) return last.isToday ? 'today' : v;
            return v === points[0]?.label ? v : '';
          }}
          fontSize={11}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          domain={[0, Math.ceil(yMax * 1.05)]}
          fontSize={11}
          width={40}
        />
        <ChartTooltip
          cursor={{ stroke: MUTED, strokeDasharray: '3 3' }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) => {
                const p = payload?.[0]?.payload as CumulativePoint | undefined;
                return p ? `${p.label}${p.isToday ? ' · today' : ''}` : '';
              }}
              formatter={(value) => (
                <span className="tabular">
                  {count(Number(value), 'ticket', 'tickets')} verified to date
                  {capacity > 0 ? ` · of ${capacity.toLocaleString('en-US')}` : ''}
                </span>
              )}
            />
          }
        />
        {capacity > 0 ? (
          <ReferenceLine
            y={capacity}
            stroke={MUTED}
            strokeDasharray="4 4"
            label={{
              value: `capacity ${capacity.toLocaleString('en-US')}`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: '#5c574c',
            }}
          />
        ) : null}
        {markers.map((m) => (
          <ReferenceLine
            key={m.label}
            x={points.find((p) => p.day === m.day)?.label}
            stroke={MARIGOLD}
            strokeDasharray="3 3"
            label={{ value: m.label, position: 'insideTopLeft', fontSize: 10, fill: '#8a5209' }}
          />
        ))}
        <Area
          dataKey="cumulative"
          type="monotone"
          stroke="none"
          fill="url(#cumulativeFill)"
          isAnimationActive={false}
        />
        <Line
          dataKey="cumulative"
          type="monotone"
          stroke={INK}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: MARIGOLD, stroke: INK }}
          isAnimationActive={n <= 120}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// --- Histograms (hour / weekday / order size) -------------------------------

export interface HistogramDatum {
  key: string;
  /** Axis tick; empty to skip. */
  tick: string;
  /** Tooltip title. */
  label: string;
  value: number;
  peak?: boolean;
}

const histogramConfig = { value: { label: 'Orders', color: INK } } satisfies ChartConfig;

export function HistogramChart({
  data,
  unit,
  className = 'h-28 w-full',
}: {
  data: HistogramDatum[];
  unit: [string, string];
  className?: string;
}) {
  return (
    <ChartContainer config={histogramConfig} className={className}>
      <BarChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
        <XAxis
          dataKey="tick"
          tickLine={false}
          axisLine={false}
          interval={0}
          fontSize={11}
          tickFormatter={(v: string) => v}
        />
        <YAxis hide allowDecimals={false} />
        <ChartTooltip
          cursor={{ fill: '#edeae3', opacity: 0.6 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_label, payload) =>
                (payload?.[0]?.payload as HistogramDatum | undefined)?.label ?? ''
              }
              formatter={(value) => (
                <span className="tabular">{count(Number(value), unit[0], unit[1])}</span>
              )}
            />
          }
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive>
          {data.map((d) => (
            <Cell
              key={d.key}
              fill={d.peak ? MARIGOLD : INK}
              fillOpacity={d.value === 0 ? 0.2 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
