import Link from "next/link";
import { Compass } from "lucide-react";

const DESTINATIONS = [
  { href: "/", label: "Public home" },
  { href: "/admin", label: "Administrator" },
  { href: "/student", label: "Student" },
  { href: "/business", label: "Employer" },
  { href: "/college", label: "College" },
  { href: "/board", label: "Workforce board" },
];

/**
 * Not found.
 *
 * Lists the portals rather than just apologising, because the likeliest way to
 * arrive here is a stale or mistyped deep link into one of them — someone was
 * forwarded a URL that no longer resolves.
 */
export default function NotFound() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-20">
      <div className="bg-white rounded-2xl border border-brand-100 shadow-sm p-8">
        <span className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mb-5">
          <Compass className="w-5 h-5" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-black text-ink-950">There&rsquo;s nothing here</h1>
        <p className="text-sm text-ink-600 mt-2">
          That address doesn&rsquo;t match a page in this demonstration.
        </p>

        <nav aria-label="Portals" className="mt-7">
          <ul className="flex flex-wrap gap-2">
            {DESTINATIONS.map((destination) => (
              <li key={destination.href}>
                <Link
                  href={destination.href}
                  className="inline-block bg-white text-ink-950 border border-ink-200 font-semibold px-4 py-2 rounded-xl text-sm hover:border-brand-700 hover:text-brand-700 transition-colors"
                >
                  {destination.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
