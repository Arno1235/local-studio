import { randomUUID } from "node:crypto";
import { Effect, Fiber } from "effect";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import type {
  EvalCustomSuite,
  EvalCustomSuiteWrite,
  EvalHardware,
  EvalResult,
  EvalRun,
  EvalSuiteInfo,
} from "@local-studio/contracts/evals";
import type { Logger } from "../../core/logger";
import type { Recipe } from "../models/types";
import type { ComputeBridge } from "../compute/bridge";
import type { LaunchFailure } from "../compute/contracts";
import { Event, type EventManager } from "../system/event-manager";
import type { PeakMetricsStore } from "../system/metrics-store";
import type { RecipeStore } from "../models/recipes/recipe-store";
import { completeChat, type EvalChatMessage, type EvalChatTool, type InferenceFetch } from "./eval-chat";
import { builtinSuiteInfo, customSuiteInfo, resolveSuite } from "./eval-registry";
import { customSuiteFromWrite, type EvalStore } from "./eval-store";
import { detectEvalHardware } from "./hardware";
import type { EvalSuiteContext, EvalSuiteOutcome } from "./suites/types";

const waitUntilAborted = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const abort = (): void => resume(Effect.void);
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

const launchFailureMessage = (failure: LaunchFailure): string => {
  switch (failure.kind) {
    case "already-running":
      return failure.kind;
    case "spawn-failed":
    case "install-failed":
      return failure.detail;
    case "unsupported":
      return failure.reason;
    case "no-capacity":
      return `needs ${failure.need} GPU(s)`;
    case "exited-early":
      return "process exited early";
    case "unhealthy-timeout":
      return "timed out waiting for the model";
    case "cancelled":
      return "Cancelled";
  }
};

type ActiveJob = {
  runId: string;
  controller: AbortController;
  fiber: Fiber.Fiber<void, never> | null;
};

export class EvalService {
  private active: ActiveJob | null = null;

  public constructor(
    private readonly store: EvalStore,
    private readonly recipeStore: RecipeStore,
    private readonly bridge: ComputeBridge,
    private readonly events: EventManager,
    private readonly logger: Logger,
    private readonly fetchInference: InferenceFetch,
    private readonly peakMetricsStore: PeakMetricsStore,
  ) {}

  public shutdown(): Effect.Effect<void> {
    const job = this.active;
    this.active = null;
    if (!job) return Effect.void;
    job.controller.abort();
    return job.fiber ? Fiber.interrupt(job.fiber).pipe(Effect.asVoid) : Effect.void;
  }

  public listSuiteInfo(): Effect.Effect<EvalSuiteInfo[], never> {
    const service = this;
    return Effect.gen(function* () {
      const custom = yield* service.store.listCustomSuites().pipe(Effect.catch(() => Effect.succeed([])));
      return [...builtinSuiteInfo(), ...custom.map(customSuiteInfo)];
    });
  }

  public hardware(): Effect.Effect<EvalHardware> {
    return detectEvalHardware();
  }

  public start(input: {
    suiteIds: readonly string[];
    recipeIds: readonly string[];
  }): Effect.Effect<EvalRun, string> {
    const service = this;
    return Effect.gen(function* () {
      const existing = yield* service.store.activeRun().pipe(Effect.catch(() => Effect.succeed(null)));
      if (existing || service.active) return yield* Effect.fail("An eval run is already in progress");
      const hardware = yield* detectEvalHardware();
      const recipes = yield* service.recipeStore.list().pipe(Effect.mapError((error) => error.message));
      const custom = yield* service.store
        .listCustomSuites()
        .pipe(Effect.catch(() => Effect.succeed([])));
      const suites = yield* service.listSuiteInfo();
      const suiteIds =
        input.suiteIds.length > 0
          ? input.suiteIds.filter((id) => suites.some((suite) => suite.id === id))
          : suites.map((suite) => suite.id);
      const recipeIds =
        input.recipeIds.length > 0
          ? input.recipeIds.filter((id) => recipes.some((recipe) => recipe.id === id))
          : recipes.map((recipe) => recipe.id);
      if (suiteIds.length === 0) return yield* Effect.fail("Select at least one eval suite");
      if (recipeIds.length === 0) return yield* Effect.fail("No recipes available to evaluate");
      const now = new Date().toISOString();
      const run: EvalRun = {
        id: randomUUID(),
        status: "queued",
        hardware_id: hardware.id,
        hardware_label: hardware.label,
        suite_ids: suiteIds,
        recipe_ids: recipeIds,
        current_recipe_id: null,
        current_suite_id: null,
        progress_done: 0,
        progress_total: suiteIds.length * recipeIds.length,
        error: null,
        started_at: now,
        finished_at: null,
      };
      yield* service.store.insertRun(run).pipe(Effect.mapError((error) => error.message));
      const owner: ActiveJob = { runId: run.id, controller: new AbortController(), fiber: null };
      service.active = owner;
      owner.fiber = yield* service
        .execute(run, recipes, custom, owner)
        .pipe(Effect.catch(() => Effect.void), Effect.forkDetach({ startImmediately: true }));
      yield* service.publishRun(run);
      return run;
    });
  }

