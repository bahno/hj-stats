import { useState } from 'react';
import { Calculator } from './components/Calculator';
import { AthleteLookup } from './components/AthleteLookup';
import { Nav, type View } from './components/Nav';

export default function App() {
  const [view, setView] = useState<View>('calculator');
  return (
    <main className="app">
      <Nav value={view} onChange={setView} />
      {view === 'calculator' ? <Calculator /> : <AthleteLookup />}
    </main>
  );
}
