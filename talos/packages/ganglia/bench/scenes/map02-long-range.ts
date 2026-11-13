import type { RouteQuery, Vec3 } from '@opendfieldmap/ganglia';

type Pair = { id: string; from: Vec3; to: Vec3 };
const spanPairs: Pair[] = [
  {
    id: 'map02-long-01',
    from: [1512.449951171875, 538.6136332948527, 1442.550048828125],
    to: [-1246.3499755859375, 242.93098529943018, -1992.1380962297028],
  },
  {
    id: 'map02-long-02',
    from: [-1949.0941272054638, 226.17501802172126, -1228.64990234375],
    to: [1021.8359292608523, 321.36285615073945, 1474.833308537801],
  },
  {
    id: 'map02-long-03',
    from: [-1614.4666906992595, 200.00530519440883, -1535.166691462199],
    to: [1330.1662909322868, 464.3953048492084, 1023.860419322033],
  },
  {
    id: 'map02-long-04',
    from: [-373.8907683184665, 211.22297835671438, 1529.1924843215502],
    to: [477.20000616709393, 221.70499501109123, -2045.8666915893555],
  },
  {
    id: 'map02-long-05',
    from: [-17.193748474121094, 292.7552340639038, -2006.1937255859375],
    to: [34.709999084472656, 151.28837276873483, 1556.699951171875],
  },
];
const detourPairs: Pair[] = [
  {
    id: 'map02-connected-1',
    from: [-700.1088118036009, 242.16585791125806, -47.2175757944274],
    to: [-1498.3000240325928, 350.0705725621491, -114.52500176429749],
  },
  {
    id: 'map02-connected-2',
    from: [-892.7999877929688, 249.03014947261897, 156.75],
    to: [-766.6500244140625, 250.1187976851745, 205.15270886481918],
  },
];

function routeCase(id: string, from: Vec3, goal: Vec3) {
  const query: RouteQuery = {
    starts: [{ id: 'player', position: from, state: 'available', cost: 0 }],
    goal,
  };
  return { id, query, horizontalDistance: Math.hypot(from[0] - goal[0], from[2] - goal[2]) };
}

function bothDirections(pairs: Pair[]) {
  // Directional drops and layered ground make the reverse journey a distinct problem.
  return pairs.flatMap(({ id, from, to }) => [
    routeCase(`${id}-forward`, from, to),
    routeCase(`${id}-reverse`, to, from),
  ]);
}

export const maximumSpanCases = bothDirections(spanPairs);
export const connectedLongCases = bothDirections(detourPairs);
export const cases = [...maximumSpanCases, ...connectedLongCases];
