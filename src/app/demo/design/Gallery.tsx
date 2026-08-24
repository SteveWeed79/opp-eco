"use client";

import { useState } from "react";
import {
  Assumption,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Combobox,
  ConfirmDialog,
  DataTable,
  DwellBadge,
  Empty,
  FileUpload,
  Modal,
  Money,
  PageSection,
  Pagination,
  paginate,
  PersonChip,
  ProgressBar,
  SelectField,
  SkeletonCard,
  SkeletonRows,
  SkeletonText,
  SlotPicker,
  Stat,
  StatusBadge,
  Tabs,
  TextField,
  Timeline,
  TrackBadge,
  useToast,
  type AttachedFile,
} from "@/components/ui";
import type { ApplicationStatus } from "@/domain/types";

const SKILLS = [
  "JavaScript", "TypeScript", "Python", "SQL", "React", "Git", "CAD",
  "SolidWorks", "Excel", "Market research", "Copywriting", "Figma",
  "Patient care", "Blueprint reading", "Data analysis", "PLC programming",
];

interface DemoRow {
  id: string;
  name: string;
  program: string;
  status: ApplicationStatus;
  days: number;
}

const ROWS: DemoRow[] = [
  { id: "1", name: "Omar Haddad", program: "Computer Science", status: "mutual_interest", days: 19 },
  { id: "2", name: "Marcus Bell", program: "Nursing", status: "mutual_interest", days: 11 },
  { id: "3", name: "Hana Whitmore", program: "Graphic Design", status: "credit_pending", days: 9 },
  { id: "4", name: "Luis Ferreira", program: "Construction Mgmt", status: "cleared", days: 6 },
  { id: "5", name: "Nina Kowalski", program: "Biology", status: "interview_scheduled", days: 5 },
  { id: "6", name: "Derek Olsen", program: "Accounting", status: "funding_authorized", days: 3 },
  { id: "7", name: "Priya Chandra", program: "Mechanical Eng Tech", status: "placement_active", days: 30 },
];

const SLOTS = [0, 0, 2, 2, 5].map((offset, i) => {
  const d = new Date(Date.now() + (offset + 1) * 86_400_000);
  d.setHours(13 + (i % 3), 0, 0, 0);
  return {
    id: `slot-${i}`,
    startsAt: d.toISOString(),
    durationMinutes: 30,
    host: i % 2 ? "Wes Trumbull" : "Marcia Delgado",
  };
});

