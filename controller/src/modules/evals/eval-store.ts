import type { Database } from "bun:sqlite";
import type { Effect } from "effect";
import type {
  EvalCaseResult,
  EvalCaseSpec,
  EvalCompareCell,
  EvalCompareResponse,
  EvalCompareRow,
  EvalCustomSuite,
  EvalCustomSuiteWrite,
  EvalGrader,
  EvalLogLine,
  EvalResult,
  EvalRun,
  EvalRunStatus,
  EvalSuiteInfo,
} from "@local-studio/contracts/evals";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "../../stores/sqlite";

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const parseJson = <T>(raw: unknown, fallback: T): T => {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const parseRun = (row: Record<string, unknown>): EvalRun => ({
  id: asString(row["id"]),
  status: asString(row["status"], "queued") as EvalRunStatus,
  hardware_id: asString(row["hardware_id"]),
  hardware_label: asString(row["hardware_label"]),
  suite_ids: parseJson<string[]>(row["suite_ids_json"], []),
  recipe_ids: parseJson<string[]>(row["recipe_ids_json"], []),
  current_recipe_id: asNullableString(row["current_recipe_id"]),
  current_suite_id: asNullableString(row["current_suite_id"]),
  progress_done: asNumber(row["progress_done"]),
  progress_total: asNumber(row["progress_total"]),
  error: asNullableString(row["error"]),
  started_at: asString(row["started_at"]),
  finished_at: asNullableString(row["finished_at"]),
});

const parseResult = (row: Record<string, unknown>): EvalResult => ({
  id: asString(row["id"]),
  run_id: asString(row["run_id"]),
  suite_id: asString(row["suite_id"]),
  recipe_id: asString(row["recipe_id"]),
  model_id: asString(row["model_id"]),
  hardware_id: asString(row["hardware_id"]),
  engine: asNullableString(row["engine"]),
  score: asNumber(row["score"]),
  display_score: asString(row["display_score"]),
  metrics: parseJson<Record<string, number | null>>(row["metrics_json"], {}),
  cases: parseJson<EvalCaseResult[]>(row["cases_json"], []),
  error: asNullableString(row["error"]),
  measured_at: asString(row["measured_at"]),
});

const parseCustom = (row: Record<string, unknown>): EvalCustomSuite => ({
  id: asString(row["id"]),
  name: asString(row["name"]),
  description: asString(row["description"]),
  kind: "custom",
  prompt: asString(row["prompt"]),
  grader: asString(row["grader"], "contains") as EvalGrader,
  expected: asString(row["expected"]),
  cases: parseJson<EvalCaseSpec[]>(row["cases_json"], []),
  created_at: asString(row["created_at"]),
  updated_at: asString(row["updated_at"]),
});

export class EvalStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => this.migrate(db));
    this.closeDatabase = makeDatabaseCloser(this.db, "evals.close");
  }

  private migrate(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS eval_custom_suites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        grader TEXT NOT NULL,
        expected TEXT NOT NULL DEFAULT '',
        cases_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        hardware_id TEXT NOT NULL,
        hardware_label TEXT NOT NULL,
        suite_ids_json TEXT NOT NULL,
        recipe_ids_json TEXT NOT NULL,
        current_recipe_id TEXT,
        current_suite_id TEXT,
        progress_done INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS eval_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        suite_id TEXT NOT NULL,
        recipe_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        hardware_id TEXT NOT NULL,
        engine TEXT,
        score REAL NOT NULL,
        display_score TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        cases_json TEXT NOT NULL,
        error TEXT,
        measured_at TEXT NOT NULL
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_eval_results_compare ON eval_results(hardware_id, recipe_id, suite_id, measured_at)`,
    );
    db.run(`
      CREATE TABLE IF NOT EXISTS eval_logs (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        line TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      )
    `);
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }

  public insertRun(run: EvalRun): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("evals.insert-run", () => {
      this.db
        .query(
          `INSERT INTO eval_runs (
            id, status, hardware_id, hardware_label, suite_ids_json, recipe_ids_json,
            current_recipe_id, current_suite_id, progress_done, progress_total, error,
            started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          run.status,
          run.hardware_id,
          run.hardware_label,
          JSON.stringify(run.suite_ids),
          JSON.stringify(run.recipe_ids),
          run.current_recipe_id,
          run.current_suite_id,
          run.progress_done,
          run.progress_total,
          run.error,
          run.started_at,
          run.finished_at,
        );
    });
  }

  public updateRun(
    id: string,
    patch: Partial<
      Pick<
        EvalRun,
        | "status"
        | "current_recipe_id"
        | "current_suite_id"
        | "progress_done"
        | "progress_total"
        | "error"
        | "finished_at"
      >
    >,
  ): Effect.Effect<EvalRun | null, RepositoryError> {
    return repositoryEffect("evals.update-run", () => {
      const current = this.db.query("SELECT * FROM eval_runs WHERE id = ?").get(id) as Record<
        string,
        unknown
      > | null;
      if (!current) return null;
      const next = parseRun({ ...current, ...patch });
      this.db
        .query(
          `UPDATE eval_runs SET
            status = ?, current_recipe_id = ?, current_suite_id = ?,
            progress_done = ?, progress_total = ?, error = ?, finished_at = ?
           WHERE id = ?`,
        )
        .run(
          next.status,
          next.current_recipe_id,
          next.current_suite_id,
          next.progress_done,
          next.progress_total,
          next.error,
          next.finished_at,
          id,
        );
      return next;
    });
  }

  public getRun(id: string): Effect.Effect<EvalRun | null, RepositoryError> {
    return repositoryEffect("evals.get-run", () => {
      const row = this.db.query("SELECT * FROM eval_runs WHERE id = ?").get(id) as Record<
        string,
        unknown
      > | null;
      return row ? parseRun(row) : null;
    });
  }

  public listRuns(limit = 40): Effect.Effect<EvalRun[], RepositoryError> {
    return repositoryEffect("evals.list-runs", () => {
      const rows = this.db
        .query("SELECT * FROM eval_runs ORDER BY started_at DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>;
      return rows.map(parseRun);
    });
  }

  public activeRun(): Effect.Effect<EvalRun | null, RepositoryError> {
    return repositoryEffect("evals.active-run", () => {
      const row = this.db
        .query(
          `SELECT * FROM eval_runs
           WHERE status IN ('queued', 'launching', 'running')
           ORDER BY started_at DESC LIMIT 1`,
        )
        .get() as Record<string, unknown> | null;
      return row ? parseRun(row) : null;
    });
  }

  public insertResult(result: EvalResult): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("evals.insert-result", () => {
      this.db
        .query(
          `INSERT INTO eval_results (
            id, run_id, suite_id, recipe_id, model_id, hardware_id, engine,
            score, display_score, metrics_json, cases_json, error, measured_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          result.id,
          result.run_id,
          result.suite_id,
          result.recipe_id,
          result.model_id,
          result.hardware_id,
          result.engine,
          result.score,
          result.display_score,
          JSON.stringify(result.metrics),
          JSON.stringify(result.cases),
          result.error,
          result.measured_at,
        );
    });
  }

  public resultsForRun(runId: string): Effect.Effect<EvalResult[], RepositoryError> {
    return repositoryEffect("evals.results-for-run", () => {
      const rows = this.db
        .query("SELECT * FROM eval_results WHERE run_id = ? ORDER BY measured_at")
        .all(runId) as Array<Record<string, unknown>>;
      return rows.map(parseResult);
    });
  }

  public compare(hardwareId: string, suites: readonly EvalSuiteInfo[]): EvalCompareResponse {
    const rows = this.db
      .query(
        `SELECT r.* FROM eval_results r
         INNER JOIN (
           SELECT recipe_id, suite_id, MAX(measured_at) AS latest
           FROM eval_results
           WHERE hardware_id = ?
           GROUP BY recipe_id, suite_id
         ) latest
         ON r.recipe_id = latest.recipe_id
         AND r.suite_id = latest.suite_id
         AND r.measured_at = latest.latest
         WHERE r.hardware_id = ?
         ORDER BY r.model_id`,
      )
      .all(hardwareId, hardwareId) as Array<Record<string, unknown>>;
    const grouped = new Map<string, EvalCompareRow>();
    for (const row of rows.map(parseResult)) {
      const existing = grouped.get(row.recipe_id);
      const cell: EvalCompareCell = {
        suite_id: row.suite_id,
        score: row.score,
        display_score: row.display_score,
        run_id: row.run_id,
        measured_at: row.measured_at,
      };
      if (existing) {
        grouped.set(row.recipe_id, { ...existing, cells: [...existing.cells, cell] });
        continue;
      }
      grouped.set(row.recipe_id, {
        recipe_id: row.recipe_id,
        model_id: row.model_id,
        engine: row.engine,
        cells: [cell],
      });
    }
    return {
      hardware: {
        id: hardwareId,
        label: hardwareId,
        gpu_name: null,
        gpu_count: 0,
        memory_gb: null,
      },
      suites,
      rows: [...grouped.values()],
    };
  }

  public compareEffect(
    hardwareId: string,
    suites: readonly EvalSuiteInfo[],
  ): Effect.Effect<EvalCompareResponse, RepositoryError> {
    return repositoryEffect("evals.compare", () => this.compare(hardwareId, suites));
  }

  public distinctHardwareIds(): Effect.Effect<string[], RepositoryError> {
    return repositoryEffect("evals.hardware-ids", () => {
      const rows = this.db
        .query(
          `SELECT hardware_id FROM eval_runs
           UNION
           SELECT hardware_id FROM eval_results
           ORDER BY hardware_id`,
        )
        .all() as Array<{ hardware_id: string }>;
      return rows.map((row) => row.hardware_id);
    });
  }

  public nextLogSeq(runId: string): Effect.Effect<number, RepositoryError> {
    return repositoryEffect("evals.next-log-seq", () => {
      const row = this.db
        .query("SELECT MAX(seq) AS seq FROM eval_logs WHERE run_id = ?")
        .get(runId) as { seq: number | null } | null;
      return (row?.seq ?? 0) + 1;
    });
  }

  public appendLog(runId: string, seq: number, line: string): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("evals.append-log", () => {
      this.db
        .query("INSERT INTO eval_logs (run_id, seq, line, created_at) VALUES (?, ?, ?, ?)")
        .run(runId, seq, line, new Date().toISOString());
    });
  }

  public logsAfter(runId: string, after = 0): Effect.Effect<EvalLogLine[], RepositoryError> {
    return repositoryEffect("evals.logs-after", () => {
      const rows = this.db
        .query("SELECT seq, line, created_at FROM eval_logs WHERE run_id = ? AND seq > ? ORDER BY seq")
        .all(runId, after) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        seq: asNumber(row["seq"]),
        line: asString(row["line"]),
        created_at: asString(row["created_at"]),
      }));
    });
  }

  public listCustomSuites(): Effect.Effect<EvalCustomSuite[], RepositoryError> {
    return repositoryEffect("evals.list-custom", () => {
      const rows = this.db
        .query("SELECT * FROM eval_custom_suites ORDER BY name")
        .all() as Array<Record<string, unknown>>;
      return rows.map(parseCustom);
    });
  }

  public getCustomSuite(id: string): Effect.Effect<EvalCustomSuite | null, RepositoryError> {
    return repositoryEffect("evals.get-custom", () => {
      const row = this.db
        .query("SELECT * FROM eval_custom_suites WHERE id = ?")
        .get(id) as Record<string, unknown> | null;
      return row ? parseCustom(row) : null;
    });
  }

  public saveCustomSuite(suite: EvalCustomSuite): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("evals.save-custom", () => {
      this.db
        .query(
          `INSERT INTO eval_custom_suites (
            id, name, description, prompt, grader, expected, cases_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            prompt = excluded.prompt,
            grader = excluded.grader,
            expected = excluded.expected,
            cases_json = excluded.cases_json,
            updated_at = excluded.updated_at`,
        )
        .run(
          suite.id,
          suite.name,
          suite.description,
          suite.prompt,
          suite.grader,
          suite.expected,
          JSON.stringify(suite.cases),
          suite.created_at,
          suite.updated_at,
        );
    });
  }

  public deleteCustomSuite(id: string): Effect.Effect<boolean, RepositoryError> {
    return repositoryEffect("evals.delete-custom", () => {
      const result = this.db.query("DELETE FROM eval_custom_suites WHERE id = ?").run(id);
      return result.changes > 0;
    });
  }
}

export const customSuiteFromWrite = (
  id: string,
  body: EvalCustomSuiteWrite,
  now: string,
  createdAt?: string,
): EvalCustomSuite => ({
  id,
  name: body.name.trim(),
  description: body.description.trim(),
  kind: "custom",
  prompt: body.prompt,
  grader: body.grader,
  expected: body.expected,
  cases: body.cases,
  created_at: createdAt ?? now,
  updated_at: now,
});
