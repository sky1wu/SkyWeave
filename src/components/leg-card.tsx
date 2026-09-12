"use client";
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
import type { DayPlan } from "@/domain/types";
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
  recalculate,
}: {
  leg: DayPlan["legs"][number];
  editable: boolean;
  mutate: (data: unknown) => Promise<unknown>;
  recalculate: () => Promise<unknown>;
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
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`leg-card ${leg.mode === "manual" ? "manual-leg" : ""}`}>
      <button
        className="leg-summary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon size={15} />
        <span>
          {modeLabels[leg.mode]} ·{" "}
          {duration == null ? "时间待定" : `${duration} 分钟`}
          {distance != null ? ` · ${(distance / 1000).toFixed(1)} km` : ""}
        </span>
        <ChevronDown size={13} className={open ? "rotate-180" : ""} />
      </button>
      <p className="leg-note">
        {leg.mode === "manual"
          ? leg.manualDescription || "手动交通段"
          : selected?.summary ||
            (leg.status === "pending" ? "等待计算路线" : leg.error)}
      </p>
      {open && (
        <div className="leg-details">
          <ErrorText error={error} />
          {editable && (
            <label>
              交通方式
              <select
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
              </select>
            </label>
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
                <label>
                  手动交通说明
                  <input
                    name="description"
                    defaultValue={leg.manualDescription ?? ""}
                    placeholder="例如：过关后步行至落马洲站"
                  />
                </label>
                <div className="field-grid">
                  <label>
                    预计时间（分钟）
                    <input
                      name="duration"
                      type="number"
                      min={0}
                      max={10080}
                      defaultValue={leg.manualDurationMinutes ?? ""}
                    />
                  </label>
                  <label>
                    距离（米，可选）
                    <input
                      name="distance"
                      type="number"
                      min={0}
                      defaultValue={leg.manualDistanceMeters ?? ""}
                    />
                  </label>
                </div>
                <button className="btn" disabled={busy}>
                  保存手动交通
                </button>
              </form>
            )
          ) : (
            <>
              <div className="grid gap-2 mt-3">
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
                      <p className="text-amber-700 mt-2">
                        路线几何不完整，地图暂不绘线
                      </p>
                    )}
                    {editable && a.id !== leg.selectedAlternativeId && (
                      <button
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
                      </button>
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
              {editable && (
                <button
                  className="btn mt-3 w-full"
                  disabled={busy}
                  onClick={() => act(recalculate)}
                >
                  重新计算此段
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
