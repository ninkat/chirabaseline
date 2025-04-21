import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import { useY } from 'react-yjs';

// define node structure type
interface NodeData {
  id: string;
  x: number;
  y: number;
  selected?: boolean;
  uuid?: string;
}

// define link structure type
interface LinkData {
  source: string;
  target: string;
}

// define the Y.Map value types
type NodeMapValue = string | number | boolean;

const Graph: React.FC = () => {
  const doc = useContext(YjsContext);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('nodes');
  const yLinks = doc!.getArray<Y.Map<string>>('links');

  const nodesData = useY(yNodes); // JSON-renderable copies
  const yNodesRef = useRef(yNodes);
  const links = useY(yLinks);

  const [draggingNode, setDraggingNode] = useState<Y.Map<NodeMapValue> | null>(
    null
  );
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // track sync status
  useEffect(() => {
    if (!doc) return;

    // get the provider from the doc (it's available in the provider property if using WebrtcProvider)
    // @ts-expect-error - the provider is attached to the doc but not typed
    const provider = doc.provider;
    console.log('provider', provider);
    // check if we're already synced
    if (provider && provider.synced) {
      setSyncStatus(true);
    }

    // listen for sync events
    const handleSync = () => {
      console.log('document synced with peers');
      setSyncStatus(true);
    };

    // some providers emit 'sync' when initial sync is complete
    if (provider) {
      provider.on('synced', handleSync);

      // also listen for 'status' changes in case provider uses that
      provider.on('status', (event: { status: string }) => {
        if (event.status === 'connected' || event.status === 'synced') {
          setSyncStatus(true);
        }
      });

      return () => {
        provider.off('synced', handleSync);
        provider.off('status');
      };
    }

    // if no provider or can't detect sync, assume we're synced after a short delay
    const timeout = setTimeout(() => setSyncStatus(true), 4000);
    return () => clearTimeout(timeout);
  }, [doc]);

  useEffect(() => {
    yNodesRef.current = yNodes; // keep up-to-date
  }, [yNodes]);

  // only initialize if we're synced
  useEffect(() => {
    // wait for sync and check if nodes are empty
    if (!syncStatus) {
      console.log('waiting for sync before initializing nodes');
      return;
    }

    console.log('yNodesRef.current', yNodesRef.current.length);
    if (yNodesRef.current.length === 0) {
      console.log('yNodes is empty, initializing default nodes');
      const makeNode = (id: string, x: number, y: number) => {
        const n = new Y.Map<NodeMapValue>();
        n.set('id', id);
        n.set('x', x);
        n.set('y', y);
        n.set('selected', false);
        n.set('uuid', crypto.randomUUID()); // ensure stable React key
        return n;
      };

      const A = makeNode('A', 100, 100);
      const B = makeNode('B', 300, 200);
      const C = makeNode('C', 200, 300);

      const link1 = new Y.Map<string>();
      link1.set('source', 'A');
      link1.set('target', 'B');

      const link2 = new Y.Map<string>();
      link2.set('source', 'B');
      link2.set('target', 'C');

      yNodes.push([A, B, C]);
      yLinks.push([link1, link2]);
    }
  }, [syncStatus]);

  const getNodeById = (id: string): NodeData | null => {
    const i = yNodes.toArray().findIndex((map) => map.get('id') === id);
    return i >= 0 ? (nodesData[i] as unknown as NodeData) : null;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingNode || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggingNode.set('x', x);
    draggingNode.set('y', y);
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
  };

  const handleMouseDown = (
    nodeMap: Y.Map<NodeMapValue>,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setDraggingNode(nodeMap);
  };

  const toggleSelection = (
    nodeMap: Y.Map<NodeMapValue>,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const isSelected = nodeMap.get('selected') ?? false;
    nodeMap.set('selected', !isSelected);
  };

  // if not synced yet, show a loading message
  if (!syncStatus) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          background: '#f9f9f9',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
          waiting for sync...
        </div>
        <div style={{ fontSize: '1rem', color: '#666' }}>
          connecting to remote peers
        </div>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100vh"
      style={{
        background: '#f9f9f9',
        cursor: draggingNode ? 'grabbing' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* render links */}
      {links.map((linkData, i: number) => {
        // cast the link data to our interface type
        const link = linkData as unknown as LinkData;
        const source = getNodeById(link.source);
        const target = getNodeById(link.target);
        if (!source || !target) return null;

        return (
          <line
            key={`link-${i}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke="#ccc"
            strokeWidth={2}
          />
        );
      })}

      {/* render nodes */}
      {yNodes.map((nodeMap: Y.Map<NodeMapValue>, i: number) => {
        const node = nodesData[i] as unknown as NodeData;
        const selected = node.selected ?? false;
        const uuid = nodeMap.get('uuid') as string;

        return (
          <g
            key={uuid}
            onMouseDown={(e) => handleMouseDown(nodeMap, e)}
            onClick={(e) => toggleSelection(nodeMap, e)}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={20}
              fill={selected ? '#f39c12' : '#3498db'}
              stroke={selected ? '#e67e22' : '#2c3e50'}
              strokeWidth={selected ? 4 : 2}
            />
            <text
              x={node.x}
              y={node.y}
              dy={5}
              textAnchor="middle"
              fill="#fff"
              fontSize={12}
              pointerEvents="none"
            >
              {node.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export default Graph;
