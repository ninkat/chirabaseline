import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import { useY } from 'react-yjs';
import senateData from '../assets/foafagain.json'; // import the json data

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string;

// define senator node data structure
interface SenatorNodeData {
  id: string;
  name: string;
  type: 'senator';
  state: string;
  party: 'd' | 'r' | 'i'; // assuming 'i' for independent, adjust if needed
  x: number;
  y: number;
  uuid: string; // stable react key
}

// define bill node data structure
interface BillNodeData {
  id: string;
  name: string;
  type: 'bill';
  status: string;
  x: number;
  y: number;
  uuid: string; // stable react key
}

// union type for any node in the graph
type GraphNodeData = SenatorNodeData | BillNodeData;

// define link structure type
interface LinkData {
  source: string; // id of source node
  target: string; // id of target node
  type: 'sponsor' | 'cosponsor';
}

const SenateVisualization: React.FC = () => {
  const doc = useContext(YjsContext);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // get reactive copies of the data for rendering
  const nodesData = useY(yNodes); // careful: this returns plain js objects
  const linksData = useY(yLinks);

  // ref to keep track of the yjs array itself for initialization checks
  const yNodesRef = useRef(yNodes);

  const [draggingNode, setDraggingNode] = useState<Y.Map<NodeMapValue> | null>(
    null
  );
  const [hoveredNode, setHoveredNode] = useState<GraphNodeData | null>(null);
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // fixed dimensions for the svg canvas
  const fixedWidth = 1280;
  const fixedHeight = 720;

  // track sync status (simple timeout approach)
  useEffect(() => {
    if (!doc) return;
    // assume synced after a short delay
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for senate visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // keep ynodesref updated
  useEffect(() => {
    yNodesRef.current = yNodes;
  }, [yNodes]);

  // initialize graph data from json if ynodes is empty after sync
  useEffect(() => {
    // wait for sync and check if nodes are empty (dimensions are now fixed)
    if (!syncStatus || yNodesRef.current.length > 0) {
      return;
    }

    console.log('initializing senate graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];
    const nodePadding = 50; // padding from svg edges

    // process nodes from json
    senateData.nodes.forEach((node) => {
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', node.id);
      yNode.set('name', node.name);
      yNode.set('type', node.type);
      // simple random initial position within fixed svg bounds
      yNode.set(
        'x',
        Math.random() * (fixedWidth - 2 * nodePadding) + nodePadding
      );
      yNode.set(
        'y',
        Math.random() * (fixedHeight - 2 * nodePadding) + nodePadding
      );
      yNode.set('uuid', crypto.randomUUID()); // stable react key

      if (node.type === 'senator') {
        yNode.set('party', node.party?.toLowerCase() || 'i'); // ensure lowercase, default independent
        yNode.set('state', node.state);
      } else if (node.type === 'bill') {
        yNode.set('status', node.status);
      }
      initialNodes.push(yNode);
    });

    // process links from json
    senateData.links.forEach((link) => {
      const yLink = new Y.Map<LinkMapValue>();
      yLink.set('source', link.source);
      yLink.set('target', link.target);
      yLink.set('type', link.type);
      initialLinks.push(yLink);
    });

    // use transaction to batch updates
    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks);
    });
  }, [syncStatus, doc, yNodes, yLinks]); // removed svgdimensions dependency

  // --- event handlers ---

  // get node data helper (using the reactive js copy from usey)
  const getNodeDataById = (id: string): GraphNodeData | null => {
    // usey returns plain js objects reflecting the y.map state.
    // we find the object by id in the reactive array.
    const nodeData = nodesData.find((node) => node.id === id);

    if (!nodeData) return null;

    // cast the plain js object to our specific type based on the 'type' property.
    // this assumes the data structure from usey matches our interfaces.
    // we cast to unknown first as suggested by linter for type safety.
    if (nodeData.type === 'senator') {
      return nodeData as unknown as SenatorNodeData;
    } else if (nodeData.type === 'bill') {
      return nodeData as unknown as BillNodeData;
    } else {
      // handle unexpected node type if necessary
      console.warn('unknown node type found:', nodeData.type);
      return null;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingNode || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // update the y.map directly, changes will propagate
    draggingNode.set('x', x);
    draggingNode.set('y', y);
  };

  const handleMouseUp = () => {
    setDraggingNode(null);
  };

  // store the y.map reference when starting drag
  const handleMouseDown = (
    nodeMap: Y.Map<NodeMapValue>,
    e: React.MouseEvent
  ) => {
    e.stopPropagation(); // prevent svg drag
    setDraggingNode(nodeMap);
  };

  // set hovered node data for info panel
  const handleMouseEnterNode = (nodeData: GraphNodeData) => {
    setHoveredNode(nodeData);
  };

  // clear hovered node
  const handleMouseLeaveNode = () => {
    setHoveredNode(null);
  };

  // --- rendering ---

  // placeholder rendering while waiting for sync
  if (!syncStatus) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          flexDirection: 'column',
          background: '#f0f0f0',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
          waiting for sync...
        </div>
        <div style={{ fontSize: '1rem', color: '#666' }}>
          connecting to peers
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        position: 'relative',
        overflow: 'auto',
      }}
    >
      {' '}
      {/* added overflow auto for fixed size svg */}
      <svg
        ref={svgRef}
        width={fixedWidth} // use fixed width
        height={fixedHeight} // use fixed height
        style={{
          background: '#f0f0f0',
          cursor: draggingNode ? 'grabbing' : 'default',
        }}
        onMouseMove={handleMouseMove} // handle drag move on svg
        onMouseUp={handleMouseUp} // handle drag end on svg
        onMouseLeave={handleMouseUp} // also end drag if mouse leaves svg
      >
        {/* render links first (under nodes) */}
        {linksData.map((linkData, index) => {
          // cast link data from the plain js object returned by usey
          const link = linkData as unknown as LinkData; // simpler cast if structure matches
          const sourceNode = getNodeDataById(link.source);
          const targetNode = getNodeDataById(link.target);

          // dont render if nodes not found yet
          if (!sourceNode || !targetNode) return null;

          return (
            <line
              // use index for key as link structure might not be stable enough for uuid
              key={`link-${index}`}
              x1={sourceNode.x}
              y1={sourceNode.y}
              x2={targetNode.x}
              y2={targetNode.y}
              stroke={link.type === 'sponsor' ? '#555' : '#bbb'} // darker for sponsor
              strokeWidth={link.type === 'sponsor' ? 2 : 1}
              strokeDasharray={link.type === 'cosponsor' ? '3,3' : 'none'}
            />
          );
        })}

        {/* render nodes on top of links */}
        {yNodes.map((nodeMap, index) => {
          // get the reactive plain js object for rendering positions, etc.
          const reactiveNodeData = nodesData[index];
          if (!reactiveNodeData) return null; // skip if data not ready

          // extract necessary fields safely
          const id = nodeMap.get('id') as string; // get id from the original y.map
          const nodeForRender = getNodeDataById(id); // use the helper to get typed data
          if (!nodeForRender) return null; // skip if full data fetch failed

          const { x, y, type, uuid } = nodeForRender;
          const isHovered = hoveredNode?.uuid === uuid;
          const isDragging = draggingNode === nodeMap;

          // styles based on type and state
          const senatorRadius = 10;
          const billSize = 16;
          const baseStroke = '#333';
          const hoverStroke = '#f39c12';
          const partyColor =
            type === 'senator'
              ? (nodeForRender as SenatorNodeData).party === 'd'
                ? '#3498db'
                : '#e74c3c' // blue for d, red for r
              : '#95a5a6'; // grey for bills

          return (
            <g
              key={uuid} // use stable uuid for react key
              transform={`translate(${x}, ${y})`} // use transform for positioning group
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => handleMouseDown(nodeMap, e)}
              onMouseEnter={() => handleMouseEnterNode(nodeForRender)}
              onMouseLeave={handleMouseLeaveNode}
            >
              {type === 'senator' ? (
                <circle
                  r={senatorRadius}
                  fill={partyColor}
                  stroke={isHovered || isDragging ? hoverStroke : baseStroke}
                  strokeWidth={isHovered || isDragging ? 3 : 1.5}
                />
              ) : (
                <rect
                  x={-billSize / 2}
                  y={-billSize / 2}
                  width={billSize}
                  height={billSize}
                  fill={partyColor}
                  stroke={isHovered || isDragging ? hoverStroke : baseStroke}
                  strokeWidth={isHovered || isDragging ? 3 : 1.5}
                />
              )}
              {/* optionally render name label on hover/drag */}
              {(isHovered || isDragging) && (
                <text
                  y={
                    type === 'senator' ? -senatorRadius - 5 : -billSize / 2 - 5
                  }
                  textAnchor="middle"
                  fontSize="10"
                  fill="#333"
                >
                  {nodeForRender.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* hover info panel */}
      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(255, 255, 255, 0.85)',
            padding: '8px 12px',
            borderRadius: '4px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            fontSize: '12px',
            pointerEvents: 'none', // prevent panel from blocking svg interactions
          }}
        >
          <div>
            <strong>id:</strong> {hoveredNode.id}
          </div>
          <div>
            <strong>name:</strong> {hoveredNode.name}
          </div>
          <div>
            <strong>type:</strong> {hoveredNode.type}
          </div>
          {hoveredNode.type === 'senator' && (
            <>
              <div>
                <strong>party:</strong>{' '}
                {(hoveredNode as SenatorNodeData).party.toUpperCase()}
              </div>
              <div>
                <strong>state:</strong> {(hoveredNode as SenatorNodeData).state}
              </div>
            </>
          )}
          {hoveredNode.type === 'bill' && (
            <div>
              <strong>status:</strong> {(hoveredNode as BillNodeData).status}
            </div>
          )}
          <div>
            <strong>pos:</strong> ({hoveredNode.x.toFixed(0)},{' '}
            {hoveredNode.y.toFixed(0)})
          </div>
        </div>
      )}
    </div>
  );
};

export default SenateVisualization;
