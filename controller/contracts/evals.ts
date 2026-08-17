export type EvalSuiteKind = "throughput" | "capability" | "product" | "custom";

export type EvalGrader = "contains" | "regex" | "exact" | "json";

export type EvalRunStatus =
  | "queued"
  | "launching"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface EvalCaseSpec {
  id: string;
  prompt: string;
  expected: string | null;
}

export interface EvalCustomSuite {
  id: string;
  name: string;
  description: string;
  kind: "custom";
  prompt: string;
  grader: EvalGrader;
  expected: string;
  cases: readonly EvalCaseSpec[];
  created_at: string;
  updated_at: string;
}

export interface EvalSuiteInfo {
  id: string;
  name: string;
  description: string;
  kind: EvalSuiteKind;
  builtin: boolean;
}

export interface EvalCaseResult {
  case_id: string;
  passed: boolean;
  score: number | null;
  metrics: Record<string, number | null>;
  output_preview: string | null;
  error: string | null;
  duration_ms: number;
}

export interface EvalResult {
  id: string;
  run_id: string;
  suite_id: string;
  recipe_id: string;
  model_id: string;
  hardware_id: string;
  engine: string | null;
  score: number;
  display_score: string;
  metrics: Record<string, number | null>;
  cases: readonly EvalCaseResult[];
  error: string | null;
  measured_at: string;
}

export interface EvalLogLine {
  seq: number;
  line: string;
  created_at: string;
}

export interface EvalHardware {
  id: string;
  label: string;
  gpu_name: string | null;
  gpu_count: number;
  memory_gb: number | null;
}

export interface EvalHardwareResponse {
  current: EvalHardware;
  hardware_ids: readonly string[];
}

export interface EvalRun {
  id: string;
  status: EvalRunStatus;
  hardware_id: string;
  hardware_label: string;
  suite_ids: readonly string[];
  recipe_ids: readonly string[];
  current_recipe_id: string | null;
  current_suite_id: string | null;
  progress_done: number;
  progress_total: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface EvalStartRequest {
  suite_ids: readonly string[];
  recipe_ids: readonly string[];
}

export interface EvalCustomSuiteWrite {
  name: string;
  description: string;
  prompt: string;
  grader: EvalGrader;
  expected: string;
  cases: readonly EvalCaseSpec[];
}

export interface EvalSuitesResponse {
  suites: readonly EvalSuiteInfo[];
}

export interface EvalRunsResponse {
  runs: readonly EvalRun[];
  active: EvalRun | null;
}

export interface EvalRunDetailResponse {
  run: EvalRun;
  results: readonly EvalResult[];
  logs: readonly EvalLogLine[];
}

export interface EvalResultsResponse {
  hardware: EvalHardware;
  results: readonly EvalResult[];
}

export interface EvalCompareCell {
  suite_id: string;
  score: number;
  display_score: string;
  run_id: string;
  measured_at: string;
}

export interface EvalCompareRow {
  recipe_id: string;
  model_id: string;
  engine: string | null;
  cells: readonly EvalCompareCell[];
}

export interface EvalCompareResponse {
  hardware: EvalHardware;
  suites: readonly EvalSuiteInfo[];
  rows: readonly EvalCompareRow[];
}
