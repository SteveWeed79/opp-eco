"use client";

/**
 * Last-resort boundary for errors thrown in the root layout itself.
 *
 * The ordinary `error.tsx` renders *inside* the layout, so it cannot catch a
 * failure in the layout. This one replaces the whole document, which is why it
 * has to supply its own `html` and `body` — and why it cannot rely on the app
 * shell, the component library, or anything else that might be the thing that
 * broke. Styling is inline for the same reason.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#020617",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>
            The application failed to start
          </h1>
          <p style={{ color: "#475569", marginTop: "0.75rem", lineHeight: 1.6 }}>
            An error occurred before the page could be assembled. No data was
            changed.
          </p>
          {error.digest && (
            <p style={{ color: "#64748b", fontSize: "0.8rem", marginTop: "1rem" }}>
              Reference <code>{error.digest}</code>
            </p>
          )}
          <button
            type="button"
            onClick={retry}
            style={{
              marginTop: "1.5rem",
              background: "#0ea5e9",
              color: "white",
              border: 0,
              borderRadius: "0.75rem",
              padding: "0.7rem 1.25rem",
              fontWeight: 700,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
