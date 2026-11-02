import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  UserPenIcon,
  FileTextIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { revertEdit, saveEdit } from "../api";
import { Markdown } from "../lib/markdown";
import type { Brief } from "../types";
import { Kbd } from "./common";
import { Button } from "./ui/button";
import { Confirm } from "./ui/confirm";
export interface StandupHandle {
  readonly copy: () => void;
  readonly edit: () => void;
  readonly regenerate: () => void;
}
export const Standup = ({
  brief,
  onSaved,
  onRegenerate,
  regenerating,
  bindKeys,
}: {
  brief: Brief;
  onSaved: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  bindKeys?: (h: StandupHandle) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<"ok" | "failed" | undefined>();
  const [confirmRegen, setConfirmRegen] = useState(false);
  const edited = brief.summary.origin === "edited";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief.summary.text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(undefined), 2500);
    return () => clearTimeout(t);
  }, [copied]);
  const regenerate = () => (edited ? setConfirmRegen(true) : onRegenerate());
  bindKeys?.({ copy: () => void copy(), edit: () => setEditing(true), regenerate });
  return (
    <article
      aria-labelledby="standup-title"
      className="rounded-xl border border-hairline bg-surface-raised"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-hairline border-b px-5 py-3 sm:px-6">
        <h2
          id="standup-title"
          className="font-semibold text-caption text-content-secondary uppercase tracking-wide"
        >
          Standup
        </h2>
        {!editing && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => void copy()} aria-keyshortcuts="c">
              {copied === "ok" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied === "ok" ? "Copied" : "Copy"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-keyshortcuts="e"
            >
              <PencilIcon aria-hidden />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={regenerate}
              loading={regenerating}
              aria-keyshortcuts="r"
            >
              <RotateCcwIcon aria-hidden />
              Regenerate
            </Button>
          </div>
        )}
      </header>

      <div className="px-5 py-5 sm:px-6">
        {editing ? (
          <Editor
            initial={brief.summary.text}
            briefKey={brief.key}
            onDone={(changed) => {
              setEditing(false);
              if (changed) onSaved();
            }}
          />
        ) : (
          <Markdown text={brief.summary.text} />
        )}
      </div>

      {!editing && <Provenance brief={brief} onReverted={onSaved} />}

      <p role="status" aria-live="polite" className="sr-only">
        {copied === "ok"
          ? "Standup copied to the clipboard"
          : copied === "failed"
            ? "Couldn't copy. Select the text and copy it by hand."
            : ""}
      </p>
      {copied === "failed" && (
        <p className="border-hairline border-t px-5 py-2 text-caption text-danger sm:px-6">
          Couldn't reach the clipboard. Select the text and copy it by hand.
        </p>
      )}

      <Confirm
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Replace your edit?"
        confirmLabel="Regenerate"
        onConfirm={onRegenerate}
      >
        Regenerating writes a fresh standup from your activity and discards the version you edited.
      </Confirm>
    </article>
  );
};
const Editor = ({
  initial,
  briefKey,
  onDone,
}: {
  initial: string;
  briefKey: string;
  onDone: (changed: boolean) => void;
}) => {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const dirty = text.trim() !== initial.trim();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = async () => {
    if (!dirty) return onDone(false);
    setSaving(true);
    setError(undefined);
    try {
      await saveEdit(briefKey, text);
      onDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="sr-only">
        Standup text (Markdown)
      </label>
      <textarea
        id={id}
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape" && !dirty) onDone(false);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        spellCheck
        className="field-sizing-content min-h-48 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2.5 font-mono text-ui leading-relaxed"
      />
      {error && <p className="text-caption text-danger">Couldn't save: {error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${id}-hint`} className="text-caption text-content-tertiary">
          Markdown. Your version replaces the generated one for this brief. <Kbd>Ctrl</Kbd>{" "}
          <Kbd>Enter</Kbd> saves.
        </p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onDone(false)}>
            {dirty ? "Discard changes" : "Cancel"}
          </Button>
          <Button size="sm" onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
const Provenance = ({ brief, onReverted }: { brief: Brief; onReverted: () => void }) => {
  const s = brief.summary;
  const [confirm, setConfirm] = useState(false);
  let icon: ReactNode;
  let line: ReactNode;
  if (s.origin === "edited") {
    icon = <UserPenIcon aria-hidden className="size-3.5" />;
    line = (
      <>
        Edited by you.{" "}
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="underline underline-offset-2 hover:text-content"
        >
          Revert to generated
        </button>
      </>
    );
  } else if (s.origin === "llm") {
    icon = <SparklesIcon aria-hidden className="size-3.5" />;
    line = (
      <>
        Written by <span className="font-mono">{s.model}</span> from your activity
        {s.cached ? " (cached)" : ""}. Check names and numbers before you paste.
      </>
    );
  } else {
    icon = <FileTextIcon aria-hidden className="size-3.5" />;
    line = (
      <>
        Plain digest, built from your activity without an LLM.{s.note ? ` ${sentence(s.note)}` : ""}
      </>
    );
  }
  return (
    <footer className="flex items-start gap-2 border-hairline border-t px-5 py-3 text-caption text-content-tertiary sm:px-6">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p>{line}</p>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Revert to the generated standup?"
        confirmLabel="Revert"
        onConfirm={() => void revertEdit(brief.key).then(onReverted)}
      >
        Your edited version is deleted and the generated text comes back.
      </Confirm>
    </footer>
  );
};
const sentence = (s: string) => {
  const t = s.trim();
  return `${t[0]?.toUpperCase() ?? ""}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
};
