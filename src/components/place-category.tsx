import {
  BedDouble,
  MapPin,
  Landmark,
  ShoppingBag,
  Utensils,
  TrainFront,
  Ticket,
  StickyNote,
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
