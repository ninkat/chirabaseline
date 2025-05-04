import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import * as d3 from 'd3';
import senateData from '../assets/foafagain.json'; // import the json data
import VideoFeeds from './VideoFeeds';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string;

// awareness states
interface AwarenessState {
  user: {
    name: string;
    color: string;
    id: string;
  };
  cursor: {
    x: number;
    y: number;
    nodeId?: string;
  };
  brushSelection?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  transform?: {
    x: number;
    y: number;
    k: number;
  };
  timestamp?: number;
}

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

// Add this interface near the top with other interfaces
interface CursorData {
  state: AwarenessState;
  clientId: number;
  isLocal: boolean;
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const originalSharedState = doc.getMap<string | boolean | null>(
      'senateSharedState'
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null>(
      'senateSharedState'
    );

    // copy nodes data
    tempDoc.transact(() => {
      // copy nodes
      for (let i = 0; i < originalNodes.length; i++) {
        const originalNode = originalNodes.get(i);
        const newNode = new Y.Map<NodeMapValue>();

        // copy all properties
        originalNode.forEach((value: NodeMapValue, key: string) => {
          newNode.set(key, value);
        });

        tempNodes.push([newNode]);
      }

      // copy links
      for (let i = 0; i < originalLinks.length; i++) {
        const originalLink = originalLinks.get(i);
        const newLink = new Y.Map<LinkMapValue>();

        // copy all properties
        originalLink.forEach((value: LinkMapValue, key: string) => {
          newLink.set(key, value);
        });

        tempLinks.push([newLink]);
      }

      // copy shared state
      originalSharedState.forEach(
        (value: string | boolean | null, key: string) => {
          tempSharedState.set(key, value);
        }
      );
    });

    // create snapshot of the cleaned data
    const cleanSnapshot = Y.encodeStateAsUpdate(tempDoc);

    // clear original doc
    doc.transact(() => {
      while (originalNodes.length > 0) originalNodes.delete(0);
      while (originalLinks.length > 0) originalLinks.delete(0);
      originalSharedState.forEach((_: string | boolean | null, key: string) =>
        originalSharedState.delete(key)
      );
    });

    // apply clean snapshot to original doc
    Y.applyUpdate(doc, cleanSnapshot);

    const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
    const reduction = Math.max(
      0,
      Math.round((1 - afterSize / beforeSize) * 100)
    );
    console.log(
      `[Yjs] Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Compaction failed:', err);

    // fallback to simple snapshot-based compaction if the more aggressive approach fails
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      doc.transact(() => {
        Y.applyUpdate(doc, snapshot);
      });

      const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
      const reduction = Math.max(
        0,
        Math.round((1 - afterSize / beforeSize) * 100)
      );
      console.log(
        `[Yjs] Simple compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error('[Yjs] Fallback compaction also failed:', fallbackErr);
    }
  }
}

