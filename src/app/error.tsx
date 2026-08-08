"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { logger } from "@/services/logging";

/**
 * Route-level error boundary.
 *
 * Without this, a thrown error renders a blank page — which during a live
 * demo is indistinguishable from the site being broken. The copy says what
 * happened and offers the two things that actually help: try again, or go
 * somewhere that works.
 *
 * `digest` is the server-side identifier for the error. It is shown because it
 * is the only handle someone reporting the problem can give you; the message
 * itself stays on the server in production.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // An error message can quote a record it failed on, so it is redacted
    // before it reaches a log aggregator that has none of the database's
    // access controls.
    logger.error("route_error", { error, digest: error.digest });
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto px-6 py-20">
      <div className="bg-white rounded-2xl border border-crit-100 shadow-sm p-8">
        <span className="w-11 h-11 rounded-2xl bg-crit-50 text-crit-600 flex items-center justify-center mb-5">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-black text-ink-950 text-balance">
          This page didn&rsquo;t load
        </h1>
        <p className="text-sm text-ink-600 mt-2 leading-relaxed">
          Something failed while building this view. Nothing you did caused it,
          and no data was changed.
        </p>

        {error.digest && (
          <p className="mt-4 text-xs text-ink-500">
            Reference{" "}
            <code className="bg-ink-100 px-1.5 py-0.5 rounded font-mono">
              {error.digest}
            </code>
          </p>
        )}

        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={retry}
            className="bg-brand-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-ink-950 transition-colors flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
          <Link
            href="/"
            className="bg-white text-ink-950 border border-ink-200 font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-ink-50 transition-colors"
          >
            Back to the start
          </Link>
        </div>
      </div>
    </div>
  );
}
