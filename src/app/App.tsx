import React from 'react';
import Display from '../components/Display';

// main app component that centers the display
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
      <Display />
    </div>
  );
};
