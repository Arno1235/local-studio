"use client";

import { useRef, useState } from "react";
import {
  AppPage,
  Button,
  Card,
  Checkbox,
  PageContainer,
  PageHeader,
  PageState,
  ProgressBar,
  Select,
  StatusPill,
  RefreshButton,
} from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { EvalCompareRow, EvalRun, EvalSuiteInfo } from "@/lib/types";
import { CustomEvalDialog, SuitePicker } from "./custom-eval-dialog";
import { useEvals } from "./use-evals";

const runTone = (status: EvalRun["status"]) => {
  if (status === "completed") return "good" as const;
  if (status === "failed") return "danger" as const;
  if (status === "cancelled") return "warning" as const;
  return "info" as const;
};

function cellFor(row: EvalCompareRow, suiteId: string) {
  return row.cells.find((cell) => cell.suite_id === suiteId) ?? null;
}

function CompareTable({
  suites,
  rows,
}: {
  suites: readonly EvalSuiteInfo[];
  rows: readonly EvalCompareRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-[length:var(--fs-sm)] text-(--ui-muted)">
        No scores yet. Run selected suites to fill this grid.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-[length:var(--fs-sm)]">
        <thead>
          <tr className="border-b border-(--ui-border) text-(--ui-muted)">
            <th className="py-2 pr-3 font-medium">Model</th>
            {suites.map((suite) => (
              <th key={suite.id} className="px-2 py-2 font-medium">
                {suite.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.recipe_id} className="border-b border-(--ui-border)/70">
              <td className="py-2 pr-3">
                <div className="font-medium text-(--ui-fg)">{row.model_id}</div>
                <div className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {row.engine ?? "—"}
                </div>
              </td>
              {suites.map((suite) => {
                const cell = cellFor(row, suite.id);
                return (
                  <td key={suite.id} className="px-2 py-2 tabular-nums text-(--ui-fg)">
                    {cell ? cell.display_score : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogPanel({ lines }: { lines: Array<{ seq: number; line: string }> }) {
  const scroller = useRef<HTMLDivElement>(null);
  useMountSubscription(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines.length]);
  return (
    <div
      ref={scroller}
      className="max-h-64 overflow-auto rounded-[var(--rad-md)] bg-(--ui-bg) px-3 py-2 font-mono text-[length:var(--fs-xs)] leading-5 text-(--ui-muted)"
    >
      {lines.length === 0 ? (
        <div>Logs appear here while a run is in progress.</div>
      ) : (
        lines.map((entry) => (
          <div key={entry.seq} className="whitespace-pre-wrap">
            {entry.line}
          </div>
        ))
      )}
    </div>
  );
}

function runLabel(
  run: EvalRun,
  recipes: Array<{ id: string; name: string }>,
  suites: EvalSuiteInfo[],
): string {
  return (
    [
      recipes.find((recipe) => recipe.id === run.current_recipe_id)?.name ?? run.current_recipe_id,
      suites.find((suite) => suite.id === run.current_suite_id)?.name ?? run.current_suite_id,
    ]
      .filter(Boolean)
      .join(" · ") || "starting"
  );
}

function RunActions({
  running,
  busy,
  canStart,
  loading,
  onRefresh,
  onCancel,
  onStartSelected,
  onStartAll,
}: {
  running: boolean;
  busy: boolean;
  canStart: boolean;
  loading: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onStartSelected: () => void;
  onStartAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RefreshButton onRefresh={onRefresh} loading={loading} />
      {running ? (
        <Button variant="danger" onClick={onCancel} disabled={busy}>
          Cancel run
        </Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onStartSelected} disabled={busy || !canStart}>
            Run selected
          </Button>
          <Button onClick={onStartAll} disabled={busy || !canStart}>
            Run all models
          </Button>
        </>
      )}
    </div>
  );
}

function ActiveRunCard({
  run,
  progress,
  recipes,
  suites,
}: {
  run: EvalRun;
  progress: number;
  recipes: Array<{ id: string; name: string }>;
  suites: EvalSuiteInfo[];
}) {
  return (
    <Card padding="sm" className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <StatusPill tone={runTone(run.status)}>
          {run.status} · {run.progress_done}/{run.progress_total}
        </StatusPill>
        <span className="min-w-0 truncate text-[length:var(--fs-xs)] text-(--ui-muted)">
          {runLabel(run, recipes, suites)}
        </span>
      </div>
      <ProgressBar progress={progress} />
    </Card>
  );
}

function RecipePicker({
  recipes,
  selected,
  onChange,
}: {
  recipes: Array<{ id: string; name: string; backend: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <Card title="Recipes" padding="sm">
      <div className="flex flex-col gap-2">
        {recipes.length === 0 ? (
          <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
            Add a serve recipe in Configure first.
          </p>
        ) : (
          recipes.map((recipe) => (
            <Checkbox
              key={recipe.id}
              checked={selected.includes(recipe.id)}
              onChange={(checked) =>
                onChange(
                  checked ? [...selected, recipe.id] : selected.filter((id) => id !== recipe.id),
                )
              }
              label={recipe.name || recipe.id}
              description={recipe.backend}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function HistoryList({ runs }: { runs: EvalRun[] }) {
  if (runs.length === 0) {
    return <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">No runs yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {runs.slice(0, 12).map((run) => (
        <li key={run.id} className="flex items-center justify-between gap-3">
          <StatusPill tone={runTone(run.status)}>{run.status}</StatusPill>
          <span className="min-w-0 truncate text-[length:var(--fs-xs)] text-(--ui-muted)">
            {run.hardware_label} · {new Date(run.started_at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EvalsPage() {
  const evals = useEvals();
  const [customOpen, setCustomOpen] = useState(false);
  const pageState = PageState({
    loading: evals.loading && !evals.compare,
    data: evals.compare,
    hasData: Boolean(evals.compare),
    error: evals.error,
    onLoad: evals.refresh,
  });
  if (pageState && evals.loading) return <AppPage>{pageState}</AppPage>;

  const suiteFilter = (evals.compare?.suites ?? evals.suites).filter(
    (suite) => evals.selectedSuites.length === 0 || evals.selectedSuites.includes(suite.id),
  );

  return (
    <AppPage>
      <PageContainer width="xl">
        <PageHeader
          title="Evals"
          description="Run the same suites on every recipe, then compare scores for this machine."
          actions={
            <RunActions
              running={evals.running}
              busy={evals.busy}
              canStart={evals.selectedSuites.length > 0}
              loading={evals.loading}
              onRefresh={evals.refresh}
              onCancel={() => void evals.cancel()}
              onStartSelected={() => void evals.start(false)}
              onStartAll={() => void evals.start(true)}
            />
          }
        />

        {evals.hardware ? (
          <p className="mb-4 text-[length:var(--fs-sm)] text-(--ui-muted)">
            This machine: {evals.hardware.label} ({evals.hardware.id})
          </p>
        ) : null}

        {evals.active ? (
          <ActiveRunCard
            run={evals.active}
            progress={evals.progress}
            recipes={evals.recipes}
            suites={evals.suites}
          />
        ) : null}

        {evals.error ? (
          <p className="mb-4 text-[length:var(--fs-sm)] text-(--err)">{evals.error}</p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <SuitePicker
              suites={evals.suites}
              selected={evals.selectedSuites}
              onChange={evals.setSelectedSuites}
              onDelete={(id) => void evals.removeCustom(id)}
            />
            <Button variant="secondary" onClick={() => setCustomOpen(true)}>
              New custom eval
            </Button>
            <RecipePicker
              recipes={evals.recipes}
              selected={evals.selectedRecipes}
              onChange={evals.setSelectedRecipes}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Card
              title="Comparison"
              description="Latest score per model and suite on the selected hardware class."
              padding="md"
            >
              {evals.hardwareIds.length > 1 ? (
                <div className="mb-3 max-w-xs">
                  <Select
                    label="Hardware"
                    value={evals.selectedHardware}
                    onChange={(event) => void evals.selectHardware(event.target.value)}
                    options={evals.hardwareIds.map((id) => ({ value: id, label: id }))}
                  />
                </div>
              ) : null}
              <CompareTable suites={suiteFilter} rows={evals.compare?.rows ?? []} />
            </Card>
            <Card title="Logs" padding="sm">
              <LogPanel lines={evals.logs} />
            </Card>
            <Card title="History" padding="sm">
              <HistoryList runs={evals.runs} />
            </Card>
          </div>
        </div>
      </PageContainer>
      <CustomEvalDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onCreate={async (body) => {
          await evals.createCustom(body);
        }}
      />
    </AppPage>
  );
}
