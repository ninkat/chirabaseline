import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import { useY } from 'react-yjs';

const Graph: React.FC = () => {
  const doc = useContext(YjsContext);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const yNodes = doc!.getArray<Y.Map<any>>('nodes');
  const yLinks = doc!.getArray<Y.Map<any>>('links');

  const nodesData = useY(yNodes); // JSON-renderable copies
  const yNodesRef = useRef(yNodes);
  const links = useY(yLinks);

  const [draggingNode, setDraggingNode] = useState<Y.Map<any> | null>(null);

  useEffect(() => {
    yNodesRef.current = yNodes; // keep up-to-date
  }, [yNodes]);

  useEffect(() => {
    console.log('yNodesRef.current', yNodesRef.current.length);
    if (yNodesRef.current.length === 0) {
      console.log('yNodes is empty');
      const makeNode = (id: string, x: number, y: number) => {
        const n = new Y.Map();
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

      const link1 = new Y.Map();
      link1.set('source', 'A');
      link1.set('target', 'B');

      const link2 = new Y.Map();
      link2.set('source', 'B');
      link2.set('target', 'C');

      yNodes.push([A, B, C]);
      yLinks.push([link1, link2]);
    }
  }, []);

  const getNodeById = (id: string) => {
    const i = yNodes.toArray().findIndex((map) => map.get('id') === id);
    return i >= 0 ? nodesData[i] : null;
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

  const handleMouseDown = (nodeMap: Y.Map<any>, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggingNode(nodeMap);
  };

  const toggleSelection = (nodeMap: Y.Map<any>, e: React.MouseEvent) => {
    e.stopPropagation();
    const isSelected = nodeMap.get('selected') ?? false;
    nodeMap.set('selected', !isSelected);
  };

  return (
    <svg
      ref={svgRef}
      width="100%"
      height="100vh"
      style={{ background: '#f9f9f9', cursor: draggingNode ? 'grabbing' : 'default' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Render links */}
      {links.map((link: any, i: number) => {
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

      {/* Render nodes */}
      {yNodes.map((nodeMap: Y.Map<any>, i: number) => {
        const node = nodesData[i];
        const selected = node.selected ?? false;
        const uuid = nodeMap.get('uuid');

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
