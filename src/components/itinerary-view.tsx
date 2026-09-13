"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  MapPin,
  Pencil,
  Route,
} from "lucide-react";
import type { TripSnapshot } from "@/domain/types";
import {
  itineraryDateRange,
  itineraryDays,
  type ItineraryDocument,
} from "@/domain/itinerary";
import { Button } from "./ui/button";
import { ItineraryExport } from "./itinerary-export";
import { ItineraryShareButton } from "./itinerary-share";

export function ItineraryView({ snapshot }: { snapshot: TripSnapshot }) {
  const days = useMemo(() => itineraryDays(snapshot.days), [snapshot.days]);
  const dates = itineraryDateRange(
    snapshot.trip.startDate,
    snapshot.trip.endDate,
  );
  return (
    <ItineraryContent
      itinerary={{
        title: snapshot.trip.title,
        dates,
        timezone: snapshot.trip.timezone,
        days,
      }}
      canEdit={snapshot.role !== "viewer"}
      actions={
        <>
          {snapshot.role !== "viewer" && (
            <Link className="btn" href={`/trips/${snapshot.trip.id}/plan`}>
              <Pencil size={15} />
              编辑行程
            </Link>
          )}
          {snapshot.role === "owner" && (
            <ItineraryShareButton tripId={snapshot.trip.id} />
          )}
        </>
      }
    />
  );
}

export function ItineraryContent({
  itinerary: { title, dates, timezone, days },
  actions,
  canEdit = false,
}: {
  itinerary: ItineraryDocument;
  actions?: ReactNode;
  canEdit?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const count = days.reduce((sum, day) => sum + day.stops.length, 0);
  return (
    <main className="itinerary-view">
      <div className="itinerary-toolbar">
        <h2>行程手册</h2>
        <div>
          {actions}
          <Button onClick={() => setExporting(true)}>
            <ArrowDownToLine size={16} />
            导出行程图
          </Button>
        </div>
      </div>
      <div className="itinerary-cover">
        <div className="itinerary-cover-title">
          <h3>{title}</h3>
          <p>
            <CalendarDays size={17} />
            {dates}
          </p>
        </div>
        <div className="itinerary-cover-count">
          <strong>
            {days.length}
            <span>天</span>
          </strong>
          <span>{count} 项安排</span>
        </div>
        <div className="itinerary-cover-route" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      <p className="itinerary-timezone">
        时间按 {timezone} 显示；预计时间随交通与停留安排推算。
      </p>
      <div className="itinerary-layout">
        {days.length > 0 && (
          <nav className="itinerary-day-nav" aria-label="按天查看行程">
            {days.map((day) => (
              <a key={day.id} href={`#itinerary-day-${day.id}`}>
                <strong>第 {day.number} 天</strong>
                <span>{day.date}</span>
              </a>
            ))}
          </nav>
        )}
        <div className="itinerary-days">
          {!days.length && (
            <div className="itinerary-empty">
              <CalendarDays size={28} />
              <h3>日期待定，旅程待启</h3>
              <p>
                {canEdit
                  ? "进入编辑行程，在行程设置中选择日期范围。"
                  : "等待同行的人设置日期和安排。"}
              </p>
            </div>
          )}
          {days.map((day) => (
            <section
              className="itinerary-day"
              id={`itinerary-day-${day.id}`}
              key={day.id}
              aria-labelledby={`itinerary-heading-${day.id}`}
            >
              <header className="itinerary-day-heading">
                <span
                  className="itinerary-day-number"
                  aria-label={`第 ${day.number} 天`}
                >
                  {String(day.number).padStart(2, "0")}
                </span>
                <div>
                  <h3 id={`itinerary-heading-${day.id}`}>{day.title}</h3>
                  <p>{day.date}</p>
                </div>
                <span>{day.stops.length} 项安排</span>
              </header>
              {!day.stops.length ? (
                <p className="itinerary-day-empty">
                  当天暂无安排，留一点时间自由探索。
                </p>
              ) : (
                <ol className="itinerary-stops">
                  {day.stops.map((stop, index) => (
                    <li key={stop.id}>
                      {stop.connection && (
                        <div className="itinerary-connection">
                          <Route size={16} aria-hidden="true" />
                          <div>
                            <strong>{stop.connection.summary}</strong>
                            {stop.connection.description && (
                              <p>{stop.connection.description}</p>
                            )}
                            {stop.connection.steps.length > 0 && (
                              <details>
                                <summary>查看交通详情</summary>
                                <ol>
                                  {stop.connection.steps.map((step, index) => (
                                    <li key={index}>{step}</li>
                                  ))}
                                </ol>
                              </details>
                            )}
                          </div>
                        </div>
                      )}
                      <article className="itinerary-stop">
                        <span
                          className="itinerary-stop-number"
                          aria-hidden="true"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="itinerary-stop-body">
                          <div className="itinerary-stop-time">
                            <strong>{stop.time}</strong>
                            <span>{stop.timing}</span>
                          </div>
                          <div className="itinerary-stop-heading">
                            <h4>{stop.title}</h4>
                            <span>{stop.category}</span>
                          </div>
                          {stop.details.map((detail, index) => (
                            <p
                              className={`itinerary-detail itinerary-detail-${detail.kind}`}
                              key={index}
                            >
                              {detail.kind === "address" && (
                                <MapPin size={15} aria-hidden="true" />
                              )}
                              {detail.text}
                            </p>
                          ))}
                          {stop.warnings.length > 0 && (
                            <ul className="itinerary-warnings">
                              {stop.warnings.map((warning) => (
                                <li key={warning}>
                                  <AlertTriangle size={14} aria-hidden="true" />
                                  {warning}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
          {days.length > 0 && (
            <div className="itinerary-end">
              <span />
              旅程的每一站，都在这里。
            </div>
          )}
        </div>
      </div>
      {exporting && (
        <ItineraryExport
          title={title}
          dates={dates}
          timezone={timezone}
          days={days}
          close={() => setExporting(false)}
        />
      )}
    </main>
  );
}
