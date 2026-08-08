import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers, applied to every page response.
 *
 * These are the controls a district IT reviewer or a state procurement
 * questionnaire actually checks for, and they cost nothing to set. The CSP is
 * nonce-based rather than allowlist-based, because an allowlist containing a
 * CDN is only as strong as that CDN.
 *
 * A fresh nonce per request means pages must render dynamically — which they
 * already do, so the demo clock re-anchors and the board's interview slots stay
 * in the future.
 */

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    `default-src 'self'`,
    // 'strict-dynamic' means scripts loaded by a trusted script are also
    // trusted, which is how Next's chunk loading works without an allowlist.
    // React uses eval in development for readable server-side stack traces;
    // production needs neither eval nor unsafe-inline.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    // No plugins, no base-tag hijacking, no posting forms off-site.
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Clickjacking. Student records inside someone else's iframe is exactly
    // the scenario this closes.
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);

  // Never let a browser guess a content type. An uploaded file served with the
  // wrong type is how a resume becomes a script.
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Send the origin but not the path to other sites, so a workforce board URL
  // containing an application id does not leak in a referrer.
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Nothing here needs a camera, a microphone, or a location.
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );

  // HSTS only in production: setting it against localhost would pin http
  // out of the browser for the developer's own machine.
  if (!isDev) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  return response;
}

export const config = {
  // Excludes static assets and image optimisation, which do not need a nonce
  // and would otherwise be re-processed on every request.
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
