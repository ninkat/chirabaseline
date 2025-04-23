import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import * as d3 from 'd3';
import senateData from '../assets/foafagain.json'; // import the json data

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string;

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
  const doc = useContext(YjsContext);
  // reference to the d3 container
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // add shared state with yjs
  const ySharedState = doc!.getMap<string | boolean | null>(
    'senateSharedState'
  );

  // reference to track initialization
  const isInitializedRef = useRef(false);

  // only keep syncStatus state (not d3 related)
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
    }, 10000); // every minute

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

    // run initial compaction after data is loaded
    setTimeout(() => {
      if (doc) {
        pruneYDoc(doc);
      }
    }, 5000); // wait 5 seconds after data load
  }, [syncStatus, doc, yNodes, yLinks]);

  // d3 visualization setup and update
  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;

    // only initialize once
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 visualization');

    // clear any existing content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg element
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: #f0f0f0; max-width: 100%; height: auto;');

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

    // create tooltip group - new d3 tooltip
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .style('visibility', 'hidden');

    // tooltip background
    tooltip
      .append('rect')
      .attr('rx', 4)
      .attr('ry', 4)
      .attr('width', 180)
      .attr('height', 120)
      .attr('fill', 'rgba(255, 255, 255, 0.85)')
      .attr('stroke', '#ccc');

    // tooltip content containers
    const tooltipContent = tooltip.append('g');
    tooltipContent
      .append('text')
      .attr('class', 'tt-id')
      .attr('y', 20)
      .attr('x', 10);
    tooltipContent
      .append('text')
      .attr('class', 'tt-name')
      .attr('y', 40)
      .attr('x', 10);
    tooltipContent
      .append('text')
      .attr('class', 'tt-type')
      .attr('y', 60)
      .attr('x', 10);
    tooltipContent
      .append('text')
      .attr('class', 'tt-detail1')
      .attr('y', 80)
      .attr('x', 10);
    tooltipContent
      .append('text')
      .attr('class', 'tt-detail2')
      .attr('y', 100)
      .attr('x', 10);

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
        .attr('stroke-width', (d) => (d.type === 'sponsor' ? 2 : 1))
        .attr('stroke-dasharray', (d) =>
          d.type === 'cosponsor' ? '3,3' : 'none'
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

      // create senator nodes
      nodeEnter
        .filter((d) => d.type === 'senator')
        .append('circle')
        .attr('r', 10)
        .attr('fill', (d) =>
          d.party === 'd' ? '#3498db' : d.party === 'r' ? '#e74c3c' : '#95a5a6'
        )
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5)
        .attr('class', 'node-shape');

      // create bill nodes
      nodeEnter
        .filter((d) => d.type === 'bill')
        .append('rect')
        .attr('x', -8)
        .attr('y', -8)
        .attr('width', 16)
        .attr('height', 16)
        .attr('fill', '#95a5a6')
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5)
        .attr('class', 'node-shape');

      // add text labels
      nodeEnter
        .append('text')
        .attr('dx', 15)
        .attr('dy', '.35em')
        .attr('font-size', '10px')
        .text((d) => d.name)
        .attr('opacity', 0)
        .attr('pointer-events', 'none');

      // merge nodes
      const nodeMerge = nodeEnter.merge(node);

      // update node positions
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      // get hover and drag state from yjs
      const hoveredId = ySharedState.get('hoveredNodeId') as string;
      const draggedId = ySharedState.get('draggedNodeId') as string;

      // reset all visual states
      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5);

      nodeMerge.select('text').attr('opacity', 0);

      // apply hover highlights
      if (hoveredId) {
        nodeMerge
          .filter((d: D3Node) => d.id === hoveredId)
          .select('.node-shape')
          .attr('stroke', '#f39c12')
          .attr('stroke-width', 3);

        nodeMerge
          .filter((d: D3Node) => d.id === hoveredId)
          .select('text')
          .attr('opacity', 1);

        // update tooltip content and position
        const hoveredNode = nodes.find((n) => n.id === hoveredId);
        if (hoveredNode) {
          updateTooltip(hoveredNode);
        }
      } else {
        // hide tooltip when no node is hovered
        tooltip.style('visibility', 'hidden');
      }

      // apply drag highlights
      if (draggedId) {
        nodeMerge
          .filter((d: D3Node) => d.id === draggedId)
          .select('.node-shape')
          .attr('stroke', '#f39c12')
          .attr('stroke-width', 3);
      }

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
        if (hoveredId === d.id) {
          updateTooltip(d);
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
        function (this: Element, _: MouseEvent, d: D3Node) {
          // set hovered node id in yjs
          ySharedState.set('hoveredNodeId', d.id);
        }
      );

      nodeMerge.on('mouseleave', function (this: Element) {
        // clear hovered node id in yjs
        ySharedState.set('hoveredNodeId', null);
      });

      // check if initialization is needed
      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to update the d3 tooltip
    const updateTooltip = (node: D3Node) => {
      tooltip.style('visibility', 'visible');

      // position tooltip in top-left corner
      tooltip.attr('transform', 'translate(10,10)');

      // update content
      tooltip.select('.tt-id').text(`id: ${node.id}`);
      tooltip.select('.tt-name').text(`name: ${node.name}`);
      tooltip.select('.tt-type').text(`type: ${node.type}`);

      if (node.type === 'senator') {
        tooltip
          .select('.tt-detail1')
          .text(`party: ${node.party?.toUpperCase()}`);
        tooltip.select('.tt-detail2').text(`state: ${node.state}`);
      } else if (node.type === 'bill') {
        tooltip.select('.tt-detail1').text(`status: ${node.status}`);
        tooltip
          .select('.tt-detail2')
          .text(
            `pos: (${Math.round(node.x || 0)}, ${Math.round(node.y || 0)})`
          );
      }
    };

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing layout');

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

      // define columns
      const leftColumnX = fixedWidth * 0.2;
      const rightColumnX = fixedWidth * 0.8;
      const centerColumnX = fixedWidth * 0.5;

      // set vertical spacing for each party
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

      // update visualization
      updateVisualization();
    };

    // initial update
    updateVisualization();

    // set up observeDeep to update visualization when yjs data changes
    const observer = () => {
      updateVisualization();
    };

    // observe all relevant yjs data
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);

    // cleanup observers when component unmounts
    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
    };
  }, [syncStatus, doc, yNodes, yLinks, ySharedState]);

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
            Senate Visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555',
            }}
          >
            Waiting for synchronization...
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
                background: 'linear-gradient(to right, #3498db, #2980b9)',
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
    </div>
  );
};

export default SenateVisualization;
