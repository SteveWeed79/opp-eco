import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/auth/session";
import { logger } from "@/services/logging";
import { LIMITS, callerKey, checkRateLimit } from "@/services/rate-limit";
import {
  canRetrieve,
  downloadHeaders,
  fileStore,
  verifyDownloadUrl,
} from "@/services/uploads";

/**
 * File download.
 *
 * Both checks run, and neither substitutes for the other:
 *
 *   - the **signature** proves the link was issued by us, which stops someone
 *     walking the store by guessing keys;
 *   - the **authorization check** proves the person holding it is still
 *     entitled, because links get forwarded, pasted into chat, and left in
 *     browser history.
 *
 * A signed URL alone would make a leaked link as good as the record.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const actor = await getActor();

  // Unauthenticated requests are refused before any lookup, so this endpoint
  // cannot be used to probe which keys exist.
  if (!actor) return notFound();

  const limit = checkRateLimit(callerKey("download", actor.user.id), LIMITS.read);
  if (!limit.ok) {
    return new NextResponse("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const url = new URL(request.url);
  const signature = verifyDownloadUrl(
    key,
    url.searchParams.get("expires"),
    url.searchParams.get("sig"),
  );
  if (!signature.ok) {
    logger.warn("download.signature_refused", { key, reason: signature.reason });
    // An expired link is worth distinguishing, because the fix is to reload
    // the page rather than to ask for access.
    return signature.reason === "expired"
      ? new NextResponse("This link has expired. Reload the page for a new one.", {
          status: 410,
        })
      : notFound();
  }

  const stored = await fileStore.get(key);
  if (!stored) return notFound();

  const decision = canRetrieve(actor, stored.meta);
  if (!decision.ok) {
    logger.warn("download.refused", {
      key,
      reason: decision.reason,
      userId: actor.user.id,
    });
    // "Forbidden" would confirm the file exists. Everything a caller is not
    // entitled to looks identical to something that is not there.
    return decision.reason === "quarantined"
      ? new NextResponse("This file is still being scanned.", { status: 409 })
      : notFound();
  }

  logger.info("download.served", { key, userId: actor.user.id });

  return new NextResponse(Buffer.from(stored.data), {
    status: 200,
    headers: downloadHeaders(stored.meta),
  });
}

/** One response for "missing" and "not yours", so neither can be told apart. */
function notFound() {
  return new NextResponse("Not found", { status: 404 });
}
