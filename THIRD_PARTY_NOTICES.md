# Third-party data

`src/geo/amap-gcj02-region.json` contains the unmodified CHN, HKG, MAC and TWN geometries extracted from
Natural Earth's `ne_10m_admin_0_map_units.geojson` (1:10m):

- Source: <https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_10m_admin_0_map_units.geojson>
- Revision: `ca96624a56bd078437bca8184e78163e5039ad19`
- Retrieved: 2026-09-11; regional extraction updated: 2026-09-12
- License: public domain; <https://www.naturalearthdata.com/about/terms-of-use/>

The FeatureCollection selects exactly one feature per `GU_A3` code, in the order
CHN, HKG, MAC, TWN. Each feature retains its original geometry; its only retained
property is `code`, copied from `GU_A3`.

Coverage follows AMap's coordinate policy:
<https://lbs.amap.com/faq/advisory/others/39840/>.
At runtime HKG/MAC use their overall bounding envelopes to include harbours and
reclaimed airports. HKG/MAC/TWN have a 1 km coastal allowance; CHN is not buffered.
These operational rules do not alter the stored source geometries.

Used only as an approximate coordinate-transform applicability mask. It is not
a surveyed boundary, a map product, or an assertion about territorial status.
Reclaimed land, very small islands and border/coastline points need separate validation.

TREK source was read to document its HTTP contract. No TREK implementation is
copied into this service. Dependency licenses are distributed with their packages.
