"use client";
import { useState } from "react";
import type { Item } from "@/domain/types";
import { typeLabels } from "@/domain/types";
import { placeCategories } from "@/domain/planning";
import { ErrorText, Modal } from "./ui";
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
    <label>
      {label}
      <div className="flex gap-2 mt-1.5">
        <select
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
        </select>
        <input
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
    </label>
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
          <label>
            名称
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={item?.title ?? (point ? "自选地点" : "")}
              placeholder="想去的地方或要做的事"
            />
          </label>
          <label>
            类型
            <select name="type" defaultValue={item?.type ?? "place"}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          地点分类
          <input
            name="placeCategory"
            list="item-place-categories"
            maxLength={40}
            defaultValue={item?.placeCategory ?? "未分类"}
          />
          <datalist id="item-place-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          地址
          <input name="address" defaultValue={item?.address ?? ""} />
        </label>
        <div className="field-grid">
          <label>
            纬度（WGS-84）
            <input
              name="lat"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={point?.lat ?? item?.lat ?? ""}
            />
          </label>
          <label>
            经度（WGS-84）
            <input
              name="lng"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={point?.lng ?? item?.lng ?? ""}
            />
          </label>
        </div>
        <div className="field-grid">
          <TimeField name="start" label="开始时间" value={item?.startMinutes} />
          <TimeField name="end" label="结束时间" value={item?.endMinutes} />
        </div>
        <div className="field-grid items-center">
          <label>
            停留时间（分钟）
            <input
              name="stayMinutes"
              type="number"
              min={0}
              max={10080}
              defaultValue={item?.stayMinutes ?? 0}
            />
          </label>
          <label className="flex items-center gap-2 pt-6">
            <input
              name="fixedTime"
              type="checkbox"
              defaultChecked={item?.fixedTime}
            />{" "}
            固定时间活动
          </label>
        </div>
        <p className="text-xs muted">
          固定活动保持原定结束时间。跨午夜请选择“次日”；结束时间留空时使用停留时长。
        </p>
        <label>
          说明
          <input name="description" defaultValue={item?.description ?? ""} />
        </label>
        <label>
          备注
          <textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "保存中…" : "保存事项"}
        </button>
      </form>
    </Modal>
  );
}
