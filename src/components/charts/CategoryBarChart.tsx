import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategoryScore } from '../../engine/score';

export function CategoryBarChart({ rows }: { rows: CategoryScore[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="category" stroke="var(--muted)" />
        <YAxis stroke="var(--muted)" />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)' }} />
        <Bar dataKey="total" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
