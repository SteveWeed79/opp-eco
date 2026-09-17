import { permanentRedirect } from "next/navigation";
import { SIGN_IN_PATH } from "@/routes";

/**
 * Where sign-in used to live.
 *
 * Kept rather than deleted, and permanent rather than temporary. This path has
 * been in a README, in redirect targets, and in whatever anybody bookmarked
 * while it was the only way in — a 404 for those is a person who cannot sign
 * in and has no idea why.
 *
 * `permanentRedirect` is a 308, so a browser and a crawler both stop asking.
 */
export default function MovedSignIn() {
  permanentRedirect(SIGN_IN_PATH);
}
