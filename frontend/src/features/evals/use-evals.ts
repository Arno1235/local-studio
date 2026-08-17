"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import type {
  EvalCompareResponse,
  EvalCustomSuiteWrite,
  EvalHardware,
  EvalLogLine,
  EvalRun,
  EvalSuiteInfo,
  RecipeWithStatus,
} from "@/lib/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asRun = (value: unknown): EvalRun | null => {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return value as unknown as EvalRun;
};

export function useEvals() {
  const [suites, setSuites] = useState<EvalSuiteInfo[]>([]);
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>([]);
  const [compare, setCompare] = useState<EvalCompareResponse | null>(null);
  const [hardware, setHardware] = useState<EvalHardware | null>(null);
  const [hardwareIds, setHardwareIds] = useState<string[]>([]);
  const [selectedHardware, setSelectedHardware] = useState<string>("");
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [active, setActive] = useState<EvalRun | null>(null);
  const [logs, setLogs] = useState<EvalLogLine[]>([]);
  const [selectedSuites, setSelectedSuites] = useState<string[]>([]);
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const logSeqRef = useRef(0);

  const refreshCompare = useCallback(async (hardwareId?: string) => {
    const payload = await api.getEvalCompare(hardwareId || undefined);
    setCompare(payload);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [suitePayload, recipePayload, hardwarePayload, runPayload] = await Promise.all([
        api.getEvalSuites(),
        api.getRecipes(),
        api.getEvalHardware(),
        api.getEvalRuns(),
      ]);
      setSuites([...suitePayload.suites]);
      setRecipes(recipePayload.recipes);
      setHardware(hardwarePayload.current);
      setHardwareIds([...hardwarePayload.hardware_ids]);
      setRuns([...runPayload.runs]);
      setActive(runPayload.active);
      setSelectedSuites((current) =>
        current.length > 0 ? current : suitePayload.suites.map((suite) => suite.id),
      );
      setSelectedRecipes((current) =>
        current.length > 0 ? current : recipePayload.recipes.map((recipe) => recipe.id),
      );
      const hardwareId = selectedHardware || hardwarePayload.current.id;
      if (!selectedHardware) setSelectedHardware(hardwarePayload.current.id);
      await refreshCompare(hardwareId);
      if (runPayload.active) {
        const detail = await api.getEvalRun(runPayload.active.id, 0);
        setLogs([...detail.logs]);
        logSeqRef.current = detail.logs.at(-1)?.seq ?? 0;
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [refreshCompare, selectedHardware]);

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  useMountSubscription(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; data?: Record<string, unknown> }>)
        .detail;
      if (!detail) return;
      if (detail.type === "eval_run") {
        const run = asRun(detail.data?.["run"]);
        if (!run) return;
        setActive(
          run.status === "queued" || run.status === "launching" || run.status === "running"
            ? run
            : null,
        );
        setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
          void refreshCompare(selectedHardware);
        }
      }
      if (detail.type === "eval_log") {
        const seq = Number(detail.data?.["seq"]);
        const line = detail.data?.["line"];
        const created =
          typeof detail.data?.["created_at"] === "string"
            ? detail.data["created_at"]
            : new Date().toISOString();
        if (!Number.isFinite(seq) || typeof line !== "string") return;
        setLogs((current) =>
          current.some((entry) => entry.seq === seq)
            ? current
            : [...current, { seq, line, created_at: created }].sort(
                (left, right) => left.seq - right.seq,
              ),
        );
        if (seq > logSeqRef.current) logSeqRef.current = seq;
      }
    };
    window.addEventListener("vllm:eval-event", onEvent);
    return () => window.removeEventListener("vllm:eval-event", onEvent);
  }, [refreshCompare, selectedHardware]);

  useMountSubscription(() => {
    const runId = active?.id;
    if (!runId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const detail = await api.getEvalRun(runId, logSeqRef.current);
        if (cancelled) return;
        const live =
          detail.run.status === "queued" ||
          detail.run.status === "launching" ||
          detail.run.status === "running";
        setActive(live ? detail.run : null);
        setLogs((current) => {
          const seen = new Set(current.map((entry) => entry.seq));
          const next = [...current];
          for (const line of detail.logs) {
            if (!seen.has(line.seq)) next.push(line);
            if (line.seq > logSeqRef.current) logSeqRef.current = line.seq;
          }
          return next.sort((left, right) => left.seq - right.seq);
        });
        if (!live) {
          setRuns((current) => [
            detail.run,
            ...current.filter((entry) => entry.id !== detail.run.id),
          ]);
          void refreshCompare(selectedHardware);
        }
      } catch {
        return;
      }
    };
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active?.id, refreshCompare, selectedHardware]);

  const running = Boolean(active);

  const start = useCallback(
    async (all: boolean) => {
      if (busy || running) return;
      setBusy(true);
      setError(null);
      setLogs([]);
      logSeqRef.current = 0;
      try {
        const payload = await api.startEvalRun({
          suite_ids: selectedSuites,
          recipe_ids: all ? [] : selectedRecipes,
        });
        setActive(payload.run);
        setRuns((current) => [
          payload.run,
          ...current.filter((entry) => entry.id !== payload.run.id),
        ]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [busy, running, selectedRecipes, selectedSuites],
  );

  const cancel = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      const payload = await api.cancelEvalRun(active.id);
      setActive(null);
      setRuns((current) => [
        payload.run,
        ...current.filter((entry) => entry.id !== payload.run.id),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [active]);

  const createCustom = useCallback(async (body: EvalCustomSuiteWrite) => {
    const payload = await api.createEvalSuite(body);
    setSuites((current) => [...current, payload.suite]);
    setSelectedSuites((current) => [...current, payload.suite.id]);
    return payload.suite;
  }, []);

  const removeCustom = useCallback(async (suiteId: string) => {
    await api.deleteEvalSuite(suiteId);
    setSuites((current) => current.filter((suite) => suite.id !== suiteId));
    setSelectedSuites((current) => current.filter((id) => id !== suiteId));
  }, []);

  const selectHardware = useCallback(
    async (hardwareId: string) => {
      setSelectedHardware(hardwareId);
      await refreshCompare(hardwareId);
    },
    [refreshCompare],
  );

  const progress = useMemo(() => {
    if (!active || active.progress_total <= 0) return 0;
    return Math.round((active.progress_done / active.progress_total) * 100);
  }, [active]);

  return {
    suites,
    recipes,
    compare,
    hardware,
    hardwareIds,
    selectedHardware,
    runs,
    active,
    logs,
    selectedSuites,
    selectedRecipes,
    error,
    loading,
    busy,
    running,
    progress,
    setSelectedSuites,
    setSelectedRecipes,
    start,
    cancel,
    createCustom,
    removeCustom,
    selectHardware,
    refresh,
  };
}