  public cancel(): Effect.Effect<EvalRun | null, never> {
    const service = this;
    return Effect.gen(function* () {
      const job = service.active;
      if (!job) {
        return yield* service.store.activeRun().pipe(Effect.catch(() => Effect.succeed(null)));
      }
      service.active = null;
      job.controller.abort();
      if (job.fiber) yield* Fiber.interrupt(job.fiber).pipe(Effect.asVoid);
      const run = yield* service.store
        .updateRun(job.runId, {
          status: "cancelled",
          error: "Cancelled",
          finished_at: new Date().toISOString(),
        })
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (run) yield* service.publishRun(run);
      return run;
    });
  }

  public saveCustom(body: EvalCustomSuiteWrite, id?: string): Effect.Effect<EvalCustomSuite, string> {
    const service = this;
    return Effect.gen(function* () {
      const name = body.name.trim();
      if (!name) return yield* Effect.fail("Name is required");
      if (!body.prompt.trim() && body.cases.length === 0) {
        return yield* Effect.fail("Provide a prompt or at least one case");
      }
      const now = new Date().toISOString();
      const existing = id
        ? yield* service.store.getCustomSuite(id).pipe(Effect.catch(() => Effect.succeed(null)))
        : null;
      if (id && !existing) return yield* Effect.fail("Custom eval not found");
      const suite = customSuiteFromWrite(
        existing?.id ?? `custom.${randomUUID()}`,
        { ...body, name },
        now,
        existing?.created_at,
      );
      yield* service.store.saveCustomSuite(suite).pipe(Effect.mapError((error) => error.message));
      return suite;
    });
  }

