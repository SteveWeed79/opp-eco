"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Combobox,
  Modal,
  TextAreaField,
  TextField,
  useToast,
} from "@/components/ui";
import type { Track } from "@/domain/types";
import { submitPosting } from "./postingActions";

/**
 * Creating an opportunity.
 *
 * The track is chosen first and changes the rest of the form, because the two
 * are genuinely different products rather than one with optional fields: a
 * standard internship is hourly, semester-long, and board-subsidised; a micro
 * project is a fixed fee for scoped work with a deliverable. Asking for a
 * "wage per hour" on a micro project would be asking the wrong question.
 *
 * Validation here is a courtesy — the same schema runs on the server, where it
 * is the actual control.
 */
export function NewPosting({
  county,
  skillVocabulary,
  hoursPerCredit,
}: {
  county: string;
  /** Skills already in use in this market, so tags converge instead of sprawl. */
  skillVocabulary: string[];
  hoursPerCredit: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <Plus className="w-4 h-4" aria-hidden="true" /> Post an opportunity
        </span>
      </Button>
      {open && (
        <PostingForm
          county={county}
          skillVocabulary={skillVocabulary}
          hoursPerCredit={hoursPerCredit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Mounted only while open, so every draft starts empty rather than stale. */
function PostingForm({
  county,
  skillVocabulary,
  hoursPerCredit,
  onClose,
}: {
  county: string;
  skillVocabulary: string[];
  hoursPerCredit: number;
  onClose: () => void;
}) {
  const [track, setTrack] = useState<Track>("standard");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [skillsRequired, setSkillsRequired] = useState<string[]>([]);
  const [skillsPreferred, setSkillsPreferred] = useState<string[]>([]);
  const [openings, setOpenings] = useState("1");

  // Standard
  const [wagePerHour, setWagePerHour] = useState("20");
  const [hoursPerWeek, setHoursPerWeek] = useState("15");
  const [weeks, setWeeks] = useState("16");
  const [creditHours, setCreditHours] = useState("3");
  const [supervisorName, setSupervisorName] = useState("");

  // Micro
  const [projectFee, setProjectFee] = useState("750");
  const [estimatedHours, setEstimatedHours] = useState("30");
  const [deliverable, setDeliverable] = useState("");
  const [dueWithinDays, setDueWithinDays] = useState("30");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const num = (value: string) => (value.trim() === "" ? NaN : Number(value));
  const totalHours =
    track === "standard"
      ? num(hoursPerWeek) * num(weeks)
      : num(estimatedHours);

  function submit() {
    setError(null);
    const common = {
      title,
      description,
      county,
      skillsRequired,
      skillsPreferred,
      openings: num(openings),
    };
    const fields =
      track === "standard"
        ? {
            ...common,
            track: "standard" as const,
            wagePerHour: num(wagePerHour),
            hoursPerWeek: num(hoursPerWeek),
            weeks: num(weeks),
            creditHours: num(creditHours),
            supervisorName,
          }
        : {
            ...common,
            track: "micro" as const,
            projectFee: num(projectFee),
            estimatedHours: num(estimatedHours),
            deliverable,
            dueWithinDays: num(dueWithinDays),
          };

    startTransition(async () => {
      const result = await submitPosting(fields);
      if (result.ok) {
        onClose();
        toast.show(
          "success",
          "Sent to your college for review. Students see it once they approve.",
        );
      } else {
        setError(result.error ?? "That didn't go through.");
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Post an opportunity"
      description="Your college reviews this before students can see it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "Submitting…" : "Submit for review"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ChoiceGroup
          label="Type"
          value={track}
          onChange={(next) => setTrack(next as Track)}
          options={[
            {
              value: "standard",
              label: "Standard internship",
              meta: "Hourly",
              description:
                "A semester of paid work. The workforce board reimburses your wage cost once the student is cleared.",
            },
            {
              value: "micro",
              label: "Micro-internship",
              meta: "Fixed fee",
              description:
                "A scoped 5–40 hour project with a deliverable. No board interview, no semester commitment, not reimbursed.",
            },
          ]}
        />

        <TextField
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            track === "standard"
              ? "Software engineering intern"
              : "Automated test suite audit"
          }
        />

        <TextAreaField
          label="Description"
          required
          hint="What the student will actually do. Vague postings get vague applicants."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <Combobox
          label="Required skills"
          hint="Used for match scoring. Only list what someone genuinely cannot start without."
          options={skillVocabulary}
          value={skillsRequired}
          onChange={setSkillsRequired}
          max={8}
        />

        <Combobox
          label="Preferred skills"
          hint="Nice to have. These raise a match score but never gate an application."
          options={skillVocabulary}
          value={skillsPreferred}
          onChange={setSkillsPreferred}
          max={8}
        />

        {track === "standard" ? (
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label="Wage per hour"
              type="number"
              min={1}
              value={wagePerHour}
              onChange={(e) => setWagePerHour(e.target.value)}
              hint="What you pay. The board reimburses against its own rate."
            />
            <TextField
              label="Hours per week"
              type="number"
              min={1}
              max={40}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
            />
            <TextField
              label="Weeks"
              type="number"
              min={1}
              value={weeks}
              onChange={(e) => setWeeks(e.target.value)}
            />
            <TextField
              label="Credit hours"
              type="number"
              min={1}
              value={creditHours}
              onChange={(e) => setCreditHours(e.target.value)}
              hint="What the college will award."
            />
            <div className="sm:col-span-2">
              <TextField
                label="Supervisor"
                required
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                hint="Who signs off the student's hours."
              />
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label="Project fee"
              type="number"
              min={1}
              value={projectFee}
              onChange={(e) => setProjectFee(e.target.value)}
              hint="Paid on acceptance, not hourly."
            />
            <TextField
              label="Estimated hours"
              type="number"
              min={5}
              max={40}
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              hint="5–40. Beyond that it is a standard internship."
            />
            <div className="sm:col-span-2">
              <TextAreaField
                label="Deliverable"
                required
                hint="What the student hands over. This is what acceptance is judged against."
                value={deliverable}
                onChange={(e) => setDeliverable(e.target.value)}
              />
            </div>
            <TextField
              label="Due within (days)"
              type="number"
              min={1}
              value={dueWithinDays}
              onChange={(e) => setDueWithinDays(e.target.value)}
            />
          </div>
        )}

        <TextField
          label="Openings"
          type="number"
          min={1}
          value={openings}
          onChange={(e) => setOpenings(e.target.value)}
        />

        {/* Said at posting time rather than discovered after the work is done.
            A micro project below the threshold still earns hours — it just
            cannot carry a credit on its own. */}
        {Number.isFinite(totalHours) && totalHours > 0 && (
          <p className="text-xs text-ink-600 bg-ink-50 border border-line-strong rounded-lg px-3 py-2">
            {totalHours} total hours ·{" "}
            {totalHours >= hoursPerCredit
              ? `clears your college's ${hoursPerCredit}-hour threshold, so this can carry credit on its own.`
              : `below your college's ${hoursPerCredit}-hour threshold, so a student stacks it with other work to reach a credit.`}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm font-semibold text-crit-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
