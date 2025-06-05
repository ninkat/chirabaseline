import React from 'react';

// travel task visualization component - to be implemented later
const TravelTask: React.FC = () => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#f5f5f5',
        borderRadius: '8px',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '2rem',
          background: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        }}
      >
        <h2
          style={{
            fontSize: '2rem',
            marginBottom: '1rem',
            color: '#333',
            fontWeight: '500',
          }}
        >
          travel task
        </h2>
        <p
          style={{
            fontSize: '1.2rem',
            color: '#666',
            margin: 0,
          }}
        >
          coming soon...
        </p>
      </div>
    </div>
  );
};

export default TravelTask;