  private execute(
    initial: EvalRun,
    recipes: Recipe[],
    custom: EvalCustomSuite[],
    owner: ActiveJob,
  ): Effect.Effect<void> {
    const service = this;
    return Effect.gen(function* () {
      let run = initial;
      const selected = initial.recipe_ids
        .map((id) => recipes.find((recipe) => recipe.id === id))
        .filter((recipe): recipe is Recipe => Boolean(recipe));
      yield* service.log(run.id, `Starting ${selected.length} model(s) × ${initial.suite_ids.length} suite(s) on ${initial.hardware_label}`);
      let done = 0;
      for (const recipe of selected) {
        if (owner.controller.signal.aborted) break;
        run =
          (yield* service.store
            .updateRun(run.id, {
              status: "launching",
              current_recipe_id: recipe.id,
              current_suite_id: null,
            })
            .pipe(Effect.catch(() => Effect.succeed(run)))) ?? run;
        yield* service.publishRun(run);
        const prepared = yield* service.ensureRecipe(recipe, owner.controller.signal);
        if (!prepared.ok) {
          yield* service.log(run.id, `Skip ${recipe.id}: ${prepared.error}`);
          done += initial.suite_ids.length;
          run =
            (yield* service.store
              .updateRun(run.id, { progress_done: done })
              .pipe(Effect.catch(() => Effect.succeed(run)))) ?? run;
          continue;
        }
        for (const suiteId of initial.suite_ids) {
          if (owner.controller.signal.aborted) break;
          const suite = resolveSuite(suiteId, custom);
          if (!suite) {
            yield* service.log(run.id, `Unknown suite ${suiteId}`);
            done += 1;
            continue;
          }
          run =
            (yield* service.store
              .updateRun(run.id, {
                status: "running",
                current_recipe_id: recipe.id,
                current_suite_id: suite.id,
                progress_done: done,
              })
              .pipe(Effect.catch(() => Effect.succeed(run)))) ?? run;
          yield* service.publishRun(run);
          yield* service.log(run.id, `Running ${suite.name} on ${prepared.modelId}`);
          const context: EvalSuiteContext = {
            modelId: prepared.modelId,
            maxModelLen: recipe.max_model_len || 8192,
            signal: owner.controller.signal,
            complete: (request) => {
              const payload: {
                model: string;
                messages: EvalChatMessage[];
                tools?: EvalChatTool[];
                stream?: boolean;
                timeoutMs?: number;
                signal: AbortSignal;
              } = {
                model: prepared.modelId,
                messages: request.messages,
                signal: owner.controller.signal,
              };
              if (request.tools) payload.tools = request.tools;
              if (request.stream === true) payload.stream = true;
              if (request.timeoutMs) payload.timeoutMs = request.timeoutMs;
              return completeChat(service.fetchInference, payload);
            },
            log: (line) => service.log(run.id, `  ${line}`),
          };
          const outcome = yield* suite.run(context).pipe(
            Effect.map((value) => ({ value, error: null as string | null })),
            Effect.catch((error) =>
              Effect.succeed({
                value: {
                  score: 0,
                  displayScore: "error",
                  metrics: {} as EvalSuiteOutcome["metrics"],
                  cases: [],
                } satisfies EvalSuiteOutcome,
                error: error.message,
              }),
            ),
          );
          const result: EvalResult = {
            id: randomUUID(),
            run_id: run.id,
            suite_id: suite.id,
            recipe_id: recipe.id,
            model_id: prepared.modelId,
            hardware_id: initial.hardware_id,
            engine: recipe.backend,
            score: outcome.value.score,
            display_score: outcome.value.displayScore,
            metrics: outcome.value.metrics,
            cases: outcome.value.cases,
            error: outcome.error,
            measured_at: new Date().toISOString(),
          };
          yield* service.store.insertResult(result).pipe(Effect.catch(() => Effect.void));
          if (suite.id === "throughput.context-sweep") {
            yield* service.peakMetricsStore
              .updateIfBetterEffect(
                prepared.modelId,
                outcome.value.metrics["prefill_tps"] ?? undefined,
                outcome.value.metrics["decode_tps"] ?? undefined,
                outcome.value.metrics["ttft_ms"] ?? undefined,
              )
              .pipe(Effect.catch(() => Effect.void));
          }
          yield* service.log(
            run.id,
            `${suite.name}: ${outcome.error ? outcome.error : outcome.value.displayScore}`,
          );
          done += 1;
        }
      }
      const aborted = owner.controller.signal.aborted;
      const finished =
        (yield* service.store
          .updateRun(run.id, {
            status: aborted ? "cancelled" : "completed",
            current_recipe_id: null,
            current_suite_id: null,
            progress_done: done,
            error: aborted ? "Cancelled" : null,
            finished_at: new Date().toISOString(),
          })
          .pipe(Effect.catch(() => Effect.succeed(run)))) ?? run;
      yield* service.publishRun(finished);
      yield* service.log(run.id, aborted ? "Cancelled" : "Run complete");
      if (service.active === owner) service.active = null;
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const message = String(error);
          service.logger.error("Eval run failed", { error: message });
          const failed = yield* service.store
            .updateRun(initial.id, {
              status: "failed",
              error: message,
              finished_at: new Date().toISOString(),
            })
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (failed) yield* service.publishRun(failed);
          if (service.active === owner) service.active = null;
        }),
      ),
    );
  }

  private ensureRecipe(
    recipe: Recipe,
    signal: AbortSignal,
  ): Effect.Effect<{ ok: true; modelId: string } | { ok: false; error: string }> {
    const service = this;
    return Effect.gen(function* () {
      if (signal.aborted) return { ok: false as const, error: "Cancelled" };
      const current = yield* service.bridge.getCurrentRecipe().pipe(Effect.catch(() => Effect.succeed(null)));
      if (!current || current.id !== recipe.id) {
        if (current) {
          yield* service.bridge.evict().pipe(Effect.catch(() => Effect.void));
          yield* Effect.sleep(1_000);
        }
        const launchError = yield* service.bridge.launchRecipe(recipe).pipe(
          Effect.as(null as string | null),
          Effect.catch((failure: LaunchFailure) =>
            failure.kind === "already-running"
              ? Effect.succeed(null)
              : Effect.succeed(launchFailureMessage(failure)),
          ),
        );
        if (launchError) return { ok: false as const, error: launchError };
        const ready = yield* Effect.raceFirst(
          service.bridge.waitForHealthy(600_000),
          waitUntilAborted(signal).pipe(Effect.as(false)),
        );
        if (signal.aborted) return { ok: false as const, error: "Cancelled" };
        if (!ready) return { ok: false as const, error: "Timed out waiting for the model" };
      }
      const inference = yield* service.bridge.findInferenceProcess();
      const modelId =
        inference?.served_model_name ?? recipe.served_model_name ?? recipe.model_path;
      return { ok: true as const, modelId };
    });
  }

  private log(runId: string, line: string): Effect.Effect<void> {
    const service = this;
    return Effect.gen(function* () {
      const seq = yield* service.store.nextLogSeq(runId).pipe(Effect.catch(() => Effect.succeed(Date.now())));
      yield* service.store.appendLog(runId, seq, line).pipe(Effect.catch(() => Effect.void));
      yield* service.events.publish(
        new Event(CONTROLLER_EVENTS.EVAL_LOG, { run_id: runId, seq, line }),
      );
    });
  }

  private publishRun(run: EvalRun): Effect.Effect<void> {
    return this.events.publish(new Event(CONTROLLER_EVENTS.EVAL_RUN, { run }));
  }
}
