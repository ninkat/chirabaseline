import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import { useY } from 'react-yjs';
import * as d3 from 'd3';
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

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: string;
  name: string;
  party?: string;
  state?: string;
  status?: string;
  uuid: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: string;
}

const SenateVisualization: React.FC = () => {
  const doc = useContext(YjsContext);
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // add shared hover state with yjs
  const ySharedState = doc!.getMap<string | null>('senateSharedState');

  // get reactive copies of the data for rendering
  const nodesData = useY(yNodes); // careful: this returns plain js objects
  const linksData = useY(yLinks);
  // we don't need to track all state changes, just observe specific changes

  // ref to keep track of the yjs array itself for initialization checks
  const yNodesRef = useRef(yNodes);

  const [hoveredNode, setHoveredNode] = useState<GraphNodeData | null>(null);
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // fixed dimensions for the svg canvas
  const fixedWidth = 1280;
  const fixedHeight = 720;

  // add a ref to track initialization
  const isInitializedRef = useRef(false);
  const svgRef = useRef<d3.Selection<
    SVGSVGElement,
    unknown,
    null,
    undefined
  > | null>(null);
  const nodesRef = useRef<d3.Selection<
    SVGGElement,
    D3Node,
    SVGGElement,
    unknown
  > | null>(null);
  const linksRef = useRef<d3.Selection<
    SVGLineElement,
    D3Link,
    SVGGElement,
    unknown
  > | null>(null);

  // Add refs for tracking node states
  const hoverTimerRef = useRef<number | null>(null);
  const lastHoveredIdRef = useRef<string | null>(null);
  const draggedNodeIdRef = useRef<string | null>(null);

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

    // we'll set positions later with d3 layout
    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // process nodes from json
    senateData.nodes.forEach((node) => {
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', node.id);
      yNode.set('name', node.name);
      yNode.set('type', node.type);
      // just set initial positions - d3 will update these
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
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
  }, [syncStatus, doc, yNodes, yLinks]);

  // get typed node data helper
  const getNodeDataById = (id: string): GraphNodeData | null => {
    const nodeData = nodesData.find((node) => node.id === id);
    if (!nodeData) return null;

    if (nodeData.type === 'senator') {
      return nodeData as unknown as SenatorNodeData;
    } else if (nodeData.type === 'bill') {
      return nodeData as unknown as BillNodeData;
    } else {
      console.warn('unknown node type found:', nodeData.type);
      return null;
    }
  };

  // sync hover state from yjs
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // observe changes to the shared hover state
    const observer = () => {
      const hoveredId = ySharedState.get('hoveredNodeId');
      // Store current hover ID to prevent circular updates
      const currentHoverId = hoveredNode?.id;

      if (hoveredId) {
        // Only update if the ID is different from what we already have
        if (hoveredId !== currentHoverId) {
          const nodeData = getNodeDataById(hoveredId);
          if (nodeData) {
            setHoveredNode(nodeData);
          }
        }
      } else if (hoveredNode) {
        // Only clear if we have something set
        setHoveredNode(null);
      }
    };

    // initial check
    observer();

    // subscribe to changes
    ySharedState.observe(observer);

    return () => {
      ySharedState.unobserve(observer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus, doc, getNodeDataById, nodesData]);

  // Create an observer for node positions and hover states
  useEffect(() => {
    if (!syncStatus || !d3Container.current || !isInitializedRef.current)
      return;

    // If we have an initialized visualization, update node positions directly
    if (svgRef.current && nodesRef.current && linksRef.current) {
      // Get shared hover state
      const hoveredId = ySharedState.get('hoveredNodeId');
      console.log(
        `Updating visualization: hoveredId=${hoveredId}, draggedNodeId=${draggedNodeIdRef.current}`
      );

      // Get the latest node data with their positions
      const nodes: D3Node[] = nodesData.map((node) => ({
        ...node,
        id: node.id as string,
        type: node.type as string,
        name: node.name as string,
        party:
          node.type === 'senator'
            ? (node as unknown as SenatorNodeData).party
            : undefined,
        state:
          node.type === 'senator'
            ? (node as unknown as SenatorNodeData).state
            : undefined,
        status:
          node.type === 'bill'
            ? (node as unknown as BillNodeData).status
            : undefined,
        x: (node.x as number) || 0,
        y: (node.y as number) || 0,
        uuid: node.uuid as string,
      }));

      // The fundamental issue:
      // React state updates (hoveredNode) trigger the tooltip, but D3 visual updates
      // might not be happening because our effect dependencies aren't detecting all changes.
      // Let's force D3 to update the visuals on every render.

      // Reset ALL visual states first
      nodesRef.current
        .selectAll('circle, rect')
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5);

      nodesRef.current.selectAll('text').attr('opacity', 0);

      // Apply hover highlights if needed - ONLY to the specifically hovered node
      if (hoveredId) {
        const hoveredNodes = nodesRef.current.filter(
          (d: D3Node) => d.id === hoveredId
        );

        if (!hoveredNodes.empty()) {
          console.log(`Highlighting hovered node: ${hoveredId}`);
          hoveredNodes
            .select('circle, rect')
            .attr('stroke', '#f39c12')
            .attr('stroke-width', 3);

          hoveredNodes.select('text').attr('opacity', 1);
        } else {
          console.log(`Could not find node with ID: ${hoveredId}`);
        }
      }

      // Apply drag highlights separately
      if (draggedNodeIdRef.current) {
        const draggedNodes = nodesRef.current.filter(
          (d: D3Node) => d.id === draggedNodeIdRef.current
        );

        if (!draggedNodes.empty()) {
          console.log(`Highlighting dragged node: ${draggedNodeIdRef.current}`);
          draggedNodes
            .select('circle, rect')
            .attr('stroke', '#f39c12')
            .attr('stroke-width', 3);
        }
      }

      // Update node positions
      nodesRef.current
        .data(nodes, (d: D3Node) => d.uuid)
        .attr('transform', (d: D3Node) => `translate(${d.x},${d.y})`);

      // Create a node map for resolving links
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      // Resolve links to use actual node references
      const links: D3Link[] = linksData.map((link) => {
        const source = nodeMap.get(link.source as string) || link.source;
        const target = nodeMap.get(link.target as string) || link.target;
        return { source, target, type: link.type as string };
      });

      // Update links
      linksRef.current
        .data(links)
        .attr('x1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.x || 0;
        })
        .attr('y1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.y || 0;
        })
        .attr('x2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.x || 0;
        })
        .attr('y2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.y || 0;
        });
    }
    // Force this effect to run on EVERY render to catch all state changes
  });

  // d3 visualization setup and update - now only runs for initial setup
  useEffect(() => {
    if (!syncStatus || !d3Container.current || nodesData.length === 0) return;

    // Only build visualization once
    if (isInitializedRef.current && svgRef.current) {
      return; // Skip rebuilding if already initialized
    }

    console.log('Building visualization initially');

    // Set initialization flag
    isInitializedRef.current = true;

    // clear previous svg content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg element
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: #f0f0f0; max-width: 100%; height: auto;');

    // Store svg reference
    svgRef.current = svg as d3.Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;

    // prepare data for d3
    const nodes: D3Node[] = nodesData.map((node) => ({
      ...node,
      // convert id string to actual node reference for d3 links
      id: node.id as string,
      type: node.type as string,
      name: node.name as string,
      party:
        node.type === 'senator'
          ? (node as unknown as SenatorNodeData).party
          : undefined,
      state:
        node.type === 'senator'
          ? (node as unknown as SenatorNodeData).state
          : undefined,
      status:
        node.type === 'bill'
          ? (node as unknown as BillNodeData).status
          : undefined,
      x: (node.x as number) || fixedWidth / 2,
      y: (node.y as number) || fixedHeight / 2,
      uuid: node.uuid as string,
    }));

    const links: D3Link[] = linksData.map((link) => ({
      source: link.source as string,
      target: link.target as string,
      type: link.type as string,
    }));

    // get counts for layout arrangement
    const demNodes = nodes.filter(
      (n) => n.type === 'senator' && n.party === 'd'
    );
    const repNodes = nodes.filter(
      (n) => n.type === 'senator' && n.party === 'r'
    );
    const billNodes = nodes.filter((n) => n.type === 'bill');

    console.log(
      `Found ${demNodes.length} Democrats, ${repNodes.length} Republicans, ${billNodes.length} Bills`
    );

    // assign initial positions directly
    const assignStaticPositions = () => {
      // define columns
      const leftColumnX = fixedWidth * 0.2;
      const rightColumnX = fixedWidth * 0.8;
      const centerColumnX = fixedWidth * 0.5;

      // set vertical spacing for each party - should be same with equal counts
      const demSpacing = (fixedHeight * 0.8) / (demNodes.length + 1);
      const repSpacing = (fixedHeight * 0.8) / (repNodes.length + 1);

      // set vertical spacing for bills
      const billRows = Math.ceil(Math.sqrt(billNodes.length));
      const billCols = Math.ceil(billNodes.length / billRows);

      const billGridWidth = fixedWidth * 0.3;
      const billGridHeight = fixedHeight * 0.7;

      const billColSpacing = billGridWidth / (billCols || 1);
      const billRowSpacing = billGridHeight / (billRows || 1);

      // center grid
      const billGridLeft = centerColumnX - billGridWidth / 2;
      const billGridTop = fixedHeight * 0.15;

      // position democratic senators in left column
      demNodes.forEach((node, i) => {
        const verticalPos = (i + 1) * demSpacing + fixedHeight * 0.1;
        node.x = leftColumnX;
        node.y = verticalPos;
      });

      // position republican senators in right column
      repNodes.forEach((node, i) => {
        const verticalPos = (i + 1) * repSpacing + fixedHeight * 0.1;
        node.x = rightColumnX;
        node.y = verticalPos;
      });

      // position bills in a grid in the center
      billNodes.forEach((node, i) => {
        const row = Math.floor(i / billCols);
        const col = i % billCols;

        node.x = billGridLeft + (col + 0.5) * billColSpacing;
        node.y = billGridTop + (row + 0.5) * billRowSpacing;
      });

      // sync with yjs
      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });
    };

    // check if we need to initialize positions
    const needsInitialLayout = nodes.some(
      (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
    );

    if (needsInitialLayout) {
      console.log('initializing layout');

      // run a simple static layout first
      assignStaticPositions();

      // then refine with force simulation
      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(70)
        )
        .force('charge', d3.forceManyBody().strength(-150))
        .force(
          'x',
          d3
            .forceX<D3Node>()
            .x((d) => {
              // keep nodes in their assigned columns
              return d.x || 0;
            })
            .strength(0.5)
        )
        .force(
          'y',
          d3
            .forceY<D3Node>()
            .y((d) => {
              // keep nodes near their assigned rows
              return d.y || 0;
            })
            .strength(0.3)
        )
        .force(
          'collision',
          d3
            .forceCollide<D3Node>()
            .radius((d) => (d.type === 'senator' ? 20 : 15))
        )
        .stop();

      // run for a fixed number of ticks
      console.log('running simulation for 100 ticks');
      simulation.tick(100);

      // update yjs after simulation
      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });
    }

    // resolve links to use node references
    const nodeMap = new Map<string, D3Node>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    links.forEach((link) => {
      if (typeof link.source === 'string') {
        const sourceNode = nodeMap.get(link.source);
        if (sourceNode) link.source = sourceNode;
      }
      if (typeof link.target === 'string') {
        const targetNode = nodeMap.get(link.target);
        if (targetNode) link.target = targetNode;
      }
    });

    // create arrow marker for sponsor links
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#555');

    // create links group
    const linkGroup = svg.append('g').attr('class', 'links');

    // create nodes group
    const nodeGroup = svg.append('g').attr('class', 'nodes');

    // draw links
    const link = linkGroup
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', (d) => (d.type === 'sponsor' ? '#555' : '#bbb'))
      .attr('stroke-width', (d) => (d.type === 'sponsor' ? 2 : 1))
      .attr('stroke-dasharray', (d) =>
        d.type === 'cosponsor' ? '3,3' : 'none'
      )
      .attr('marker-end', (d) =>
        d.type === 'sponsor' ? 'url(#arrowhead)' : ''
      )
      .attr('x1', (d: D3Link) => {
        const source = d.source as D3Node;
        return source.x || 0;
      })
      .attr('y1', (d: D3Link) => {
        const source = d.source as D3Node;
        return source.y || 0;
      })
      .attr('x2', (d: D3Link) => {
        const target = d.target as D3Node;
        return target.x || 0;
      })
      .attr('y2', (d: D3Link) => {
        const target = d.target as D3Node;
        return target.y || 0;
      });

    // Save link reference
    linksRef.current = link as d3.Selection<
      SVGLineElement,
      D3Link,
      SVGGElement,
      unknown
    >;

    // Create node elements without drag handler initially
    const node = nodeGroup
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .attr('data-id', (d) => d.id)
      .attr('data-uuid', (d) => d.uuid)
      .attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);

    // Save node reference
    nodesRef.current = node as d3.Selection<
      SVGGElement,
      D3Node,
      SVGGElement,
      unknown
    >;

    // Create circles for senators
    node
      .filter((d) => d.type === 'senator')
      .append('circle')
      .attr('r', 10)
      .attr('fill', (d) =>
        d.party === 'd' ? '#3498db' : d.party === 'r' ? '#e74c3c' : '#95a5a6'
      )
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5)
      .attr('class', 'node-shape'); // add class for selecting shapes

    // Create rectangles for bills
    node
      .filter((d) => d.type === 'bill')
      .append('rect')
      .attr('x', -8)
      .attr('y', -8)
      .attr('width', 16)
      .attr('height', 16)
      .attr('fill', '#95a5a6')
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5)
      .attr('class', 'node-shape'); // add class for selecting shapes

    // Add text labels
    node
      .append('text')
      .attr('dx', 15)
      .attr('dy', '.35em')
      .attr('font-size', '10px')
      .text((d) => d.name)
      .attr('opacity', 0)
      .attr('pointer-events', 'none'); // disable pointer events on text

    // Define a simplified drag handler using function declaration for "this" context

    function dragStarted(
      this: SVGElement,
      event: d3.D3DragEvent<SVGElement, D3Node, D3Node>,
      d: D3Node
    ) {
      // Set the dragged node ID
      draggedNodeIdRef.current = d.id;

      // raise the element to the front and add active class
      d3.select(this).raise().classed('active', true);
    }

    function dragged(
      this: SVGElement,
      event: d3.D3DragEvent<SVGElement, D3Node, D3Node>,
      d: D3Node
    ) {
      // Update node position
      d.x = event.x;
      d.y = event.y;

      // Update visual position
      d3.select(this).attr('transform', `translate(${event.x},${event.y})`);

      // Update connected links
      link
        .filter((l: D3Link) => {
          const source = l.source as D3Node;
          const target = l.target as D3Node;
          return source.id === d.id || target.id === d.id;
        })
        .attr('x1', (l: D3Link) => {
          const source = l.source as D3Node;
          return source.id === d.id ? event.x : source.x || 0;
        })
        .attr('y1', (l: D3Link) => {
          const source = l.source as D3Node;
          return source.id === d.id ? event.y : source.y || 0;
        })
        .attr('x2', (l: D3Link) => {
          const target = l.target as D3Node;
          return target.id === d.id ? event.x : target.x || 0;
        })
        .attr('y2', (l: D3Link) => {
          const target = l.target as D3Node;
          return target.id === d.id ? event.y : target.y || 0;
        });

      // Sync with YJS during dragging for real-time updates
      // Using a single transaction for each update is more efficient
      doc!.transact(() => {
        for (let i = 0; i < yNodes.length; i++) {
          const nodeMap = yNodes.get(i);
          if (nodeMap.get('id') === d.id) {
            nodeMap.set('x', d.x);
            nodeMap.set('y', d.y);
            break;
          }
        }
      });
    }

    /* eslint-disable @typescript-eslint/no-unused-vars */
    function dragEnded(
      this: SVGElement,
      event: d3.D3DragEvent<SVGElement, D3Node, D3Node>,
      d: D3Node
    ) {
      // Clear the dragged node ID
      draggedNodeIdRef.current = null;

      // Remove the active class
      d3.select(this).classed('active', false);
    }
    /* eslint-enable @typescript-eslint/no-unused-vars */

    // Apply drag behavior to nodes
    node.call(
      d3
        .drag<SVGGElement, D3Node>()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
    );

    // Add hover behaviors with debounce to prevent flickering
    node
      .selectAll<SVGElement, D3Node>('.node-shape') // only attach hover to shapes
      .on('mouseenter', function (this: Element, _: PointerEvent, d: D3Node) {
        // Clear any existing hover timer
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }

        const nodeData = getNodeDataById(d.id);
        if (nodeData) {
          // Set local state for tooltip
          setHoveredNode(nodeData);
          lastHoveredIdRef.current = d.id;

          // Immediate visual feedback for this client
          const parentElement = this.parentElement;
          if (parentElement) {
            const parentNode = d3.select(parentElement);
            parentNode
              .select('.node-shape')
              .attr('stroke', '#f39c12')
              .attr('stroke-width', 3);

            parentNode.select('text').attr('opacity', 1);
          }

          // Update shared state with slight delay
          hoverTimerRef.current = setTimeout(() => {
            if (lastHoveredIdRef.current === d.id) {
              ySharedState.set('hoveredNodeId', d.id);
            }
          }, 50);
        }
      })
      .on('mouseleave', function (this: Element) {
        // Clear any pending hover timer
        if (hoverTimerRef.current) {
          clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }

        // Immediate visual feedback for this client
        const parentElement = this.parentElement;
        if (parentElement) {
          const parentNode = d3.select(parentElement);
          parentNode
            .select('.node-shape')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5);

          parentNode.select('text').attr('opacity', 0);
        }

        // Set local state for tooltip
        setHoveredNode(null);
        const previousHoveredId = lastHoveredIdRef.current;
        lastHoveredIdRef.current = null;

        // Clear shared state with slight delay
        hoverTimerRef.current = setTimeout(() => {
          // Only clear if we were the ones who set it
          if (ySharedState.get('hoveredNodeId') === previousHoveredId) {
            ySharedState.set('hoveredNodeId', null);
          }
        }, 100);
      });

    // Store svg reference
    svgRef.current = svg as d3.Selection<
      SVGSVGElement,
      unknown,
      null,
      undefined
    >;
  }, [syncStatus, nodesData, linksData, doc]);

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
        width: fixedWidth,
        height: fixedHeight,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div ref={d3Container} style={{ width: '100%', height: '100%' }} />

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
