import {
  BedDouble,
  MapPin,
  Landmark,
  ShoppingBag,
  Utensils,
  TrainFront,
  Ticket,
  StickyNote,
  Plane,
  Bus,
  Ship,
} from "lucide-react";

const categories = {
  住宿: { icon: BedDouble, tone: "blue" },
  酒店: { icon: BedDouble, tone: "blue" },
  景点: { icon: Landmark, tone: "green" },
  餐饮: { icon: Utensils, tone: "orange" },
  购物: { icon: ShoppingBag, tone: "violet" },
  交通: { icon: TrainFront, tone: "blue" },
  口岸: { icon: TrainFront, tone: "blue" },
  活动: { icon: Ticket, tone: "violet" },
  备注: { icon: StickyNote, tone: "neutral" },
  火车: { icon: TrainFront, tone: "blue" },
  飞机: { icon: Plane, tone: "violet" },
  长途汽车: { icon: Bus, tone: "orange" },
  轮船: { icon: Ship, tone: "blue" },
};

export function PlaceCategory({ name }: { name: string }) {
  const { icon: Icon, tone } = categories[name as keyof typeof categories] ?? {
    icon: MapPin,
    tone: "neutral",
  };
  return (
    <span className={`place-category category-${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {name}
    </span>
  );
}
