import React, { useState } from 'react';
import Senate from './vis/SenateVisualization';
import VideoFeeds from './ui/VideoFeeds';
import TravelTask from './vis/TravelTask';
import DoMi from './vis/DoMi';

// visualization types available
type VisualizationType = 'senate' | 'travel' | 'domi';

// style constants
const styles = {
  container: {
    width: 'min(1280px, 100vw)',
    height: 'min(720px, 100vh)',
    maxWidth: '100vw',
    maxHeight: '100vh',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  visualizationContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sidebar: {
    position: 'absolute' as const,
    bottom: '0px',
    right: '0px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: '8px',
    padding: '12px',
    zIndex: 1000,
    transition: 'all 0.3s ease',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  sidebarCollapsed: {
    width: '80px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  sidebarExpanded: {
    minWidth: '200px',
    maxHeight: '250px',
  },
  toggleButton: {
    background: 'none',
    border: 'none',
    color: 'white',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '12px',
    borderRadius: '6px',
    transition: 'background-color 0.2s ease',
  },
  menuContent: {
    marginTop: '8px',
  },
  menuTitle: {
    color: 'white',
    fontSize: '16px',
    fontWeight: 'bold',
    marginBottom: '0px',
    textAlign: 'left' as const,
  },
  menuItem: {
    display: 'block',
    width: '100%',
    padding: '6px 12px',
    margin: '2px 0',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s ease',
  },
  menuItemActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.6)',
  },
};

// main display component with collapsible sidebar
const Display: React.FC = () => {
  const [currentVisualization, setCurrentVisualization] =
    useState<VisualizationType>('travel');
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // handle visualization change
  const handleVisualizationChange = (type: VisualizationType) => {
    setCurrentVisualization(type);
    setSidebarExpanded(false); // collapse sidebar after selection
  };

  // toggle sidebar expansion
  const toggleSidebar = () => {
    setSidebarExpanded(!sidebarExpanded);
  };

  // render current visualization
  const renderVisualization = () => {
    switch (currentVisualization) {
      case 'senate':
        return <Senate />;
      case 'travel':
        return <TravelTask />;
      case 'domi':
        return <DoMi />;
      default:
        return <Senate />;
    }
  };

  // handle hover effects for buttons
  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.currentTarget.style.backgroundColor !== 'rgba(59, 130, 246, 0.6)') {
      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const isActive = e.currentTarget.getAttribute('data-active') === 'true';
    if (!isActive) {
      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    }
  };

  const handleToggleHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  };

  const handleToggleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
  };

  return (
    <div style={styles.container}>
      {/* main visualization area */}
      <div style={styles.visualizationContainer}>{renderVisualization()}</div>

      {/* video feeds - always visible */}
      <div
        style={{
          position: 'absolute',
          top: '0px',
          right: '0px',
          zIndex: 999,
        }}
      >
        <VideoFeeds roomId="default-room" />
      </div>

      {/* collapsible sidebar menu */}
      <div
        style={{
          ...styles.sidebar,
          ...(sidebarExpanded
            ? styles.sidebarExpanded
            : styles.sidebarCollapsed),
        }}
      >
        {!sidebarExpanded ? (
          // collapsed state - just show toggle button
          <button
            style={styles.toggleButton}
            onClick={toggleSidebar}
            onMouseEnter={handleToggleHover}
            onMouseLeave={handleToggleLeave}
            title="Open visualization menu"
          >
            ⚙️
          </button>
        ) : (
          // expanded state - show menu content
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <div style={styles.menuTitle}>Visualizations</div>
              <button
                style={styles.toggleButton}
                onClick={toggleSidebar}
                onMouseEnter={handleToggleHover}
                onMouseLeave={handleToggleLeave}
                title="Close menu"
              >
                ✕
              </button>
            </div>
            <div>
              <button
                style={{
                  ...styles.menuItem,
                  ...(currentVisualization === 'travel'
                    ? styles.menuItemActive
                    : {}),
                }}
                onClick={() => handleVisualizationChange('travel')}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                data-active={currentVisualization === 'travel'}
              >
                🌎 Travel Task
              </button>
              <button
                style={{
                  ...styles.menuItem,
                  ...(currentVisualization === 'domi'
                    ? styles.menuItemActive
                    : {}),
                }}
                onClick={() => handleVisualizationChange('domi')}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                data-active={currentVisualization === 'domi'}
              >
                🔁 Domestic Migration
              </button>
              <button
                style={{
                  ...styles.menuItem,
                  ...(currentVisualization === 'senate'
                    ? styles.menuItemActive
                    : {}),
                }}
                onClick={() => handleVisualizationChange('senate')}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                data-active={currentVisualization === 'senate'}
              >
                🏛️ Senate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Display;
