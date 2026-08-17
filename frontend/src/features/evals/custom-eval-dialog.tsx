"use client";

import {
  Button,
  Card,
  Checkbox,
  FormField,
  Input,
  Select,
  Textarea,
  UiModal,
  UiModalHeader,
} from "@/ui";
import { useState } from "react";
import type { EvalCustomSuiteWrite, EvalGrader } from "@/lib/types";

const GRADERS: Array<{ value: EvalGrader; label: string }> = [
  { value: "contains", label: "Contains text" },
  { value: "exact", label: "Exact match" },
  { value: "regex", label: "Regular expression" },
  { value: "json", label: "JSON equals" },
];

export function CustomEvalDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (body: EvalCustomSuiteWrite) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [grader, setGrader] = useState<EvalGrader>("contains");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setDescription("");
    setPrompt("");
    setGrader("contains");
    setExpected("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim() || !prompt.trim()) {
      setError("Name and prompt are required");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        prompt,
        grader,
        expected,
        cases: [],
      });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UiModal isOpen={open} onClose={onClose} maxWidth="max-w-lg">
      <UiModalHeader title="New custom eval" onClose={onClose} />
      <div className="flex flex-col gap-3 p-4">
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tool JSON smoke"
          />
        </FormField>
        <FormField label="Description">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this measures"
          />
        </FormField>
        <FormField label="Prompt" required>
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Ask the model to do something checkable"
          />
        </FormField>
        <FormField label="Grader">
          <Select
            value={grader}
            onChange={(event) => setGrader(event.target.value as EvalGrader)}
            options={GRADERS}
          />
        </FormField>
        <FormField label="Expected">
          <Textarea
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
            rows={3}
            placeholder={grader === "regex" ? "^OK$" : "Text or JSON the answer should match"}
          />
        </FormField>
        {error ? <p className="text-[length:var(--fs-sm)] text-(--err)">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Save eval
          </Button>
        </div>
      </div>
    </UiModal>
  );
}

export function SuitePicker({
  suites,
  selected,
  onChange,
  onDelete,
}: {
  suites: Array<{ id: string; name: string; description: string; builtin: boolean; kind: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card title="Suites" padding="sm">
      <div className="flex flex-col gap-2">
        {suites.map((suite) => (
          <div key={suite.id} className="flex items-start justify-between gap-2">
            <Checkbox
              checked={selected.includes(suite.id)}
              onChange={(checked) =>
                onChange(
                  checked ? [...selected, suite.id] : selected.filter((id) => id !== suite.id),
                )
              }
              label={suite.name}
              description={suite.description}
            />
            {!suite.builtin ? (
              <Button variant="ghost" size="sm" onClick={() => onDelete(suite.id)}>
                Remove
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
