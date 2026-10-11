"""Build offline briefing cartography. Requires shapely; sources are public domain.
Run with paths to Natural Earth's ne_50m_land and rivers_lake_centerlines GeoJSON.
Routes and tactical symbols are rendered separately by missionDiagram.ts.
"""
import json, math, sys
from pathlib import Path
from shapely.geometry import shape, box
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
REGIONS = {
    'europe': [-3, 46, 19, 57],
    'germany': [3, 48, 17, 55],
    'rzhev': [29, 54.5, 38, 58.5],
    'poltava': [29, 46.5, 39, 51.5],
    'asch': [2, 49, 9, 52.5],
    'okinawa': [125.5, 25, 129, 27],
    'solomons': [158, -12.5, 163.5, -8],
    'leyte': [123.3, 9.5, 126.3, 12.3],
}
land, rivers = [json.loads(Path(p).read_text(encoding='utf8')) for p in sys.argv[1:3]]
out = ROOT / 'public/ui/maps'
out.mkdir(parents=True, exist_ok=True)
for name, (west, south, east, north) in REGIONS.items():
    bounds = box(west, south, east, north)
    def project(x, y, z=None):
        return ((x-west)/(east-west)*800, (north-y)/(north-south)*500)
    def paths(geo):
        if geo.is_empty: return ''
        if hasattr(geo, 'geoms'): return ''.join(paths(g) for g in geo.geoms)
        rings = [geo.exterior, *geo.interiors] if geo.geom_type == 'Polygon' else [geo]
        result = ''
        for ring in rings:
            pts = list(transform(project, ring).simplify(.35).coords)
            if len(pts) < 2: continue
            result += 'M' + 'L'.join(f'{x:.1f},{y:.1f}' for x,y in pts)
            if geo.geom_type == 'Polygon': result += 'Z'
        return result
    layers = []
    for dataset, style in [(land, 'fill="#d4c59d" stroke="#716d51" stroke-width="1.1"'), (rivers, 'fill="none" stroke="#6f8985" stroke-width="1.1" opacity=".65"')]:
        d = ''.join(paths(shape(f['geometry']).intersection(bounds)) for f in dataset['features'] if f['geometry'] and shape(f['geometry']).intersects(bounds))
        layers.append(f'<path d="{d}" {style} fill-rule="evenodd"/>')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#8eaaa7"/>' + ''.join(layers) + '</svg>'
    (out / f'{name}.svg').write_text(svg, encoding='utf8')
print('Built', len(REGIONS), 'regional maps')
