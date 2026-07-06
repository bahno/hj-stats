import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategoryScore } from '../../engine/score';

export function CategoryBarChart({ rows }: { rows: CategoryScore[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e2733" />
        <XAxis dataKey="category" stroke="#8b949e" />
        <YAxis stroke="#8b949e" />
        <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2733' }} />
        <Bar dataKey="total" fill="#3b82f6" />
      </BarChart>
    </ResponsiveContainer>
  );
}
