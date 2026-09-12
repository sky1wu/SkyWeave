"use client";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Label } from "./ui/label";
import { useState } from "react";
import {
  ChevronDown,
  Footprints,
  TrainFront,
  Car,
  Bike,
  PencilLine,
  Check,
} from "lucide-react";
import type { DayPlan, Item } from "@/domain/types";
import type { TimelineEntry } from "@/domain/timeline";
import { FixedArrival } from "./fixed-arrival";
import { modeLabels } from "@/domain/types";
import { ErrorText } from "./ui";
const icons = {
  walking: Footprints,
  transit: TrainFront,
  driving: Car,
  cycling: Bike,
  manual: PencilLine,
};
export function LegCard({
  leg,
  editable,
  mutate,
  focus,
  destination,
  arrival,
}: {
  leg: DayPlan["legs"][number];
  editable: boolean;
  mutate: (data: unknown) => Promise<unknown>;
  focus: () => void;
  destination: Item;
  arrival: TimelineEntry;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = leg.alternatives.find(
      (a) => a.id === leg.selectedAlternativeId,
    ),
    Icon = icons[leg.mode];
  const duration =
    leg.mode === "manual"
      ? leg.manualDurationMinutes
      : selected
        ? Math.ceil(selected.durationSeconds / 60)
        : null;
  const distance =
    leg.mode === "manual" ? leg.manualDistanceMeters : selected?.distanceMeters;
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      focus();
      await fn();
      focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      data-leg-id={leg.id}
      className={`leg-card ${open ? "expanded" : ""} ${leg.mode === "manual" ? "manual-leg" : ""}`}
    >
      <button
        className="leg-summary"
        aria-expanded={open}
        aria-controls={`leg-details-${leg.id}`}
        onClick={() => {
          if (!open) focus();
          setOpen(!open);
        }}
      >
        <Icon size={15} />
        <span>
          {modeLabels[leg.mode]} ·{" "}
          {duration == null ? "时间待定" : `${duration} 分钟`}
          {distance != null ? ` · ${(distance / 1000).toFixed(1)} km` : ""}
        </span>
        <span className="leg-toggle-label">
          {open ? "收起路线" : "展开路线"}
          <ChevronDown size={15} className={open ? "rotate-180" : ""} />
        </span>
      </button>
      <p className="leg-note">
        {leg.mode === "manual"
          ? leg.manualDescription || "手动交通段"
          : selected?.summary ||
            (leg.status === "pending" ? "等待计算路线" : leg.error)}
      </p>
      {open && (
        <div className="leg-details" id={`leg-details-${leg.id}`}>
          <ErrorText error={error} />
          <FixedArrival item={destination} entry={arrival} />
          {editable && (
            <Label>
              交通方式
              <NativeSelect
                aria-label="交通方式"
                value={leg.mode}
                disabled={busy}
                onChange={(e) =>
                  act(() =>
                    mutate({
                      mode: e.target.value,
                      expectedVersion: leg.version,
                    }),
                  )
                }
              >
                {Object.entries(modeLabels).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          {leg.mode === "manual" ? (
            editable && (
              <form
                className="grid gap-3 mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(() =>
                    mutate({
                      expectedVersion: leg.version,
                      manualDescription: f.get("description"),
                      manualDurationMinutes:
                        f.get("duration") === ""
                          ? null
                          : Number(f.get("duration")),
                      manualDistanceMeters:
                        f.get("distance") === ""
                          ? null
                          : Number(f.get("distance")),
                    }),
                  );
                }}
              >
                <Label>
                  手动交通说明
                  <Input
                    name="description"
                    defaultValue={leg.manualDescription ?? ""}
                    placeholder="例如：过关后步行至落马洲站"
                  />
                </Label>
                <div className="field-grid">
                  <Label>
                    预计时间（分钟）
                    <Input
                      name="duration"
                      type="number"
                      min={0}
                      max={10080}
                      defaultValue={leg.manualDurationMinutes ?? ""}
                    />
                  </Label>
                  <Label>
                    距离（米，可选）
                    <Input
                      name="distance"
                      type="number"
                      min={0}
                      defaultValue={leg.manualDistanceMeters ?? ""}
                    />
                  </Label>
                </div>
                <Button
                  variant="outline"
                  type="submit"
                  className="btn"
                  disabled={busy}
                >
                  保存手动交通
                </Button>
              </form>
            )
          ) : (
            <>
              <div className="route-alternatives" aria-label="路线方案">
                {leg.alternatives.map((a) => (
                  <div
                    key={a.id}
                    className={`alternative ${a.id === leg.selectedAlternativeId ? "selected" : ""}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <b>
                        {a.label} · {Math.ceil(a.durationSeconds / 60)} 分钟
                      </b>
                      {a.id === leg.selectedAlternativeId && (
                        <Check size={15} />
                      )}
                    </div>
                    <p>{a.summary}</p>
                    <p className="muted mt-2">
                      {(a.distanceMeters / 1000).toFixed(1)} km
                      {a.walkingDistanceMeters !== null &&
                        ` · 步行 ${a.walkingDistanceMeters} m`}
                      {a.transferCount !== null &&
                        ` · 换乘 ${a.transferCount} 次`}
                    </p>
                    {!a.geometryComplete && (
                      <p className="text-amber-700 mt-2">无法完整绘制路线</p>
                    )}
                    {editable && a.id !== leg.selectedAlternativeId && (
                      <Button
                        variant="outline"
                        type="button"
                        className="btn mt-3"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            mutate({
                              expectedVersion: leg.version,
                              selectedAlternativeId: a.id,
                            }),
                          )
                        }
                      >
                        使用{a.label}
                      </Button>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer muted">
                        路线步骤
                      </summary>
                      <ol className="pl-4 list-decimal mt-2 space-y-2">
                        {a.steps.map((step, i) => (
                          <li key={i}>{step.instruction}</li>
                        ))}
                      </ol>
                    </details>
                  </div>
                ))}
              </div>
            </>
          )}
          <button className="leg-close" onClick={() => setOpen(false)}>
            收起路线
            <ChevronDown size={14} className="rotate-180" />
          </button>
        </div>
      )}
    </div>
  );
}
