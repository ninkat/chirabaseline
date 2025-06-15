import React, { useEffect, useRef, useContext, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import { YjsContext } from '../../context/YjsContext';
// define a non-null version of geojsonproperties for extension
type definedgeojsonproperties = Exclude<GeoJsonProperties, null>;

interface CountryProperties extends definedgeojsonproperties {
  name: string;
}

// simplified topojson types
interface TopoGeometry {
  type: string;
  [key: string]: unknown;
}

interface TopoGeometryCollection {
  type: 'GeometryCollection';
  geometries: TopoGeometry[];
}

interface WorldTopology {
  type: 'Topology';
  arcs: unknown[];
  objects: {
    countries: TopoGeometryCollection;
  };
}

// define airport data structure
interface Airport {
  IATA: string;
  'Airport Name': string;
  City: string;
  Latitude: number;
  Longitude: number;
}

// define flight data structure
interface Flight {
  id: number;
  origin: string;
  destination: string;
  price: number;
  duration: number; // assuming duration is in hours
  date: string; // date string format 'yyyy-mm-dd'
  airline: {
    code: string;
    name: string;
    continent: string;
  };
}

// define puzzle description structure
interface PuzzleDescription {
  title: string;
  description: string;
  friends: {
    user_1: {
      name: string;
      description: string;
      origin_airport: string;
      available_dates: string[];
      preferred_airlines: string[];
      max_budget: number;
    };
    user_2: {
      name: string;
      description: string;
      origin_airport: string;
      available_dates: string[];
      preferred_airlines: string[];
      max_budget: number;
    };
  };
  constraints: {
    must_arrive_same_day: boolean;
    both_must_afford: boolean;
    both_must_be_available: boolean;
    overlap_dates: string[];
  };
  evaluation_criteria: {
    valid_solution: {
      same_destination: string;
      same_date: string;
      within_budgets: string;
      date_availability: string;
      airline_preferences: string;
    };
  };
  hints: {
    overlap_dates: string;
    budget_consideration: string;
    airline_overlap: string;
    multiple_solutions: string;
  };
}

// validation result interface
interface ValidationResult {
  isValid: boolean;
  failedCriteria: string[];
}

// yjs shared value types
type WorldMapStateValue = string | number | boolean | null; // arrays will be y.array, not directly in map value for this type

// simple transform function type
type GetCurrentTransformFn = () => { scale: number; x: number; y: number };

// props interface for the WorldMap component
interface WorldMapProps {
  getCurrentTransformRef?: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// constants for styling
const totalWidth = 1280;
const totalHeight = 720;
const defaultFill = 'rgba(170, 170, 170, 0.6)';
const strokeColor = '#fff';
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (3 / 4);

// constants for airport stylings
const airportRadius = 25;
const airportFill = '#1E90FF';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1.5;
const airportHighlightStroke = '#FFD580';
const airportHighlightStrokeWidth = 4;
const airportSelectedStrokeWidth = 4;
const airportSelectedLeftStroke = '#FFB6C1';
const airportSelectedRightStroke = '#ADD8E6';

// constants for line styling
const lineColor = 'rgba(116, 100, 139, 0.9)';
const lineWidth = 4;
const pinnedFlightColor = '#32CD32'; // bright green for pinned flights

// constants for panel styling
const panelWidth = totalWidth / 4;
const panelBackground = 'rgba(33, 33, 33, 0.2)';
const panelTextColor = 'white';

// awareness states interface
interface AwarenessState {
  user: {
    name: string;
    color: string;
    id: string;
  };
  cursor: {
    x: number;
    y: number;
    airportIATA?: string;
  };
  brushSelection?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    mode: 'origin' | 'destination'; // track which mode the brush was in
  };
  timestamp?: number;
}

// cursor data interface
interface CursorData {
  state: AwarenessState;
  clientId: number;
  isLocal: boolean;
}

const TravelTask: React.FC<WorldMapProps> = ({ getCurrentTransformRef }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null); // main group for d3 transformations
  const panelSvgRef = useRef<SVGSVGElement>(null); // ref for the info panel svg
  const animationFrameRef = useRef<number | null>(null);
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());
  const updateBrushInteractionsRef = useRef<(() => void) | null>(null);

  // refs for brush update throttling
  const brushUpdateFrameRef = useRef<number | null>(null);
  const pendingBrushUpdateRef = useRef<{
    mode: 'origin' | 'destination';
    coordinates: { x0: number; y0: number; x1: number; y1: number };
    selectedIATAs: string[];
  } | null>(null);

  // get doc from yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const awareness = yjsContext?.awareness;

  // yjs shared state maps and arrays
  const yWorldMapState = doc?.getMap<WorldMapStateValue>('worldMapGlobalState');
  const yHoveredAirportIATAsLeft = doc?.getArray<string>(
    'worldMapHoveredIATAsLeft'
  );
  const yHoveredAirportIATAsRight = doc?.getArray<string>(
    'worldMapHoveredIATAsRight'
  );
  const ySelectedAirportIATAsLeft = doc?.getArray<string>(
    'worldMapSelectedIATAsLeft'
  );
  const ySelectedAirportIATAsRight = doc?.getArray<string>(
    'worldMapSelectedIATAsRight'
  );
  const yPanelState = doc?.getMap<WorldMapStateValue>('worldMapPanelState'); // panel svg state
  const yHoveredFlights = doc?.getArray<number>('worldMapHoveredFlights'); // track hovered flight ids globally
  const ySelectedFlights = doc?.getArray<number>('worldMapSelectedFlights'); // track pinned/selected flight ids (global)

  // add brush selections map - maps userId to array of selected airport iatas
  const yClientBrushSelectionsLeft = doc?.getMap<string[]>(
    'worldMapClientBrushSelectionsLeft'
  );
  const yClientBrushSelectionsRight = doc?.getMap<string[]>(
    'worldMapClientBrushSelectionsRight'
  );

  // add brush coordinates map - maps userId to brush selection coordinates
  const yClientBrushCoordsLeft = doc?.getMap<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }>('worldMapClientBrushCoordsLeft');
  const yClientBrushCoordsRight = doc?.getMap<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }>('worldMapClientBrushCoordsRight');

  // user state management
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

  // ref to track current transform from yjs or local updates before sync
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // track current d3 transform for zoom/pan (similar to SenateVisualization)
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );

  // track current hover mode without causing rerenders
  const hoverModeRef = useRef<'origin' | 'destination'>('origin');
  const modeIndicatorRef = useRef<HTMLDivElement>(null);

  // function to update mode indicator
  const updateModeIndicator = () => {
    if (modeIndicatorRef.current) {
      const isOriginMode = hoverModeRef.current === 'origin';
      modeIndicatorRef.current.textContent = isOriginMode
        ? 'Origins'
        : 'Destinations';
      modeIndicatorRef.current.style.background = isOriginMode
        ? 'rgba(232, 27, 35, 0.9)' // red for origins
        : 'rgba(0, 174, 243, 0.9)'; // blue for destinations
    }
  };

  // ref for scroll drag state for flights list
  const scrollDragStateRef = useRef<{
    left: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
    right: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
  }>({
    left: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
    right: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
  });

  // state for sync status
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // state for flight data (loaded once)
  const allFlights = useRef<Flight[]>([]);
  // all airport data loaded once, used to map iatas to airport objects
  const allAirports = useRef<Airport[]>([]);
  // puzzle description data
  const puzzleDescription = useRef<PuzzleDescription | null>(null);

  // state for validation results
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    isValid: false,
    failedCriteria: [],
  });

  // ref to track previous filter state for scroll reset detection
  const previousFilterStateRef = useRef<{
    leftIATAs: string[];
    rightIATAs: string[];
  }>({
    leftIATAs: [],
    rightIATAs: [],
  });

  // validation function
  const validateSelectedFlights = (flights: Flight[]): ValidationResult => {
    if (!puzzleDescription.current || flights.length !== 2) {
      return { isValid: false, failedCriteria: [] };
    }

    const puzzle = puzzleDescription.current;
    const [flight1, flight2] = flights;

    // helper function to validate a specific assignment
    const validateAssignment = (
      user1Flight: Flight,
      user2Flight: Flight
    ): string[] => {
      const assignmentFailures: string[] = [];

      // check both flights originate from the same airport as users
      if (user1Flight.origin !== puzzle.friends.user_1.origin_airport) {
        assignmentFailures.push(
          `flight doesn't originate from user 1's home airport`
        );
      }
      if (user2Flight.origin !== puzzle.friends.user_2.origin_airport) {
        assignmentFailures.push(
          `flight doesn't originate from user 2's home airport`
        );
      }

      // check same destination
      if (user1Flight.destination !== user2Flight.destination) {
        assignmentFailures.push(
          puzzle.evaluation_criteria.valid_solution.same_destination
        );
      }

      // check same date
      if (user1Flight.date !== user2Flight.date) {
        assignmentFailures.push(
          puzzle.evaluation_criteria.valid_solution.same_date
        );
      }

      // check within budgets
      if (user1Flight.price > puzzle.friends.user_1.max_budget) {
        assignmentFailures.push(
          `user 1's flight exceeds $${puzzle.friends.user_1.max_budget} budget`
        );
      }
      if (user2Flight.price > puzzle.friends.user_2.max_budget) {
        assignmentFailures.push(
          `user 2's flight exceeds $${puzzle.friends.user_2.max_budget} budget`
        );
      }

      // check date availability for both users
      if (!puzzle.friends.user_1.available_dates.includes(user1Flight.date)) {
        assignmentFailures.push('date not available for user 1');
      }
      if (!puzzle.friends.user_2.available_dates.includes(user2Flight.date)) {
        assignmentFailures.push('date not available for user 2');
      }

      // check airline preferences
      if (
        !puzzle.friends.user_1.preferred_airlines.includes(
          user1Flight.airline.code
        )
      ) {
        assignmentFailures.push('airline not preferred by user 1');
      }
      if (
        !puzzle.friends.user_2.preferred_airlines.includes(
          user2Flight.airline.code
        )
      ) {
        assignmentFailures.push('airline not preferred by user 2');
      }

      return assignmentFailures;
    };

    // try both possible assignments
    const assignment1Failures = validateAssignment(flight1, flight2); // user 1 gets flight1, user 2 gets flight2
    const assignment2Failures = validateAssignment(flight2, flight1); // user 1 gets flight2, user 2 gets flight1

    // if either assignment works (has no failures), the solution is valid
    if (assignment1Failures.length === 0 || assignment2Failures.length === 0) {
      return { isValid: true, failedCriteria: [] };
    }

    // if both assignments fail, return the failures from the first assignment
    // (we could combine both, but that might be confusing)
    return {
      isValid: false,
      failedCriteria: assignment1Failures,
    };
  };

  // set up the getCurrentTransform function for interaction handlers
  useEffect(() => {
    if (getCurrentTransformRef) {
      getCurrentTransformRef.current = () => ({
        scale: currentTransform.k,
        x: currentTransform.x,
        y: currentTransform.y,
      });

      // cleanup function to clear the ref when component unmounts
      return () => {
        if (getCurrentTransformRef) {
          getCurrentTransformRef.current = null;
        }
      };
    }
  }, [getCurrentTransformRef, currentTransform]);

  // track sync status (simple timeout approach)
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      setSyncStatus(true);
      console.log('[worldmap] assuming sync after timeout');
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

  // keyboard event handler for control key toggle
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ignore if already processed or if modifier keys are held
      if (event.repeat || event.metaKey || event.altKey || event.shiftKey)
        return;

      if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
        // transfer hover state to the other side when switching modes
        const currentMode = hoverModeRef.current;
        const currentHoverArray =
          currentMode === 'origin'
            ? yHoveredAirportIATAsLeft
            : yHoveredAirportIATAsRight;
        const targetHoverArray =
          currentMode === 'origin'
            ? yHoveredAirportIATAsRight
            : yHoveredAirportIATAsLeft;
        const targetSelectedArray =
          currentMode === 'origin'
            ? ySelectedAirportIATAsRight
            : ySelectedAirportIATAsLeft;

        if (currentHoverArray && targetHoverArray && targetSelectedArray) {
          const currentHoveredIATAs = currentHoverArray.toArray();
          const targetSelectedIATAs = targetSelectedArray.toArray();

          // clear current hover
          if (currentHoveredIATAs.length > 0) {
            currentHoverArray.delete(0, currentHoverArray.length);
          }

          // transfer hover to other side only if not already selected there
          if (currentHoveredIATAs.length > 0) {
            const transferableIATAs = currentHoveredIATAs.filter(
              (iata) => !targetSelectedIATAs.includes(iata)
            );
            if (transferableIATAs.length > 0) {
              // clear target hover first
              if (targetHoverArray.length > 0) {
                targetHoverArray.delete(0, targetHoverArray.length);
              }
              // add transferable hovers
              transferableIATAs.forEach((iata) => {
                targetHoverArray.push([iata]);
              });
            }
          }
        }

        // toggle mode on control key press
        hoverModeRef.current =
          hoverModeRef.current === 'origin' ? 'destination' : 'origin';
        updateModeIndicator();

        // update brush interactions based on new mode
        if (updateBrushInteractionsRef.current) {
          updateBrushInteractionsRef.current();
        }
      }
    };

    // add event listener to document
    document.addEventListener('keydown', handleKeyDown);

    // initial mode indicator update
    updateModeIndicator();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // effect to monitor selected flights and trigger validation
  useEffect(() => {
    if (!ySelectedFlights) return;

    const checkValidation = () => {
      const selectedFlightIds = ySelectedFlights.toArray();

      if (
        selectedFlightIds.length === 2 &&
        puzzleDescription.current &&
        allFlights.current.length > 0
      ) {
        const selectedFlights = selectedFlightIds
          .map((id) => allFlights.current.find((f) => f.id === id))
          .filter(Boolean) as Flight[];

        if (selectedFlights.length === 2) {
          const result = validateSelectedFlights(selectedFlights);
          setValidationResult(result);
        }
      } else if (selectedFlightIds.length !== 2) {
        // only reset to default message if not exactly 2 flights selected
        setValidationResult({ isValid: false, failedCriteria: [] });
      }
      // if we have 2 flights but puzzle data isn't loaded yet, keep current validation state
    };

    ySelectedFlights.observeDeep(checkValidation);
    checkValidation(); // initial check

    return () => ySelectedFlights.unobserveDeep(checkValidation);
  }, [ySelectedFlights]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus || !yWorldMapState || !svgRef.current) return;

    const updateLocalTransform = () => {
      const scale = (yWorldMapState.get('zoomScale') as number) || 1;
      const x = (yWorldMapState.get('panX') as number) || 0;
      const y = (yWorldMapState.get('panY') as number) || 0;

      // always update on first run (when joining), then check for meaningful differences
      const isFirstSync =
        transformRef.current.k === 1 &&
        transformRef.current.x === 0 &&
        transformRef.current.y === 0;
      const scaleDiff = Math.abs(scale - transformRef.current.k);
      const xDiff = Math.abs(x - transformRef.current.x);
      const yDiff = Math.abs(y - transformRef.current.y);

      if (isFirstSync || scaleDiff > 0.001 || xDiff > 0.1 || yDiff > 0.1) {
        transformRef.current = { k: scale, x, y };

        // update the d3 transform state
        const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
        setCurrentTransform(newTransform);

        // get the svg and root elements
        const svg = d3.select(svgRef.current);
        const root = svg.select('g.root');

        if (!root.empty()) {
          // apply transform to root group
          root.attr('transform', newTransform.toString());

          // update zoom behavior to match new transform without triggering the zoom event
          // this is critical to prevent feedback loops
          svg.property('__zoom', newTransform);

          // also re-apply styles that depend on scale
          adjustStylesForTransform(scale);

          // redraw lines with new scale if projection is available
          if (projectionRef.current) {
            redrawAllLinesFromYjs(projectionRef.current);
          }
        }
      }
    };

    yWorldMapState.observe(updateLocalTransform);
    updateLocalTransform(); // initial sync

    return () => yWorldMapState.unobserve(updateLocalTransform);
  }, [doc, syncStatus, yWorldMapState]);

  // function to get pair key for origin-destination
  const getPairKey = (origin: string, destination: string) =>
    `${origin}->${destination}`;

  // function to find airport data by iata code
  const getAirportByIATA = (iata: string): Airport | undefined => {
    return allAirports.current.find((ap) => ap.IATA === iata);
  };

  // function to adjust styles based on transform (e.g., stroke widths)
  const adjustStylesForTransform = (scale: number) => {
    if (
      !gRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight
    )
      return;
    const svgRoot = d3.select(gRef.current);

    // collect all brush selections from all clients
    const allBrushLeftIATAs: string[] = [];
    const allBrushRightIATAs: string[] = [];

    if (yClientBrushSelectionsLeft) {
      yClientBrushSelectionsLeft.forEach((iatas: string[]) => {
        allBrushLeftIATAs.push(...iatas);
      });
    }

    if (yClientBrushSelectionsRight) {
      yClientBrushSelectionsRight.forEach((iatas: string[]) => {
        allBrushRightIATAs.push(...iatas);
      });
    }

    svgRoot
      .selectAll('circle.airport')
      .attr('r', airportRadius / scale)
      .attr('stroke-width', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft || isSelectedRight) {
          return airportSelectedStrokeWidth / scale;
        }

        // check for hover or brush
        const isHovered =
          yHoveredAirportIATAsLeft.toArray().includes(airportIATA) ||
          yHoveredAirportIATAsRight.toArray().includes(airportIATA);
        const isBrushed =
          allBrushLeftIATAs.includes(airportIATA) ||
          allBrushRightIATAs.includes(airportIATA);

        if (isHovered || isBrushed) {
          return airportHighlightStrokeWidth / scale;
        }
        return airportStrokeWidth / scale;
      })
      .attr('stroke', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft) {
          return airportSelectedLeftStroke;
        }
        if (isSelectedRight) {
          return airportSelectedRightStroke;
        }

        // check for hover or brush
        const isHoveredLeft = yHoveredAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isHoveredRight = yHoveredAirportIATAsRight
          .toArray()
          .includes(airportIATA);
        const isBrushedLeft = allBrushLeftIATAs.includes(airportIATA);
        const isBrushedRight = allBrushRightIATAs.includes(airportIATA);

        if (
          isHoveredLeft ||
          isHoveredRight ||
          isBrushedLeft ||
          isBrushedRight
        ) {
          return airportHighlightStroke;
        }
        return airportStroke;
      })
      .attr('fill', airportFill); // ensure fill is reset/set

    activeLinesByPair.current.forEach((line, pairKey) => {
      d3.select(line).attr('stroke-width', lineWidth / scale);

      // extract origin and destination from pair key (format: "ORIGIN->DESTINATION")
      const [originIATA, destinationIATA] = pairKey.split('->');

      // check if this line corresponds to any selected (pinned) flight
      const selectedFlights = ySelectedFlights?.toArray() || [];
      const selectedFlightData = selectedFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isPinned = selectedFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // check if this line corresponds to any hovered flight
      const hoveredFlights = yHoveredFlights?.toArray() || [];
      const hoveredFlightData = hoveredFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isHighlighted = hoveredFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // use pinned color if pinned, highlight color if highlighted, otherwise default
      const strokeColor = isPinned
        ? pinnedFlightColor
        : isHighlighted
        ? airportHighlightStroke
        : lineColor;
      d3.select(line).attr('stroke', strokeColor);
    });
  };

  // function to draw line between airports by iata codes
  const drawAirportLineByIATAs = (
    originIATA: string,
    destinationIATA: string,
    projection: d3.GeoProjection,
    highlight = false,
    pinned = false
  ) => {
    if (!gRef.current || !projection) return;

    const originAirport = getAirportByIATA(originIATA);
    const destAirport = getAirportByIATA(destinationIATA);

    if (!originAirport || !destAirport) return;

    const pairKey = getPairKey(originIATA, destinationIATA);
    if (activeLinesByPair.current.has(pairKey)) return;

    const originCoords = projection([
      originAirport.Longitude,
      originAirport.Latitude,
    ]);
    const destCoords = projection([
      destAirport.Longitude,
      destAirport.Latitude,
    ]);

    if (!originCoords || !destCoords) return;

    // calculate arc control point for curved flight path
    const midX = (originCoords[0] + destCoords[0]) / 2;
    const midY = (originCoords[1] + destCoords[1]) / 2;

    // calculate distance between points to determine arc height
    const distance = Math.sqrt(
      Math.pow(destCoords[0] - originCoords[0], 2) +
        Math.pow(destCoords[1] - originCoords[1], 2)
    );

    // arc height is proportional to distance (but capped for very long distances)
    const arcHeight = Math.min(distance * 0.2, 100);

    // control point is above the midpoint
    const controlX = midX;
    const controlY = midY - arcHeight;

    // create quadratic curve path
    const pathData = `M ${originCoords[0]} ${originCoords[1]} Q ${controlX} ${controlY} ${destCoords[0]} ${destCoords[1]}`;

    // use pinned color if pinned, highlight color if highlighted, otherwise use default line color
    const strokeColor = pinned
      ? pinnedFlightColor
      : highlight
      ? airportHighlightStroke
      : lineColor;

    const line = d3
      .select(gRef.current)
      .append('path')
      .attr('d', pathData)
      .attr('stroke', strokeColor)
      .attr('stroke-width', lineWidth / transformRef.current.k) // use current transform
      .attr('fill', 'none')
      .style('stroke-linecap', 'round')
      .style('pointer-events', 'none'); // make flight lines uninteractable

    activeLinesByPair.current.set(pairKey, line.node()!);
  };

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to redraw all lines based on yjs hovered airport iatas
  const redrawAllLinesFromYjs = (projection: d3.GeoProjection | null) => {
    if (
      !projection ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight
    )
      return;
    clearAllLines();

    // first draw pinned flight lines (always visible in green)
    drawPinnedFlightLines(projection);

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();

    // collect all brush selections from all clients
    const allBrushLeftIATAs: string[] = [];
    const allBrushRightIATAs: string[] = [];

    if (yClientBrushSelectionsLeft) {
      yClientBrushSelectionsLeft.forEach((iatas: string[]) => {
        allBrushLeftIATAs.push(...iatas);
      });
    }

    if (yClientBrushSelectionsRight) {
      yClientBrushSelectionsRight.forEach((iatas: string[]) => {
        allBrushRightIATAs.push(...iatas);
      });
    }

    // combine selected, hovered, and brushed for line drawing
    const effectiveLeftIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs, ...allBrushLeftIATAs])
    );
    const effectiveRightIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...allBrushRightIATAs,
      ])
    );

    // get hovered flights to determine which routes should be highlighted
    const hoveredFlights = yHoveredFlights?.toArray() || [];
    const hoveredFlightData = hoveredFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    effectiveLeftIATAs.forEach((originIATA) => {
      effectiveRightIATAs.forEach((destIATA) => {
        if (originIATA !== destIATA) {
          // prevent self-loops if an airport is somehow in both effective lists

          // check if this route corresponds to any hovered flight
          const isHighlighted = hoveredFlightData.some(
            (flight) =>
              flight.origin === originIATA && flight.destination === destIATA
          );

          drawAirportLineByIATAs(
            originIATA,
            destIATA,
            projection,
            isHighlighted
          );
        }
      });
    });
  };

  // ref for cursor overlay div
  const cursorOverlayRef = useRef<HTMLDivElement>(null);

  // function to update user cursors
  const updateCursors = () => {
    if (!awareness || !cursorOverlayRef.current) return;

    const cursorStates = Array.from(awareness.getStates().entries())
      .map(([clientId, state]) => ({
        clientId,
        state: state as AwarenessState,
        isLocal:
          state &&
          (state as AwarenessState).user &&
          (state as AwarenessState).user.id === userId,
      }))
      .filter(
        (item) => item.state && item.state.cursor && item.state.user
      ) as CursorData[];

    // clear existing cursors
    cursorOverlayRef.current.innerHTML = '';

    // create cursor elements
    cursorStates.forEach((cursorData) => {
      if (!cursorOverlayRef.current) return;

      const cursorDiv = document.createElement('div');
      cursorDiv.style.position = 'absolute';
      cursorDiv.style.left = `${cursorData.state.cursor.x}px`;
      cursorDiv.style.top = `${cursorData.state.cursor.y}px`;
      cursorDiv.style.pointerEvents = 'none';
      cursorDiv.style.zIndex = '9999';
      cursorDiv.className = cursorData.isLocal
        ? 'local-cursor'
        : 'remote-cursor';

      // create cursor svg
      const cursorSvg = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      cursorSvg.setAttribute('width', '24');
      cursorSvg.setAttribute('height', '24');
      cursorSvg.style.overflow = 'visible';

      // cursor shape
      const cursorPath = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      );
      cursorPath.setAttribute('d', 'M0,0 L24,12 L12,12 L12,24 L0,0');
      cursorPath.setAttribute('fill', cursorData.state.user.color);
      cursorPath.setAttribute('stroke', '#000');
      cursorPath.setAttribute('stroke-width', '2');
      cursorSvg.appendChild(cursorPath);

      cursorDiv.appendChild(cursorSvg);

      // add user name only for remote cursors
      if (!cursorData.isLocal) {
        const labelDiv = document.createElement('div');
        labelDiv.style.position = 'absolute';
        labelDiv.style.left = '23px';
        labelDiv.style.top = '18px';
        labelDiv.style.background = cursorData.state.user.color;
        labelDiv.style.color = '#ffffff';
        labelDiv.style.padding = '4px 8px';
        labelDiv.style.borderRadius = '4px';
        labelDiv.style.fontSize = '14px';
        labelDiv.style.fontWeight = '500';
        labelDiv.style.fontFamily = 'system-ui, sans-serif';
        labelDiv.style.whiteSpace = 'nowrap';
        labelDiv.textContent = cursorData.state.user.name;
        cursorDiv.appendChild(labelDiv);
      }

      cursorOverlayRef.current.appendChild(cursorDiv);
    });
  };

  // function to update the info panel with hovered/selected airports from yjs
  const updateInfoPanelFromYjs = () => {
    if (
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !panelSvgRef.current ||
      !yPanelState
    )
      return;

    const panelSvg = d3.select(panelSvgRef.current);

    // clear existing content
    panelSvg.selectAll('g.panel-content').remove();

    const contentGroup = panelSvg.append('g').attr('class', 'panel-content');

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();

    // collect all brush selections from all clients
    const allBrushLeftIATAs: string[] = [];
    const allBrushRightIATAs: string[] = [];

    if (yClientBrushSelectionsLeft) {
      yClientBrushSelectionsLeft.forEach((iatas: string[]) => {
        allBrushLeftIATAs.push(...iatas);
      });
    }

    if (yClientBrushSelectionsRight) {
      yClientBrushSelectionsRight.forEach((iatas: string[]) => {
        allBrushRightIATAs.push(...iatas);
      });
    }

    // display logic: selected items are primary. hovered and brushed items are secondary if not selected.
    // for flight filtering, combine selected, hovered, and brushed items (pins are sticky hovers, brushes are multi-hovers)
    const leftFilterIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs, ...allBrushLeftIATAs])
    );
    const rightFilterIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...allBrushRightIATAs,
      ])
    );

    // check if filter state has changed and reset scroll position if needed
    const previousFilterState = previousFilterStateRef.current;
    const filterStateChanged =
      JSON.stringify(leftFilterIATAs.sort()) !==
        JSON.stringify(previousFilterState.leftIATAs.sort()) ||
      JSON.stringify(rightFilterIATAs.sort()) !==
        JSON.stringify(previousFilterState.rightIATAs.sort());

    if (filterStateChanged && yPanelState) {
      yPanelState.set('flightsScrollY', 0);
      previousFilterStateRef.current = {
        leftIATAs: [...leftFilterIATAs],
        rightIATAs: [...rightFilterIATAs],
      };
    }

    let currentFilteredFlights: Flight[] = [];
    if (leftFilterIATAs.length > 0 && rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter(
        (flight) =>
          leftFilterIATAs.includes(flight.origin) &&
          rightFilterIATAs.includes(flight.destination)
      );
    } else if (leftFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        leftFilterIATAs.includes(flight.origin)
      );
    } else if (rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        rightFilterIATAs.includes(flight.destination)
      );
    }

    // svg panel layout constants
    const padding = 6;
    const sectionGap = 12; // consistent spacing between all sections
    // const sectionHeight = (totalHeight - 2 * padding - 2 * sectionGap) / 3; // properly account for gaps between sections // removing the 1/3 rule

    // calculate fixed height for origins/destinations boxes to fit exactly 4 entries
    const titleHeight = 20; // height for "origins"/"destinations" title
    const itemHeight = 35; // height per airport item
    const maxItems = 4; // exactly 4 entries
    const topPadding = 10; // padding above the boxes
    const bottomPadding = 10; // padding below the boxes to match top
    const boxHeight = titleHeight + 25 + maxItems * itemHeight - bottomPadding; // 25px padding after title, reduced by bottom padding for balance

    // section 1: current selections
    const selectionsY = padding;
    const selectionsGroup = contentGroup
      .append('g')
      .attr('class', 'selections-section');

    // origins and destinations boxes
    const boxY = selectionsY + topPadding; // use the defined topPadding constant
    // const boxHeight = sectionHeight - 10; // adjusted for removed title // removing this line since we have fixed height now
    const boxWidth = (panelWidth - 2 * padding - 8) / 2; // wider boxes with smaller gap

    // origins box background
    selectionsGroup
      .append('rect')
      .attr('x', padding)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.12)')
      .attr('rx', 6)
      .attr('ry', 6);

    // origins title
    selectionsGroup
      .append('text')
      .attr('x', padding + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Origins');

    // origins content
    const uniqueLeftDisplayIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs, ...allBrushLeftIATAs])
    );
    const leftAirportsToShow = uniqueLeftDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const maxAirportsToShow = 3;
    const leftToShow = leftAirportsToShow.slice(0, maxAirportsToShow);
    const leftRemaining = leftAirportsToShow.length - leftToShow.length;

    leftToShow.forEach((airport, index) => {
      const isSelected = selectedLeftIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedLeftStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (leftRemaining > 0) {
      const remainingY = boxY + 45 + leftToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4) // reduced padding from 8 to 4
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8) // increased width from -16 to -8
        .attr('height', 30)
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${leftRemaining} more...`);
    }

    // destinations box background (side by side with origins)
    const destBoxX = padding + boxWidth + 8; // 8px gap between boxes
    selectionsGroup
      .append('rect')
      .attr('x', destBoxX)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.15)')
      .attr('rx', 6)
      .attr('ry', 6);

    // destinations title
    selectionsGroup
      .append('text')
      .attr('x', destBoxX + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Destinations');

    // destinations content
    const uniqueRightDisplayIATAs = Array.from(
      new Set([
        ...selectedRightIATAs,
        ...hoveredRightIATAs,
        ...allBrushRightIATAs,
      ])
    );
    const rightAirportsToShow = uniqueRightDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const rightToShow = rightAirportsToShow.slice(0, maxAirportsToShow);
    const rightRemaining = rightAirportsToShow.length - rightToShow.length;

    rightToShow.forEach((airport, index) => {
      const isSelected = selectedRightIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedRightStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (rightRemaining > 0) {
      const remainingY = boxY + 45 + rightToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4)
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8)
        .attr('height', 30)
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10)
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${rightRemaining} more...`);
    }

    // section 2: available flights
    const flightsY = selectionsY + boxHeight + sectionGap;
    const flightsGroup = contentGroup
      .append('g')
      .attr('class', 'flights-section');

    // calculate space for distributions section (fixed size)
    const distributionsFixedHeight = 10 + 3 * 70; // 10px for content Y offset + space for 3 histograms at 70px each

    // flights content area - use all available space except what's reserved for distributions
    const flightsContentY = flightsY + 10; // reduced from flightsY + 40 since no title
    const flightsContentHeight =
      totalHeight -
      flightsContentY -
      distributionsFixedHeight -
      sectionGap -
      padding; // use all remaining space

    // get current scroll position from yjs or default to 0
    const scrollOffset = (yPanelState.get('flightsScrollY') as number) || 0;

    const displayOriginsSelected =
      selectedLeftIATAs.length > 0 ||
      hoveredLeftIATAs.length > 0 ||
      allBrushLeftIATAs.length > 0;
    const displayDestinationsSelected =
      selectedRightIATAs.length > 0 ||
      hoveredRightIATAs.length > 0 ||
      allBrushRightIATAs.length > 0;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 - 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 + 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see available flights.');
    } else if (currentFilteredFlights.length === 0) {
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('No direct flights found for the current selection.');
    } else {
      // sort flights by price (cheapest first)
      const flightsToShow = currentFilteredFlights.sort(
        (a, b) => a.price - b.price
      );

      // create clipping path for flights list
      const clipId = 'flights-clip';
      panelSvg
        .select('defs')
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', padding)
        .attr('y', flightsContentY)
        .attr('width', panelWidth - 2 * padding)
        .attr('height', flightsContentHeight);

      const flightsListGroup = flightsGroup
        .append('g')
        .attr('class', 'flights-list')
        .attr('clip-path', `url(#${clipId})`);

      const itemHeight = 80;
      const visibleItems = Math.ceil(flightsContentHeight / itemHeight) + 1;
      const startIndex = Math.max(0, Math.floor(scrollOffset / itemHeight));
      const endIndex = Math.min(
        flightsToShow.length,
        startIndex + visibleItems
      );

      for (let i = startIndex; i < endIndex; i++) {
        const flight = flightsToShow[i];
        const itemY = flightsContentY + i * itemHeight - scrollOffset;

        // get current hovered flights from yjs state
        const hoveredFlights = yHoveredFlights?.toArray() || [];
        const isHovered = hoveredFlights.includes(flight.id);

        // get current selected flights from yjs state
        const selectedFlights = ySelectedFlights?.toArray() || [];
        const isSelected = selectedFlights.includes(flight.id);

        // create a group for each flight item to make it interactable
        const flightGroup = flightsListGroup
          .append('g')
          .attr('class', 'flight-item')
          .attr('data-flight-id', flight.id.toString())
          .style('cursor', 'none')
          .on('mouseenter', function () {
            // add to hovered flights
            if (yHoveredFlights) {
              const currentHovered = yHoveredFlights.toArray();
              if (!currentHovered.includes(flight.id)) {
                yHoveredFlights.push([flight.id]);
              }
            }
          })
          .on('mouseleave', function () {
            // remove from hovered flights
            if (yHoveredFlights) {
              const currentHovered = yHoveredFlights.toArray();
              const index = currentHovered.indexOf(flight.id);
              if (index !== -1) {
                yHoveredFlights.delete(index, 1);
              }
            }
          })
          .on('click', function (event) {
            event.stopPropagation();

            if (ySelectedFlights) {
              const currentSelected = ySelectedFlights.toArray();

              if (currentSelected.includes(flight.id)) {
                // deselect if already selected
                const index = currentSelected.indexOf(flight.id);
                ySelectedFlights.delete(index, 1);
              } else if (currentSelected.length < 2) {
                // select if under limit of 2
                ySelectedFlights.push([flight.id]);
              } else {
                // if already at max (2), replace the oldest (first) selection
                ySelectedFlights.delete(0, 1); // remove oldest
                ySelectedFlights.push([flight.id]); // add new
              }
            }
          });

        // flight item background
        flightGroup
          .append('rect')
          .attr('x', padding + 4)
          .attr('y', itemY)
          .attr('width', panelWidth - 2 * padding - 8)
          .attr('height', itemHeight - 4)
          .attr('fill', 'rgba(255, 255, 255, 0.12)')
          .attr(
            'stroke',
            isSelected
              ? pinnedFlightColor
              : isHovered
              ? airportHighlightStroke
              : 'none'
          )
          .attr('stroke-width', isSelected || isHovered ? 2 : 0)
          .attr('rx', 3)
          .attr('ry', 3);

        // flight route and price
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 20)
          .attr('fill', panelTextColor)
          .attr('font-size', '22px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.origin} → ${flight.destination}`);

        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + 20) // back to top line with route
          .attr('fill', panelTextColor)
          .attr('font-size', '22px') // back to 20px to match route
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`$${flight.price.toFixed(2)}`);

        // airline information (full name only, no abbreviation)
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 40)
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.airline.name}`);

        // flight duration (same styling as price)
        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(`${flight.duration.toFixed(1)}h`);

        // flight date (same size and styling as airline name)
        // parse date as local date to avoid timezone issues
        const dateParts = flight.date.split('-');
        const flightDate = new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2])
        );
        const formattedDate = flightDate.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .style('pointer-events', 'none')
          .text(formattedDate);
      }

      // add scrollbar if there are more flights than can be displayed
      const totalContentHeight = flightsToShow.length * itemHeight;
      if (totalContentHeight > flightsContentHeight) {
        const scrollbarWidth = 4;
        const scrollbarX = panelWidth - padding - scrollbarWidth;

        // scrollbar track
        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', flightsContentY)
          .attr('width', scrollbarWidth)
          .attr('height', flightsContentHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.1)')
          .attr('rx', 2)
          .attr('ry', 2);

        // scrollbar thumb
        const scrollRatio = Math.min(
          1,
          flightsContentHeight / totalContentHeight
        );
        const thumbHeight = flightsContentHeight * scrollRatio;
        const maxScrollForThumb = Math.max(
          0,
          totalContentHeight - flightsContentHeight
        );
        const thumbY =
          maxScrollForThumb > 0
            ? flightsContentY +
              (scrollOffset / maxScrollForThumb) *
                (flightsContentHeight - thumbHeight)
            : flightsContentY;

        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', thumbY)
          .attr('width', scrollbarWidth)
          .attr('height', thumbHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.4)')
          .attr('rx', 2)
          .attr('ry', 2);
      }
    }

    // section 3: flight distributions
    const distributionsY = flightsContentY + flightsContentHeight + sectionGap;
    const distributionsGroup = contentGroup
      .append('g')
      .attr('class', 'distributions-section');

    // distributions content
    const distributionsContentY = distributionsY + 10; // reduced from distributionsY + 40 since no title
    const flightsToAnalyze = currentFilteredFlights;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 40)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 60)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see flight distributions.');
    } else if (flightsToAnalyze.length === 0) {
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 50)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('no flight data available for distribution analysis.');
    } else {
      const prices = flightsToAnalyze.map((f) => f.price);
      const durations = flightsToAnalyze.map((f) => f.duration);
      // parse dates as local dates to avoid timezone issues
      const dates = flightsToAnalyze.map((f) => {
        const dateParts = f.date.split('-');
        return new Date(
          parseInt(dateParts[0]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[2])
        );
      });

      const histHeight = 40; // increased from 32 for better visibility
      const numBins = 8;
      const histogramBarFill = 'rgba(255, 255, 255, 0.4)';
      const calculatedHistWidth = panelWidth - 2 * padding - 8; // match other sections' width calculation

      // histograms use <= for the last bin to include maximum values (edge case fix)

      // create histograms
      let currentHistY = distributionsContentY;

      // price histogram
      if (prices.length > 0) {
        const [minVal, maxVal] = d3.extent(prices);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(prices);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's price falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.price >= binStart &&
                    (isLastBin ? flight.price <= binEnd : flight.price < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                return `$${((bin.x0! + bin.x1!) / 2).toFixed(0)}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '18px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // duration histogram
      if (durations.length > 0) {
        const [minVal, maxVal] = d3.extent(durations);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(durations);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's duration falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.duration >= binStart &&
                    (isLastBin
                      ? flight.duration <= binEnd
                      : flight.duration < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const hours = (bin.x0! + bin.x1!) / 2;
                // show half-hour precision for better granularity
                return `${hours.toFixed(1)}h`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // date histogram
      if (dates.length > 0) {
        const [minVal, maxVal] = d3.extent(dates);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleTime()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          // calculate number of days between earliest and latest dates for bins
          const daysBetween =
            Math.ceil(
              (maxVal.getTime() - minVal.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;

          const histogram = d3
            .histogram<Date, Date>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(daysBetween));

          const bins = histogram(dates);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's date falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  // parse date as local date to avoid timezone issues
                  const dateParts = flight.date.split('-');
                  const flightDate = new Date(
                    parseInt(dateParts[0]),
                    parseInt(dateParts[1]) - 1,
                    parseInt(dateParts[2])
                  ).getTime();
                  const binStart = d.x0!.getTime();
                  const binEnd = d.x1!.getTime();
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flightDate >= binStart &&
                    (isLastBin ? flightDate <= binEnd : flightDate < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const date = new Date(bin.x0!);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);
        }
      }
    }
  };

  // store projection ref for use in handlers
  const projectionRef = useRef<d3.GeoProjection | null>(null);
  // removed interaction handler ref

  useEffect(() => {
    if (
      !doc ||
      !syncStatus ||
      !svgRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !yPanelState
    ) {
      return undefined; // ensure a value is returned for cleanup path
    }

    const currentSvg = svgRef.current;
    const svg = d3.select(currentSvg);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    defs
      .append('filter')
      .attr('id', 'map-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 3)
      .attr('flood-opacity', 0.5);
    defs
      .append('filter')
      .attr('id', 'airport-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 2)
      .attr('flood-opacity', 0.75);

    // create a root group for all content that will be transformed (like SenateVisualization)
    const root = svg.append('g').attr('class', 'root');
    const g = root.append('g');
    gRef.current = g.node();

    // don't apply initial transform here - let the sync effect handle it
    // this prevents conflicts when joining after transforms have been made
    transformRef.current = { k: 1, x: 0, y: 0 };

    // removed parent element listener

    Promise.all([
      d3.json<WorldTopology>('/src/assets/traveldata/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/situation3/airports.json'),
      d3.json<Flight[]>('/src/assets/situation3/flights.json'),
      d3.json<PuzzleDescription>(
        '/src/assets/situation3/puzzle_description.json'
      ),
    ])
      .then(([topology, airportsData, flightsData, puzzleData]) => {
        if (
          !topology ||
          !topology.objects.countries ||
          !airportsData ||
          !flightsData ||
          !puzzleData
        ) {
          console.error('failed to load data.');
          return;
        }

        allFlights.current = flightsData;
        allAirports.current = airportsData; // store all airport data
        puzzleDescription.current = puzzleData; // store puzzle description data

        // trigger validation check for joining users with existing selections
        if (ySelectedFlights) {
          const selectedFlightIds = ySelectedFlights.toArray();
          if (selectedFlightIds.length === 2) {
            const selectedFlights = selectedFlightIds
              .map((id) => allFlights.current.find((f) => f.id === id))
              .filter(Boolean) as Flight[];

            if (selectedFlights.length === 2) {
              const result = validateSelectedFlights(selectedFlights);
              setValidationResult(result);
            }
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const geoFeature = (topojson.feature as any)(
          topology,
          topology.objects.countries
        ) as FeatureCollection<Geometry, CountryProperties>;

        const projection = d3
          .geoEqualEarth()
          .center([-75, 47])
          .translate([mapWidth / 2, totalHeight / 3.75])
          .scale(700);
        projectionRef.current = projection; // store projection
        const path = d3.geoPath().projection(projection);

        const mapGroup = g
          .append('g')
          .attr('class', 'map-features')
          .style('pointer-events', 'none')
          .style('filter', 'url(#map-shadow)');
        mapGroup
          .selectAll('path')
          .data(geoFeature.features)
          .join('path')
          .attr('d', path)
          .attr('fill', defaultFill)
          .attr('stroke', strokeColor)
          .attr('stroke-width', defaultStrokeWidth)
          .attr('class', 'country')
          .append('title')
          .text((d) => d.properties?.name ?? 'unknown');

        // create separate brush interaction groups for true separation
        const originBrushInteractionGroup = g
          .append('g')
          .attr('class', 'origin-brush-interaction')
          .style('pointer-events', 'all');

        const destinationBrushInteractionGroup = g
          .append('g')
          .attr('class', 'destination-brush-interaction')
          .style('pointer-events', 'all');

        // create brush visuals group for rendering above airports
        const brushVisualsGroup = g
          .append('g')
          .attr('class', 'brush-visuals')
          .style('pointer-events', 'none');

        // create remote brushes group for showing other users' brush selections
        const remoteBrushesGroup = g
          .append('g')
          .attr('class', 'remote-brushes')
          .style('pointer-events', 'none');

        // create separate custom brush rectangles for each mode
        const originBrushRect = brushVisualsGroup
          .append('rect')
          .attr('class', 'origin-brush-rect')
          .attr('pointer-events', 'none')
          .attr('fill', 'rgba(232, 27, 35, 0.3)') // red for origins
          .attr('stroke', userColor)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '3,3')
          .attr('visibility', 'hidden');

        const destinationBrushRect = brushVisualsGroup
          .append('rect')
          .attr('class', 'destination-brush-rect')
          .attr('pointer-events', 'none')
          .attr('fill', 'rgba(0, 174, 243, 0.3)') // blue for destinations
          .attr('stroke', userColor)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '3,3')
          .attr('visibility', 'hidden');

        const bbox = g.node()?.getBBox();

        // initialize separate brush behaviors for origin and destination
        const originBrush = d3
          .brush()
          .filter((event) => {
            // only allow brush when no modifier keys pressed
            return (
              event.type === 'mousedown' && !event.shiftKey && !event.ctrlKey
            );
          })
          .on('start', (event) => brushStarted(event, 'origin'))
          .on('brush', (event) => brushed(event, 'origin'))
          .on('end', (event) => brushEnded(event, 'origin'));

        const destinationBrush = d3
          .brush()
          .filter((event) => {
            // only allow brush when no modifier keys pressed
            return (
              event.type === 'mousedown' && !event.shiftKey && !event.ctrlKey
            );
          })
          .on('start', (event) => brushStarted(event, 'destination'))
          .on('brush', (event) => brushed(event, 'destination'))
          .on('end', (event) => brushEnded(event, 'destination'));

        if (bbox) {
          const extent: [[number, number], [number, number]] = [
            [bbox.x, bbox.y],
            [bbox.x + bbox.width, bbox.y + bbox.height],
          ];
          originBrush.extent(extent);
          destinationBrush.extent(extent);
        }

        // function to switch active brush based on current mode
        const switchActiveBrush = () => {
          const currentMode = hoverModeRef.current;

          // show/hide the appropriate interaction groups
          if (currentMode === 'origin') {
            originBrushInteractionGroup.style('display', 'block');
            destinationBrushInteractionGroup.style('display', 'none');
          } else {
            originBrushInteractionGroup.style('display', 'none');
            destinationBrushInteractionGroup.style('display', 'block');
          }

          // load brush selection from yjs if available for current mode
          const coordsArray =
            currentMode === 'origin'
              ? yClientBrushCoordsLeft
              : yClientBrushCoordsRight;

          if (coordsArray && coordsArray.has(userId)) {
            const coords = coordsArray.get(userId)!;
            const brushSelectionFromYjs: [[number, number], [number, number]] =
              [
                [coords.x0, coords.y0],
                [coords.x1, coords.y1],
              ];

            // restore brush selection from yjs
            if (currentMode === 'origin') {
              originBrush.move(
                originBrushInteractionGroup,
                brushSelectionFromYjs
              );
            } else {
              destinationBrush.move(
                destinationBrushInteractionGroup,
                brushSelectionFromYjs
              );
            }
          }
        };

        // set up both brush behaviors on their respective interaction groups
        if (bbox) {
          const extent: [[number, number], [number, number]] = [
            [bbox.x, bbox.y],
            [bbox.x + bbox.width, bbox.y + bbox.height],
          ];
          originBrush.extent(extent);
          destinationBrush.extent(extent);
        }

        // apply brushes to their respective groups
        originBrushInteractionGroup.call(originBrush);
        destinationBrushInteractionGroup.call(destinationBrush);

        // hide the default d3 brush visual elements for both groups
        [originBrushInteractionGroup, destinationBrushInteractionGroup].forEach(
          (group) => {
            group
              .select('.selection')
              .attr('fill', 'none')
              .attr('stroke', 'none')
              .attr('stroke-width', 0);

            group
              .selectAll('.handle')
              .attr('fill', 'none')
              .attr('stroke', 'none')
              .attr('stroke-width', 0);
          }
        );

        // store function in ref for keyboard handler access
        updateBrushInteractionsRef.current = switchActiveBrush;

        // set initial brush visibility
        switchActiveBrush();

        // brush event handlers that work with specific brush modes
        function brushStarted(
          event: d3.D3BrushEvent<unknown>,
          brushMode: 'origin' | 'destination'
        ) {
          // if the event target is the overlay, it's a new brush.
          // otherwise, we are resizing or moving an existing brush.
          if (event.sourceEvent) {
            const source = event.sourceEvent.target as SVGElement;
            const isNewBrush = source.classList.contains('overlay');

            if (isNewBrush) {
              // this is a new brush. clear this user's previous brush selection for this mode only.
              const targetArray =
                brushMode === 'origin'
                  ? yClientBrushSelectionsLeft
                  : yClientBrushSelectionsRight;

              if (targetArray && targetArray.has(userId)) {
                targetArray.set(userId, []);
              }
            }
          }
        }

        function brushed(
          event: d3.D3BrushEvent<unknown>,
          brushMode: 'origin' | 'destination'
        ) {
          const brushRect =
            brushMode === 'origin' ? originBrushRect : destinationBrushRect;

          if (!event.selection) {
            // immediate updates for clearing selections
            brushRect.attr('visibility', 'hidden');
            const targetArray =
              brushMode === 'origin'
                ? yClientBrushSelectionsLeft
                : yClientBrushSelectionsRight;

            if (targetArray && userId) {
              targetArray.set(userId, []);
            }

            // cancel any pending updates
            if (brushUpdateFrameRef.current) {
              cancelAnimationFrame(brushUpdateFrameRef.current);
              brushUpdateFrameRef.current = null;
            }
            pendingBrushUpdateRef.current = null;
            return;
          }

          const [[x0, y0], [x1, y1]] = event.selection as [
            [number, number],
            [number, number]
          ];

          // immediate visual updates (no throttling needed for local ui)
          if (awareness && event.sourceEvent) {
            const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());
            const currentState = awareness.getLocalState() as AwarenessState;
            if (currentState) {
              awareness.setLocalState({
                ...currentState,
                cursor: { x: svgX, y: svgY },
                brushSelection: { x0, y0, x1, y1, mode: brushMode },
              });
            }
          }

          // immediate brush rectangle update
          const brushFillColor =
            brushMode === 'origin'
              ? 'rgba(232, 27, 35, 0.3)' // red for origins
              : 'rgba(0, 174, 243, 0.3)'; // blue for destinations

          brushRect
            .attr('visibility', 'visible')
            .attr('x', x0)
            .attr('y', y0)
            .attr('width', x1 - x0)
            .attr('height', y1 - y0)
            .attr('fill', brushFillColor);

          // calculate selected airports
          const selectedAirports = allAirports.current.filter((airport) => {
            const coords = projection([airport.Longitude, airport.Latitude]);
            if (!coords) return false;
            const [px, py] = coords;
            return px >= x0 && px <= x1 && py >= y0 && py <= y1;
          });

          const oppositeSelectedArray =
            brushMode === 'origin'
              ? ySelectedAirportIATAsRight
              : ySelectedAirportIATAsLeft;

          const oppositeSelectedIATAs = oppositeSelectedArray?.toArray() || [];
          const selectedIATAs = selectedAirports
            .map((a) => a.IATA)
            .filter((iata) => !oppositeSelectedIATAs.includes(iata));

          // store pending update data
          pendingBrushUpdateRef.current = {
            mode: brushMode,
            coordinates: { x0, y0, x1, y1 },
            selectedIATAs,
          };

          // throttle yjs updates using requestAnimationFrame
          if (!brushUpdateFrameRef.current) {
            brushUpdateFrameRef.current = requestAnimationFrame(() => {
              const pendingUpdate = pendingBrushUpdateRef.current;
              if (pendingUpdate && doc) {
                // batch yjs updates in a single transaction
                doc.transact(() => {
                  const targetArray =
                    pendingUpdate.mode === 'origin'
                      ? yClientBrushSelectionsLeft
                      : yClientBrushSelectionsRight;

                  const coordsArray =
                    pendingUpdate.mode === 'origin'
                      ? yClientBrushCoordsLeft
                      : yClientBrushCoordsRight;

                  if (targetArray && userId) {
                    targetArray.set(userId, pendingUpdate.selectedIATAs);
                  }

                  if (coordsArray && userId) {
                    coordsArray.set(userId, pendingUpdate.coordinates);
                  }
                });
              }

              // reset for next frame
              brushUpdateFrameRef.current = null;
              pendingBrushUpdateRef.current = null;
            });
          }
        }

        function brushEnded(
          event: d3.D3BrushEvent<unknown>,
          brushMode: 'origin' | 'destination'
        ) {
          const brushRect =
            brushMode === 'origin' ? originBrushRect : destinationBrushRect;

          // if no selection after brush ends, this means user clicked outside or cleared the brush
          if (!event.selection) {
            // hide the custom brush rectangle and clear yjs selection for this mode
            brushRect.attr('visibility', 'hidden');

            const targetArray =
              brushMode === 'origin'
                ? yClientBrushSelectionsLeft
                : yClientBrushSelectionsRight;

            if (targetArray && userId) {
              targetArray.set(userId, []);
            }

            // also clear brush coordinates from yjs
            const coordsArray =
              brushMode === 'origin'
                ? yClientBrushCoordsLeft
                : yClientBrushCoordsRight;

            if (coordsArray && userId) {
              coordsArray.delete(userId);
            }
          }

          // update cursor position and clear brush selection from awareness
          if (awareness && event.sourceEvent) {
            const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());
            const currentState = awareness.getLocalState() as AwarenessState;
            if (currentState) {
              const stateWithoutBrush = {
                ...currentState,
                cursor: {
                  x: svgX,
                  y: svgY,
                },
              };
              if ('brushSelection' in stateWithoutBrush) {
                delete stateWithoutBrush.brushSelection;
              }
              awareness.setLocalState(stateWithoutBrush);
            }
          }
        }

        // function to update remote brush selections
        const updateRemoteBrushes = () => {
          if (!awareness || !yClientBrushCoordsLeft || !yClientBrushCoordsRight)
            return;

          // get remote users' persistent brush coordinates from yjs
          const remoteBrushData: Array<{
            userId: string;
            coords: { x0: number; y0: number; x1: number; y1: number };
            mode: 'origin' | 'destination';
            userColor: string;
          }> = [];

          // get user colors from awareness
          const userStates = Array.from(awareness.getStates().values());
          const userColorMap = new Map<string, string>();
          userStates.forEach((state) => {
            const awarenessState = state as AwarenessState;
            if (awarenessState && awarenessState.user) {
              userColorMap.set(
                awarenessState.user.id,
                awarenessState.user.color
              );
            }
          });

          // collect origin brushes
          yClientBrushCoordsLeft.forEach((coords, userIdKey) => {
            if (userIdKey !== userId) {
              // exclude local user
              const userColor = userColorMap.get(userIdKey) || '#999';
              remoteBrushData.push({
                userId: userIdKey,
                coords,
                mode: 'origin',
                userColor,
              });
            }
          });

          // collect destination brushes
          yClientBrushCoordsRight.forEach((coords, userIdKey) => {
            if (userIdKey !== userId) {
              // exclude local user
              const userColor = userColorMap.get(userIdKey) || '#999';
              remoteBrushData.push({
                userId: userIdKey,
                coords,
                mode: 'destination',
                userColor,
              });
            }
          });

          // also include temporary brushes from awareness (while actively brushing)
          const tempBrushStates = userStates
            .map((state) => state as AwarenessState)
            .filter(
              (state) =>
                state &&
                state.brushSelection &&
                state.user &&
                state.user.id !== userId
            );

          tempBrushStates.forEach((state) => {
            const coords = {
              x0: state.brushSelection!.x0,
              y0: state.brushSelection!.y0,
              x1: state.brushSelection!.x1,
              y1: state.brushSelection!.y1,
            };
            remoteBrushData.push({
              userId: `temp-${state.user.id}`,
              coords,
              mode: state.brushSelection!.mode,
              userColor: state.user.color,
            });
          });

          // update brush visualization
          const brushes = remoteBrushesGroup
            .selectAll<SVGRectElement, (typeof remoteBrushData)[0]>(
              'rect.remote-brush'
            )
            .data(remoteBrushData, (d) => d.userId);

          // remove old brushes
          brushes.exit().remove();

          // create new brushes
          const newBrushes = brushes
            .enter()
            .append('rect')
            .attr('class', 'remote-brush')
            .attr('pointer-events', 'none')
            .attr('fill', (d) => {
              return d.mode === 'origin'
                ? 'rgba(232, 27, 35, 0.3)' // red for origins
                : 'rgba(0, 174, 243, 0.3)'; // blue for destinations
            })
            .attr('stroke', (d) => d.userColor)
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '3,3');

          // update all brushes
          newBrushes
            .merge(brushes)
            .attr('x', (d) => d.coords.x0)
            .attr('y', (d) => d.coords.y0)
            .attr('width', (d) => d.coords.x1 - d.coords.x0)
            .attr('height', (d) => d.coords.y1 - d.coords.y0)
            .attr('fill', (d) => {
              return d.mode === 'origin'
                ? 'rgba(232, 27, 35, 0.3)' // red for origins
                : 'rgba(0, 174, 243, 0.3)'; // blue for destinations
            })
            .attr('stroke', (d) => d.userColor);
        };

        const airportsGroup = g
          .append('g')
          .attr('class', 'airports')
          .style('pointer-events', 'all')
          .style('filter', 'url(#airport-shadow)');

        // move brush visual groups after airports so they render on top
        brushVisualsGroup.raise();
        remoteBrushesGroup.raise();

        const airportCircles = airportsGroup
          .selectAll('circle')
          .data(airportsData) // use airportsData directly
          .join('circle')
          .attr('cx', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[0] : 0;
          })
          .attr('cy', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[1] : 0;
          })
          .attr('r', airportRadius / transformRef.current.k) // use current transform scale
          .attr('fill', airportFill)
          .attr('stroke', airportStroke)
          .attr('stroke-width', airportStrokeWidth / transformRef.current.k) // use current transform scale
          .attr('class', 'airport')
          .attr('data-iata', (d) => d.IATA) // add iata for easy selection
          .style('cursor', 'none');

        // add hover event handlers to airports
        airportCircles
          .on('mouseenter', function (_, d: Airport) {
            const currentMode = hoverModeRef.current;
            const targetArray =
              currentMode === 'origin'
                ? yHoveredAirportIATAsLeft
                : yHoveredAirportIATAsRight;
            const oppositeSelectedArray =
              currentMode === 'origin'
                ? ySelectedAirportIATAsRight
                : ySelectedAirportIATAsLeft;

            if (targetArray && oppositeSelectedArray) {
              const oppositeSelectedIATAs = oppositeSelectedArray.toArray();

              // only allow hover if airport is not selected in opposite side
              if (!oppositeSelectedIATAs.includes(d.IATA)) {
                // clear previous hovers and set new one
                targetArray.delete(0, targetArray.length);
                targetArray.push([d.IATA]);
              }
            }
          })
          .on('mouseleave', function () {
            const currentMode = hoverModeRef.current;
            const targetArray =
              currentMode === 'origin'
                ? yHoveredAirportIATAsLeft
                : yHoveredAirportIATAsRight;

            if (targetArray) {
              // clear hover
              targetArray.delete(0, targetArray.length);
            }
          })
          .on('click', function (event, d: Airport) {
            // prevent event from bubbling to zoom behavior
            event.stopPropagation();

            const currentMode = hoverModeRef.current;
            const targetArray =
              currentMode === 'origin'
                ? ySelectedAirportIATAsLeft
                : ySelectedAirportIATAsRight;
            const oppositeArray =
              currentMode === 'origin'
                ? ySelectedAirportIATAsRight
                : ySelectedAirportIATAsLeft;

            if (targetArray && oppositeArray) {
              const currentSelections = targetArray.toArray();
              const oppositeSelections = oppositeArray.toArray();

              // toggle selection - if already selected, remove it; otherwise add it
              if (currentSelections.includes(d.IATA)) {
                // remove from current selection
                const index = currentSelections.indexOf(d.IATA);
                targetArray.delete(index, 1);
              } else {
                // check if airport is in opposite array and remove it first
                if (oppositeSelections.includes(d.IATA)) {
                  const oppositeIndex = oppositeSelections.indexOf(d.IATA);
                  oppositeArray.delete(oppositeIndex, 1);
                }
                // add to current selection
                targetArray.push([d.IATA]);
              }
            }
          });

        // get initial transform from yjs state and apply it
        const initialScale = (yWorldMapState.get('zoomScale') as number) || 1;
        const initialX = (yWorldMapState.get('panX') as number) || 0;
        const initialY = (yWorldMapState.get('panY') as number) || 0;

        // update transformRef and apply transform
        transformRef.current = { k: initialScale, x: initialX, y: initialY };
        const initialTransform = d3.zoomIdentity
          .translate(initialX, initialY)
          .scale(initialScale);
        setCurrentTransform(initialTransform);
        root.attr('transform', initialTransform.toString());

        // initial application of styles based on current transform
        adjustStylesForTransform(transformRef.current.k);
        redrawAllLinesFromYjs(projection);
        updateInfoPanelFromYjs();

        // add mouse tracking for cursor awareness
        svg.on('mousemove', function (event) {
          if (!awareness) return;

          // get coordinates in SVG space
          const [svgX, svgY] = d3.pointer(event, svg.node());

          // update local awareness state with cursor position
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            awareness.setLocalState({
              ...currentState,
              cursor: {
                x: svgX,
                y: svgY,
              },
            });
          }
        });

        // add awareness observer for cursor and brush updates
        const awarenessObserver = () => {
          updateCursors();
          updateRemoteBrushes();
        };

        if (awareness) {
          awareness.on('change', awarenessObserver);
        }

        // initial cursor and remote brush update
        updateCursors();
        updateRemoteBrushes();

        // create zoom behavior (same as SenateVisualization)
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

            // update local state
            setCurrentTransform(transform);

            // apply transform to root group
            root.attr('transform', transform.toString());

            // update transformRef for consistency with existing code
            transformRef.current = {
              k: transform.k,
              x: transform.x,
              y: transform.y,
            };

            // only sync with yjs if this is a user-initiated transform (not external)
            // check if sourceEvent exists - it won't for programmatic transforms
            if (yWorldMapState && doc && event.sourceEvent) {
              doc.transact(() => {
                yWorldMapState.set('zoomScale', transform.k);
                yWorldMapState.set('panX', transform.x);
                yWorldMapState.set('panY', transform.y);
              });
            }

            // re-apply styles that depend on scale
            adjustStylesForTransform(transform.k);
          });

        // apply zoom behavior to svg
        svg.call(zoom);

        // set the zoom behavior's internal state to match the current transform
        // this ensures new users sync properly to existing transforms
        svg.property('__zoom', initialTransform);

        // cleanup function for awareness observer
        return () => {
          if (awareness) {
            awareness.off('change', awarenessObserver);
          }
        };
      })
      .catch((error) =>
        console.error('error loading or processing data:', error)
      );

    // setup observers for yjs changes to reflect in d3
    const yjsObserver = () => {
      const currentProj = projectionRef.current;
      if (
        !currentProj ||
        !yWorldMapState ||
        !yHoveredAirportIATAsLeft ||
        !yHoveredAirportIATAsRight
      )
        return;
      console.log('[yjs observer] updating visualization due to yjs change');
      adjustStylesForTransform(transformRef.current.k); // re-apply styles based on current known scale
      redrawAllLinesFromYjs(currentProj);
      updateInfoPanelFromYjs();
    };

    yHoveredAirportIATAsLeft.observeDeep(yjsObserver);
    yHoveredAirportIATAsRight.observeDeep(yjsObserver);
    ySelectedAirportIATAsLeft.observeDeep(yjsObserver);
    ySelectedAirportIATAsRight.observeDeep(yjsObserver);
    yPanelState.observeDeep(yjsObserver); // observe panel state changes
    yHoveredFlights?.observeDeep(yjsObserver); // observe hovered flights changes
    ySelectedFlights?.observeDeep(yjsObserver); // observe selected flights changes
    yClientBrushSelectionsLeft?.observeDeep(yjsObserver); // observe brush selections changes
    yClientBrushSelectionsRight?.observeDeep(yjsObserver); // observe brush selections changes
    yClientBrushCoordsLeft?.observeDeep(yjsObserver); // observe brush coordinates changes
    yClientBrushCoordsRight?.observeDeep(yjsObserver); // observe brush coordinates changes

    // main effect cleanup
    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      // cleanup brush throttling animation frame
      if (brushUpdateFrameRef.current) {
        cancelAnimationFrame(brushUpdateFrameRef.current);
        brushUpdateFrameRef.current = null;
      }
      pendingBrushUpdateRef.current = null;
      clearAllLines();
      yHoveredAirportIATAsLeft?.unobserveDeep(yjsObserver);
      yHoveredAirportIATAsRight?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsLeft?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsRight?.unobserveDeep(yjsObserver);
      yPanelState?.unobserveDeep(yjsObserver); // unobserve panel state changes
      yHoveredFlights?.unobserveDeep(yjsObserver); // unobserve hovered flights changes
      ySelectedFlights?.unobserveDeep(yjsObserver); // unobserve selected flights changes
      yClientBrushSelectionsLeft?.unobserveDeep(yjsObserver); // unobserve brush selections changes
      yClientBrushSelectionsRight?.unobserveDeep(yjsObserver); // unobserve brush selections changes
      yClientBrushCoordsLeft?.unobserveDeep(yjsObserver); // unobserve brush coordinates changes
      yClientBrushCoordsRight?.unobserveDeep(yjsObserver); // unobserve brush coordinates changes

      // cleanup scroll drag state
      scrollDragStateRef.current.left.active = false;
      scrollDragStateRef.current.right.active = false;

      // placeholder for future interaction cleanup
    };
  }, [
    doc,
    syncStatus,
    yWorldMapState,
    yHoveredAirportIATAsLeft,
    yHoveredAirportIATAsRight,
    ySelectedAirportIATAsLeft,
    ySelectedAirportIATAsRight,
    yPanelState,
    yHoveredFlights,
    ySelectedFlights,
    yClientBrushSelectionsLeft,
    yClientBrushSelectionsRight,
    awareness,
    userId,
    userName,
    userColor,
  ]);

  // function to draw pinned flight lines (always visible in green)
  const drawPinnedFlightLines = (projection: d3.GeoProjection | null) => {
    if (!projection || !ySelectedFlights) return;

    const selectedFlights = ySelectedFlights.toArray();
    const selectedFlightData = selectedFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    selectedFlightData.forEach((flight) => {
      const pairKey = getPairKey(flight.origin, flight.destination);
      // only draw if this line doesn't already exist
      if (!activeLinesByPair.current.has(pairKey)) {
        drawAirportLineByIATAs(
          flight.origin,
          flight.destination,
          projection,
          false,
          true
        );
      }
    });
  };

  if (
    !syncStatus ||
    !doc ||
    !ySelectedAirportIATAsLeft ||
    !ySelectedAirportIATAsRight
  ) {
    // ensure doc is also available for initial render
    return (
      <div
        style={{
          width: '100%', // Use 100% to fill parent like Senate
          height: '100%', // Use 100% to fill parent like Senate
          position: 'relative', // Relative for potential inner absolute elements
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent', // Match Senate
          overflow: 'hidden', // Match Senate
          borderRadius: '8px', // Match Senate
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)', // Match Senate
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
            background: 'rgba(255,255,255,0.8)', // Match Senate
            borderRadius: '12px', // Match Senate
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)', // Match Senate
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333', // Match Senate
            }}
          >
            Travel Map Visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555', // Match Senate
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee', // Match Senate
              borderRadius: '8px', // Match Senate
              overflow: 'hidden', // Match Senate
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #1E90FF, #1E90FF)`, // Adjusted color for WorldMap theme
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px', // Match Senate
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

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#1a2d42', // dark ocean blue background
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{
          pointerEvents: 'all',
          touchAction: 'none',
          cursor: 'none',
          overflow: 'hidden',
        }}
      />
      {/* cursor overlay div */}
      <div
        ref={cursorOverlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10000,
        }}
      />
      {/* info panel svg structure */}
      <div
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          width: panelWidth,
          height: totalHeight,
          zIndex: 1000,
          pointerEvents: 'all',
        }}
        onWheel={(event) => {
          // handle scroll wheel for flights list
          if (yPanelState && yHoveredFlights) {
            event.preventDefault(); // prevent default scroll behavior
            event.stopPropagation(); // prevent event bubbling

            // clear any hovered flights when scrolling to prevent stuck hover states
            if (yHoveredFlights.length > 0) {
              yHoveredFlights.delete(0, yHoveredFlights.length);
            }

            const currentScroll =
              (yPanelState.get('flightsScrollY') as number) || 0;
            const scrollDelta = event.deltaY * 0.5; // smooth scrolling

            // collect all brush selections from all clients
            const allBrushLeftIATAs: string[] = [];
            const allBrushRightIATAs: string[] = [];

            if (yClientBrushSelectionsLeft) {
              yClientBrushSelectionsLeft.forEach((iatas: string[]) => {
                allBrushLeftIATAs.push(...iatas);
              });
            }

            if (yClientBrushSelectionsRight) {
              yClientBrushSelectionsRight.forEach((iatas: string[]) => {
                allBrushRightIATAs.push(...iatas);
              });
            }

            // calculate scroll bounds based on current flight data (including brush selections)
            const leftFilterIATAs = Array.from(
              new Set([
                ...(ySelectedAirportIATAsLeft?.toArray() || []),
                ...(yHoveredAirportIATAsLeft?.toArray() || []),
                ...allBrushLeftIATAs,
              ])
            );
            const rightFilterIATAs = Array.from(
              new Set([
                ...(ySelectedAirportIATAsRight?.toArray() || []),
                ...(yHoveredAirportIATAsRight?.toArray() || []),
                ...allBrushRightIATAs,
              ])
            );

            let currentFilteredFlights: Flight[] = [];
            if (leftFilterIATAs.length > 0 && rightFilterIATAs.length > 0) {
              currentFilteredFlights = allFlights.current.filter(
                (flight) =>
                  leftFilterIATAs.includes(flight.origin) &&
                  rightFilterIATAs.includes(flight.destination)
              );
            } else if (leftFilterIATAs.length > 0) {
              currentFilteredFlights = allFlights.current.filter((flight) =>
                leftFilterIATAs.includes(flight.origin)
              );
            } else if (rightFilterIATAs.length > 0) {
              currentFilteredFlights = allFlights.current.filter((flight) =>
                rightFilterIATAs.includes(flight.destination)
              );
            }

            // calculate content dimensions for scroll bounds
            const itemHeight = 80;
            const distributionsFixedHeight = 10 + 3 * 70;
            const sectionGap = 12;
            const padding = 6;
            const boxHeight = 20 + 25 + 4 * 35 - 10; // from the fixed height calculation
            const flightsY = padding + boxHeight + sectionGap;
            const flightsContentY = flightsY + 10;
            const flightsContentHeight =
              totalHeight -
              flightsContentY -
              distributionsFixedHeight -
              sectionGap -
              padding;

            const totalContentHeight =
              currentFilteredFlights.length * itemHeight;
            const maxScroll = Math.max(
              0,
              totalContentHeight - flightsContentHeight
            );

            // apply scroll bounds
            const newScroll = Math.max(
              0,
              Math.min(maxScroll, currentScroll + scrollDelta)
            );
            yPanelState.set('flightsScrollY', newScroll);
          }
        }}
        onMouseMove={(event) => {
          // handle mouse tracking for cursor awareness in info panel
          if (!awareness) return;

          // get coordinates relative to the main container
          const containerRect = event.currentTarget
            .closest('div')
            ?.getBoundingClientRect();

          if (containerRect) {
            const panelX = event.clientX - containerRect.left;
            const panelY = event.clientY - containerRect.top;

            // update local awareness state with cursor position
            const currentState = awareness.getLocalState() as AwarenessState;
            if (currentState) {
              awareness.setLocalState({
                ...currentState,
                cursor: {
                  x: panelX,
                  y: panelY,
                },
              });
            }
          }
        }}
      >
        <svg
          ref={panelSvgRef}
          width={panelWidth}
          height={totalHeight}
          style={{
            background: panelBackground,
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            backdropFilter: 'blur(12px)',
            pointerEvents: 'all',
          }}
        >
          <defs>
            <filter id="panel-text-shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.3" />
            </filter>
          </defs>
        </svg>
      </div>

      {/* hover mode indicator */}
      <div
        ref={modeIndicatorRef}
        style={{
          position: 'absolute',
          bottom: '0px',
          left: `${totalWidth / 2}px`,
          transform: 'translateX(-50%)',
          zIndex: 1001,
          background: 'rgba(232, 27, 35, 0.9)', // default to origins color
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          fontWeight: '600',
          textAlign: 'center',
          userSelect: 'none',
          transition: 'background 0.2s ease',
        }}
      >
        Origins
      </div>

      {/* validation indicator in top middle of vis */}
      {ySelectedFlights && ySelectedFlights.toArray().length === 2 && (
        <div
          style={{
            position: 'absolute',
            top: '0px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            background: validationResult.isValid ? '#16a34a' : '#f43f5e',
            color: 'white',
            padding: '16px 20px',
            borderRadius: '0 0 12px 12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            maxWidth: '320px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {validationResult.isValid ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '24px' }}>✅</div>
              <div>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    marginBottom: '4px',
                  }}
                >
                  Valid Solution!
                </div>
                <div style={{ fontSize: '14px', opacity: 0.9 }}>
                  congratulations! you found a matching flight pair.
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '20px' }}>❌</span>
                solution invalid
              </div>
              <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
                {validationResult.failedCriteria.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                    {validationResult.failedCriteria.map((criteria, index) => (
                      <li key={index} style={{ marginBottom: '4px' }}>
                        {criteria}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'select exactly 2 flights to validate.'
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TravelTask;
