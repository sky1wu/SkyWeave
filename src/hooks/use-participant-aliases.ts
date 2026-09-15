"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ParticipantAlias } from "@/domain/types";
import { api, ApiFailure } from "@/lib/client";

export function useParticipantAliases(tripId: string) {
  const [aliases, setAliases] = useState<ParticipantAlias[] | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await api<ParticipantAlias[]>(
        `/trips/${tripId}/participant-aliases`,
        "GET",
        undefined,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setAliases(result);
        setError("");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiFailure && [401, 403, 404].includes(error.status))
        setAliases(null);
      setError("备注名加载失败，请重试。");
    }
  }, [tripId]);
  useEffect(() => {
    const focus = () => void refresh();
    focus();
    window.addEventListener("focus", focus);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  async function save(
    participantId: string,
    name: string,
    expectedVersion: number,
  ) {
    const result = await api<ParticipantAlias>(
      `/trips/${tripId}/participant-aliases/${participantId}`,
      "PATCH",
      { name, expectedVersion },
    );
    // A read started before this save must not restore the previous alias.
    request.current?.abort();
    setAliases((current) => [
      ...(current ?? []).filter(
        (alias) => alias.participantId !== participantId,
      ),
      result,
    ]);
    setError("");
  }

  return { aliases, error, refresh, save };
}
