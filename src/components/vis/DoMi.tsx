import React, { useEffect, useRef, useContext, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection as TopoGeometryCollection,
} from 'topojson-specification';
import * as Y from 'yjs';
import { YjsContext } from '../../context/YjsContext';
import {
  ForceEdgeBundling,
  type DataNodes,
  type Edge,
  type Point,
} from '../../utils/d3-ForceEdgeBundling';

// performance optimization: add css styles for state classes
const addPerformanceStyles = () => {
  const styleId = 'domi-performance-styles';

  // remove existing styles if they exist
  const existingStyle = document.getElementById(styleId);
  if (existingStyle) {
    existingStyle.remove();
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* default state styling */
    .tile {
      fill: rgba(170,170,170,0.4);
      stroke: #fff;
      stroke-width: 1.5px;
      filter: drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.2));
    }
    
    /* hover states */
    .tile.state-hover-left {
      fill: rgba(232, 27, 35, 0.6);
      stroke-width: 2.5px;
    }
    
    .tile.state-hover-right {
      fill: rgba(0, 174, 243, 0.6);
      stroke-width: 2.5px;
    }
    
    /* pinned states (overrides hover styling) */
    .tile.state-pinned {
      stroke: #FFD700;
      stroke-width: 3px;
    }
    
    /* bundled line default styling */
    .bundled-migration-line {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    
    /* highlighted line styling */
    .bundled-migration-line.line-dimmed {
      opacity: 0.3;
    }
    
    .highlighted-migration-line {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-opacity: 1;
    }
    
    .highlighted-migration-line-outline {
      fill: none;
      stroke: black;
      stroke-opacity: 0.95;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;
  document.head.appendChild(style);
};

// removed gesture-specific interfaces

// mapping of state names to their correct abbreviations
const stateAbbreviations: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

// types for topojson data
interface StateGeometry {
  type: string;
  id: string;
  properties: {
    name: string;
  };
}

interface StateTopology extends TopoTopology {
  objects: {
    states: TopoGeometryCollection;
  };
}

// types for migration data
interface Migration {
  origin: string;
  destination: string;
  value: number;
}

interface MigrationData {
  migrations: Migration[];
}

// era types
type Era = '1960s' | '1990s' | '2020s';

// view type for absolute vs rate data
type ViewType = 'absolute' | 'rate';

// constants for hover and selection styling (moved to css for performance)
// note: styling constants are now defined in css classes for better performance

// constants for edge bundling algorithm
const EDGE_BUNDLING_COMPATIBILITY_THRESHOLD = 0.1; // much lower for aggressive bundling - more edges bundle together
const EDGE_BUNDLING_STIFFNESS = 0.4; // much higher stiffness for tighter bundles
const EDGE_BUNDLING_STEP_SIZE = 0.05; // smaller steps for more refined movement
const EDGE_BUNDLING_CYCLES = 6; // more cycles for aggressive bundling
const EDGE_BUNDLING_ITERATIONS = 80; // more iterations for better convergence
const EDGE_BUNDLING_ITERATIONS_RATE = 0.6666667; // original I_rate - rate at which iteration number decreases i.e. 2/3
const EDGE_BUNDLING_SUBDIVISION_SEED = 1; // more subdivision points for smoother curves
const EDGE_BUNDLING_SUBDIVISION_RATE = 2; // original P_rate - subdivision rate increase

// constants for layout
const totalWidth = 1280;
const totalHeight = 720;
const thirdWidth = totalWidth / 3;
const mapWidth = thirdWidth * 2;
const panelWidth = thirdWidth;
const mapLeftOffset = panelWidth - 40; // move map 20px more to the left (reduced from 50px)

// toggle for including alaska and hawaii
const includeAlaskaHawaii = false; // set to true to include ak+hi+dc, false for continental us only

// constants for info panel styling (will be adapted for d3)
const panelBgColor = 'rgba(33, 33, 33, 0.65)';
const panelTxtColor = 'white';
const mainPadding = 8; // reduced from 24 for more space for components
const tooltipPanelWidth = panelWidth * 0.8; // define tooltipPanelWidth at a higher scope

// systematic spacing constants for info panel
const sectionSpacing = 20; // space between major sections
const titleSpacing = 12; // space between title and content
const itemSpacing = 48; // space for each migration flow item (increased from 45)
const buttonSectionHeight = 40; // era button height

// constants for era buttons
const buttonHeight = 48;
const buttonSpacing = 10;

// interface for migration link info
interface MigrationLinkInfo {
  origin: string;
  destination: string;
  value: number;
}

// define a non-null version of geojsonproperties for extension
// yjs shared value types (removed unused types)

// helper function to convert uppercase state names to proper case
const formatStateName = (stateName: string): string => {
  return stateName
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// manual adjustments for optimal state label positioning
// values are [x_offset, y_offset] from the geometric centroid
const stateLabelAdjustments: Record<string, [number, number]> = {
  // states that need significant repositioning due to shape or size
  CALIFORNIA: [0, 20], // move south to avoid northern mountains
  FLORIDA: [10, -5], // move slightly east and north
  TEXAS: [5, 3], // move slightly west and south
  ALASKA: [0, 0], // keep centered (if included)
  HAWAII: [0, 0], // keep centered (if included)
  NEVADA: [0, 0], // move slightly east
  UTAH: [0, 0], // keep centered
  COLORADO: [0, 0], // keep centered - rectangular shape works well
  WYOMING: [0, 0], // keep centered - rectangular shape works well
  MONTANA: [0, 0], // keep centered
  'NORTH DAKOTA': [0, 0], // keep centered
  'SOUTH DAKOTA': [0, 0], // keep centered
  NEBRASKA: [0, 0], // keep centered
  KANSAS: [0, 0], // keep centered
  OKLAHOMA: [7, 0], // move slightly east
  'NEW MEXICO': [0, 0], // keep centered
  ARIZONA: [0, 5], // move slightly south
  IDAHO: [0, 15], // move south to avoid narrow northern part
  WASHINGTON: [0, 5], // move slightly south
  OREGON: [0, 0], // keep centered
  MICHIGAN: [15, 25], // move to lower peninsula
  MINNESOTA: [-4, 5], // move slightly south
  WISCONSIN: [0, 0], // keep centered
  IOWA: [0, 0], // keep centered
  MISSOURI: [0, 0], // keep centered
  ARKANSAS: [0, 0], // keep centered
  LOUISIANA: [-10, -10], // move slightly north to main body
  MISSISSIPPI: [0, 0], // keep centered
  ALABAMA: [0, 0], // keep centered
  TENNESSEE: [-3, 0], // move slightly west
  KENTUCKY: [10, 0], // move slightly east
  INDIANA: [0, 0], // keep centered
  OHIO: [0, 0], // keep centered
  'WEST VIRGINIA': [-3, 3], // move slightly west and north
  VIRGINIA: [5, 0], // move slightly east to main body
  'NORTH CAROLINA': [5, 0], // move slightly east
  'SOUTH CAROLINA': [0, 0], // keep centered
  GEORGIA: [0, 0], // keep centered
  PENNSYLVANIA: [0, 0], // keep centered
  'NEW YORK': [7, 0], // move south to avoid northern regions
  VERMONT: [0, 0], // keep centered
  'NEW HAMPSHIRE': [0, 0], // keep centered
  MAINE: [2, 0], // move north to main body
  MASSACHUSETTS: [0, 0], // keep centered
  'RHODE ISLAND': [0, 0], // keep centered
  CONNECTICUT: [0, 0], // move slightly east
  'NEW JERSEY': [0, 0], // keep centered
  DELAWARE: [0, 0], // keep centered
  MARYLAND: [5, 0], // move slightly east
  'DISTRICT OF COLUMBIA': [0, 0], // keep centered (if included)
  ILLINOIS: [0, 0], // keep centered
};

// function to get optimal label position for a state
const getStateLabelPosition = (
  feature: Feature<Geometry, GeoJsonProperties>,
  pathGenerator: d3.GeoPath<unknown, d3.GeoPermissibleObjects>
): [number, number] => {
  const stateName = (
    feature.properties as StateGeometry['properties']
  )?.name?.toUpperCase();
  const centroid = pathGenerator.centroid(feature);

  // return fallback position if centroid calculation fails
  if (isNaN(centroid[0]) || isNaN(centroid[1])) {
    return [0, 0];
  }

  // apply manual adjustment if available
  if (stateName && stateLabelAdjustments[stateName]) {
    const [xOffset, yOffset] = stateLabelAdjustments[stateName];
    return [centroid[0] + xOffset, centroid[1] + yOffset];
  }

  // default to centroid for states without specific adjustments
  return [centroid[0], centroid[1]];
};

// states that need external labels with leader lines (northeastern states)
const statesWithLeaderLines = new Set([
  'VERMONT',
  'NEW HAMPSHIRE',
  'MARYLAND',
  'DELAWARE',
  'NEW JERSEY',
  'CONNECTICUT',
  'RHODE ISLAND',
  'MASSACHUSETTS',
]);

// external label positions for states with leader lines
// values are [x_offset, y_offset] from the map bounds for external positioning
const externalLabelPositions: Record<string, [number, number]> = {
  VERMONT: [780, 160], // position to the right of new england
  'NEW HAMPSHIRE': [800, 130], // position to the right of new england
  MASSACHUSETTS: [855, 220], // position to the right of new england
  'RHODE ISLAND': [865, 255], // position to the right of new england
  CONNECTICUT: [860, 280], // position to the right of new england
  'NEW JERSEY': [830, 300], // position to the right of mid-atlantic
  DELAWARE: [820, 320], // position to the right of mid-atlantic
  MARYLAND: [810, 340], // position to the right of mid-atlantic
};

// adjustments for external label positioning relative to their base positions
// values are [x_offset, y_offset] from the base external position
const externalLabelAdjustments: Record<string, [number, number]> = {
  VERMONT: [-13, -7], // no adjustment from base position
  'NEW HAMPSHIRE': [-16, -7], // no adjustment from base position
  MASSACHUSETTS: [0, 0], // no adjustment from base position
  'RHODE ISLAND': [0, 0], // no adjustment from base position
  CONNECTICUT: [0, 0], // no adjustment from base position
  'NEW JERSEY': [0, 0], // no adjustment from base position
  DELAWARE: [0, 0], // no adjustment from base position
  MARYLAND: [0, 0], // no adjustment from base position
};

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
    stateName?: string;
  };
  brushSelection?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    mode: 'origin' | 'destination';
  };
  timestamp?: number;
}

// cursor data interface
interface CursorData {
  state: AwarenessState;
  clientId: number;
  isLocal: boolean;
}

