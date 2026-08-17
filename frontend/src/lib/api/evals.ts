import type {
  EvalCompareResponse,
  EvalCustomSuiteWrite,
  EvalHardwareResponse,
  EvalRun,
  EvalRunDetailResponse,
  EvalRunsResponse,
  EvalStartRequest,
  EvalSuiteInfo,
  EvalSuitesResponse,
} from "@local-studio/contracts/evals";
import type { ApiCore } from "./core";

export function createEvalsApi(core: ApiCore) {
  return {
    getEvalSuites: (): Promise<EvalSuitesResponse> => core.request("/evals/suites"),

    createEvalSuite: (body: EvalCustomSuiteWrite): Promise<{ suite: EvalSuiteInfo }> =>
      core.request("/evals/suites", { method: "POST", body: JSON.stringify(body) }),

    updateEvalSuite: (
      suiteId: string,
      body: EvalCustomSuiteWrite,
    ): Promise<{ suite: EvalSuiteInfo }> =>
      core.request(`/evals/suites/${encodeURIComponent(suiteId)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),

    deleteEvalSuite: (suiteId: string): Promise<{ success: boolean }> =>
      core.request(`/evals/suites/${encodeURIComponent(suiteId)}`, { method: "DELETE" }),

    getEvalHardware: (): Promise<EvalHardwareResponse> => core.request("/evals/hardware"),

    getEvalCompare: (hardwareId?: string): Promise<EvalCompareResponse> => {
      const query = hardwareId ? `?hardware_id=${encodeURIComponent(hardwareId)}` : "";
      return core.request(`/evals/compare${query}`);
    },

    getEvalRuns: (): Promise<EvalRunsResponse> => core.request("/evals/runs"),

    getEvalRun: (runId: string, after = 0): Promise<EvalRunDetailResponse> =>
      core.request(`/evals/runs/${encodeURIComponent(runId)}?after=${after}`),

    startEvalRun: (body: EvalStartRequest): Promise<{ run: EvalRun }> =>
      core.request("/evals/runs", {
        method: "POST",
        body: JSON.stringify(body),
        retries: 0,
      }),

    cancelEvalRun: (runId: string): Promise<{ run: EvalRun }> =>
      core.request(`/evals/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        retries: 0,
      }),
  };
}
