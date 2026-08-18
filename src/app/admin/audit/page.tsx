import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  Badge,
  Card,
  CardHeader,
  Empty,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { repositories } from "@/data/backend";
import { actorForPortal } from "@/auth/session";

export default async function AuditPage() {
  const admin = await actorForPortal("admin");
  const events = await repositories.auditEvents.list(admin);

  // The acting user for each row, fetched once per distinct actor rather than
  // once per event — an audit log is the longest list in the app.
  const actorIds = Array.from(new Set(events.map((e) => e.actorUserId)));
  const actors = await Promise.all(actorIds.map((id) => repositories.users.find(id)));
  const userById = new Map(actorIds.map((id, i) => [id, actors[i]]));

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8 pb-16 space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-950"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to operations
      </Link>

      <PageHeader
        eyebrow="Program administrator"
        title="Audit log"
        subtitle="Append-only. Every state change records who, what, when, and why."
      />

      <Card>
        <CardHeader
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Recorded transitions"
          subtitle="Overrides and reasons are captured alongside ordinary moves"
        />
        {events.length === 0 ? (
          <Empty>No events recorded.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full">
              <thead className="border-b border-line">
                <tr>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Entity</Th>
                  <Th>Transition</Th>
                </tr>
              </thead>
              <tbody className="row-list divide-y divide-line">
                {events.map((event) => {
                  const user = userById.get(event.actorUserId) ?? null;
                  return (
                    <tr key={event.id}>
                      <Td className="whitespace-nowrap text-xs">
                        {new Date(event.at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </Td>
                      <Td>
                        <span className="font-semibold text-ink-950">
                          {user?.name ?? event.actorUserId}
                        </span>
                        <span className="block text-xs text-ink-500 capitalize">
                          {event.actorRole}
                        </span>
                      </Td>
                      <Td className="text-xs">
                        <span className="capitalize">{event.entityType}</span>{" "}
                        <code className="text-ink-500">{event.entityId}</code>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2 flex-wrap">
                          {event.from && <Badge>{event.from}</Badge>}
                          <span className="text-ink-400" aria-hidden="true">
                            →
                          </span>
                          <Badge tone="brand">{event.to}</Badge>
                        </div>
                        {event.reason && (
                          <p className="text-xs text-ink-500 mt-1.5 max-w-md">
                            {event.reason}
                          </p>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
