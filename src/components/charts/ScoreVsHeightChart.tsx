import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategoryCode } from '../../data/types';

export interface HeightSeriesPoint {
  height: number;
  [category: string]: number;
}

const COLORS = ['#3b82f6', '#60a5fa', '#93c5fd', '#38bdf8', '#22d3ee', '#818cf8', '#a78bfa', '#c084fc', '#e879f9', '#f472b6'];

export function ScoreVsHeightChart({
  data, categories,
}: { data: HeightSeriesPoint[]; categories: CategoryCode[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
        <XAxis dataKey="height" stroke="#8b949e" />
        <YAxis stroke="#8b949e" />
        <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2733' }} />
        {categories.map((c, i) => (
          <Line key={c} type="monotone" dataKey={c} stroke={COLORS[i % COLORS.length]} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
