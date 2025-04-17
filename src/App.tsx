import React from 'react';
import { DeepStructure } from './components/DeepStructure';
import { Settings } from './components/Settings';
import { Todos } from './components/Todos';
import { YjsProvider } from './context/YjsContext';

export const App: React.FC = () => {
  return (
    <YjsProvider>
      <h2>Settings Example</h2>
      <Settings />
      <hr />
      <h2>Todos Example</h2>
      <Todos />
      <hr />
      <h2>Deep Structure Example</h2>
      <DeepStructure />
    </YjsProvider>
  );
};
