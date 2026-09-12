// Fixed numerical vectors for the approximate GCJ model, not surveyed POIs.
// AMap's coordinate policy: https://lbs.amap.com/faq/advisory/others/39840/
export const regionalCoordinates = [
  {
    name: "香港",
    citycode: "1852",
    wgs84: { longitude: 114.166, latitude: 22.298 },
    gcj02: { longitude: 114.17097492355126, latitude: 22.295262221040677 },
  },
  {
    name: "澳门",
    citycode: "1853",
    wgs84: { longitude: 113.5439, latitude: 22.1987 },
    gcj02: { longitude: 113.54900330274944, latitude: 22.195760844510346 },
  },
  {
    name: "台北",
    citycode: "1886",
    wgs84: { longitude: 121.5654, latitude: 25.033 },
    gcj02: { longitude: 121.5691731258631, latitude: 25.030065990080267 },
  },
] as const;
