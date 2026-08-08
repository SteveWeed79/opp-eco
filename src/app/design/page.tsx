import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { Gallery } from "./Gallery";

export const metadata: Metadata = {
  title: "[Demo] Component library — Opportunity Ecosystem",
  robots: { index: false, follow: false },
};

/**
 * The component library, rendered.
 *
 * Deliberately unlinked from the portal switcher — it is a working reference
 * for whoever builds the next screen, not part of the product. Its value is
 * making the library discoverable by looking rather than by grepping, and
 * making accessibility behaviour testable by hand: tab through a modal, sort a
 * table from the keyboard, watch a toast get announced.
 */
export default function DesignPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-8 space-y-8">
      <PageHeader
        eyebrow="Internal reference"
        title="Component library"
        subtitle="Every reusable piece, with the accessibility behaviour you can only check by using it"
      />
      <Gallery />
    </div>
  );
}
