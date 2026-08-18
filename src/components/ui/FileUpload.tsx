"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileText, Paperclip, X } from "lucide-react";

/**
 * File attachment.
 *
 * Resumes on a student profile, deliverables on a completed micro-internship.
 * Drag-and-drop is offered but never required — the whole control is a real
 * button wrapping a real file input, so it works from the keyboard and with a
 * screen reader rather than only under a mouse.
 *
 * Validation happens here *and* must happen again on the server; a client-side
 * size check is a courtesy, not a control.
 */

export interface AttachedFile {
  name: string;
  size: number;
}

export function FileUpload({
  label,
  hint,
  accept,
  maxBytes = 5 * 1024 * 1024,
  files,
  onChange,
  multiple = false,
}: {
  label: string;
  hint?: string;
  accept?: string;
  maxBytes?: number;
  files: AttachedFile[];
  onChange: (files: AttachedFile[]) => void;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept_(incoming: FileList | null) {
    if (!incoming) return;
    const next: AttachedFile[] = [];
    for (const file of Array.from(incoming)) {
      if (file.size > maxBytes) {
        setError(
          `${file.name} is ${formatSize(file.size)}. The limit is ${formatSize(maxBytes)}.`,
        );
        continue;
      }
      next.push({ name: file.name, size: file.size });
    }
    if (next.length === 0) return;
    setError(null);
    onChange(multiple ? [...files, ...next] : next.slice(0, 1));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    accept_(event.dataTransfer.files);
  }

  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-bold text-ink-700 uppercase tracking-wider">
        {label}
      </span>
      {hint && <p className="text-xs text-ink-500">{hint}</p>}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`w-full rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragging
            ? "border-brand-700 bg-brand-50"
            : "border-line-strong bg-white hover:border-brand-400"
        }`}
      >
        <Paperclip className="w-5 h-5 mx-auto text-ink-400 mb-2" aria-hidden="true" />
        <span className="block text-sm font-semibold text-ink-950">
          Choose a file or drag it here
        </span>
        <span className="block text-xs text-ink-500 mt-1">
          Up to {formatSize(maxBytes)}
          {accept ? ` · ${accept}` : ""}
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        onChange={(e) => accept_(e.target.files)}
      />

      {error && (
        <p role="alert" className="text-xs font-semibold text-crit-700">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {files.map((file) => (
            <li
              key={file.name}
              className="flex items-center gap-2.5 rounded-lg border border-line-strong px-3 py-2"
            >
              <FileText className="w-4 h-4 text-brand-700 shrink-0" aria-hidden="true" />
              <span className="text-sm text-ink-950 truncate flex-1">{file.name}</span>
              <span className="text-xs text-ink-500 tabular shrink-0">
                {formatSize(file.size)}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((f) => f.name !== file.name))}
                aria-label={`Remove ${file.name}`}
                className="text-ink-400 hover:text-crit-600 shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
