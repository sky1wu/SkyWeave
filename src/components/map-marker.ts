import type { MapLocation } from "@/domain/map-locations";
import { placeMapLabels, type LabelRect } from "@/domain/map-labels";

// Compact outline symbols drawn in a 24 × 24 grid; text is always assigned as textContent.
const icons = {
  pin: [
    "M12 22s8-8 8-13A8 8 0 0 0 4 9c0 5 8 13 8 13Z",
    "M9 9a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  ],
  hotel: ["M3 20V5M21 20v-8H3M7 8h4v4H7ZM13 7h6v5"],
  sight: ["m3 8 9-5 9 5ZM5 10v9M10 10v9M15 10v9M20 10v9M3 21h18"],
  food: ["M4 3v6c0 3 6 3 6 0V3M7 3v18M18 3c-4 3-4 8 0 8h2M20 3v18"],
  shopping: ["M4 7h16l1 14H3ZM8 7V5a4 4 0 0 1 8 0v2"],
  train: [
    "M6 3h12v15H6ZM6 10h12M10 3v7M8 21l2-3M16 21l-2-3M9 14h.01M15 14h.01",
  ],
  plane: ["M12 2v20M12 7 3 13v3l9-4 9 4v-3ZM12 18l-4 3M12 18l4 3"],
  bus: ["M4 4h16v14H4ZM4 11h16M7 18v3M17 18v3M7 14h.01M17 14h.01"],
  ship: [
    "M8 10V4h8v6M12 4V2M3 12l9-3 9 3-4 8H7ZM12 9v10M3 22l3-1 3 1 3-1 3 1 3-1 3 1",
  ],
  activity: [
    "M3 5h18v4a3 3 0 0 0 0 6v4H3v-4a3 3 0 0 0 0-6ZM15 5v3M15 11v2M15 16v3",
  ],
  note: ["M4 3h16v13l-5 5H4ZM15 21v-5h5M8 8h8M8 12h6"],
};
export function mapCategory(category: string): {
  icon: keyof typeof icons;
  color: string;
  glyph?: string;
} {
  const mapping: Record<string, { icon: keyof typeof icons; color: string }> = {
    景点: { icon: "sight", color: "#32826d" },
    餐饮: { icon: "food", color: "#bc7934" },
    住宿: { icon: "hotel", color: "#4671b9" },
    酒店: { icon: "hotel", color: "#4671b9" },
    购物: { icon: "shopping", color: "#9b5d9a" },
    交通: { icon: "train", color: "#367e9d" },
    火车: { icon: "train", color: "#367e9d" },
    口岸: { icon: "train", color: "#367e9d" },
    飞机: { icon: "plane", color: "#7964b2" },
    长途汽车: { icon: "bus", color: "#ad773e" },
    轮船: { icon: "ship", color: "#347ba2" },
    活动: { icon: "activity", color: "#8b64ad" },
    备注: { icon: "note", color: "#738198" },
  };
  return (
    mapping[category] ?? {
      icon: "pin",
      color: "#647d9c",
      glyph: ["未分类", "地点", "其他", "其他交通"].includes(category)
        ? undefined
        : [...category][0],
    }
  );
}

export function markerElement(point: MapLocation, active: boolean) {
  const { icon, color, glyph } = mapCategory(point.category);
  const node = document.createElement("button");
  node.className = `map-marker map-place-marker ${point.poolPlaceId ? "unplanned" : "planned"} ${active ? "active" : ""}`;
  node.style.setProperty("--marker-color", color);
  node.dataset.locationId = point.id;
  node.dataset.icon = icon;
  node.dataset.category = point.category;
  if (point.itemId) node.dataset.itemId = point.itemId;
  if (point.poolPlaceId) node.dataset.poolPlaceId = point.poolPlaceId;
  node.setAttribute(
    "aria-label",
    `${point.poolPlaceId ? "未安排地点" : "地图地点"} ${point.title}`,
  );
  node.title = point.title;
  const symbol = document.createElement("span");
  symbol.className = "map-marker-symbol";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, value);
  for (const d of icons[icon]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  if (glyph) symbol.textContent = glyph;
  else symbol.append(svg);
  node.append(symbol);
  if (point.number !== undefined) {
    const badge = document.createElement("span");
    badge.className = "map-marker-number";
    badge.textContent = String(point.number);
    node.append(badge);
  }
  const label = document.createElement("span");
  label.className = "map-marker-label";
  label.textContent = point.title;
  if (point.endpoint) {
    const endpoint = document.createElement("small");
    endpoint.textContent = point.endpoint === "origin" ? "出发" : "到达";
    label.append(endpoint);
  }
  node.append(label);
  const leader = document.createElement("span");
  leader.className = "map-label-leader";
  node.prepend(leader);
  return node;
}

export function arrangeMapLabels(container: HTMLElement, bounds: LabelRect) {
  const markers = [
    ...container.querySelectorAll<HTMLElement>(".map-place-marker"),
  ];
  const anchors = markers.map((node) => {
    const rect = node.getBoundingClientRect(),
      label = node.querySelector<HTMLElement>(".map-marker-label")!;
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      width: label.offsetWidth,
      height: label.offsetHeight,
    };
  });
  const labels = placeMapLabels(anchors, bounds);
  for (const [i, node] of markers.entries()) {
    const anchor = anchors[i],
      rect = labels[i],
      dx = rect.x + rect.width / 2 - anchor.x,
      dy = rect.y + rect.height / 2 - anchor.y;
    const label = node.querySelector<HTMLElement>(".map-marker-label")!;
    label.style.left = `${17 + dx}px`;
    label.style.top = `${17 + rect.y - anchor.y}px`;
    const leader = node.querySelector<HTMLElement>(".map-label-leader")!;
    leader.style.width = `${Math.hypot(dx, dy)}px`;
    leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }
}
