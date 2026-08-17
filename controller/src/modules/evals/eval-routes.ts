import { Effect, Schema } from "effect";
import { badRequest, notFound, HttpStatus } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { builtinSuiteInfo, customSuiteInfo } from "./eval-registry";

const IdListSchema = Schema.Array(Schema.String);
const StartRunSchema = Schema.Struct({
  suite_ids: Schema.optional(IdListSchema),
  recipe_ids: Schema.optional(IdListSchema),
});
const CaseSpecSchema = Schema.Struct({
  id: Schema.String,
  prompt: Schema.String,
  expected: Schema.optional(Schema.NullOr(Schema.String)),
});
const CustomSuiteSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  grader: Schema.optional(Schema.Literals(["contains", "regex", "exact", "json"])),
  expected: Schema.optional(Schema.String),
  cases: Schema.optional(Schema.Array(CaseSpecSchema)),
});

export const registerEvalRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    app.get(
      "/evals/suites",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const suites = yield* context.evalService.listSuiteInfo();
          return ctx.json({ suites });
        }),
      ),
    ),

    app.post(
      "/evals/suites",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, CustomSuiteSchema);
          const suite = yield* context.evalService
            .saveCustom({
              name: body.name,
              description: body.description ?? "",
              prompt: body.prompt ?? "",
              grader: body.grader ?? "contains",
              expected: body.expected ?? "",
              cases: (body.cases ?? []).map((entry) => ({
                id: entry.id,
                prompt: entry.prompt,
                expected: entry.expected ?? null,
              })),
            })
            .pipe(Effect.mapError((detail) => badRequest(detail)));
          return ctx.json({ suite: customSuiteInfo(suite) });
        }),
      ),
    ),

    app.put(
      "/evals/suites/:suiteId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const suiteId = ctx.req.param("suiteId") ?? "";
          const body = yield* decodeJsonBody(ctx, CustomSuiteSchema);
          const suite = yield* context.evalService
            .saveCustom(
              {
                name: body.name,
                description: body.description ?? "",
                prompt: body.prompt ?? "",
                grader: body.grader ?? "contains",
                expected: body.expected ?? "",
                cases: (body.cases ?? []).map((entry) => ({
                  id: entry.id,
                  prompt: entry.prompt,
                  expected: entry.expected ?? null,
                })),
              },
              suiteId,
            )
            .pipe(Effect.mapError((detail) => badRequest(detail)));
          return ctx.json({ suite: customSuiteInfo(suite) });
        }),
      ),
    ),

    app.delete(
      "/evals/suites/:suiteId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const suiteId = ctx.req.param("suiteId") ?? "";
          if (!suiteId.startsWith("custom.")) {
            return yield* Effect.fail(badRequest("Built-in suites cannot be deleted"));
          }
          const deleted = yield* context.stores.evalStore.deleteCustomSuite(suiteId);
          if (!deleted) return yield* Effect.fail(notFound("Custom eval not found"));
          return ctx.json({ success: true });
        }),
      ),
    ),

    app.get(
      "/evals/hardware",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* context.evalService.hardware();
          const ids = yield* context.stores.evalStore.distinctHardwareIds();
          const seen = new Set(ids);
          const hardware = seen.has(current.id) ? ids : [current.id, ...ids];
          return ctx.json({ current, hardware_ids: hardware });
        }),
      ),
    ),

    app.get(
      "/evals/compare",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* context.evalService.hardware();
          const hardwareId = ctx.req.query("hardware_id")?.trim() || current.id;
          const custom = yield* context.stores.evalStore.listCustomSuites();
          const suites = [...builtinSuiteInfo(), ...custom.map(customSuiteInfo)];
          const compare = yield* context.stores.evalStore.compareEffect(hardwareId, suites);
          return ctx.json({ ...compare, hardware: hardwareId === current.id ? current : compare.hardware });
        }),
      ),
    ),

    app.get(
      "/evals/runs",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const runs = yield* context.stores.evalStore.listRuns();
          const active = yield* context.stores.evalStore.activeRun();
          return ctx.json({ runs, active });
        }),
      ),
    ),

    app.get(
      "/evals/runs/:runId",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const runId = ctx.req.param("runId") ?? "";
          const run = yield* context.stores.evalStore.getRun(runId);
          if (!run) return yield* Effect.fail(notFound("Eval run not found"));
          const results = yield* context.stores.evalStore.resultsForRun(runId);
          const after = Number(ctx.req.query("after") ?? 0);
          const logs = yield* context.stores.evalStore.logsAfter(
            runId,
            Number.isFinite(after) ? after : 0,
          );
          return ctx.json({ run, results, logs });
        }),
      ),
    ),

    app.post(
      "/evals/runs",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const body = yield* decodeJsonBody(ctx, StartRunSchema);
          const run = yield* context.evalService
            .start({
              suiteIds: body.suite_ids ?? [],
              recipeIds: body.recipe_ids ?? [],
            })
            .pipe(
              Effect.mapError((detail) =>
                detail.includes("already")
                  ? new HttpStatus({ status: 409, detail })
                  : badRequest(detail),
              ),
            );
          return ctx.json({ run });
        }),
      ),
    ),

    app.post(
      "/evals/runs/:runId/cancel",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const run = yield* context.evalService.cancel();
          if (!run) return yield* Effect.fail(notFound("No eval run in progress"));
          return ctx.json({ run });
        }),
      ),
    ),
  ),
);
