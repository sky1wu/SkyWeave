import type {
  DayGeometry,
  DayPlan,
  Member,
  TripSection,
  VersionedSnapshot,
} from "@/domain/types";
import { api, ApiFailure } from "./client";

interface Entry {
  data: VersionedSnapshot | null;
  error: string;
  epoch: number;
}
const empty: Entry = { data: null, error: "", epoch: -1 };

// Owned by one trip layout, never shared between users or browser sessions.
export class TripStore {
  private entries = new Map<TripSection, Entry>();
  private listeners = new Set<() => void>();
  private flights = new Map<TripSection, Promise<void>>();
  private controllers = new Set<AbortController>();
  private geometries = new Map<string, DayGeometry>();
  private geometryFlights = new Map<string, Promise<DayGeometry>>();
  private revisionFlight?: Promise<void>;
  private sequence = 0;
  private epoch = 0;
  private revoked = false;
  private revokedEntry?: Entry;
  private active?: TripSection;

  constructor(
    readonly tripId: string,
    private request: typeof api = api,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = (section: TripSection) =>
    this.revokedEntry ?? this.entries.get(section) ?? empty;
  isRevoked = () => this.revoked;
  private emit() {
    for (const listener of this.listeners) listener();
  }

  activate(section: TripSection) {
    this.active = section;
    // Re-entering a cached page also validates profile edits made outside the
    // activity log, while retaining the existing content during the small check.
    if (this.get(section).data)
      return this.checkRevision().then(() => this.load(section));
    return this.load(section);
  }

  sync(sequence: number) {
    this.sequence = Math.max(this.sequence, sequence);
    return this.active ? this.load(this.active) : Promise.resolve();
  }

  refresh(section: TripSection) {
    // A mutation completing during a read requires a trailing read. Every cached
    // section becomes stale, including sections not currently on screen.
    this.epoch++;
    return this.load(section);
  }

  load(section: TripSection): Promise<void> {
    if (this.revoked) return Promise.resolve();
    const running = this.flights.get(section);
    if (running) return running;
    const cached = this.get(section);
    if (
      cached.data &&
      cached.data.sequence >= this.sequence &&
      cached.epoch === this.epoch
    )
      return Promise.resolve();
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = (async () => {
      try {
        do {
          const epoch = this.epoch;
          const data = await this.request<VersionedSnapshot>(
            `/trips/${this.tripId}?section=${section}`,
            "GET",
            undefined,
            { signal: controller.signal },
          );
          if (controller.signal.aborted || this.revoked) return;
          this.sequence = Math.max(this.sequence, data.sequence);
          this.entries.set(section, { data, error: "", epoch });
          this.emit();
          // SSE can arrive after the DB read but before the download finishes.
          // Keep that result usable, then catch up exactly once if necessary.
        } while (
          this.get(section).data!.sequence < this.sequence ||
          this.get(section).epoch < this.epoch
        );
      } catch (error) {
        if (controller.signal.aborted || this.revoked) return;
        if (
          error instanceof ApiFailure &&
          [401, 403, 404].includes(error.status)
        )
          this.revoke(error.message);
        else {
          this.entries.set(section, {
            ...this.get(section),
            error: (error as Error).message,
          });
          this.emit();
        }
        throw error;
      } finally {
        this.controllers.delete(controller);
      }
    })();
    this.flights.set(section, task);
    const clear = () => {
      if (this.flights.get(section) === task) this.flights.delete(section);
    };
    void task.then(clear, clear);
    return task;
  }

  checkRevision(): Promise<void> {
    if (this.revoked) return Promise.resolve();
    if (this.revisionFlight) return this.revisionFlight;
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = (async () => {
      try {
        const result = await this.request<{
          sequence: number;
          members?: Pick<Member, "userId" | "name" | "email">[];
        }>(`/trips/${this.tripId}/revision`, "GET", undefined, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && !this.revoked) {
          if (result.members) this.updateProfiles(result.members);
          await this.sync(result.sequence);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          error instanceof ApiFailure &&
          [401, 403, 404].includes(error.status)
        )
          this.revoke(error.message);
        throw error;
      } finally {
        this.controllers.delete(controller);
      }
    })();
    this.revisionFlight = task;
    const clear = () => {
      if (this.revisionFlight === task) this.revisionFlight = undefined;
    };
    void task.then(clear, clear);
    return task;
  }

  private updateProfiles(
    profiles: Pick<Member, "userId" | "name" | "email">[],
  ) {
    const users = new Map(profiles.map((profile) => [profile.userId, profile]));
    let changed = false;
    for (const [section, entry] of this.entries) {
      const data = entry.data;
      if (
        !data ||
        !data.members.some((member) => {
          const profile = users.get(member.userId);
          return (
            profile &&
            (profile.name !== member.name || profile.email !== member.email)
          );
        })
      )
        continue;
      this.entries.set(section, {
        ...entry,
        data: {
          ...data,
          members: data.members.map((member) => ({
            ...member,
            ...users.get(member.userId),
          })),
          comments: data.comments.map((comment) => ({
            ...comment,
            authorName:
              users.get(comment.authorUserId)?.name ?? comment.authorName,
          })),
          activity: data.activity.map((activity) => ({
            ...activity,
            actorName:
              users.get(activity.actorUserId)?.name ?? activity.actorName,
          })),
        },
      });
      changed = true;
    }
    if (changed) this.emit();
  }

  geometry(day: Pick<DayPlan, "id" | "version">): Promise<DayGeometry> {
    if (this.revoked)
      return Promise.reject(new Error("你已没有访问此行程的权限"));
    const cached = this.geometries.get(day.id);
    if (cached?.version === day.version) return Promise.resolve(cached);
    const key = `${day.id}:${day.version}`;
    const running = this.geometryFlights.get(key);
    if (running) return running;
    const controller = new AbortController();
    this.controllers.add(controller);
    const task = this.request<DayGeometry>(
      `/days/${day.id}/geometry`,
      "GET",
      undefined,
      { signal: controller.signal },
    ).then((data) => {
      if (!controller.signal.aborted && !this.revoked) {
        const current = this.geometries.get(day.id);
        if (!current || current.version <= data.version)
          this.geometries.set(day.id, data);
      }
      return data;
    });
    this.geometryFlights.set(key, task);
    const clear = () => {
      this.controllers.delete(controller);
      if (this.geometryFlights.get(key) === task)
        this.geometryFlights.delete(key);
    };
    void task.then(clear, clear);
    return task;
  }

  cancel() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.flights.clear();
    this.geometryFlights.clear();
    this.revisionFlight = undefined;
  }

  revoke(message = "你已没有访问此行程的权限") {
    this.revoked = true;
    this.revokedEntry = { data: null, error: message, epoch: -1 };
    this.cancel();
    this.geometries.clear();
    this.entries.clear();
    this.emit();
  }
}
