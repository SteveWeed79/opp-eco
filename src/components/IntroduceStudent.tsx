"use client";

import { useState, useTransition } from "react";
import { HandHeart } from "lucide-react";
import { Button, ChoiceGroup, Modal, useToast } from "@/components/ui";

/**
 * The control that turns the mentor list into something you can act on.
 *
 * It was a list because the introduction happened in a college officer's
 * inbox: the offer said an employer would take two students at once, and
 * nothing recorded who those two were. The button is the smaller half of
 * closing that — the record behind it is what makes `capacity` checkable and
 * lets a mentorship count toward the outcome this platform measures.
 *
 * Shared by the college and the administrator, each passing its own Server
 * Action with its role pinned server-side, exactly as `TransitionActions`
 * does. Rendering is not authorization: the same checks run again inside the
 * action, because a Server Action accepts a direct POST.
 */
export interface IntroducibleStudent {
  id: string;
  name: string;
  programOfStudy: string;
  classStanding: string;
}

export function IntroduceStudent({
  offerId,
  mentorName,
  employerName,
  formatLabel,
  placesLeft,
  students,
  action,
}: {
  offerId: string;
  mentorName: string;
  employerName: string;
  formatLabel: string;
  /** Places not currently spoken for. Zero disables the control and says why. */
  placesLeft: number;
  /** Verified students who are not already with this mentor. */
  students: IntroducibleStudent[];
  action: (
    offerId: string,
    studentId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const full = placesLeft <= 0;
  const nobodyLeft = students.length === 0;

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      const result = await action(offerId, selected);
      if (result.ok) {
        setOpen(false);
        setSelected(null);
        toast.show(
          "success",
          `Introduced. ${mentorName} and the student have both been told.`,
        );
      } else {
        toast.show("error", result.error ?? "Could not make that introduction.");
      }
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="quiet"
        // Disabled *and* explained. A control that is simply dead tells a
        // college nothing about whether to wait or find another mentor.
        disabled={full || nobodyLeft}
        onClick={() => setOpen(true)}
      >
        {full
          ? "No places left"
          : nobodyLeft
            ? "No students to introduce"
            : "Introduce a student"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Introduce a student to ${mentorName}`}
        description={`${formatLabel} at ${employerName}. They will be told who is coming, and the student will be told who to contact.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!selected || pending}
            >
              {pending ? "Introducing…" : "Make the introduction"}
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="Which student"
          value={selected}
          onChange={setSelected}
          options={students.map((student) => ({
            value: student.id,
            label: student.name,
            meta: student.classStanding,
            description: student.programOfStudy,
          }))}
        />
        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <HandHeart className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Only verified students appear here. There is no supervisor, no
            timesheet and no board interview behind a mentorship, so the
            college&rsquo;s verification is the check that stands in their place.
          </span>
        </p>
      </Modal>
    </>
  );
}
