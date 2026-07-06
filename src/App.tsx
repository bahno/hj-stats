import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { Compare } from './components/Compare';
import { type View } from './components/Nav';

export default function App() {
  const [view] = useState<View>('calculator');
  return (
    <main className="app">
      {view === 'calculator' ? <Calculator /> : <Compare />}
    </main>
  );
}
