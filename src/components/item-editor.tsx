"use client";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { useState } from "react";
import { Checkbox } from "./ui/checkbox";
import type { Item } from "@/domain/types";
import { typeLabels } from "@/domain/types";
import { placeCategories } from "@/domain/planning";
import { ErrorText, Modal } from "./ui";
import { SearchableSelect } from "./searchable-select";
export function itemPayload(item: Item) {
  return {
    title: item.title,
    type: item.type,
    description: item.description,
    amapPoiId: item.amapPoiId,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    startMinutes: item.startMinutes,
    endMinutes: item.endMinutes,
    stayMinutes: item.stayMinutes,
    fixedTime: item.fixedTime,
    notes: item.notes,
    sourcePlaceId: item.sourcePlaceId,
    placeCategory: item.placeCategory,
    transport: item.transport,
  };
}
export function TimeField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value?: number | null;
}) {
  return (
    <Label>
      {label}
      <div className="flex gap-2 mt-1.5">
        <NativeSelect
          name={`${name}Day`}
          defaultValue={Math.floor((value ?? 0) / 1440)}
          aria-label={`${label}日期`}
          className="max-w-24"
        >
          {Array.from({ length: 8 }, (_, d) => (
            <option key={d} value={d}>
              {d === 0 ? "当天" : d === 1 ? "次日" : `第 ${d + 1} 日`}
            </option>
          ))}
        </NativeSelect>
        <Input
          name={name}
          type="time"
          aria-label={label}
          defaultValue={
            value == null
              ? ""
              : `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`
          }
        />
      </div>
    </Label>
  );
}
export function readTime(form: FormData, key: string): number | null {
  const text = String(form.get(key) ?? "");
  if (!text) return null;
  const [h, m] = text.split(":").map(Number);
  return Number(form.get(`${key}Day`) ?? 0) * 1440 + h * 60 + m;
}
export function ItemEditor({
  item,
  point,
  close,
  save,
  categories = placeCategories,
}: {
  item?: Item;
  point?: { lat: number; lng: number };
  close: () => void;
  save: (data: Record<string, unknown>) => Promise<unknown>;
  categories?: string[];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const num = (key: string) =>
      f.get(key) === "" ? null : Number(f.get(key));
    const lat = num("lat"),
      lng = num("lng");
    try {
      await save({
        title: f.get("title"),
        type: f.get("type"),
        placeCategory: f.get("placeCategory") || "未分类",
        address: f.get("address") || null,
        description: f.get("description") || null,
        notes: f.get("notes") || null,
        lat,
        lng,
        amapPoiId:
          lat === item?.lat && lng === item?.lng
            ? (item?.amapPoiId ?? null)
            : null,
        stayMinutes: Number(f.get("stayMinutes")),
        fixedTime: f.get("fixedTime") === "on",
        startMinutes: readTime(f, "start"),
        endMinutes: readTime(f, "end"),
        ...(item ? { expectedVersion: item.version } : {}),
      });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={item ? "编辑行程事项" : "添加行程事项"} close={close}>
      <form onSubmit={submit}>
        <ErrorText error={error} />
        <div className="field-grid">
          <Label>
            名称
            <Input
              name="title"
              required
              maxLength={200}
              defaultValue={item?.title ?? (point ? "自选地点" : "")}
              placeholder="想去的地方或要做的事"
            />
          </Label>
          <Label>
            类型
            <NativeSelect name="type" defaultValue={item?.type ?? "place"}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </div>
        <SearchableSelect
          label="地点分类"
          name="placeCategory"
          defaultValue={item?.placeCategory ?? "未分类"}
          options={categories.map((value) => ({ value, label: value }))}
          allowCustom
        />
        <Label>
          地址
          <Input name="address" defaultValue={item?.address ?? ""} />
        </Label>
        <div className="field-grid">
          <Label>
            纬度（WGS-84）
            <Input
              name="lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={point?.lat ?? item?.lat ?? ""}
            />
          </Label>
          <Label>
            经度（WGS-84）
            <Input
              name="lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={point?.lng ?? item?.lng ?? ""}
            />
          </Label>
        </div>
        <div className="field-grid">
          <TimeField name="start" label="开始时间" value={item?.startMinutes} />
          <TimeField name="end" label="结束时间" value={item?.endMinutes} />
        </div>
        <div className="field-grid items-center">
          <Label>
            停留时间（分钟）
            <Input
              name="stayMinutes"
              type="number"
              min={0}
              max={10080}
              defaultValue={item?.stayMinutes ?? 0}
            />
          </Label>
          <Label className="flex items-center gap-2 pt-6">
            <Checkbox name="fixedTime" defaultChecked={item?.fixedTime} />{" "}
            固定时间活动
          </Label>
        </div>
        <p className="text-xs muted">
          固定活动保持原定结束时间。跨午夜请选择“次日”；结束时间留空时使用停留时长。
        </p>
        <Label>
          说明
          <Input name="description" defaultValue={item?.description ?? ""} />
        </Label>
        <Label>
          备注
          <Textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} />
        </Label>
        <Button
          variant="default"
          type="submit"
          className="btn primary"
          disabled={busy}
        >
          {busy ? "保存中…" : "保存事项"}
        </Button>
      </form>
    </Modal>
  );
}