const SenateVisualization: React.FC = () => {
  // get both doc and awareness from context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const awareness = yjsContext?.awareness;

  // reference to the d3 container
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // add shared state with yjs
  const ySharedState = doc!.getMap<string | boolean | null | string[]>(
    'senateSharedState'
  );

  // add client brush selections map
  const yClientBrushSelections = doc!.getMap<string[]>('clientBrushSelections');

  // add click selections map - maps userId to array of selected node ids
  const yClientClickSelections = doc!.getMap<string[]>('clientClickSelections');

  // reference to track initialization
  const isInitializedRef = useRef(false);

  // only keep states for non-d3 related variables
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [userId] = useState<string>(() => crypto.randomUUID());
  const [userName] = useState<string>(
    () => `User-${Math.floor(Math.random() * 1000)}`
  );
  const [userColor] = useState<string>(() => {
    const colors = [
      '#9b59b6', // purple
      '#f39c12', // orange
      '#16a085', // teal
      '#ff69b4', // hot pink
      '#2ecc71', // vibrant green
      '#ffcc00', // golden yellow
      '#00bcd4', // cyan
      '#8e44ad', // deeper purple
      '#ff8c00', // dark orange
      '#1abc9c', // aqua green
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  });

  // fixed dimensions for the svg canvas
  const fixedWidth = 1280;
  const fixedHeight = 720;

  // inside SenateVisualization component, after fixedHeight declaration
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );

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

  // set up initial awareness state
  useEffect(() => {
    if (!awareness) return;

    // set initial awareness state
    awareness.setLocalState({
      user: {
        name: userName,
        color: userColor,
        id: userId,
      },
      cursor: {
        x: 0,
        y: 0,
      },
    } as AwarenessState);

    // cleanup on unmount
    return () => {
      awareness.setLocalState(null);
    };
  }, [awareness, userId, userName, userColor]);

  // performance monitoring intervals and compaction
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // monitor yjs document size
    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs] Document size: ${byteLength} bytes`);
    }, 60000); // every 60 seconds

    // monitor DOM elements
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(`[DOM] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`);
    }, 10000);

    // periodic document compaction to prevent unbounded growth
    const compactionInterval = setInterval(() => {
      pruneYDoc(doc);
    }, 300000); // every 5 minutes

    // cleanup intervals on unmount
    return () => {
      clearInterval(yjsMonitor);
      clearInterval(domMonitor);
      clearInterval(compactionInterval);
    };
  }, [doc, syncStatus]);

  // initialize graph data from json if ynodes is empty after sync
  useEffect(() => {
    // wait for sync and check if nodes are empty
    if (!syncStatus || yNodes.length > 0) {
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

  // d3 visualization setup and update
  useEffect(() => {
    if (!syncStatus || !d3Container.current || !awareness) return;

    // only initialize once
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 visualization');

    // define dimensions early
    const tooltipWidth = fixedWidth * 0.25;
    const tooltipHeight = fixedHeight;

    // clear any existing content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg element
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr(
        'style',
        'background: #f0f0f0; max-width: 100%; height: auto; cursor: none;'
      );

    // create a root group for all content that will be transformed
    const root = svg.append('g').attr('class', 'root');

    // move cursor group outside of root so it's not affected by root transform
    const cursorGroup = svg.append('g').attr('class', 'cursors');

    // move all your existing groups into root
    const brushGroup = root
      .append('g')
      .attr('class', 'brush')
      .attr('transform', `translate(${tooltipWidth}, 0)`);

    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');
    const remoteBrushesGroup = root
      .append('g')
      .attr('class', 'remote-brushes')
      .attr('transform', `translate(${tooltipWidth}, 0)`);

    // create a custom local brush element (hidden initially)
    const localBrushRect = brushGroup
      .append('rect')
      .attr('class', 'local-brush-rect')
      .attr('pointer-events', 'none')
      .attr('fill', `${userColor}33`) // exact same transparency as remote
      .attr('stroke', userColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '3,3')
      .attr('visibility', 'hidden'); // hidden by default

    // initialize brush
    const brush = d3
      .brush()
      .extent([
        [0, 0],
        [fixedWidth - tooltipWidth, fixedHeight],
      ])
      .filter((event) => {
        // only start
        return event.type === 'mousedown' && !event.shiftKey;
      })
      .on('start', brushStarted)
      .on('brush', brushed)
      .on('end', brushEnded);

    // apply brush to the group
    brushGroup.call(brush);

    // hide the default d3 brush visual elements completely
    brushGroup
      .select('.selection')
      .attr('fill', 'none')
      .attr('stroke', 'none')
      .attr('stroke-width', 0);

    brushGroup
      .selectAll('.handle')
      .attr('fill', 'none')
      .attr('stroke', 'none')
      .attr('stroke-width', 0);

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

    // create tooltip group with modern styling
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');

    // add gradient for tooltip
    const tooltipGradient = svg.append('defs').append('linearGradient');

    tooltipGradient
      .attr('id', 'tooltip-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    tooltipGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#1a202c')
      .attr('stop-opacity', 0.98);

    tooltipGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#171923')
      .attr('stop-opacity', 0.98);

    tooltip
      .append('rect')
      .attr('width', tooltipWidth)
      .attr('height', tooltipHeight)
      .attr('fill', 'url(#tooltip-gradient)')
      .attr('rx', 12)
      .attr('ry', 12);

    // tooltip content containers with text wrapping
    const tooltipContent = tooltip
      .append('g')
      .attr('transform', `translate(20, 40)`);

    // add title text element with proper styling
    tooltipContent
      .append('text')
      .attr('class', 'tt-title')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '28px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '500');

    tooltipContent
      .append('text')
      .attr('class', 'tt-id')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-name')
      .attr('x', 0)
      .attr('y', 35) // increased spacing for larger text
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-type')
      .attr('x', 0)
      .attr('y', 70) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-detail1')
      .attr('x', 0)
      .attr('y', 105) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-detail2')
      .attr('x', 0)
      .attr('y', 140) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    // add divider for presence panel
    tooltip
      .append('line')
      .attr('x1', 20)
      .attr('y1', fixedHeight - 140)
      .attr('x2', tooltipWidth - 20)
      .attr('y2', fixedHeight - 140)
      .attr('stroke', '#4a5568')
      .attr('stroke-width', 1);

    // add presence section title
    tooltip
      .append('text')
      .attr('x', 20)
      .attr('y', fixedHeight - 110)
      .attr('font-size', '18px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '500')
      .text('online users');

    // create presence list container within tooltip
    const presenceList = tooltip
      .append('g')
      .attr('class', 'presence-list')
      .attr('transform', `translate(20, ${fixedHeight - 90})`);

    // adjust the main visualization area
    linkGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    cursorGroup.attr('transform', `translate(${tooltipWidth}, 0)`);

    // makes sure the default cursor is invisible at all times
    svg.selectAll('*').style('cursor', 'inherit');

    // helper function to convert node maps to d3 nodes
    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as string;
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;

        const d3Node: D3Node = {
          id,
          type,
          name,
          x,
          y,
          uuid,
        };

        if (type === 'senator') {
          d3Node.party = node.get('party') as string;
          d3Node.state = node.get('state') as string;
        } else if (type === 'bill') {
          d3Node.status = node.get('status') as string;
        }

        nodes.push(d3Node);
      }
      return nodes;
    };

    // helper function to convert link maps to d3 links
    const mapLinksToD3 = (nodeMap: Map<string, D3Node>): D3Link[] => {
      const links: D3Link[] = [];
      for (let i = 0; i < yLinks.length; i++) {
        const link = yLinks.get(i);
        const sourceId = link.get('source') as string;
        const targetId = link.get('target') as string;
        const type = link.get('type') as string;

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type });
      }
      return links;
    };

    // function to update presence list
    const updatePresenceList = () => {
      if (!awareness) return;

      const states = Array.from(awareness.getStates().entries())
        .map(([clientId, state]) => ({
          clientId,
          state: state as AwarenessState,
        }))
        .filter((item) => item.state && item.state.user)
        .slice(0, 2); // limit to maximum 2 users

      // update presence list
      const userItems = presenceList
        .selectAll<SVGGElement, { clientId: number; state: AwarenessState }>(
          'g.user-item'
        )
        .data(states, (d) => d.clientId.toString());

      // remove old items
      userItems.exit().remove();

      // create new items with larger size for tooltip
      const newUserItems = userItems
        .enter()
        .append('g')
        .attr('class', 'user-item')
        .attr('transform', (d, i) => `translate(0, ${i * 35})`); // more spacing

      // add color indicators - larger
      newUserItems
        .append('circle')
        .attr('cx', 12)
        .attr('cy', 12)
        .attr('r', 8) // larger radius
        .attr('fill', (d) => d.state.user.color);

      // add user names - larger
      newUserItems
        .append('text')
        .attr('x', 30) // more space from circle
        .attr('y', 17) // better vertical alignment
        .attr('fill', '#cbd5e0')
        .attr('font-size', '18px') // larger font
        .text((d) => d.state.user.name);

      // update existing items
      userItems
        .attr('transform', (d, i) => `translate(0, ${i * 35})`)
        .select('circle')
        .attr('fill', (d) => d.state.user.color);

      userItems.select('text').text((d) => d.state.user.name);
    };

    // function to update user cursors
    const updateCursors = () => {
      if (!awareness) return;

      const cursorStates = Array.from(awareness.getStates().entries())
        .map(([clientId, state]) => ({
          clientId,
          state: state as AwarenessState,
          isLocal:
            state &&
            (state as AwarenessState).user &&
            (state as AwarenessState).user.id === userId,
        }))
        .filter((item) => item.state && item.state.cursor && item.state.user);

      // update cursor visualization
      const cursors = cursorGroup
        .selectAll<
          SVGGElement,
          { clientId: number; state: AwarenessState; isLocal: boolean }
        >('g.cursor')
        .data(cursorStates, (d) => d.clientId.toString());

      // remove old cursors
      cursors.exit().remove();

      // create new cursors
      const newCursors = cursors
        .enter()
        .append('g')
        .attr(
          'class',
          (d) => `cursor ${d.isLocal ? 'local-cursor' : 'remote-cursor'}`
        )
        .attr('pointer-events', 'none') // make sure cursors don't block interactions
        .attr('transform', (d) => {
          const x = d.state.cursor.x || 0;
          const y = d.state.cursor.y || 0;
          return `translate(${x}, ${y})`;
        });

      // add cursor shape
      newCursors
        .append('path')
        .attr('d', 'M0,0 L24,12 L12,12 L12,24 L0,0')
        .attr('fill', (d) => d.state.user.color)
        .attr('stroke', '#000')
        .attr('stroke-width', 2);

      // add user name only for remote cursors
      const remoteLabels = newCursors.filter((d) => !d.isLocal);

      // add background box for remote cursor labels
      remoteLabels
        .append('rect')
        .attr('x', 23)
        .attr('y', 18)
        .attr('rx', 4) // rounded corners
        .attr('ry', 4)
        .attr('padding', 4)
        .attr('fill', (d) => d.state.user.color)
        .attr('width', (d) => d.state.user.name.length * 8 + 16) // dynamic width based on text length
        .attr('height', 24);

      // add text on top of the box
      remoteLabels
        .append('text')
        .attr('x', 31) // add padding inside the box
        .attr('y', 35)
        .attr('font-size', '14px')
        .attr('fill', '#ffffff') // white text
        .attr('font-weight', '500')
        .text((d) => d.state.user.name);

      // update existing cursors
      cursors.attr('transform', (d) => {
        const x = d.state.cursor.x || 0;
        const y = d.state.cursor.y || 0;
        return `translate(${x}, ${y})`;
      });
    };

    // function to update remote brush selections
    const updateRemoteBrushes = () => {
      if (!awareness) return;

      const brushStates = Array.from(awareness.getStates().entries())
        .map(([clientId, state]) => ({
          clientId,
          state: state as AwarenessState,
          isLocal:
            state &&
            (state as AwarenessState).user &&
            (state as AwarenessState).user.id === userId,
        }))
        .filter(
          (item) =>
            item.state &&
            item.state.brushSelection &&
            item.state.user &&
            !item.isLocal
        ); // only remote brushes

      // update brush visualization
      const brushes = remoteBrushesGroup
        .selectAll<
          SVGRectElement,
          { clientId: number; state: AwarenessState; isLocal: boolean }
        >('rect.remote-brush')
        .data(brushStates, (d) => d.clientId.toString());

      // remove old brushes
      brushes.exit().remove();

      // create new brushes
      const newBrushes = brushes
        .enter()
        .append('rect')
        .attr('class', 'remote-brush')
        .attr('pointer-events', 'none')
        .attr('fill', (d) => `${d.state.user.color}33`) // add transparency
        .attr('stroke', (d) => d.state.user.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3,3');

      // update all brushes
      newBrushes
        .merge(brushes)
        .attr('x', (d) => d.state.brushSelection!.x0)
        .attr('y', (d) => d.state.brushSelection!.y0)
        .attr(
          'width',
          (d) => d.state.brushSelection!.x1 - d.state.brushSelection!.x0
        )
        .attr(
          'height',
          (d) => d.state.brushSelection!.y1 - d.state.brushSelection!.y0
        );
    };

    // function to update the visualization
    const updateVisualization = () => {
      // get current data
      const nodes = mapNodesToD3();

      // create a node map for resolving links
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      // resolve links
      const links = mapLinksToD3(nodeMap);

      // create a key function for links
      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}`;
      };

      // update links
      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);

      // handle removed links
      link.exit().remove();

      // handle new links
      const linkEnter = link
        .enter()
        .append('line')
        .attr('stroke', (d) => (d.type === 'sponsor' ? '#555' : '#bbb'))
        .attr('stroke-width', (d) => (d.type === 'sponsor' ? 3 : 1.5))
        .attr('stroke-dasharray', (d) =>
          d.type === 'cosponsor' ? '5,5' : 'none'
        )
        .attr('marker-end', (d) =>
          d.type === 'sponsor' ? 'url(#arrowhead)' : ''
        );

      // merge links
      const linkMerge = linkEnter.merge(link);

      // update link positions
      linkMerge
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

      // update nodes
      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d: D3Node) => d.uuid);

      // handle removed nodes
      node.exit().remove();

      // handle new nodes
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // create senator nodes with larger radius
      nodeEnter
        .filter((d) => d.type === 'senator')
        .append('circle')
        .attr('r', 15)
        .attr('fill', (d) =>
          d.party === 'd' ? '#3498db' : d.party === 'r' ? '#e74c3c' : '#95a5a6'
        )
        .attr('stroke', '#333')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape');

      // create bill nodes with larger size
      nodeEnter
        .filter((d) => d.type === 'bill')
        .append('rect')
        .attr('x', -12)
        .attr('y', -12)
        .attr('width', 24)
        .attr('height', 24)
        .attr('fill', '#95a5a6')
        .attr('stroke', '#333')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape');

      // add text labels with larger font - but don't show on hover
      nodeEnter
        .append('text')
        .attr('dx', 20)
        .attr('dy', '.35em')
        .attr('font-size', '12px')
        .text((d) => d.name)
        .attr('opacity', 0) // keep hidden
        .attr('pointer-events', 'none');

      // merge nodes
      const nodeMerge = nodeEnter.merge(node);

      // update node positions
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      // get hover and drag state from yjs
      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];
      const draggedId = ySharedState.get('draggedNodeId') as string;

      // collect all brush selections from all clients
      const allBrushSelectedIds: string[] = [];
      yClientBrushSelections.forEach((nodeIds: string[]) => {
        allBrushSelectedIds.push(...nodeIds);
      });

      // collect all click selections from all clients
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });

      // combine hover, brush selections, and click selections
      const allHighlightedIds = [
        ...new Set([
          ...hoveredIds,
          ...allBrushSelectedIds,
          ...allClickSelectedIds,
        ]),
      ];

      // reset all visual states
      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#333')
        .attr('stroke-width', 2);

      // apply hover highlights to any node that is either hovered by cursor OR in any brush selection
      if (allHighlightedIds.length > 0) {
        // First handle hover and brush selections with default orange color
        const hoveredOrBrushedIds = [
          ...new Set([...hoveredIds, ...allBrushSelectedIds]),
        ];
        if (hoveredOrBrushedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredOrBrushedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#f39c12')
            .attr('stroke-width', 3);
        }

        // Then handle click selections with user colors
        yClientClickSelections.forEach(
          (nodeIds: string[], clientId: string) => {
            // Get the user's color from awareness
            let userColor = '#f39c12'; // default fallback color
            if (awareness) {
              const states = Array.from(awareness.getStates());
              const userState = states.find(([, state]) => {
                const awarenessState = state as AwarenessState;
                return awarenessState?.user?.id === clientId;
              });
              if (userState) {
                userColor = (userState[1] as AwarenessState).user.color;
              }
            }

            // Apply the user's color to their selected nodes
            nodeMerge
              .filter((d: D3Node) => nodeIds.includes(d.id))
              .select('.node-shape')
              .attr('stroke', userColor)
              .attr('stroke-width', 3);
          }
        );

        // update tooltip content with all highlighted nodes
        const highlightedNodes = nodes.filter((n) =>
          allHighlightedIds.includes(n.id)
        );
        updateSelectedNodesInfo(highlightedNodes);
      } else {
        // show default tooltip message when no node is hovered
        updateSelectedNodesInfo([]);
      }

      // apply drag highlights
      if (draggedId) {
        nodeMerge
          .filter((d: D3Node) => d.id === draggedId)
          .select('.node-shape')
          .attr('stroke', '#f39c12')
          .attr('stroke-width', 3);
      }

      // update presence data
      updatePresenceList();
      updateCursors();
      updateRemoteBrushes();

      // add click handler to nodes
      nodeMerge.on(
        'click',
        function (this: Element, event: MouseEvent, d: D3Node) {
          event.stopPropagation(); // prevent click from propagating

          // check if node is already selected by another user
          let isSelectedByOther = false;
          yClientClickSelections.forEach(
            (nodeIds: string[], clientId: string) => {
              if (clientId !== userId && nodeIds.includes(d.id)) {
                isSelectedByOther = true;
              }
            }
          );

          if (isSelectedByOther) {
            return; // do nothing if node is selected by another user
          }

          // get current user's selections
          const currentSelections = yClientClickSelections.get(userId) || [];

          // toggle selection
          if (currentSelections.includes(d.id)) {
            // remove node from selections
            yClientClickSelections.set(
              userId,
              currentSelections.filter((id) => id !== d.id)
            );
          } else {
            // add node to selections
            yClientClickSelections.set(userId, [...currentSelections, d.id]);
          }

          // update visualization
          updateVisualization();
        }
      );

      function dragStarted(
        this: SVGElement,
        event: d3.D3DragEvent<SVGElement, D3Node, D3Node>,
        d: D3Node
      ) {
        // set dragged node id in yjs
        ySharedState.set('draggedNodeId', d.id);

        // raise the element to the front
        d3.select(this).raise().classed('active', true);
      }

      function dragged(
        this: SVGElement,
        event: d3.D3DragEvent<SVGElement, D3Node, D3Node>,
        d: D3Node
      ) {
        // update node position visually
        d.x = event.x;
        d.y = event.y;

        d3.select(this).attr('transform', `translate(${event.x},${event.y})`);

        // update connected links visually
        linkMerge
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

        // update position in yjs (in real-time)
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

        // update tooltip if this is the hovered node
        if (hoveredIds.includes(d.id)) {
          updateSelectedNodesInfo(d);
        }

        // also update cursor position in awareness during drag
        if (awareness) {
          // Get source event position - using sourceEvent which is the original DOM event
          const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());

          // adjust for tooltip width
          const x = svgX - tooltipWidth;
          const y = svgY;

          // update cursor position in awareness
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            awareness.setLocalState({
              ...currentState,
              cursor: {
                x: x,
                y: y,
                nodeId: d.id, // also track which node is being dragged
              },
            });
          }
        }
      }

      function dragEnded(this: SVGElement) {
        // clear dragged state in yjs
        ySharedState.set('draggedNodeId', null);

        // remove active class
        d3.select(this).classed('active', false);
      }

      // add drag behavior
      nodeMerge.call(
        d3
          .drag<SVGGElement, D3Node>()
          .on('start', dragStarted)
          .on('drag', dragged)
          .on('end', dragEnded)
      );

      // handle node hover
      nodeMerge.on(
        'mouseenter',
        function (this: Element, event: MouseEvent, d: D3Node) {
          // set single node hover
          ySharedState.set('hoveredNodeIds', [d.id]);

          // Get all highlighted nodes (from both hover and all clients' brush selections)
          const hoveredIds = [d.id];

          // Collect all brush selections from all clients
          const allBrushSelectedIds: string[] = [];
          yClientBrushSelections.forEach((nodeIds: string[]) => {
            allBrushSelectedIds.push(...nodeIds);
          });

          const allHighlightedIds = [
            ...new Set([...hoveredIds, ...allBrushSelectedIds]),
          ];
          const allHighlightedNodes = mapNodesToD3().filter((n) =>
            allHighlightedIds.includes(n.id)
          );

          // update tooltip with all highlighted nodes
          updateSelectedNodesInfo(allHighlightedNodes);
        }
      );

      nodeMerge.on('mouseleave', function (this: Element) {
        // clear hover selection
        ySharedState.set('hoveredNodeIds', []);

        // Update tooltip to show brush-selected and click-selected nodes from all clients
        const allBrushSelectedIds: string[] = [];
        yClientBrushSelections.forEach((nodeIds: string[]) => {
          allBrushSelectedIds.push(...nodeIds);
        });

        const allClickSelectedIds: string[] = [];
        yClientClickSelections.forEach((nodeIds: string[]) => {
          allClickSelectedIds.push(...nodeIds);
        });

        const allSelectedIds = [
          ...new Set([...allBrushSelectedIds, ...allClickSelectedIds]),
        ];

        if (allSelectedIds.length > 0) {
          const selectedNodes = mapNodesToD3().filter((n) =>
            allSelectedIds.includes(n.id)
          );
          updateSelectedNodesInfo(selectedNodes);
        } else {
          // No nodes selected at all
          updateSelectedNodesInfo([]);
        }
      });

      // check if initialization is needed
      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to update the tooltip content
    const updateSelectedNodesInfo = (nodes: D3Node[] | D3Node | null) => {
      // Convert single node to array or use empty array if null
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

      // Clear all text elements first
      tooltip.select('.tt-title').text('');
      tooltip.select('.tt-id').text('');
      tooltip.select('.tt-name').text('');
      tooltip.select('.tt-type').text('');
      tooltip.select('.tt-detail1').text('');
      tooltip.select('.tt-detail2').text('');

      // Always remove all list items no matter what state we're in
      tooltipContent.selectAll('.node-list-item').remove();

      if (nodesArray.length === 0) {
        // show default tooltip message when no nodes are selected
        tooltip.select('.tt-title').text('118th US Congress');
        tooltip.select('.tt-name').text('1st Session, Senate');
        tooltip.select('.tt-type').text('hover over nodes for details');
      } else {
        // multiple nodes - show count as title
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${
              nodesArray.length === 1 ? 'node' : 'nodes'
            } selected`
          );

        // Show up to 5 node names as a bullet list
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;

        // Define text wrapping width
        const maxWidth = tooltipWidth - 40; // Padding on both sides

        // Function to wrap text with proper line breaks
        const wrapText = (text: string, width: number): string[] => {
          const words = text.split(/\s+/);
          const lines: string[] = [];
          let line = '';

          for (const word of words) {
            const testLine = line + (line ? ' ' : '') + word;
            // Simple estimation of width since we can't measure SVG text easily
            if (testLine.length * 10 > width) {
              // Rough approximation
              lines.push(line);
              line = word;
            } else {
              line = testLine;
            }
          }

          if (line) {
            lines.push(line);
          }

          return lines;
        };

        // Track vertical position for next item
        let currentY = 35;
        const lineHeight = 30;

        // Add each name as a separate text element with proper spacing
        namesToShow.forEach((node) => {
          const nameWithBullet = `• ${node.name}`;
          const wrappedLines = wrapText(nameWithBullet, maxWidth);

          // Create a group for this list item
          const itemGroup = tooltipContent
            .append('g')
            .attr('class', 'node-list-item');

          // Add each line of wrapped text
          wrappedLines.forEach((line, lineIndex) => {
            itemGroup
              .append('text')
              .attr('x', 0)
              .attr('y', currentY + lineIndex * lineHeight)
              .attr('font-size', '25px')
              .attr('fill', '#cbd5e0')
              .attr('font-weight', '300')
              .text(line);
          });

          // Update vertical position for next item
          currentY += wrappedLines.length * lineHeight + 10; // Add spacing between items
        });

        // Show "and X more..." at the bottom of the list if needed
        if (additionalCount > 0) {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '22px')
            .attr('fill', '#cbd5e0')
            .attr('font-weight', '300')
            .attr('font-style', 'italic')
            .text(`and ${additionalCount} more...`);
        }
      }
    };

    // brush event handlers
    function brushStarted() {
      // clear only this client's brush selection
      if (userId) {
        yClientBrushSelections.set(userId, []);
      }
    }

    function brushed(event: d3.D3BrushEvent<unknown>) {
      if (!event.selection) {
        // Hide the custom brush rect when no selection
        localBrushRect.attr('visibility', 'hidden');
        // Clear this client's brush selection
        if (userId) {
          yClientBrushSelections.set(userId, []);
        }
        return;
      }

      // get current brush selection
      const [[x0, y0], [x1, y1]] = event.selection as [
        [number, number],
        [number, number]
      ];

      // Update cursor position during brush - this prevents cursor from freezing
      if (awareness && event.sourceEvent) {
        // Get source event position - using sourceEvent which is the original DOM event
        const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());

        // adjust for tooltip width
        const x = svgX - tooltipWidth;
        const y = svgY;

        // update cursor position in awareness
        const currentState = awareness.getLocalState() as AwarenessState;
        if (currentState) {
          awareness.setLocalState({
            ...currentState,
            cursor: {
              x: x,
              y: y,
              nodeId: currentState.cursor?.nodeId,
            },
            brushSelection: { x0, y0, x1, y1 },
          });
        }
      } else {
        // Fall back to just updating brush selection if no sourceEvent
        if (awareness) {
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            awareness.setLocalState({
              ...currentState,
              brushSelection: { x0, y0, x1, y1 },
            });
          }
        }
      }

      // Update the custom brush rectangle to exactly match remote brushes
      localBrushRect
        .attr('visibility', 'visible')
        .attr('x', x0)
        .attr('y', y0)
        .attr('width', x1 - x0)
        .attr('height', y1 - y0);

      // find nodes within the brush selection
      const selectedNodes = mapNodesToD3().filter((d) => {
        // adjust for tooltip width
        const nodeX = d.x || 0;
        const nodeY = d.y || 0;
        return nodeX >= x0 && nodeX <= x1 && nodeY >= y0 && nodeY <= y1;
      });

      // update this client's brush selection
      const selectedIds = selectedNodes.map((n) => n.id);
      if (userId) {
        yClientBrushSelections.set(userId, selectedIds);
      }

      // Get all highlighted nodes (from both hover and all clients' brush selections)
      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];

      // Collect all brush selections from all clients
      const allBrushSelectedIds: string[] = [];
      yClientBrushSelections.forEach((nodeIds: string[]) => {
        allBrushSelectedIds.push(...nodeIds);
      });

      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allBrushSelectedIds]),
      ];
      const allHighlightedNodes = mapNodesToD3().filter((n) =>
        allHighlightedIds.includes(n.id)
      );

      // update tooltip with all highlighted nodes
      updateSelectedNodesInfo(allHighlightedNodes);
    }

    function brushEnded(event: d3.D3BrushEvent<unknown>) {
      // Hide the custom brush rectangle
      localBrushRect.attr('visibility', 'hidden');

      // Clear this client's brush selection
      if (userId) {
        yClientBrushSelections.set(userId, []);
      }

      // Update cursor position and clear brush selection from awareness
      if (awareness && event.sourceEvent) {
        // Get source event position
        const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());

        // adjust for tooltip width
        const x = svgX - tooltipWidth;
        const y = svgY;

        // update cursor position while removing brush selection
        const currentState = awareness.getLocalState() as AwarenessState;
        if (currentState) {
          const stateWithoutBrush = {
            ...currentState,
            cursor: {
              x: x,
              y: y,
              nodeId: currentState.cursor?.nodeId,
            },
          };
          if ('brushSelection' in stateWithoutBrush) {
            delete stateWithoutBrush.brushSelection;
          }
          awareness.setLocalState(stateWithoutBrush);
        }
        brushGroup.call(brush.move, null);
        return;
      }

      // If selection remains, update cursor position
      if (awareness && event.sourceEvent) {
        // Get source event position
        const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());

        // adjust for tooltip width
        const x = svgX - tooltipWidth;
        const y = svgY;

        // update cursor position while keeping brush selection
        const currentState = awareness.getLocalState() as AwarenessState;
        if (currentState) {
          awareness.setLocalState({
            ...currentState,
            cursor: {
              x: x,
              y: y,
              nodeId: currentState.cursor?.nodeId,
            },
          });
        }
      }

      // Keep the custom brush rectangle visible at the end of interaction
      // No need to update it here as the last brushed event already positioned it correctly
    }

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing layout');

      const demNodes = nodes.filter(
        (n) => n.type === 'senator' && n.party === 'd'
      );
      const repNodes = nodes.filter(
        (n) => n.type === 'senator' && n.party === 'r'
      );
      const billNodes = nodes.filter((n) => n.type === 'bill');

      // define columns - adjusted for tooltip width and better centering
      const availableWidth = fixedWidth - tooltipWidth;
      const graphCenter = tooltipWidth + availableWidth * 0.18; // moved center point left
      const spread = availableWidth * 0.45; // significantly increased spread

      const leftColumnX = graphCenter - spread;
      const rightColumnX = graphCenter + spread;
      const centerColumnX = graphCenter;

      // adjust bill grid width to match new spread
      const billGridWidth = availableWidth * 0.4; // increased bill grid width
      const billGridHeight = fixedHeight * 0.85; // increased height for more vertical spread

      // set vertical spacing for each party with better vertical centering
      const verticalPadding = fixedHeight * 0.1; // reduced padding to use more vertical space
      const demSpacing =
        (fixedHeight - 2 * verticalPadding) / (demNodes.length + 1);
      const repSpacing =
        (fixedHeight - 2 * verticalPadding) / (repNodes.length + 1);

      // set vertical spacing for bills
      const billRows = Math.ceil(Math.sqrt(billNodes.length));
      const billCols = Math.ceil(billNodes.length / billRows);

      const billColSpacing = billGridWidth / (billCols || 1);
      const billRowSpacing = billGridHeight / (billRows || 1);

      // center grid
      const billGridLeft = centerColumnX - billGridWidth / 2;
      const billGridTop = fixedHeight * 0.15;

      // position democratic senators in left column
      demNodes.forEach((node, i) => {
        const verticalPos = verticalPadding + (i + 1) * demSpacing;
        node.x = leftColumnX;
        node.y = verticalPos;
      });

      // position republican senators in right column
      repNodes.forEach((node, i) => {
        const verticalPos = verticalPadding + (i + 1) * repSpacing;
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

      // then refine with force simulation
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      const links = mapLinksToD3(nodeMap);

      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(150) // increased link distance
        )
        .force('charge', d3.forceManyBody().strength(-300)) // increased repulsion
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
            .radius((d) => (d.type === 'senator' ? 35 : 30)) // increased collision radius
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

      // update visualization
      updateVisualization();
    };

    // animation frame related state
    let animationFrameId: number | null = null;
    let needsVisualizationUpdate = false;
    let needsCursorsUpdate = false;
    let needsPresenceUpdate = false;
    let needsRemoteBrushesUpdate = false;
    let lastPresenceUpdateTime = 0;

    // animation frame loop for device's native refresh rate
    const renderLoop = () => {
      const now = Date.now();

      // process visualization updates if needed
      if (needsVisualizationUpdate) {
        updateVisualization();
        needsVisualizationUpdate = false;
      }

      // process cursor updates if needed
      if (needsCursorsUpdate) {
        updateCursors();
        needsCursorsUpdate = false;
      }

      // process remote brushes updates if needed
      if (needsRemoteBrushesUpdate) {
        updateRemoteBrushes();
        needsRemoteBrushesUpdate = false;
      }

      // process presence updates if needed (throttled to once per second)
      if (needsPresenceUpdate && now - lastPresenceUpdateTime > 1000) {
        updatePresenceList();
        lastPresenceUpdateTime = now;
        needsPresenceUpdate = false;
      }

      // continue the animation loop
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    // start the animation loop
    animationFrameId = requestAnimationFrame(renderLoop);

    // observe awareness changes for user presence and cursors
    const awarenessObserver = () => {
      needsCursorsUpdate = true;
      needsPresenceUpdate = true;
      needsRemoteBrushesUpdate = true;

      // Check for transform updates from other clients
      if (awareness) {
        const states = Array.from(awareness.getStates().entries());

        // Get our current state and transform
        const localState = awareness.getLocalState() as AwarenessState;
        const localTimestamp = localState?.timestamp || 0;

        // Find the most recent transform from any client
        let mostRecentTransform: { x: number; y: number; k: number } | null =
          null;
        let mostRecentTimestamp = 0;

        for (const [, state] of states) {
          const awarenessState = state as AwarenessState;
          // Consider transforms from all clients, including our own
          if (awarenessState?.transform) {
            const timestamp = awarenessState.timestamp || 0;
            // Only update if this transform is newer than our local one
            if (timestamp > mostRecentTimestamp && timestamp > localTimestamp) {
              mostRecentTransform = awarenessState.transform;
              mostRecentTimestamp = timestamp;
            }
          }
        }

        // If we found a more recent transform, apply it
        if (mostRecentTransform && mostRecentTimestamp > localTimestamp) {
          const { x, y, k } = mostRecentTransform;

          // Create a new d3 transform
          const newTransform = d3.zoomIdentity.translate(x, y).scale(k);

          // Update local transform state
          setCurrentTransform(newTransform);

          // Apply transform to root group
          root.attr('transform', newTransform.toString());

          // Update zoom behavior to match new transform WITHOUT triggering the zoom event
          // This prevents an infinite loop of transform updates
          const zoomBehavior = zoom as d3.ZoomBehavior<SVGSVGElement, unknown>;
          if (zoomBehavior.transform) {
            zoomBehavior.transform(svg, newTransform);
          }

          // Scale cursors according to new transform
          cursorGroup
            .selectAll<SVGGElement, CursorData>('.cursor')
            .attr('transform', (d) => {
              const cursorX = d.state.cursor.x || 0;
              const cursorY = d.state.cursor.y || 0;

              // Transform cursor position to screen space
              const screenX = cursorX * k + x + tooltipWidth;
              const screenY = cursorY * k + y;

              return `translate(${screenX}, ${screenY}) scale(${1 / k})`;
            });
        }
      }
    };

    // create zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .filter((event) => {
        if (event.type === 'wheel') return true;
        if (event.type === 'mousedown' && event.shiftKey) return true;
        return false;
      })
      .on('zoom', (event) => {
        const transform = event.transform;

        // Update local state
        setCurrentTransform(transform);

        // Apply transform to root group
        root.attr('transform', transform.toString());

        // Update shared state through awareness
        if (awareness) {
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            const newState = {
              ...currentState,
              transform: {
                x: transform.x,
                y: transform.y,
                k: transform.k,
              },
              timestamp: Date.now(),
            };
            awareness.setLocalState(newState);
          }
        }

        // Scale and position cursors to maintain screen size and correct position
        cursorGroup
          .selectAll<SVGGElement, CursorData>('.cursor')
          .attr('transform', (d) => {
            const cursorX = d.state.cursor.x || 0;
            const cursorY = d.state.cursor.y || 0;

            // Transform cursor position to screen space
            const screenX = cursorX * transform.k + transform.x + tooltipWidth;
            const screenY = cursorY * transform.k + transform.y;

            return `translate(${screenX}, ${screenY}) scale(${
              1 / transform.k
            })`;
          });
      });

    // Apply zoom behavior to svg
    svg.call(zoom);

    // Update the mouse move handler to account for zoom transform
    svg.on('mousemove', function (event) {
      if (!awareness) return;

      // Get coordinates in SVG space
      const [svgX, svgY] = d3.pointer(event, svg.node());

      // Adjust for tooltip width and current transform
      const x = (svgX - tooltipWidth - currentTransform.x) / currentTransform.k;
      const y = (svgY - currentTransform.y) / currentTransform.k;

      // Update local awareness state with cursor position
      const currentState = awareness.getLocalState() as AwarenessState;
      if (currentState) {
        awareness.setLocalState({
          ...currentState,
          cursor: {
            x: x,
            y: y,
            nodeId: currentState.cursor?.nodeId,
          },
        });
      }
    });

    // initial update to show visualization
    updateVisualization();

    // initialize tooltip with default message
    updateSelectedNodesInfo([]);

    // set up observeDeep to update visualization when yjs data changes
    const observer = () => {
      // instead of updating immediately, mark that an update is needed
      needsVisualizationUpdate = true;
    };

    // observe all relevant yjs data
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientBrushSelections.observe(observer);
    yClientClickSelections.observe(observer);
    awareness.on('change', awarenessObserver);

    // cleanup observers and animation frame when component unmounts
    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      yClientBrushSelections.unobserve(observer);
      yClientClickSelections.unobserve(observer);
      awareness.off('change', awarenessObserver);

      // cancel the animation frame loop
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [syncStatus, doc, yNodes, yLinks, ySharedState, awareness, userId]);

  // placeholder rendering while waiting for sync
  if (!syncStatus) {
    return (
      <div
        style={{
          width: fixedWidth,
          height: fixedHeight,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#f0f0f0',
          overflow: 'hidden',
          borderRadius: '8px',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            maxWidth: '600px',
            background: 'rgba(255,255,255,0.8)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333',
            }}
          >
            senate visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555',
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              fontSize: '1rem',
              marginTop: '0.5rem',
              color: userColor,
              fontWeight: 'bold',
            }}
          >
            connected as: {userName}
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, ${userColor}, #2980b9)`,
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px',
              }}
            >
              <style>
                {`
                  @keyframes progressAnimation {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(250%); }
                  }
                `}
              </style>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // just return the container for d3
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

      {/* video feeds container */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          zIndex: 10,
        }}
      >
        <VideoFeeds roomId="senate-video-room" />
      </div>
    </div>
  );
};

export default SenateVisualization;