const DoMi: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const panelSvgRef = useRef<SVGSVGElement>(null); // ref for the info panel svg
  const gRef = useRef<SVGGElement | null>(null);
  const cursorOverlayRef = useRef<HTMLDivElement>(null);
  const migrationDataByEra = useRef<Record<Era, Migration[]>>({
    '1960s': [],
    '1990s': [],
    '2020s': [],
  });
  const migrationRateDataByEra = useRef<Record<Era, Migration[]>>({
    '1960s': [],
    '1990s': [],
    '2020s': [],
  });
  const stateCentroidsRef = useRef<Record<string, [number, number]>>({});
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());
  const bundledPathsRef = useRef<
    Record<
      Era,
      Record<ViewType, Map<string, { points: Point[]; value: number }>>
    >
  >({
    '1960s': { absolute: new Map(), rate: new Map() },
    '1990s': { absolute: new Map(), rate: new Map() },
    '2020s': { absolute: new Map(), rate: new Map() },
  }); // store bundled paths with migration values for all eras and view types
  const allBundledLinesRef = useRef<SVGGElement | null>(null); // group for all bundled lines
  const isInitializedRef = useRef(false);
  const buttonContainerRef = useRef<SVGGElement | null>(null);
  const currentEraRef = useRef<Era>('2020s');
  const currentViewTypeRef = useRef<ViewType>('absolute');
  const calculateAndStoreMigrationsRef = useRef<(() => void) | null>(null);

  const { doc, awareness } = useContext(YjsContext) ?? {};
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [migrationDataLoaded, setMigrationDataLoaded] = useState(false);

  const yHoveredLeftStates = doc?.getArray<string>('usTileHoveredLeftStates');
  const yHoveredRightStates = doc?.getArray<string>('usTileHoveredRightStates');
  const yPinnedLeftStates = doc?.getArray<string>('usTilePinnedLeftStates');
  const yPinnedRightStates = doc?.getArray<string>('usTilePinnedRightStates');
  const yClientBrushSelectionsLeft = doc?.getMap<string[]>(
    'usTileClientBrushSelectionsLeft'
  );
  const yClientBrushSelectionsRight = doc?.getMap<string[]>(
    'usTileClientBrushSelectionsRight'
  );
  const yActiveMigrationLinks = doc?.getArray<Y.Map<unknown>>(
    'usTileActiveMigrationLinks'
  );
  const yTotalMigrationValue = doc?.getMap<string | number>(
    'usTileTotalMigrationValue'
  );
  const ySharedState = doc?.getMap<string | boolean | null | string[] | number>(
    'usTileSharedState'
  );

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

  const hoverModeRef = useRef<'origin' | 'destination'>('origin');
  const modeIndicatorRef = useRef<HTMLDivElement | null>(null);

  const width = totalWidth;
  const height = totalHeight;

  const updateModeIndicator = () => {
    if (modeIndicatorRef.current) {
      const isOriginMode = hoverModeRef.current === 'origin';
      modeIndicatorRef.current.textContent = isOriginMode
        ? 'Origins'
        : 'Destinations';
      modeIndicatorRef.current.style.background = isOriginMode
        ? 'rgba(232, 27, 35, 0.9)'
        : 'rgba(0, 174, 243, 0.9)';
    }
  };

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      setSyncStatus(true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [doc]);

  useEffect(() => {
    if (!awareness) return;

    awareness.setLocalState({
      user: { name: userName, color: userColor, id: userId },
      cursor: { x: 0, y: 0 },
    } as AwarenessState);

    return () => {
      awareness.setLocalState(null);
    };
  }, [awareness, userId, userName, userColor]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.altKey || event.shiftKey)
        return;

      if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
        const currentMode = hoverModeRef.current;
        const currentHoverArray =
          currentMode === 'origin' ? yHoveredLeftStates : yHoveredRightStates;
        const targetHoverArray =
          currentMode === 'origin' ? yHoveredRightStates : yHoveredLeftStates;
        const targetPinnedArray =
          currentMode === 'origin' ? yPinnedRightStates : yPinnedLeftStates;

        if (currentHoverArray && targetHoverArray && targetPinnedArray) {
          const currentHovered = currentHoverArray.toArray();
          const targetPinned = targetPinnedArray.toArray();

          if (currentHovered.length > 0) {
            currentHoverArray.delete(0, currentHoverArray.length);
          }

          if (currentHovered.length > 0) {
            const transferable = currentHovered.filter(
              (state) => !targetPinned.includes(state)
            );
            if (transferable.length > 0) {
              if (targetHoverArray.length > 0) {
                targetHoverArray.delete(0, targetHoverArray.length);
              }
              targetHoverArray.push(transferable);
            }
          }
        }

        hoverModeRef.current =
          hoverModeRef.current === 'origin' ? 'destination' : 'origin';
        updateModeIndicator();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    updateModeIndicator();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    yHoveredLeftStates,
    yHoveredRightStates,
    yPinnedLeftStates,
    yPinnedRightStates,
  ]);

  // removed transform synchronization for non-gesture version

  // load all migration data files (both absolute and rate)
  useEffect(() => {
    const loadMigrationData = async () => {
      try {
        const [
          data1960s,
          data1990s,
          data2020s,
          rateData1960s,
          rateData1990s,
          rateData2020s,
        ] = await Promise.all([
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_1960s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_1990s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_2020s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_rate_1960s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_rate_1990s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_rate_2020s.json'
          ),
        ]);

        if (
          data1960s &&
          data1990s &&
          data2020s &&
          rateData1960s &&
          rateData1990s &&
          rateData2020s
        ) {
          migrationDataByEra.current = {
            '1960s': data1960s.migrations,
            '1990s': data1990s.migrations,
            '2020s': data2020s.migrations,
          };
          migrationRateDataByEra.current = {
            '1960s': rateData1960s.migrations,
            '1990s': rateData1990s.migrations,
            '2020s': rateData2020s.migrations,
          };
          setMigrationDataLoaded(true);
        }
      } catch (error) {
        console.error('error loading migration era data:', error);
      }
    };

    loadMigrationData();
  }, []);

  // removed getStateName function (was only used in gesture interaction handler)

  const getPairKey = (origin: string, destination: string): string =>
    `${origin}->${destination}`;

  // helper function to get current dataset based on era and view type
  const getCurrentMigrationData = (
    era: Era,
    viewType: ViewType
  ): Migration[] => {
    if (viewType === 'rate') {
      return migrationRateDataByEra.current[era] || [];
    }
    return migrationDataByEra.current[era] || [];
  };

  const formatMigrationValue = (
    value: number | string,
    viewType: ViewType = currentViewTypeRef.current
  ): string => {
    if (typeof value === 'string') return String(value);

    const numValue = Number(value);

    // for rate data, show per 100k inhabitants
    if (viewType === 'rate') {
      if (numValue >= 1000) {
        const thousands = Math.round(numValue / 1000);
        return `${thousands}K per 100K`;
      }
      return `${numValue} per 100K`;
    }

    // for absolute data, use existing formatting
    // if value is a million or more, round to nearest ten thousand and show as X.XM
    if (numValue >= 1000000) {
      const millions = numValue / 1000000;
      const rounded = Math.round(millions * 100) / 100; // round to nearest 0.01M (which is 10K)
      return `${rounded.toFixed(2)}M`;
    }

    // if value is a thousand or more, round to nearest thousand and show as XXXK
    if (numValue >= 1000) {
      const thousands = Math.round(numValue / 1000);
      return `${thousands}K`;
    }

    // if less than a thousand, show as is
    return String(numValue);
  };

  // compute bundled paths for all migration flows using force-directed edge bundling for all eras and view types
  const computeBundledPaths = () => {
    if (Object.keys(stateCentroidsRef.current).length === 0) {
      return;
    }

    console.log('computing bundled paths for all 6 combinations...');

    // convert state centroids to the format expected by ForceEdgeBundling
    const nodes: DataNodes = {};
    Object.entries(stateCentroidsRef.current).forEach(
      ([stateName, centroid]) => {
        nodes[stateName] = {
          x: centroid[0] + mapLeftOffset,
          y: centroid[1] - totalHeight * 0.1,
        };
      }
    );

    // compute bundled paths for each era and view type combination
    const eras: Era[] = ['1960s', '1990s', '2020s'];
    const viewTypes: ViewType[] = ['absolute', 'rate'];

    eras.forEach((era) => {
      viewTypes.forEach((viewType) => {
        console.log(`computing bundled paths for ${era} ${viewType}...`);

        const allMigrationData = includeAlaskaHawaii
          ? getCurrentMigrationData(era, viewType)
          : getCurrentMigrationData(era, viewType).filter(
              (migration) =>
                !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                  migration.origin
                ) &&
                !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                  migration.destination
                )
            );

        // sort by migration value and take only the top 100 flows
        const currentMigrationData = allMigrationData
          .sort((a, b) => b.value - a.value)
          .slice(0, 100);

        // convert migration data to edges format and create a value mapping
        const edgesWithValues: { edge: Edge; value: number }[] =
          currentMigrationData
            .filter(
              (migration) =>
                nodes[migration.origin] && nodes[migration.destination]
            )
            .map((migration) => ({
              edge: { source: migration.origin, target: migration.destination },
              value: migration.value,
            }));

        const edges: Edge[] = edgesWithValues.map((item) => item.edge);

        if (edges.length === 0) {
          return;
        }

        try {
          // check if ForceEdgeBundling is available
          if (!ForceEdgeBundling || typeof ForceEdgeBundling !== 'function') {
            throw new Error('ForceEdgeBundling is not available');
          }

          // create and configure the bundling algorithm with proper type handling
          const bundling = ForceEdgeBundling() as {
            nodes: (nl?: DataNodes) => unknown;
            edges: (ll?: Edge[]) => unknown;
            compatibility_threshold: (t?: number) => unknown;
            bundling_stiffness: (k?: number) => unknown;
            step_size: (step?: number) => unknown;
            cycles: (c?: number) => unknown;
            iterations: (i?: number) => unknown;
            iterations_rate: (i?: number) => unknown;
            subdivision_points_seed: (p?: number) => unknown;
            subdivision_rate: (r?: number) => unknown;
            (): Point[][];
          };

          // configure the bundling algorithm
          (bundling.nodes as (nl: DataNodes) => unknown)(nodes);
          (bundling.edges as (ll: Edge[]) => unknown)(edges);
          (bundling.compatibility_threshold as (t: number) => unknown)(
            EDGE_BUNDLING_COMPATIBILITY_THRESHOLD
          );
          (bundling.bundling_stiffness as (k: number) => unknown)(
            EDGE_BUNDLING_STIFFNESS
          );
          (bundling.step_size as (step: number) => unknown)(
            EDGE_BUNDLING_STEP_SIZE
          );
          (bundling.cycles as (c: number) => unknown)(EDGE_BUNDLING_CYCLES);
          (bundling.iterations as (i: number) => unknown)(
            EDGE_BUNDLING_ITERATIONS
          );
          (bundling.iterations_rate as (i: number) => unknown)(
            EDGE_BUNDLING_ITERATIONS_RATE
          );
          (bundling.subdivision_points_seed as (p: number) => unknown)(
            EDGE_BUNDLING_SUBDIVISION_SEED
          );
          (bundling.subdivision_rate as (r: number) => unknown)(
            EDGE_BUNDLING_SUBDIVISION_RATE
          );

          // compute bundled paths
          const bundledPaths = (bundling as () => Point[][])();

          // store bundled paths for this era and view type with correct values
          bundledPathsRef.current[era][viewType].clear();
          edges.forEach((edge, index) => {
            const pairKey = getPairKey(edge.source, edge.target);
            bundledPathsRef.current[era][viewType].set(pairKey, {
              points: bundledPaths[index],
              value: edgesWithValues[index].value,
            });
          });
        } catch (error) {
          console.error(
            `error computing bundled paths for era ${era} viewtype ${viewType}, falling back to straight lines:`,
            error
          );

          // fallback to straight line paths if bundling fails
          bundledPathsRef.current[era][viewType].clear();
          edgesWithValues.forEach(({ edge, value }) => {
            const pairKey = getPairKey(edge.source, edge.target);
            const originNode = nodes[edge.source];
            const targetNode = nodes[edge.target];

            // create a simple straight line path as fallback
            const straightPath: Point[] = [
              { x: originNode.x, y: originNode.y },
              { x: targetNode.x, y: targetNode.y },
            ];

            bundledPathsRef.current[era][viewType].set(pairKey, {
              points: straightPath,
              value: value,
            });
          });
        }
      });
    });

    console.log('finished computing all bundled paths');
  };

  // render all bundled migration lines on the map for the current era and view type
  const renderAllBundledLines = () => {
    if (
      !svgRef.current ||
      bundledPathsRef.current[currentEraRef.current][currentViewTypeRef.current]
        .size === 0
    )
      return;

    const svg = d3.select(svgRef.current);

    // remove existing base bundled lines group and their specific gradients
    svg.select('g.all-bundled-lines').remove();
    // svg.select('g.highlighted-bundled-lines').remove(); // do not remove the highlight group
    svg
      .select('defs')
      .selectAll(
        'linearGradient[id^="migration-gradient-"]:not([id^="highlight-migration-gradient-"]):not([id^="temp-migration-gradient-"])'
      )
      .remove(); // only remove base gradients

    // ensure defs exists for gradients
    const defsSelection = svg.select('defs');
    const defs = defsSelection.empty() ? svg.append('defs') : defsSelection;

    // create new group for bundled lines (background layer)
    const bundledLinesGroup = svg
      .append('g') // append to be on top of previously added elements (like the map)
      .attr('class', 'all-bundled-lines')
      .style('pointer-events', 'none');

    // ensure group for highlighted lines (foreground layer) exists, create if not
    let highlightedLinesGroup = svg.select<SVGGElement>(
      'g.highlighted-bundled-lines'
    );
    if (highlightedLinesGroup.empty()) {
      highlightedLinesGroup = svg
        .append('g')
        .attr('class', 'highlighted-bundled-lines')
        .style('pointer-events', 'none');
    }

    allBundledLinesRef.current = bundledLinesGroup.node();

    // get the bundled paths for the current era and view type
    const currentEraBundledPaths =
      bundledPathsRef.current[currentEraRef.current][
        currentViewTypeRef.current
      ];

    // calculate min and max values for logarithmic scaling
    const values = Array.from(currentEraBundledPaths.values()).map(
      (data) => data.value
    );
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const minStrokeWidth = 2;
    const maxStrokeWidth = 12;

    // render each bundled path with directional gradient
    currentEraBundledPaths.forEach((data, pairKey) => {
      if (data.points.length < 2) return;

      // calculate linear stroke width based on migration value
      let strokeWidth: number;
      if (maxValue === minValue) {
        strokeWidth = maxStrokeWidth;
      } else {
        const normalizedValue = (data.value - minValue) / (maxValue - minValue);
        strokeWidth =
          minStrokeWidth + normalizedValue * (maxStrokeWidth - minStrokeWidth);
      }

      // create unique gradient id for this path
      const gradientId = `migration-gradient-${pairKey.replace(
        /[^a-zA-Z0-9]/g,
        '-'
      )}`;

      // get start and end points for gradient direction
      const startPoint = data.points[0];
      const endPoint = data.points[data.points.length - 1];

      // create linear gradient based on path direction
      const gradient = defs
        .append('linearGradient')
        .attr('id', gradientId)
        .attr('class', 'migration-gradient')
        .attr('x1', startPoint.x)
        .attr('y1', startPoint.y)
        .attr('x2', endPoint.x)
        .attr('y2', endPoint.y)
        .attr('gradientUnits', 'userSpaceOnUse');

      // red at origin (start), blue at destination (end)
      gradient
        .append('stop')
        .attr('offset', '0%')
        .attr('stop-color', '#e53e3e') // red for origin
        .attr('stop-opacity', 0.2);

      gradient
        .append('stop')
        .attr('offset', '100%')
        .attr('stop-color', '#3182ce') // blue for destination
        .attr('stop-opacity', 0.2);

      // create line generator for the bundled path
      const lineGenerator = d3
        .line<Point>()
        .x((d) => d.x)
        .y((d) => d.y)
        .curve(d3.curveBasis); // smooth curve for bundled appearance

      const pathData = lineGenerator(data.points);
      if (!pathData) return;

      // create bundled lines with directional gradient
      bundledLinesGroup
        .append('path')
        .attr('class', 'bundled-migration-line')
        .attr('d', pathData)
        .attr('stroke', `url(#${gradientId})`)
        .attr('stroke-width', strokeWidth) // linearly scaled thickness
        .attr('data-pair-key', pairKey)
        .attr('data-value', data.value) // store value for potential use
        .attr('data-gradient-id', gradientId) // store gradient id for highlighting
        .attr('data-path-data', pathData); // store path data for highlighting
      // css classes handle fill and stroke styling for performance
    });
  };

  // highlight specific bundled lines based on active migration links
  const highlightBundledLines = (activeMigrationLinks: MigrationLinkInfo[]) => {
    if (!allBundledLinesRef.current) return;

    const bundledLinesGroup = d3.select(allBundledLinesRef.current);
    const svg = d3.select(svgRef.current);
    const highlightedLinesGroup = svg.select('g.highlighted-bundled-lines');

    // clear any existing highlighted lines
    highlightedLinesGroup.selectAll('*').remove();

    // clear existing highlight and temp gradients from defs to prevent memory leaks
    // these gradients accumulate over time as they're created on each hover/selection change
    // but only the path elements (not gradients) were being removed previously
    svg
      .select('defs')
      .selectAll(
        'linearGradient[id^="highlight-migration-gradient-"], linearGradient[id^="temp-migration-gradient-"]'
      )
      .remove();

    // get the bundled paths for the current era and view type
    const currentEraBundledPaths =
      bundledPathsRef.current[currentEraRef.current][
        currentViewTypeRef.current
      ];

    // calculate min/max values ONLY from bundled paths for consistent stroke width scaling
    const bundledValues = Array.from(currentEraBundledPaths.values()).map(
      (data) => data.value
    );

    const bundledMaxValue = Math.max(...bundledValues);
    const bundledMinValue = Math.min(...bundledValues);
    const minStrokeWidth = 2;
    const maxStrokeWidth = 12;

    // reset all bundled lines to their original appearance without recalculating stroke widths
    bundledLinesGroup
      .selectAll('path.bundled-migration-line')
      .classed('line-dimmed', false)
      .style('filter', 'none');

    // highlight the active migration links by creating thick, high-opacity gradient lines in the foreground group
    const top5Links = activeMigrationLinks.slice(0, 5);
    if (top5Links.length > 0) {
      // ensure defs exists for gradients
      const defsSelection = svg.select('defs');
      const defs = defsSelection.empty() ? svg.append('defs') : defsSelection;

      // create line generator for temporary straight-line paths
      const lineGenerator = d3
        .line<[number, number]>()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveBasis);

      top5Links.forEach((link) => {
        const pairKey = getPairKey(link.origin, link.destination);

        // calculate much thicker highlighted line width using bundled values scaling
        let highlightedWidth: number;
        let normalizedValue: number;
        if (bundledMaxValue === bundledMinValue) {
          highlightedWidth = maxStrokeWidth;
          normalizedValue = 1;
        } else {
          normalizedValue = Math.max(
            0,
            Math.min(
              1,
              (link.value - bundledMinValue) /
                (bundledMaxValue - bundledMinValue)
            )
          );
          highlightedWidth =
            minStrokeWidth +
            normalizedValue * (maxStrokeWidth - minStrokeWidth);
        }

        // check if this link is already in the bundled paths for the current era
        const bundledData = currentEraBundledPaths.get(pairKey);

        if (bundledData) {
          // get the original path data and gradient from the background line
          const originalLine = bundledLinesGroup.select(
            `path[data-pair-key="${pairKey}"]`
          );

          // check if originalLine exists and has a node
          if (originalLine.empty() || !originalLine.node()) {
            return; // skip this link if no corresponding background line exists
          }

          const pathData = originalLine.attr('data-path-data');
          const gradientId = originalLine.attr('data-gradient-id');

          if (pathData && gradientId) {
            // create new highlighted gradient for bundled lines
            const highlightGradientId = `highlight-migration-gradient-${pairKey.replace(
              /[^a-zA-Z0-9]/g,
              '-'
            )}`;

            // get start and end points from bundled data for gradient direction
            const startPoint = bundledData.points[0];
            const endPoint = bundledData.points[bundledData.points.length - 1];

            const highlightGradient = defs
              .append('linearGradient')
              .attr('id', highlightGradientId)
              .attr('class', 'migration-gradient')
              .attr('x1', startPoint.x)
              .attr('y1', startPoint.y)
              .attr('x2', endPoint.x)
              .attr('y2', endPoint.y)
              .attr('gradientUnits', 'userSpaceOnUse');

            // vibrant red at origin (start), bright blue at destination (end)
            highlightGradient
              .append('stop')
              .attr('offset', '0%')
              .attr('stop-color', '#ff0000') // even brighter red for highlighted origin
              .attr('stop-opacity', 0.95);

            highlightGradient
              .append('stop')
              .attr('offset', '100%')
              .attr('stop-color', '#0066ff') // even brighter blue for highlighted destination
              .attr('stop-opacity', 0.95);

            // create highlighted line using new distinctive gradient with same width as background
            const backgroundStrokeWidth =
              Number(originalLine.attr('stroke-width')) || highlightedWidth;
            const outlineStrokeWidth = backgroundStrokeWidth + 2; // 1px outline on each side

            // draw the black outline path first
            highlightedLinesGroup
              .append('path')
              .attr('class', 'highlighted-migration-line-outline')
              .attr('d', pathData)
              .attr('stroke-width', outlineStrokeWidth)
              .attr('data-pair-key', pairKey); // for consistency
            // css classes handle stroke, fill, opacity, and line caps

            // draw the main gradient path on top
            highlightedLinesGroup
              .append('path')
              .attr('class', 'highlighted-migration-line')
              .attr('d', pathData)
              .attr('stroke', `url(#${highlightGradientId})`) // use new distinctive gradient
              .attr('stroke-width', backgroundStrokeWidth) // same width as background line
              .attr('data-pair-key', pairKey);
            // css classes handle fill, opacity, and line caps
          }
        } else {
          // this link is not in the bundled paths, create a temporary straight line with gradient
          const originCentroid =
            stateCentroidsRef.current[link.origin.toUpperCase()];
          const destCentroid =
            stateCentroidsRef.current[link.destination.toUpperCase()];

          if (originCentroid && destCentroid) {
            // adjust coordinates to match map positioning
            const adjustedOrigin: [number, number] = [
              originCentroid[0] + mapLeftOffset,
              originCentroid[1] - totalHeight * 0.1,
            ];
            const adjustedDest: [number, number] = [
              destCentroid[0] + mapLeftOffset,
              destCentroid[1] - totalHeight * 0.1,
            ];

            // create gradient for temporary line
            const tempGradientId = `temp-migration-gradient-${pairKey.replace(
              /[^a-zA-Z0-9]/g,
              '-'
            )}`;

            const tempGradient = defs
              .append('linearGradient')
              .attr('id', tempGradientId)
              .attr('class', 'migration-gradient')
              .attr('x1', adjustedOrigin[0])
              .attr('y1', adjustedOrigin[1])
              .attr('x2', adjustedDest[0])
              .attr('y2', adjustedDest[1])
              .attr('gradientUnits', 'userSpaceOnUse');

            // red at origin (start), blue at destination (end) with full opacity
            tempGradient
              .append('stop')
              .attr('offset', '0%')
              .attr('stop-color', '#ff0000') // even brighter red for highlighted origin
              .attr('stop-opacity', 1); // full opacity for highlighting

            tempGradient
              .append('stop')
              .attr('offset', '100%')
              .attr('stop-color', '#0066ff') // even brighter blue for highlighted destination
              .attr('stop-opacity', 1); // full opacity for highlighting

            const straightLinePath = lineGenerator([
              adjustedOrigin,
              adjustedDest,
            ]);

            if (straightLinePath) {
              // calculate what the background line width would be for this value using bundled values scaling
              let backgroundEquivalentWidth: number;
              if (bundledMaxValue === bundledMinValue) {
                backgroundEquivalentWidth = maxStrokeWidth;
              } else {
                const normalizedValue = Math.max(
                  0,
                  Math.min(
                    1,
                    (link.value - bundledMinValue) /
                      (bundledMaxValue - bundledMinValue)
                  )
                );
                backgroundEquivalentWidth =
                  minStrokeWidth +
                  normalizedValue * (maxStrokeWidth - minStrokeWidth);
              }

              const temporaryOutlineStrokeWidth = backgroundEquivalentWidth + 2; // 1px outline on each side

              // draw the black outline path first for temporary lines
              highlightedLinesGroup
                .append('path')
                .attr('class', 'highlighted-migration-line-outline temporary')
                .attr('d', straightLinePath)
                .attr('stroke-width', temporaryOutlineStrokeWidth)
                .attr('data-pair-key', pairKey);
              // css classes handle stroke, fill, opacity, and line caps

              // create highlighted line using temporary gradient with background-equivalent width
              highlightedLinesGroup
                .append('path')
                .attr('class', 'highlighted-migration-line temporary')
                .attr('d', straightLinePath)
                .attr('stroke', `url(#${tempGradientId})`) // use temporary gradient
                .attr('stroke-width', backgroundEquivalentWidth) // same width as background would be
                .attr('data-pair-key', pairKey);
              // css classes handle fill, opacity, and line caps
            }
          }
        }
      });
    }
  };

  const clearAllD3MigrationLines = () => {
    d3.select(svgRef.current).selectAll('path.migration-line').remove();
    activeLinesByPair.current.clear();
  };

  useEffect(() => {
    if (
      !doc ||
      !syncStatus ||
      !yHoveredLeftStates ||
      !yHoveredRightStates ||
      !yPinnedLeftStates ||
      !yPinnedRightStates ||
      !yActiveMigrationLinks ||
      !yTotalMigrationValue ||
      !yClientBrushSelectionsLeft ||
      !yClientBrushSelectionsRight ||
      getCurrentMigrationData(currentEraRef.current, currentViewTypeRef.current)
        .length === 0
    )
      return;

    const calculateAndStoreMigrations = () => {
      const currentLeftHovered = yHoveredLeftStates.toArray();
      const currentRightHovered = yHoveredRightStates.toArray();
      const currentLeftPinned = yPinnedLeftStates?.toArray() || [];
      const currentRightPinned = yPinnedRightStates?.toArray() || [];

      const allBrushLeftStates: string[] = [];
      yClientBrushSelectionsLeft?.forEach((states) => {
        allBrushLeftStates.push(...states);
      });

      const allBrushRightStates: string[] = [];
      yClientBrushSelectionsRight?.forEach((states) => {
        allBrushRightStates.push(...states);
      });

      // combine hovered and pinned states
      const originStates = new Set<string>([
        ...currentLeftHovered,
        ...currentLeftPinned,
        ...allBrushLeftStates,
      ]);
      const destStates = new Set<string>([
        ...currentRightHovered,
        ...currentRightPinned,
        ...allBrushRightStates,
      ]);

      doc.transact(() => {
        // case 1: no states selected at all
        if (originStates.size === 0 && destStates.size === 0) {
          if (yActiveMigrationLinks.length > 0) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
          }
          yTotalMigrationValue.set('value', 'select states to view data');
        }
        // case 2: only origins selected (left hand hover)
        else if (originStates.size > 0 && destStates.size === 0) {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // convert state names to uppercase for migration data comparison
          const originStatesUpper = new Set(
            [...originStates].map((s) => s.toUpperCase())
          );

          // calculate migration from selected origins to all other states (excluding origins)
          const migrationData = includeAlaskaHawaii
            ? getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              )
            : getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              ).filter(
                (migration) =>
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.origin
                  ) &&
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.destination
                  )
              );

          migrationData.forEach((migration) => {
            if (
              originStatesUpper.has(migration.origin) &&
              !originStatesUpper.has(migration.destination)
            ) {
              const pairKey = getPairKey(
                migration.origin,
                migration.destination
              );
              migrationsByPair.set(
                pairKey,
                (migrationsByPair.get(pairKey) || 0) + migration.value
              );
              totalValue += migration.value;
            }
          });

          migrationsByPair.forEach((value, pairKey) => {
            const [origin, destination] = pairKey.split('->');
            newMigrationLinksInfo.push({ origin, destination, value });
          });

          newMigrationLinksInfo.sort((a, b) => b.value - a.value);
          const topLinks = newMigrationLinksInfo.slice(0, 5);

          const currentYLinks = yActiveMigrationLinks.map(
            (m) => m.toJSON() as MigrationLinkInfo
          );
          if (JSON.stringify(currentYLinks) !== JSON.stringify(topLinks)) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
            const yMapsToAdd = topLinks.map((link) => {
              const yMap = new Y.Map();
              Object.entries(link).forEach(([key, val]) => yMap.set(key, val));
              return yMap;
            });
            if (yMapsToAdd.length > 0) yActiveMigrationLinks.push(yMapsToAdd);
          }

          if (yTotalMigrationValue.get('value') !== totalValue) {
            yTotalMigrationValue.set('value', totalValue);
          }
        }
        // case 3: only destinations selected (right hand hover)
        else if (originStates.size === 0 && destStates.size > 0) {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // convert state names to uppercase for migration data comparison
          const destStatesUpper = new Set(
            [...destStates].map((s) => s.toUpperCase())
          );

          // calculate migration from all other states (excluding destinations) to selected destinations
          const migrationData = includeAlaskaHawaii
            ? getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              )
            : getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              ).filter(
                (migration) =>
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.origin
                  ) &&
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.destination
                  )
              );

          migrationData.forEach((migration) => {
            if (
              !destStatesUpper.has(migration.origin) &&
              destStatesUpper.has(migration.destination)
            ) {
              const pairKey = getPairKey(
                migration.origin,
                migration.destination
              );
              migrationsByPair.set(
                pairKey,
                (migrationsByPair.get(pairKey) || 0) + migration.value
              );
              totalValue += migration.value;
            }
          });

          migrationsByPair.forEach((value, pairKey) => {
            const [origin, destination] = pairKey.split('->');
            newMigrationLinksInfo.push({ origin, destination, value });
          });

          newMigrationLinksInfo.sort((a, b) => b.value - a.value);
          const topLinks = newMigrationLinksInfo.slice(0, 5);

          const currentYLinks = yActiveMigrationLinks.map(
            (m) => m.toJSON() as MigrationLinkInfo
          );
          if (JSON.stringify(currentYLinks) !== JSON.stringify(topLinks)) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
            const yMapsToAdd = topLinks.map((link) => {
              const yMap = new Y.Map();
              Object.entries(link).forEach(([key, val]) => yMap.set(key, val));
              return yMap;
            });
            if (yMapsToAdd.length > 0) yActiveMigrationLinks.push(yMapsToAdd);
          }

          if (yTotalMigrationValue.get('value') !== totalValue) {
            yTotalMigrationValue.set('value', totalValue);
          }
        }
        // case 4: both origins and destinations selected (existing logic)
        else {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // convert state names to uppercase for migration data comparison
          const originStatesUpper = new Set(
            [...originStates].map((s) => s.toUpperCase())
          );
          const destStatesUpper = new Set(
            [...destStates].map((s) => s.toUpperCase())
          );

          // use current era data
          const migrationData = includeAlaskaHawaii
            ? getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              )
            : getCurrentMigrationData(
                currentEraRef.current,
                currentViewTypeRef.current
              ).filter(
                (migration) =>
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.origin
                  ) &&
                  !['ALASKA', 'HAWAII', 'DISTRICT OF COLUMBIA'].includes(
                    migration.destination
                  )
              );

          migrationData.forEach((migration) => {
            if (
              originStatesUpper.has(migration.origin) &&
              destStatesUpper.has(migration.destination)
            ) {
              const pairKey = getPairKey(
                migration.origin,
                migration.destination
              );
              migrationsByPair.set(
                pairKey,
                (migrationsByPair.get(pairKey) || 0) + migration.value
              );
              totalValue += migration.value;
            }
          });

          migrationsByPair.forEach((value, pairKey) => {
            const [origin, destination] = pairKey.split('->');
            newMigrationLinksInfo.push({ origin, destination, value });
          });

          newMigrationLinksInfo.sort((a, b) => b.value - a.value);
          const topLinks = newMigrationLinksInfo.slice(0, 5);

          const currentYLinks = yActiveMigrationLinks.map(
            (m) => m.toJSON() as MigrationLinkInfo
          );
          if (JSON.stringify(currentYLinks) !== JSON.stringify(topLinks)) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
            const yMapsToAdd = topLinks.map((link) => {
              const yMap = new Y.Map();
              Object.entries(link).forEach(([key, val]) => yMap.set(key, val));
              return yMap;
            });
            if (yMapsToAdd.length > 0) yActiveMigrationLinks.push(yMapsToAdd);
          }

          if (yTotalMigrationValue.get('value') !== totalValue) {
            yTotalMigrationValue.set('value', totalValue);
          }
        }
      }, 'update-migration-calculations');
    };

    // store the function in ref so it can be called manually when era changes
    calculateAndStoreMigrationsRef.current = calculateAndStoreMigrations;

    yHoveredLeftStates.observeDeep(calculateAndStoreMigrations);
    yHoveredRightStates.observeDeep(calculateAndStoreMigrations);
    yPinnedLeftStates.observeDeep(calculateAndStoreMigrations);
    yPinnedRightStates.observeDeep(calculateAndStoreMigrations);
    yClientBrushSelectionsLeft.observeDeep(calculateAndStoreMigrations);
    yClientBrushSelectionsRight.observeDeep(calculateAndStoreMigrations);
    calculateAndStoreMigrations();

    return () => {
      yHoveredLeftStates.unobserveDeep(calculateAndStoreMigrations);
      yHoveredRightStates.unobserveDeep(calculateAndStoreMigrations);
      yPinnedLeftStates.unobserveDeep(calculateAndStoreMigrations);
      yPinnedRightStates.unobserveDeep(calculateAndStoreMigrations);
      yClientBrushSelectionsLeft.unobserveDeep(calculateAndStoreMigrations);
      yClientBrushSelectionsRight.unobserveDeep(calculateAndStoreMigrations);
    };
  }, [
    doc,
    syncStatus,
    yHoveredLeftStates,
    yHoveredRightStates,
    yPinnedLeftStates,
    yPinnedRightStates,
    yActiveMigrationLinks,
    yTotalMigrationValue,
    migrationDataLoaded,
    yClientBrushSelectionsLeft,
    yClientBrushSelectionsRight,
  ]);

  // function to update the info panel with migration data
  const updateInfoPanel = () => {
    if (
      !doc ||
      !panelSvgRef.current ||
      !yActiveMigrationLinks ||
      !yTotalMigrationValue
    )
      return;

    const panelSvg = d3.select(panelSvgRef.current);

    // select the existing content group and clear panel content only
    const contentGroup = panelSvg.select('g');
    contentGroup.selectAll('.panel-content').remove();

    const panelContentGroup = contentGroup
      .append('g')
      .attr('class', 'panel-content');

    const currentActiveLinks =
      yActiveMigrationLinks.map((ymap) => ymap.toJSON() as MigrationLinkInfo) ||
      [];
    const totalMigrationDisplayValue = formatMigrationValue(
      yTotalMigrationValue.get('value') || 'select states to view data',
      currentViewTypeRef.current
    );

    const padding = mainPadding;

    // era title at the top
    panelContentGroup
      .append('text')
      .attr('class', 'tooltip-title-era')
      .attr('x', padding)
      .attr('y', padding + 16)
      .style('font-size', '20px')
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('migration era');

    // create era buttons at the top
    const buttonContainerY = padding + 16 + titleSpacing;
    const buttonContainer = panelContentGroup
      .append('g')
      .attr('class', 'd3-button-container')
      .attr('transform', `translate(${padding}, ${buttonContainerY})`)
      .style('pointer-events', 'all');

    buttonContainerRef.current = buttonContainer.node();

    const eras: Era[] = ['1960s', '1990s', '2020s'];
    const buttonWidth =
      (tooltipPanelWidth - 2 * padding - buttonSpacing * 2) / 3;

    eras.forEach((era, i) => {
      const buttonGroup = buttonContainer
        .append('g')
        .attr('class', 'era-button')
        .attr('data-era', era)
        .attr('transform', `translate(${i * (buttonWidth + buttonSpacing)}, 0)`)
        .style('cursor', 'pointer');

      const isActive = era === currentEraRef.current;

      buttonGroup
        .append('rect')
        .attr('class', 'era-button-rect')
        .attr('width', buttonWidth)
        .attr('height', buttonHeight)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr(
          'fill',
          isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.2)'
        )
        .attr(
          'stroke',
          isActive ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.4)'
        );

      buttonGroup
        .append('text')
        .attr('x', buttonWidth / 2)
        .attr('y', buttonHeight / 2 + 6)
        .attr('text-anchor', 'middle')
        .style('font-size', '18px')
        .style('font-weight', isActive ? '700' : '500')
        .style(
          'fill',
          isActive ? 'rgba(33, 33, 33, 0.9)' : 'rgba(255, 255, 255, 0.9)'
        )
        .style('pointer-events', 'none')
        .text(era);

      // add click handler for era buttons
      buttonGroup.on('click', () => {
        if (era !== currentEraRef.current && ySharedState) {
          ySharedState.set('currentEra', era);
          // recalculate migrations for the new era
          if (calculateAndStoreMigrationsRef.current) {
            calculateAndStoreMigrationsRef.current();
          }
        }
      });
    });

    // view type buttons section
    const viewTypeButtonY = buttonContainerY + buttonSectionHeight + 10;
    const viewTypeButtonContainer = panelContentGroup
      .append('g')
      .attr('class', 'd3-view-type-button-container')
      .attr('transform', `translate(${padding}, ${viewTypeButtonY})`)
      .style('pointer-events', 'all');

    const viewTypes: ViewType[] = ['absolute', 'rate'];
    const viewTypeButtonWidth =
      (tooltipPanelWidth - 2 * padding - buttonSpacing) / 2;

    viewTypes.forEach((viewType, i) => {
      const buttonGroup = viewTypeButtonContainer
        .append('g')
        .attr('class', 'view-type-button')
        .attr('data-view-type', viewType)
        .attr(
          'transform',
          `translate(${i * (viewTypeButtonWidth + buttonSpacing)}, 0)`
        )
        .style('cursor', 'pointer');

      const isActive = viewType === currentViewTypeRef.current;

      buttonGroup
        .append('rect')
        .attr('class', 'view-type-button-rect')
        .attr('width', viewTypeButtonWidth)
        .attr('height', 36) // slightly smaller than era buttons
        .attr('rx', 4)
        .attr('ry', 4)
        .attr(
          'fill',
          isActive ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)'
        )
        .attr(
          'stroke',
          isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.3)'
        );

      buttonGroup
        .append('text')
        .attr('x', viewTypeButtonWidth / 2)
        .attr('y', 18 + 4)
        .attr('text-anchor', 'middle')
        .style('font-size', '14px')
        .style('font-weight', isActive ? '600' : '400')
        .style(
          'fill',
          isActive ? 'rgba(33, 33, 33, 0.8)' : 'rgba(255, 255, 255, 0.8)'
        )
        .style('pointer-events', 'none')
        .text(viewType === 'absolute' ? 'absolute' : 'per 100K');

      // add click handler for view type buttons
      buttonGroup.on('click', () => {
        if (viewType !== currentViewTypeRef.current && ySharedState) {
          ySharedState.set('currentViewType', viewType);
          // recalculate migrations for the new view type
          if (calculateAndStoreMigrationsRef.current) {
            calculateAndStoreMigrationsRef.current();
          }
        }
      });
    });

    // total migration section (only show for absolute view)
    let migrationFlowsY = viewTypeButtonY + 36 + sectionSpacing;

    if (currentViewTypeRef.current === 'absolute') {
      const totalMigrationY = viewTypeButtonY + 36 + sectionSpacing;

      panelContentGroup
        .append('text')
        .attr('class', 'tooltip-title-total')
        .attr('x', padding)
        .attr('y', totalMigrationY + 20)
        .style('font-size', '20px')
        .style('fill', 'rgba(255, 255, 255, 0.75)')
        .style('font-weight', '500')
        .text('total migration');

      panelContentGroup
        .append('text')
        .attr('class', 'tooltip-total-migration-value')
        .attr('x', padding)
        .attr('y', totalMigrationY + 20 + titleSpacing + 40)
        .style(
          'font-size',
          totalMigrationDisplayValue === 'select states to view data'
            ? '24px'
            : '48px'
        )
        .style('font-weight', '700')
        .style('fill', panelTxtColor)
        .style(
          'opacity',
          totalMigrationDisplayValue === 'select states to view data' ||
            totalMigrationDisplayValue === '0'
            ? 0.5
            : 1
        )
        .text(totalMigrationDisplayValue);

      migrationFlowsY =
        totalMigrationY + 20 + titleSpacing + 40 + sectionSpacing;
    }

    // migration flows section

    panelContentGroup
      .append('text')
      .attr('class', 'tooltip-title-flows')
      .attr('x', padding)
      .attr('y', migrationFlowsY + 20)
      .style('font-size', '20px')
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('migration flows');

    const migrationLinksGroup = panelContentGroup
      .append('g')
      .attr('class', 'tooltip-migration-links')
      .attr(
        'transform',
        `translate(${padding}, ${migrationFlowsY + 20 + titleSpacing})`
      );

    // display all 10 migration flows in the info panel
    currentActiveLinks.forEach((link, i) => {
      const linkGroup = migrationLinksGroup
        .append('g')
        .attr('transform', `translate(0, ${i * itemSpacing})`);

      linkGroup
        .append('text')
        .attr('x', 0)
        .attr('y', 26)
        .style('font-size', '15px')
        .style('font-weight', '600')
        .style('fill', 'rgba(255, 255, 255, 0.9)')
        .text(
          `${formatStateName(link.origin)} → ${formatStateName(
            link.destination
          )}`
        );

      linkGroup
        .append('text')
        .attr('x', tooltipPanelWidth - 2 * padding)
        .attr('y', 26)
        .attr('text-anchor', 'end')
        .style('font-size', '18px')
        .style('font-weight', '500')
        .style('fill', 'rgba(255, 255, 255, 0.8)')
        .text(formatMigrationValue(link.value, currentViewTypeRef.current));
    });
  };

  const renderVisuals = () => {
    if (!doc || !svgRef.current || !isInitializedRef.current) return;

    const currentLeftHovered = yHoveredLeftStates?.toArray() || [];
    const currentRightHovered = yHoveredRightStates?.toArray() || [];
    const currentLeftPinned = yPinnedLeftStates?.toArray() || [];
    const currentRightPinned = yPinnedRightStates?.toArray() || [];
    const currentActiveLinks =
      yActiveMigrationLinks?.map(
        (ymap) => ymap.toJSON() as MigrationLinkInfo
      ) || [];

    const allBrushLeftStates: string[] = [];
    yClientBrushSelectionsLeft?.forEach((states) => {
      allBrushLeftStates.push(...states.map((s) => s.toUpperCase()));
    });
    const allBrushRightStates: string[] = [];
    yClientBrushSelectionsRight?.forEach((states) => {
      allBrushRightStates.push(...states.map((s) => s.toUpperCase()));
    });

    // performance optimization: use css classes instead of individual attribute updates
    d3.select(svgRef.current)
      .select('g#map-group')
      .selectAll('path.tile')
      .each(function () {
        const tileElement = this as SVGPathElement;
        const stateName = d3.select(tileElement).attr('data-statename');
        const isLeftHover = stateName
          ? currentLeftHovered.includes(stateName)
          : false;
        const isRightHover = stateName
          ? currentRightHovered.includes(stateName)
          : false;
        const isLeftPinned = stateName
          ? currentLeftPinned.includes(stateName)
          : false;
        const isRightPinned = stateName
          ? currentRightPinned.includes(stateName)
          : false;

        const isLeftBrush = stateName
          ? allBrushLeftStates.includes(stateName)
          : false;
        const isRightBrush = stateName
          ? allBrushRightStates.includes(stateName)
          : false;

        // treat pinned states as permanently hovered for fill color
        const effectiveLeftHover = isLeftHover || isLeftPinned || isLeftBrush;
        const effectiveRightHover =
          isRightHover || isRightPinned || isRightBrush;

        // apply css classes for performance - much faster than individual attribute updates
        const element = d3.select(tileElement);

        // remove all state classes first
        element
          .classed('state-hover-left', false)
          .classed('state-hover-right', false)
          .classed('state-pinned', false);

        // apply appropriate classes based on state
        if (effectiveLeftHover && effectiveRightHover) {
          // left takes precedence when both are hovered
          element.classed('state-hover-left', true);
        } else if (effectiveLeftHover) {
          element.classed('state-hover-left', true);
        } else if (effectiveRightHover) {
          element.classed('state-hover-right', true);
        }

        // pinned styling overrides hover styling for stroke
        if (isLeftPinned || isRightPinned) {
          element.classed('state-pinned', true);
        }
      });

    // use bundled line highlighting instead of creating new migration lines
    highlightBundledLines(currentActiveLinks);

    // clear any old migration lines (they're now replaced by bundled lines)
    clearAllD3MigrationLines();

    // update info panel
    updateInfoPanel();
  };

  // render visuals with current brush selection for immediate feedback
  const renderVisualsWithCurrentBrush = (currentBrushStates: {
    left: string[];
    right: string[];
  }) => {
    if (!doc || !svgRef.current || !isInitializedRef.current) return;

    const currentLeftHovered = yHoveredLeftStates?.toArray() || [];
    const currentRightHovered = yHoveredRightStates?.toArray() || [];
    const currentLeftPinned = yPinnedLeftStates?.toArray() || [];
    const currentRightPinned = yPinnedRightStates?.toArray() || [];
    const currentActiveLinks =
      yActiveMigrationLinks?.map(
        (ymap) => ymap.toJSON() as MigrationLinkInfo
      ) || [];

    // use provided brush states instead of yjs arrays
    const allBrushLeftStates = currentBrushStates.left;
    const allBrushRightStates = currentBrushStates.right;

    // performance optimization: use css classes instead of individual attribute updates
    d3.select(svgRef.current)
      .select('g#map-group')
      .selectAll('path.tile')
      .each(function () {
        const tileElement = this as SVGPathElement;
        const stateName = d3.select(tileElement).attr('data-statename');
        const isLeftHover = stateName
          ? currentLeftHovered.includes(stateName)
          : false;
        const isRightHover = stateName
          ? currentRightHovered.includes(stateName)
          : false;
        const isLeftPinned = stateName
          ? currentLeftPinned.includes(stateName)
          : false;
        const isRightPinned = stateName
          ? currentRightPinned.includes(stateName)
          : false;

        const isLeftBrush = stateName
          ? allBrushLeftStates.includes(stateName.toUpperCase())
          : false;
        const isRightBrush = stateName
          ? allBrushRightStates.includes(stateName.toUpperCase())
          : false;

        // treat pinned states as permanently hovered for fill color
        const effectiveLeftHover = isLeftHover || isLeftPinned || isLeftBrush;
        const effectiveRightHover =
          isRightHover || isRightPinned || isRightBrush;

        // apply css classes for performance - much faster than individual attribute updates
        const element = d3.select(tileElement);

        // remove all state classes first
        element
          .classed('state-hover-left', false)
          .classed('state-hover-right', false)
          .classed('state-pinned', false);

        // apply appropriate classes based on state
        if (effectiveLeftHover && effectiveRightHover) {
          // left takes precedence when both are hovered
          element.classed('state-hover-left', true);
        } else if (effectiveLeftHover) {
          element.classed('state-hover-left', true);
        } else if (effectiveRightHover) {
          element.classed('state-hover-right', true);
        }

        // pinned styling overrides hover styling for stroke
        if (isLeftPinned || isRightPinned) {
          element.classed('state-pinned', true);
        }
      });

    // use bundled line highlighting instead of creating new migration lines
    highlightBundledLines(currentActiveLinks);

    // clear any old migration lines (they're now replaced by bundled lines)
    clearAllD3MigrationLines();

    // update info panel
    updateInfoPanel();
  };

  useEffect(() => {
    if (!syncStatus || !doc || !svgRef.current || isInitializedRef.current)
      return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('g#map-group').remove();

    const mapGroup = svg
      .append('g')
      .attr('id', 'map-group')
      .attr('transform', `translate(${mapLeftOffset}, ${-totalHeight * 0.1})`);
    gRef.current = mapGroup.node();

    // initialize panel SVG structure
    if (panelSvgRef.current) {
      const panelSvg = d3.select(panelSvgRef.current);
      panelSvg.selectAll('*').remove();

      // create defs for panel
      const defs = panelSvg.append('defs');
      defs
        .append('filter')
        .attr('id', 'panel-text-shadow')
        .append('feDropShadow')
        .attr('dx', '0')
        .attr('dy', '1')
        .attr('stdDeviation', '1')
        .attr('flood-opacity', '0.3');

      // create content group
      const contentGroup = panelSvg.append('g');

      // create custom panel background with square left corners and rounded right corners
      const borderRadius = 8;
      const panelPath = `
        M 0,0
        L ${tooltipPanelWidth - borderRadius},0
        Q ${tooltipPanelWidth},0 ${tooltipPanelWidth},${borderRadius}
        L ${tooltipPanelWidth},${totalHeight - borderRadius}
        Q ${tooltipPanelWidth},${totalHeight} ${
        tooltipPanelWidth - borderRadius
      },${totalHeight}
        L 0,${totalHeight}
        Z
      `;

      contentGroup
        .append('path')
        .attr('d', panelPath)
        .attr('fill', panelBgColor)
        .style('box-shadow', '0 8px 32px rgba(0,0,0,0.25)')
        .style('border', '1px solid rgba(255, 255, 255, 0.15)')
        .style('backdrop-filter', 'blur(12px)');
    }

    d3.json('/src/assets/domesticmigration/usmap.json').then((topology) => {
      if (!topology) return;
      const geoFeature = topojson.feature(
        topology as StateTopology,
        (topology as StateTopology).objects.states
      ) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;

      // set up the map projection using albers usa for geographic accuracy
      const projection = d3
        .geoAlbersUsa()
        .scale(includeAlaskaHawaii ? 1100 : 1275)
        .translate([mapWidth / 2, height / 2]);
      const pathGenerator = d3.geoPath().projection(projection);

      // filter out Alaska and Hawaii from features if not including them
      const filteredFeatures = includeAlaskaHawaii
        ? geoFeature.features
        : geoFeature.features.filter((feature) => {
            const stateName = feature.properties?.name;
            return (
              stateName &&
              !['Alaska', 'Hawaii', 'District of Columbia'].includes(stateName)
            );
          });

      stateCentroidsRef.current = {};
      filteredFeatures.forEach((feature) => {
        const stateName = feature.properties?.name;
        if (stateName) {
          const centroid = pathGenerator.centroid(feature);
          if (!isNaN(centroid[0]) && !isNaN(centroid[1]))
            stateCentroidsRef.current[stateName.toUpperCase()] = centroid;
        }
      });

      // add performance styles to document head
      addPerformanceStyles();

      // create map features group first (background, non-interactive)
      const mapFeaturesGroup = mapGroup
        .append('g')
        .attr('class', 'map-features')
        .style('pointer-events', 'none');

      mapFeaturesGroup
        .selectAll('path')
        .data(filteredFeatures)
        .join('path')
        .attr('d', pathGenerator)
        .attr('class', 'tile')
        .attr(
          'data-statename',
          (d) =>
            (d.properties as StateGeometry['properties'])?.name || 'unknown'
        );
      // css classes handle styling now for better performance

      // create brush group for multi-selection (before interactive elements)
      const brushGroup = mapGroup
        .append('g')
        .attr('class', 'brush')
        .style('pointer-events', 'all');
      mapGroup
        .append('g')
        .attr('class', 'remote-brushes')
        .style('pointer-events', 'none');

      const localBrushRect = brushGroup
        .append('rect')
        .attr('class', 'local-brush-rect')
        .attr('pointer-events', 'none')
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('stroke', userColor)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3,3')
        .attr('visibility', 'hidden');

      const brush = d3
        .brush()
        .on('start', brushStarted)
        .on('brush', brushed)
        .on('end', brushEnded);

      brushGroup.call(brush);

      function brushStarted() {
        const currentMode = hoverModeRef.current;
        const targetMap =
          currentMode === 'origin'
            ? yClientBrushSelectionsLeft
            : yClientBrushSelectionsRight;
        if (targetMap && userId) {
          targetMap.set(userId, []);
        }
      }

      function brushed(event: d3.D3BrushEvent<unknown>) {
        if (!event.selection) {
          localBrushRect.attr('visibility', 'hidden');
          const currentMode = hoverModeRef.current;
          const targetMap =
            currentMode === 'origin'
              ? yClientBrushSelectionsLeft
              : yClientBrushSelectionsRight;
          if (targetMap && userId) {
            targetMap.set(userId, []);
          }
          return;
        }

        const [[x0, y0], [x1, y1]] = event.selection as [
          [number, number],
          [number, number]
        ];

        if (awareness && event.sourceEvent) {
          const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            awareness.setLocalState({
              ...currentState,
              cursor: { x: svgX, y: svgY },
              brushSelection: {
                x0,
                y0,
                x1,
                y1,
                mode: hoverModeRef.current,
              },
            });
          }
        }

        const brushMode = hoverModeRef.current;
        const brushFillColor =
          brushMode === 'origin'
            ? 'rgba(232, 27, 35, 0.3)'
            : 'rgba(0, 174, 243, 0.3)';

        localBrushRect
          .attr('visibility', 'visible')
          .attr('x', x0)
          .attr('y', y0)
          .attr('width', x1 - x0)
          .attr('height', y1 - y0)
          .attr('fill', brushFillColor);

        const selectedStates = filteredFeatures.filter((feature) => {
          // get the bounding box of the state's geometry
          const bounds = pathGenerator.bounds(feature);
          if (!bounds || bounds.length !== 2) return false;

          const [[stateX0, stateY0], [stateX1, stateY1]] = bounds;

          // check if brush rectangle intersects with state bounding box
          // rectangles intersect if they don't completely miss each other
          const brushMissesStateHorizontally = x1 < stateX0 || x0 > stateX1;
          const brushMissesStateVertically = y1 < stateY0 || y0 > stateY1;

          return !(brushMissesStateHorizontally || brushMissesStateVertically);
        });

        const selectedStateNames = selectedStates
          .map((f) => f.properties?.name)
          .filter(Boolean) as string[];

        const currentMode = hoverModeRef.current;
        const targetMap =
          currentMode === 'origin'
            ? yClientBrushSelectionsLeft
            : yClientBrushSelectionsRight;
        const oppositePinnedArray =
          currentMode === 'origin' ? yPinnedRightStates : yPinnedLeftStates;

        const oppositePinned = oppositePinnedArray?.toArray() || [];
        const validSelections = selectedStateNames.filter(
          (name) => !oppositePinned.includes(name.toUpperCase())
        );

        if (targetMap && userId) {
          targetMap.set(
            userId,
            validSelections.map((s) => s.toUpperCase())
          );
        }

        // trigger visual update during brushing for immediate feedback with current selection
        const activeBrushMode = hoverModeRef.current;
        const currentBrushStates = {
          left:
            activeBrushMode === 'origin'
              ? validSelections.map((s) => s.toUpperCase())
              : [],
          right:
            activeBrushMode === 'destination'
              ? validSelections.map((s) => s.toUpperCase())
              : [],
        };
        renderVisualsWithCurrentBrush(currentBrushStates);
      }

      function brushEnded(event: d3.D3BrushEvent<unknown>) {
        localBrushRect.attr('visibility', 'hidden');

        const currentMode = hoverModeRef.current;
        const targetMap =
          currentMode === 'origin'
            ? yClientBrushSelectionsLeft
            : yClientBrushSelectionsRight;

        if (targetMap && userId) {
          targetMap.set(userId, []);
        }

        if (awareness && event.sourceEvent) {
          const [svgX, svgY] = d3.pointer(event.sourceEvent, svg.node());
          const currentState = awareness.getLocalState() as AwarenessState;
          if (currentState) {
            const stateWithoutBrush = {
              ...currentState,
              cursor: { x: svgX, y: svgY },
            };
            if ('brushSelection' in stateWithoutBrush) {
              delete (stateWithoutBrush as Partial<AwarenessState>)
                .brushSelection;
            }
            awareness.setLocalState(stateWithoutBrush);
          }
          brushGroup.call(brush.move, null);
        }
      }

      // create interactive states group AFTER brush (on top with pointer-events)
      const statesGroup = mapGroup
        .append('g')
        .attr('class', 'interactive-states')
        .style('pointer-events', 'all');

      const stateTiles = statesGroup
        .selectAll('path.tile')
        .data(filteredFeatures)
        .join('path')
        .attr('class', 'tile')
        .attr(
          'data-statename',
          (d) =>
            (d.properties as StateGeometry['properties'])?.name || 'unknown'
        )
        .attr('d', pathGenerator)
        .style('cursor', 'pointer');
      // css classes handle styling now for better performance

      // add hover event handlers to state tiles
      stateTiles
        .on('mouseenter', function (_, d) {
          const feature = d as Feature<Geometry, GeoJsonProperties>;
          const stateName = (feature.properties as StateGeometry['properties'])
            ?.name;
          if (!stateName) return;

          const currentMode = hoverModeRef.current;
          const targetArray =
            currentMode === 'origin' ? yHoveredLeftStates : yHoveredRightStates;
          const oppositePinnedArray =
            currentMode === 'origin' ? yPinnedRightStates : yPinnedLeftStates;

          if (targetArray && oppositePinnedArray) {
            const oppositePinned = oppositePinnedArray.toArray();
            if (!oppositePinned.includes(stateName)) {
              if (targetArray.length > 0) {
                targetArray.delete(0, targetArray.length);
              }
              targetArray.push([stateName]);
            }
          }
        })
        .on('mouseleave', function () {
          const currentMode = hoverModeRef.current;
          const targetArray =
            currentMode === 'origin' ? yHoveredLeftStates : yHoveredRightStates;

          if (targetArray && targetArray.length > 0) {
            targetArray.delete(0, targetArray.length);
          }
        })
        .on('click', function (event, d) {
          event.stopPropagation();
          const feature = d as Feature<Geometry, GeoJsonProperties>;
          const stateName = (feature.properties as StateGeometry['properties'])
            ?.name;
          if (!stateName) return;

          // clear any hover state for immediate visual feedback
          const currentMode = hoverModeRef.current;
          const currentHoverArray =
            currentMode === 'origin' ? yHoveredLeftStates : yHoveredRightStates;

          if (currentHoverArray && currentHoverArray.length > 0) {
            currentHoverArray.delete(0, currentHoverArray.length);
          }

          const targetArray =
            currentMode === 'origin' ? yPinnedLeftStates : yPinnedRightStates;
          const oppositeArray =
            currentMode === 'origin' ? yPinnedRightStates : yPinnedLeftStates;

          if (targetArray && oppositeArray) {
            const currentPinned = targetArray.toArray();
            const oppositePinned = oppositeArray.toArray();

            if (currentPinned.includes(stateName)) {
              const index = currentPinned.indexOf(stateName);
              targetArray.delete(index, 1);

              // after unpinning, restore hover state if mouse is still over state and not pinned opposite
              if (!oppositePinned.includes(stateName) && currentHoverArray) {
                currentHoverArray.push([stateName]);
              }
            } else {
              if (oppositePinned.includes(stateName)) {
                const oppositeIndex = oppositePinned.indexOf(stateName);
                oppositeArray.delete(oppositeIndex, 1);
              }
              targetArray.push([stateName]);
            }
          }
        });

      // filter features for internal vs external labels
      const featuresWithInternalLabels = filteredFeatures.filter((feature) => {
        const stateName = (
          feature.properties as StateGeometry['properties']
        )?.name?.toUpperCase();
        return !statesWithLeaderLines.has(stateName || '');
      });

      const featuresWithExternalLabels = filteredFeatures.filter((feature) => {
        const stateName = (
          feature.properties as StateGeometry['properties']
        )?.name?.toUpperCase();
        return statesWithLeaderLines.has(stateName || '');
      });

      // render internal labels (existing approach for most states)
      mapGroup
        .selectAll('text.state-label-internal')
        .data(featuresWithInternalLabels)
        .join('text')
        .attr('class', 'state-label-internal')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#333')
        .attr('font-size', '22px')
        .attr('font-weight', '600')
        .attr('text-shadow', '0 1px 1px rgba(255, 255, 255, 0.5)')
        .attr('x', (d) => {
          const position = getStateLabelPosition(d, pathGenerator);
          return position[0];
        })
        .attr('y', (d) => {
          const position = getStateLabelPosition(d, pathGenerator);
          return position[1];
        })
        .text((d) =>
          (d.properties as StateGeometry['properties'])?.name
            ? stateAbbreviations[
                (d.properties as StateGeometry['properties']).name.toUpperCase()
              ] || ''
            : ''
        );

      // render leader lines for external labels
      mapGroup
        .selectAll('line.leader-line')
        .data(featuresWithExternalLabels)
        .join('line')
        .attr('class', 'leader-line')
        .attr('pointer-events', 'none')
        .attr('stroke', '#000')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8)
        .attr('x1', (d) => {
          const centroid = pathGenerator.centroid(d);
          return centroid[0];
        })
        .attr('y1', (d) => {
          const centroid = pathGenerator.centroid(d);
          return centroid[1];
        })
        .attr('x2', (d) => {
          const stateName = (
            d.properties as StateGeometry['properties']
          )?.name?.toUpperCase();
          const externalPos = externalLabelPositions[stateName || ''];
          return externalPos ? externalPos[0] : 0; // leader line ends at base external position
        })
        .attr('y2', (d) => {
          const stateName = (
            d.properties as StateGeometry['properties']
          )?.name?.toUpperCase();
          const externalPos = externalLabelPositions[stateName || ''];
          return externalPos ? externalPos[1] : 0; // leader line ends at base external position
        });

      // render external labels
      mapGroup
        .selectAll('text.state-label-external')
        .data(featuresWithExternalLabels)
        .join('text')
        .attr('class', 'state-label-external')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'start')
        .attr('dy', '0.35em')
        .attr('fill', '#333')
        .attr('font-size', '22px')
        .attr('font-weight', '600')
        .attr('text-shadow', '0 1px 1px rgba(255, 255, 255, 0.8)')
        .attr('x', (d) => {
          const stateName = (
            d.properties as StateGeometry['properties']
          )?.name?.toUpperCase();
          const externalPos = externalLabelPositions[stateName || ''];
          const adjustments = externalLabelAdjustments[stateName || ''] || [
            0, 0,
          ];
          return externalPos ? externalPos[0] + adjustments[0] : 0; // label position = base position + adjustments
        })
        .attr('y', (d) => {
          const stateName = (
            d.properties as StateGeometry['properties']
          )?.name?.toUpperCase();
          const externalPos = externalLabelPositions[stateName || ''];
          const adjustments = externalLabelAdjustments[stateName || ''] || [
            0, 0,
          ];
          return externalPos ? externalPos[1] + adjustments[1] : 0; // label position = base position + adjustments
        })
        .text((d) =>
          (d.properties as StateGeometry['properties'])?.name
            ? stateAbbreviations[
                (d.properties as StateGeometry['properties']).name.toUpperCase()
              ] || ''
            : ''
        );

      isInitializedRef.current = true;
      renderVisuals();

      // compute and render bundled paths for all eras if migration data is loaded
      if (migrationDataLoaded) {
        computeBundledPaths();
        renderAllBundledLines();
      }
    });

    const visualObserver = () => renderVisuals();
    yHoveredLeftStates?.observeDeep(visualObserver);
    yHoveredRightStates?.observeDeep(visualObserver);
    yActiveMigrationLinks?.observeDeep(visualObserver);
    yTotalMigrationValue?.observe(visualObserver);
    yClientBrushSelectionsLeft?.observeDeep(visualObserver);
    yClientBrushSelectionsRight?.observeDeep(visualObserver);

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

      const overlay = d3.select(cursorOverlayRef.current);

      // use efficient d3 data join pattern instead of recreating all elements
      const cursors = overlay
        .selectAll<HTMLDivElement, CursorData>('div.cursor')
        .data(cursorStates, (d) => d.clientId.toString());

      // remove cursors for users who left
      cursors.exit().remove();

      // create new cursors for new users
      const newCursors = cursors
        .enter()
        .append('div')
        .attr('class', 'cursor')
        .style('position', 'absolute')
        .style('pointer-events', 'none')
        .style('z-index', '9999')
        .each(function (d) {
          const cursorDiv = d3.select(this);

          // set class based on local/remote
          cursorDiv.classed('local-cursor', d.isLocal);
          cursorDiv.classed('remote-cursor', !d.isLocal);

          // create svg cursor icon
          const cursorSvg = cursorDiv
            .append('svg')
            .attr('width', '24')
            .attr('height', '24')
            .style('overflow', 'visible');

          cursorSvg
            .append('path')
            .attr('d', 'M0,0 L24,12 L12,12 L12,24 L0,0')
            .attr('fill', d.state.user.color)
            .attr('stroke', '#000')
            .attr('stroke-width', '2');

          // create label for remote cursors
          if (!d.isLocal) {
            cursorDiv
              .append('div')
              .style('position', 'absolute')
              .style('left', '23px')
              .style('top', '18px')
              .style('background', d.state.user.color)
              .style('color', '#ffffff')
              .style('padding', '4px 8px')
              .style('border-radius', '4px')
              .style('font-size', '14px')
              .style('font-weight', '500')
              .style('font-family', 'system-ui, sans-serif')
              .style('white-space', 'nowrap')
              .text(d.state.user.name);
          }
        });

      // update positions for all cursors (existing + new)
      cursors
        .merge(newCursors)
        .style('left', (d) => `${d.state.cursor.x}px`)
        .style('top', (d) => `${d.state.cursor.y}px`)
        .each(function (d) {
          const cursorDiv = d3.select(this);

          // update cursor color in case user changed it
          cursorDiv.select('path').attr('fill', d.state.user.color);

          // update label background color and text for remote cursors
          if (!d.isLocal) {
            const label = cursorDiv.select('div');
            if (!label.empty()) {
              label
                .style('background', d.state.user.color)
                .text(d.state.user.name);
            }
          }
        });
    };

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
        );

      const remoteBrushesGroup = d3
        .select(gRef.current)
        .select('g.remote-brushes');

      const brushes = remoteBrushesGroup
        .selectAll<
          SVGRectElement,
          { clientId: number; state: AwarenessState; isLocal: boolean }
        >('rect.remote-brush')
        .data(brushStates, (d) => d.clientId.toString());

      brushes.exit().remove();

      const newBrushes = brushes
        .enter()
        .append('rect')
        .attr('class', 'remote-brush')
        .attr('pointer-events', 'none')
        .attr('fill', (d) => {
          const mode = d.state.brushSelection!.mode;
          return mode === 'origin'
            ? 'rgba(232, 27, 35, 0.3)'
            : 'rgba(0, 174, 243, 0.3)';
        })
        .attr('stroke', (d) => d.state.user.color)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3,3');

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
        )
        .attr('fill', (d) => {
          const mode = d.state.brushSelection!.mode;
          return mode === 'origin'
            ? 'rgba(232, 27, 35, 0.3)'
            : 'rgba(0, 174, 243, 0.3)';
        });
    };

    const awarenessObserver = () => {
      updateCursors();
      updateRemoteBrushes();
    };
    if (awareness) {
      awareness.on('change', awarenessObserver);
    }
    updateCursors();
    updateRemoteBrushes();

    svg.on('mousemove', function (event) {
      if (!awareness) return;

      const [containerX, containerY] = d3.pointer(event, svgRef.current!);
      const currentState = awareness.getLocalState() as AwarenessState;
      if (currentState) {
        awareness.setLocalState({
          ...currentState,
          cursor: { x: containerX, y: containerY },
        });
      }
    });

    doc.transact(() => {
      if (yTotalMigrationValue && !yTotalMigrationValue.has('value')) {
        yTotalMigrationValue.set('value', 'select states to view data');
      }
      if (ySharedState && !ySharedState.has('currentEra')) {
        ySharedState.set('currentEra', '2020s');
      }
      if (ySharedState && !ySharedState.has('currentViewType')) {
        ySharedState.set('currentViewType', 'absolute');
      }
    }, 'init-yjs-values');

    return () => {
      yHoveredLeftStates?.unobserveDeep(visualObserver);
      yHoveredRightStates?.unobserveDeep(visualObserver);
      yActiveMigrationLinks?.unobserveDeep(visualObserver);
      yTotalMigrationValue?.unobserve(visualObserver);
      yClientBrushSelectionsLeft?.unobserveDeep(visualObserver);
      yClientBrushSelectionsRight?.unobserveDeep(visualObserver);
      if (awareness) {
        awareness.off('change', awarenessObserver);
      }
      clearAllD3MigrationLines();

      // clean up all gradients when component unmounts to prevent memory leaks
      if (svgRef.current) {
        d3.select(svgRef.current)
          .select('defs')
          .selectAll('linearGradient')
          .remove();
      }

      isInitializedRef.current = false;
    };
  }, [
    syncStatus,
    doc,
    yHoveredLeftStates,
    yHoveredRightStates,
    yPinnedLeftStates,
    yPinnedRightStates,
    yActiveMigrationLinks,
    yTotalMigrationValue,
    migrationDataLoaded,
    yClientBrushSelectionsLeft,
    yClientBrushSelectionsRight,
    awareness,
    userId,
  ]);

  // re-render when yjs shared state changes
  useEffect(() => {
    if (!ySharedState) return;

    const handleSharedStateChange = () => {
      if (isInitializedRef.current) {
        // immediately update refs to ensure we're using the correct era/view type for calculations
        const era = (ySharedState.get('currentEra') as Era) || '2020s';
        const viewType =
          (ySharedState.get('currentViewType') as ViewType) || 'absolute';

        currentEraRef.current = era;
        currentViewTypeRef.current = viewType;

        renderAllBundledLines(); // just switch to precomputed bundled lines for the new era/view
        renderVisuals(); // then update highlights and other visual elements
      }
    };

    ySharedState.observe(handleSharedStateChange);
    return () => ySharedState.unobserve(handleSharedStateChange);
  }, [ySharedState]);

  // sync refs with yjs shared state
  useEffect(() => {
    if (!ySharedState) return;

    const updateRefs = () => {
      const era = (ySharedState.get('currentEra') as Era) || '2020s';
      const viewType =
        (ySharedState.get('currentViewType') as ViewType) || 'absolute';

      currentEraRef.current = era;
      currentViewTypeRef.current = viewType;
    };

    ySharedState.observe(updateRefs);
    updateRefs(); // initial sync

    return () => ySharedState.unobserve(updateRefs);
  }, [ySharedState]);

  // removed gesture interaction handler for non-gesture version

  if (!syncStatus) {
    return (
      <div
        style={{
          width: totalWidth,
          height: totalHeight,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent',
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
            color: '#333',
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
            US Domestic Migration Visualization
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
                background: `linear-gradient(to right, #2980b9, #2980b9)`,
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

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          border: '2px solid black',
          overflow: 'hidden',
          backgroundColor: '#f0f0f0',
          cursor: 'none',
          pointerEvents: 'none',
        }}
      >
        {/* d3 map will be appended here by effects */}
      </svg>
      {/* info panel wrapper with cursor tracking */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: `translate(-${totalWidth / 2}px, -50%)`,
          width: tooltipPanelWidth,
          height: totalHeight,
          zIndex: 1000,
          pointerEvents: 'all',
        }}
        onMouseMove={(event) => {
          // handle mouse tracking for cursor awareness in info panel
          if (!awareness) return;

          // get coordinates relative to the main container (entire visualization)
          const containerRect = event.currentTarget
            .closest('div')
            ?.getBoundingClientRect();

          if (containerRect) {
            // calculate position relative to the main visualization container
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
          width={tooltipPanelWidth}
          height={totalHeight}
          style={{
            pointerEvents: 'none',
          }}
        >
          <defs>
            <filter id="panel-text-shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.3" />
            </filter>
          </defs>
          <g style={{ pointerEvents: 'none' }}>
            {/* Panel content will be added here by D3 */}
          </g>
        </svg>
      </div>
      <div
        ref={cursorOverlayRef}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: totalWidth,
          height: totalHeight,
          pointerEvents: 'none',
          zIndex: 10000,
        }}
      />
      <div
        ref={modeIndicatorRef}
        style={{
          position: 'absolute',
          bottom: '0px',
          left: `${totalWidth / 2}px`,
          transform: 'translateX(-50%)',
          zIndex: 1001,
          background: 'rgba(232, 27, 35, 0.9)',
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
    </>
  );
};

export default DoMi;