export function Gallery() {
  return (
    <Tabs
      label="Component categories"
      tabs={[
        { id: "actions", label: "Actions & feedback", content: <ActionsSection /> },
        { id: "forms", label: "Forms", content: <FormsSection /> },
        { id: "data", label: "Data display", content: <DataSection /> },
        { id: "status", label: "Status & people", content: <StatusSection /> },
        { id: "loading", label: "Loading", content: <LoadingSection /> },
      ]}
    />
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-6">
      <CardHeader title={title} subtitle={note} />
      <div className="px-6 py-5">{children}</div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ActionsSection() {
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();

  return (
    <>
      <Section title="Buttons" note="Danger is reserved for irreversible actions, so the colour keeps its meaning">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="dark">Dark</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="primary" size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Modal" note="Focus trap, Escape to close, scroll lock, focus restored on close">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Book your board interview"
          description="Southeast Kansas Workforce Partnership will confirm your eligibility."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>Confirm</Button>
            </>
          }
        >
          <p className="text-sm text-ink-600">
            Try Tab, Shift+Tab, and Escape. Focus cannot leave this dialog, and
            returns to the trigger when it closes.
          </p>
        </Modal>
      </Section>

      <Section title="Confirm dialog" note="Captures the reason the audit log requires, in the same step as the confirmation">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Terminate placement
        </Button>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          onConfirm={(reason) => {
            setConfirm(false);
            toast.show("success", `Recorded: ${reason}`);
          }}
          title="End this placement early?"
          description="The student, employer, and board will all be notified."
          confirmLabel="End placement"
          tone="danger"
          reason={{
            label: "Reason",
            hint: "Written to the audit log and visible to the administrator.",
            required: true,
          }}
        />
      </Section>

      <Section title="Toasts" note="Announced in a live region. Errors persist until dismissed; the rest clear themselves">
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={() => toast.show("success", "Interview booked. The board has been notified.")}>
            Success
          </Button>
          <Button variant="ghost" onClick={() => toast.show("error", "Someone booked that slot first. Pick another.")}>
            Error
          </Button>
          <Button variant="ghost" onClick={() => toast.show("info", "Three postings are waiting on your review.")}>
            Info
          </Button>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function FormsSection() {
  const [skills, setSkills] = useState<string[]>(["Python", "SQL"]);
  const [slot, setSlot] = useState<string | null>(SLOTS[0].id);
  const [files, setFiles] = useState<AttachedFile[]>([]);

  return (
    <>
      <Section title="Text inputs" note="Labels are real labels; errors are announced">
        <div className="grid gap-5 md:grid-cols-2 max-w-3xl">
          <TextField label="Posting title" placeholder="Software Engineering Intern" />
          <TextField
            label="Hourly wage"
            type="number"
            hint="Must meet the program minimum."
            defaultValue={22}
          />
          <TextField
            label="Contact email"
            defaultValue="not-an-email"
            error="Enter a valid email address."
          />
          <SelectField
            label="Track"
            options={[
              { value: "standard", label: "Standard — semester, 3 credits" },
              { value: "micro", label: "Micro — project, banks hours" },
            ]}
          />
        </div>
      </Section>

      <Section title="Combobox" note="For taxonomies too large for a select. Backspace on an empty field removes the last chip">
        <div className="max-w-lg">
          <Combobox
            label="Skills"
            hint="Start typing to filter."
            options={SKILLS}
            value={skills}
            onChange={setSkills}
            max={8}
          />
        </div>
      </Section>

      <Section title="Slot picker" note="Grouped by day, because a flat list of timestamps is unreadable">
        <SlotPicker slots={SLOTS} value={slot} onChange={setSlot} />
      </Section>

      <Section title="File upload" note="Drag-and-drop offered, never required — it is a real button wrapping a real input">
        <div className="max-w-lg">
          <FileUpload
            label="Resume"
            hint="PDF or Word."
            accept=".pdf,.doc,.docx"
            files={files}
            onChange={setFiles}
          />
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function DataSection() {
  const [page, setPage] = useState(1);
  const pageSize = 4;

  return (
    <>
      <Section title="Data table" note="Click a header to sort. Order is announced through aria-sort">
        <DataTable
          rows={paginate(ROWS, page, pageSize)}
          rowKey={(r) => r.id}
          caption="Example candidate pipeline"
          rowTone={(r) => (r.days >= 14 ? "crit" : r.days >= 7 ? "warn" : undefined)}
          columns={[
            {
              key: "name",
              header: "Candidate",
              sortValue: (r) => r.name,
              render: (r) => <PersonChip name={r.name} subtitle={r.program} size="sm" />,
            },
            {
              key: "status",
              header: "State",
              sortValue: (r) => r.status,
              render: (r) => <StatusBadge status={r.status} />,
            },
            {
              key: "days",
              header: "Dwell",
              align: "right",
              sortValue: (r) => r.days,
              render: (r) => <DwellBadge days={r.days} />,
            },
          ]}
        />
        <div className="-mx-6 -mb-5">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={ROWS.length}
            onChange={setPage}
            label="Candidates"
          />
        </div>
      </Section>

      <Section title="Timeline" note="An application's audit history — the answer to 'why is this placement here?'">
        <Timeline
          entries={[
            { id: "1", title: "Application submitted", at: "2026-06-12", actor: "Omar Haddad" },
            { id: "2", title: "Shortlisted", at: "2026-06-18", actor: "Dana Reyes · Apex Robotics", tone: "good" },
            { id: "3", title: "Mutual interest confirmed", at: "2026-06-20", actor: "Omar Haddad", tone: "warn" },
            {
              id: "4",
              title: "Forced to interview_scheduled",
              at: "2026-07-09",
              actor: "Steve Weed · administrator",
              tone: "crit",
              detail: "Override: student unable to reach the board by phone for 12 days.",
            },
          ]}
        />
      </Section>

      <Section title="Empty state">
        <Empty>Nothing is waiting. Every queue is inside its threshold.</Empty>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function StatusSection() {
  const statuses: ApplicationStatus[] = [
    "submitted", "shortlisted", "mutual_interest", "interview_scheduled",
    "cleared", "funding_authorized", "placement_active", "credit_granted",
    "credit_denied", "unsubsidized",
  ];

  return (
    <>
      <Section
        title="Page sections"
        note="Portals are named zones, not a flat stack of cards — and settings are recessed so configuration stops reading like work"
      >
        <div className="space-y-2">
          <PageSection
            title="Needs you today"
            description="Work only this actor can clear. Every portal opens on one of these."
          >
            <Card className="p-5 text-sm text-ink-600">A queue lives here.</Card>
          </PageSection>
          <PageSection
            title="Institution settings"
            description="Rarely changed, and deliberately quieter than the work above it."
            tone="settings"
          >
            <Card className="p-5 text-sm text-ink-600">Configuration lives here.</Card>
          </PageSection>
        </div>
      </Section>

      <Section title="Stat tiles" note="Tone carries meaning: a stalled count is not neutral">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Stalled in the pause" value="5" hint="Waiting on the board" tone="crit" />
          <Stat label="Awaiting vetting" value="3" tone="warn" />
          <Stat label="Interns on site" value="11" tone="good" />
          <Stat label="Subsidy committed" value="$30K" hint="of $240K allocated" tone="brand" />
        </div>
      </Section>

      <Section title="Status badges" note="Every state in the machine has one label, defined once">
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => <StatusBadge key={s} status={s} />)}
        </div>
      </Section>

      <Section title="Track and dwell badges" note="Track badges read credit from the posting rather than assuming it">
        <div className="flex flex-wrap gap-2 items-center">
          <TrackBadge track="standard" />
          <TrackBadge track="micro" />
          <Badge tone="good">Verified</Badge>
          <Badge tone="warn">Needs review</Badge>
          <DwellBadge days={3} />
          <DwellBadge days={9} />
          <DwellBadge days={19} />
        </div>
      </Section>

      <Section title="People" note="Colour is derived from the name, so the same person is the same colour everywhere — and never carries meaning alone">
        <div className="flex flex-wrap items-center gap-6">
          <Avatar name="Omar Haddad" size="lg" />
          <PersonChip name="Dr. Ellen Vance" subtitle="Verdigris State University" />
          <PersonChip name="Marcia Delgado" subtitle="Workforce officer" size="sm" />
        </div>
      </Section>

      <Section title="Progress and money">
        <div className="max-w-md space-y-4">
          <ProgressBar value={33} max={45} label="Hours banked toward the next credit" />
          <ProgressBar value={38} max={45} tone="warn" label="Hours banked, approaching the threshold" />
          <ProgressBar value={45} max={45} tone="good" label="Hours banked, credit ready" />
          <p className="text-sm text-ink-600">
            Committed <Money value={29680} /> of <Money value={240000} />
          </p>
        </div>
      </Section>

      <Section title="Assumption marker" note="Marks a decision standing in for an unanswered question, tagged with its number">
        <Assumption>
          Micro-internships are unsubsidized here (Q13) — a fixed project fee has
          no hours for an hourly reimbursement to attach to.
        </Assumption>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function LoadingSection() {
  return (
    <>
      <Section title="Skeletons" note="Unused today because fixtures return instantly. Real database latency turns every list into a blank flash">
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="border border-line-strong rounded-xl overflow-hidden mb-6">
          <SkeletonRows rows={4} columns={4} />
        </div>
        <div className="max-w-md">
          <SkeletonText lines={4} />
        </div>
      </Section>
    </>
  );
}
