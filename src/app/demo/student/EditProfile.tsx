"use client";

import { useState, useTransition } from "react";
import { UserPen } from "lucide-react";
import {
  Button,
  Combobox,
  Modal,
  TextField,
  useToast,
} from "@/components/ui";

/**
 * Editing your own profile.
 *
 * The control this replaces did nothing: the student portal's header carried a
 * primary "Update profile" button that swallowed the click, so the fields every
 * match is scored on could only change by editing the fixtures — which is to
 * say, a learner whose interests changed had no way to say so.
 *
 * Only the fields a learner owns are here. Name, email and college are what the
 * registrar verified, and the email is the credential under real sign-on; the
 * form says so rather than leaving somebody hunting for a field that is not
 * there. Eligibility and status are absent for the same reason — they are
 * somebody else's determination about this person, not this person's claim
 * about themselves.
 */
export function EditProfile({
  profile,
  skillVocabulary,
  collegeName,
  action,
}: {
  profile: {
    programOfStudy: string;
    classStanding: string;
    expectedGraduation: string;
    skills: string[];
    interests: string[];
    availableHoursPerWeek: number;
  };
  /** Skills already in use in this market, so tags converge instead of sprawl. */
  skillVocabulary: string[];
  collegeName: string;
  action: (edit: unknown) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [programOfStudy, setProgramOfStudy] = useState(profile.programOfStudy);
  const [classStanding, setClassStanding] = useState(profile.classStanding);
  const [expectedGraduation, setExpectedGraduation] = useState(
    profile.expectedGraduation,
  );
  const [skills, setSkills] = useState(profile.skills);
  const [interests, setInterests] = useState(profile.interests);
  const [hours, setHours] = useState(String(profile.availableHoursPerWeek));
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const parsedHours = Number(hours);
  const valid =
    programOfStudy.trim().length >= 2 &&
    classStanding.trim().length > 0 &&
    expectedGraduation.trim().length > 0 &&
    Number.isInteger(parsedHours) &&
    parsedHours >= 1 &&
    parsedHours <= 40;

  function close() {
    setOpen(false);
    setProgramOfStudy(profile.programOfStudy);
    setClassStanding(profile.classStanding);
    setExpectedGraduation(profile.expectedGraduation);
    setSkills(profile.skills);
    setInterests(profile.interests);
    setHours(String(profile.availableHoursPerWeek));
  }

  function confirm() {
    if (!valid) return;
    startTransition(async () => {
      const result = await action({
        programOfStudy: programOfStudy.trim(),
        classStanding: classStanding.trim(),
        expectedGraduation: expectedGraduation.trim(),
        skills,
        interests,
        availableHoursPerWeek: parsedHours,
      });
      if (result.ok) {
        setOpen(false);
        toast.show("success", "Profile updated.");
      } else {
        toast.show("error", result.error ?? "Could not save that.");
      }
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <UserPen className="w-4 h-4" aria-hidden="true" /> Update profile
        </span>
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Update your profile"
        description="This is what employers match against, so it is worth keeping current."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirm} disabled={!valid || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 items-start">
            <TextField
              label="Program of study"
              value={programOfStudy}
              required
              onChange={(event) => setProgramOfStudy(event.target.value)}
            />
            <TextField
              label="Class standing"
              value={classStanding}
              required
              onChange={(event) => setClassStanding(event.target.value)}
              hint="Sophomore, Junior, Senior…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 items-start">
            <TextField
              label="Expected graduation"
              value={expectedGraduation}
              required
              onChange={(event) => setExpectedGraduation(event.target.value)}
              hint="For example, May 2027."
            />
            <TextField
              label="Hours a week you can work"
              type="number"
              min={1}
              max={40}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>

          <Combobox
            label="Skills"
            options={skillVocabulary}
            value={skills}
            onChange={setSkills}
            max={12}
            hint="Employers match on these. Pick from what this market already uses where you can."
          />

          <Combobox
            label="Interests"
            options={skillVocabulary}
            value={interests}
            onChange={setInterests}
            max={12}
            hint="What you want to work on, which is not always what you can already do."
          />

          <p className="text-xs text-ink-500 leading-relaxed border-t border-line pt-3">
            Your name, email and college are not editable here. {collegeName} verified
            them, and your email is how you sign in — changing either is something the
            registrar does, not something this form should be able to do.
          </p>
        </div>
      </Modal>
    </>
  );
}
