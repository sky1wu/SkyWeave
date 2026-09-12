"use client";
import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import type { Item, PoolPlace } from "@/domain/types";
import {
  transportLabels,
  type TransportPlan,
  type TransportPoint,
} from "@/domain/transport";
import type { Place } from "@/amap/requests";
import { api } from "@/lib/client";
import { readTime, TimeField } from "./item-editor";
import { ErrorText, Modal } from "./ui";

const blankPoint = (): TransportPoint => ({
  name: "",
  sourcePlaceId: null,
  lat: null,
  lng: null,
  amapPoiId: null,
  address: null,
});

function EndpointField({
  label,
  point,
  change,
  places,
}: {
  label: string;
  point: TransportPoint;
  change: (point: TransportPoint) => void;
  places: PoolPlace[];
}) {
  const [results, setResults] = useState<Place[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function search() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ places: Place[] }>(
        `/places/search?q=${encodeURIComponent(point.name)}`,
      );
      if (request === sequence.current) setResults(data.places);
    } catch (e) {
      if (request === sequence.current) setError((e as Error).message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <fieldset className="transport-endpoint-field">
      <legend>{label}</legend>
      <div className="transport-endpoint-search">
        <input
          aria-label={`${label}名称`}
          required
          maxLength={200}
          placeholder="城市、车站或机场"
          value={point.name}
          onChange={(e) => {
            sequence.current++;
            setBusy(false);
            change({ ...blankPoint(), name: e.target.value });
            setResults(null);
          }}
        />
        <button
          className="btn"
          type="button"
          aria-label={`搜索${label}`}
          disabled={busy || !point.name.trim()}
          onClick={search}
        >
          <Search size={15} />
          {busy ? "搜索中" : "搜索"}
        </button>
      </div>
      <select
        aria-label={`从地点池选择${label}`}
        value=""
        onChange={(e) => {
          const p = places.find((p) => p.id === e.target.value);
          if (p) {
            sequence.current++;
            setBusy(false);
            change({
              sourcePlaceId: p.id,
              name: p.title,
              lat: p.lat,
              lng: p.lng,
              amapPoiId: p.amapPoiId,
              address: p.address,
            });
            setResults(null);
          }
        }}
      >
        <option value="">从地点池选择</option>
        {places.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <ErrorText error={error} />
      {results && (
        <div className="transport-endpoint-results">
          {!results.length && <p className="muted">未找到地点，可保留名称。</p>}
          {results.map((p) => (
            <button
              type="button"
              key={p.amapPoiId}
              onClick={() => {
                sequence.current++;
                setBusy(false);
                change({
                  sourcePlaceId:
                    places.find((place) => place.amapPoiId === p.amapPoiId)
                      ?.id ?? null,
                  name: p.name,
                  lat: p.lat,
                  lng: p.lng,
                  amapPoiId: p.amapPoiId,
                  address: p.address,
                });
                setResults(null);
              }}
            >
              <MapPin size={14} />
              <span>
                <strong>{p.name}</strong>
                <small>{p.address}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="transport-location-state">
        {point.lat !== null && point.lng !== null
          ? `已定位${point.address ? ` · ${point.address}` : ""}`
          : "地点待定位，可先保存名称"}
      </p>
      <details>
        <summary>坐标</summary>
        <div className="field-grid">
          <label>
            纬度
            <input
              aria-label={`${label}纬度`}
              type="number"
              step="any"
              min={-90}
              max={90}
              value={point.lat ?? ""}
              onChange={(e) =>
                change({
                  ...point,
                  lat: e.target.value === "" ? null : Number(e.target.value),
                  amapPoiId: null,
                })
              }
            />
          </label>
          <label>
            经度
            <input
              aria-label={`${label}经度`}
              type="number"
              step="any"
              min={-180}
              max={180}
              value={point.lng ?? ""}
              onChange={(e) =>
                change({
                  ...point,
                  lng: e.target.value === "" ? null : Number(e.target.value),
                  amapPoiId: null,
                })
              }
            />
          </label>
        </div>
      </details>
    </fieldset>
  );
}

export function TransportEditor({
  item,
  places,
  close,
  save,
}: {
  item?: Item;
  places: PoolPlace[];
  close: () => void;
  save: (data: Record<string, unknown>) => Promise<unknown>;
}) {
  const [origin, setOrigin] = useState(item?.transport?.origin ?? blankPoint()),
    [destination, setDestination] = useState(
      item?.transport?.destination ?? blankPoint(),
    );
  const [mode, setMode] = useState<TransportPlan["mode"]>(
    item?.transport?.mode ?? "train",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={item ? "编辑独立交通" : "添加独立交通"} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(event.currentTarget),
            start = readTime(f, "start"),
            end = readTime(f, "end");
          try {
            await save({
              title:
                String(f.get("title") ?? "").trim() ||
                `${transportLabels[mode]} · ${origin.name} → ${destination.name}`,
              type: "transport",
              placeCategory: "交通",
              lat: null,
              lng: null,
              amapPoiId: null,
              address: null,
              sourcePlaceId: null,
              stayMinutes: 0,
              fixedTime: start !== null,
              startMinutes: start,
              endMinutes: end,
              notes: f.get("notes") || null,
              transport: {
                mode,
                status: f.get("status"),
                serviceNumber: f.get("serviceNumber") || null,
                origin,
                destination,
                durationMinutes:
                  f.get("duration") === "" ? null : Number(f.get("duration")),
              },
              ...(item ? { expectedVersion: item.version } : {}),
            });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorText error={error} />
        <div className="field-grid">
          <label>
            交通类型
            <select
              name="mode"
              aria-label="交通类型"
              value={mode}
              onChange={(e) => setMode(e.target.value as TransportPlan["mode"])}
            >
              {Object.entries(transportLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            确认状态
            <select
              name="status"
              aria-label="确认状态"
              defaultValue={item?.transport?.status ?? "tentative"}
            >
              <option value="tentative">暂定</option>
              <option value="confirmed">已确认</option>
            </select>
          </label>
        </div>
        <EndpointField
          label="出发地"
          point={origin}
          change={setOrigin}
          places={places}
        />
        <EndpointField
          label="到达地"
          point={destination}
          change={setDestination}
          places={places}
        />
        <div className="field-grid">
          <label>
            班次（可选）
            <input
              name="serviceNumber"
              maxLength={80}
              defaultValue={item?.transport?.serviceNumber ?? ""}
              placeholder={mode === "flight" ? "航班号" : "车次或班次"}
            />
          </label>
          <label>
            预计用时（分钟）
            <input
              name="duration"
              type="number"
              min={0}
              max={10080}
              defaultValue={item?.transport?.durationMinutes ?? ""}
              placeholder="待定"
            />
          </label>
        </div>
        <div className="field-grid">
          <TimeField name="start" label="出发时间" value={item?.startMinutes} />
          <TimeField name="end" label="到达时间" value={item?.endMinutes} />
        </div>
        <p className="text-xs muted">
          时间可留空，使用行程时区；跨午夜请选择“次日”。
        </p>
        <label>
          名称（可选）
          <input
            name="title"
            maxLength={200}
            defaultValue={item?.title ?? ""}
            placeholder="默认使用交通类型和起终点"
          />
        </label>
        <label>
          备注
          <textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "保存中…" : "保存交通"}
        </button>
      </form>
    </Modal>
  );
}
