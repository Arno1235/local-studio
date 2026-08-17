import type { EvalCustomSuite, EvalSuiteInfo } from "@local-studio/contracts/evals";
import { codingSmoke } from "./suites/coding-smoke";
import { customSuite } from "./suites/custom";
import { instructionFollow } from "./suites/instruction-follow";
import { throughputContextSweep } from "./suites/throughput-context-sweep";
import { toolcallJson } from "./suites/toolcall-json";
import type { EvalSuite } from "./suites/types";

export const BUILTIN_SUITES: readonly EvalSuite[] = [
  throughputContextSweep,
  instructionFollow,
  toolcallJson,
  codingSmoke,
];

export const builtinSuiteInfo = (): EvalSuiteInfo[] =>
  BUILTIN_SUITES.map((suite) => ({
    id: suite.id,
    name: suite.name,
    description: suite.description,
    kind: suite.kind,
    builtin: true,
  }));

export const customSuiteInfo = (definition: EvalCustomSuite): EvalSuiteInfo => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  kind: "custom",
  builtin: false,
});

export const resolveSuite = (
  id: string,
  custom: readonly EvalCustomSuite[],
): EvalSuite | null => {
  const builtin = BUILTIN_SUITES.find((suite) => suite.id === id);
  if (builtin) return builtin;
  const definition = custom.find((suite) => suite.id === id);
  return definition ? customSuite(definition) : null;
};
