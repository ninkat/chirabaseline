import React from 'react';
import Senate from './SenateVisualization';

// main app component that centers the senate visualization
export const App: React.FC = () => {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <Senate />
    </div>
  );
};
