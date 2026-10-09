/** Geographic atlas labels use their printed Latin names in both UI languages.
 * Map extent and target location are geographic; flight paths are illustrative. */
type Point = readonly [number, number]
type MapArea = { asset: string; bounds: readonly [number, number, number, number]; labels: readonly (readonly [string, number, number])[] }
const areas: Record<string, MapArea> = {
  europe: { asset: 'europe', bounds: [-3, 46, 19, 57], labels: [['ENGLAND', -1, 53], ['NORTH SEA', 4, 55], ['FRANCE', 3, 47.7], ['GERMANY', 10, 49.5], ['DENMARK', 10, 56], ['BERLIN', 13.4, 52.52]] },
  germany: { asset: 'germany', bounds: [3, 48, 17, 55], labels: [['NORTH SEA', 5, 54], ['HAMBURG', 10, 53.55], ['BERLIN', 13.4, 52.52], ['LEUNA', 12.02, 51.32], ['FRANKFURT', 8.68, 50.1], ['PRAGUE', 14.4, 50.08]] },
  rzhev: { asset: 'rzhev', bounds: [29, 54.5, 38, 58.5], labels: [['RZHEV', 34.33, 56.26], ['VOLGA', 35.7, 57.1], ['KALININ', 35.9, 56.85], ['VYAZMA', 34.3, 55.2], ['SELIGER', 33, 57.2]] },
  poltava: { asset: 'poltava', bounds: [29, 46.5, 39, 51.5], labels: [['POLTAVA', 34.55, 49.59], ['KIEV', 30.52, 50.45], ['KHARKOV', 36.23, 50], ['DNEPR', 33.7, 48.2], ['BLACK SEA', 31.2, 46.9]] },
  asch: { asset: 'asch', bounds: [2, 49, 9, 52.5], labels: [['ASCH / Y-29', 5.59, 51.0], ['BRUSSELS', 4.35, 50.85], ['COLOGNE', 6.96, 50.94], ['NORTH SEA', 3, 52], ['RHINE', 7.5, 50.1]] },
  okinawa: { asset: 'okinawa', bounds: [125.5, 25, 129, 27], labels: [['OKINAWA', 127.95, 26.5], ['KERAMA', 127.3, 26.18], ['EAST CHINA SEA', 126.4, 26.7], ['PACIFIC OCEAN', 128.15, 25.6]] },
  solomons: { asset: 'solomons', bounds: [158, -12.5, 163.5, -8], labels: [['GUADALCANAL', 160.15, -9.65], ['MALAITA', 161, -8.8], ['RENNELL', 160.25, -11.68], ['SOLOMON SEA', 159.1, -10.8], ['SAN CRISTOBAL', 162, -10.5]] },
  leyte: { asset: 'leyte', bounds: [123.3, 9.5, 126.3, 12.3], labels: [['LEYTE', 124.8, 10.8], ['SAMAR', 125.2, 11.8], ['CEBU', 123.7, 10.3], ['LEYTE GULF', 125.65, 10.5], ['TACLOBAN', 125, 11.24]] },
}
const missions: Record<string, readonly [string, Point]> = {
  'allies-m1': ['europe', [13.4, 52.52]], 'allies-m2': ['germany', [12.02, 51.32]],
  'allies-m3': ['okinawa', [126.9, 26.1]], 'germany-m1': ['germany', [12.02, 51.32]],
  'germany-m4': ['rzhev', [34.1, 56.26]], 'germany-m2': ['poltava', [34.4, 49.6]],
  'germany-m3': ['asch', [5.59, 51]], 'japan-m1': ['solomons', [160, -9.2]],
  'japan-m2': ['leyte', [124.85, 11]], 'japan-m3': ['solomons', [160.4, -11.3]],
}
export function missionMapData(id: string) {
  const entry = missions[id]
  if (!entry) return undefined
  const area = areas[entry[0]]!
  const [w, s, e, n] = area.bounds
  const project = ([lon, lat]: Point): Point => [(lon - w) / (e - w) * 800, (n - lat) / (n - s) * 350]
  return { ...area, target: project(entry[1]), labels: area.labels.map(([name, lon, lat]) => ({ name, point: project([lon, lat]) })) }
}
