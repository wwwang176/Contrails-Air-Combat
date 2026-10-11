/** Terrain-only base assets for the ten independently editable briefing charts. */
const ARTWORK: Readonly<Record<string, string>> = {
  'allies-m1': 'berlin-runtime-terrain.webp',
  'allies-m2': 'allies-m2-terrain.webp',
  'allies-m3': 'allies-m3-terrain.webp',
  'germany-m1': 'germany-m1-terrain.webp',
  'germany-m4': 'germany-m4-terrain.webp',
  'germany-m2': 'germany-m2-terrain.webp',
  'germany-m3': 'germany-m3-terrain.webp',
  'japan-m1': 'japan-m1-terrain.webp',
  'japan-m2': 'japan-m2-terrain.webp',
  'japan-m3': 'japan-m3-terrain.webp',
}

export function missionArtwork(id: string): string | undefined {
  const name = ARTWORK[id]
  return name ? `/ui/maps/${id === 'germany-m4' ? 'reference' : 'tactical'}/${name}` : undefined
}
