import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { Compare } from './components/Compare';
import { Nav, type View } from './components/Nav';

export default function App() {
  const [view, setView] = useState<View>('calculator');
  return (
    <main className="app">
      <header className="topbar">
        <h1>hj-stats</h1>
        <Nav value={view} onChange={setView} />
      </header>
      {view === 'calculator' ? <Calculator /> : <Compare />}
    </main>
  );
}
