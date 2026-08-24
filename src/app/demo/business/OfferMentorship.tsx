"use client";

import { useState, useTransition } from "react";
import { HandHeart } from "lucide-react";
import {
  Button,
  ChoiceGroup,
  Combobox,
  Modal,
  TextAreaField,
  TextField,
  useToast,
} from "@/components/ui";
import type { MentorshipFormat } from "@/domain/types";
import { MENTORSHIP_FORMATS } from "@/domain/mentorship";
import { submitMentorshipOffer } from "./mentorshipActions";

/**
 * Offering to mentor.
 *
 * The form is short by design. An employer reaching this has already declined
 * or deferred a placement — a semester of supervision, a wage, a board
 * interview — and the whole point of the mentorship surface is that it asks
 * for none of that. Every field a posting needs and this does not is a field
 * that was deliberately left out, not one still to be added.
 *
 * Validation here is a courtesy; the same schema runs on the server, where it
 * is the actual control.
 */
export function OfferMentorship({ topicVocabulary }: { topicVocabulary: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <span className="flex items-center gap-1.5">
          <HandHeart className="w-4 h-4" aria-hidden="true" /> Offer to mentor
        </span>
      </Button>
      {open && (
        <MentorshipForm
          topicVocabulary={topicVocabulary}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Mounted only while open, so every draft starts empty rather than stale. */
function MentorshipForm({
  topicVocabulary,
  onClose,
}: {
  topicVocabulary: string[];
  onClose: () => void;
}) {
  // Lightest commitment first. An employer who reads "ongoing one-to-one" as
  // the default offer declines the whole card.
  const [format, setFormat] = useState<MentorshipFormat>("portfolio_review");
  const [mentorName, setMentorName] = useState("");
  const [mentorRole, setMentorRole] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("2");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitMentorshipOffer({
        format,
        mentorName,
        mentorRole,
        topics,
        description,
        capacity: capacity.trim() === "" ? NaN : Number(capacity),
      });
      if (result.ok) {
        onClose();
        toast.show(
          "success",
          "You're on the mentor list. Your college introduces students to you.",
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
      title="Offer to mentor students"
      description="No wage, no credit, no board interview. This goes live as soon as you save it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Add me to the list"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ChoiceGroup
          label="What you're offering"
          value={format}
          columns={2}
          onChange={(next) => setFormat(next as MentorshipFormat)}
          options={MENTORSHIP_FORMATS.map((f) => ({
            value: f.value,
            label: f.label,
            meta: f.meta,
            description: f.description,
          }))}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            label="Who the student meets"
            required
            value={mentorName}
            onChange={(e) => setMentorName(e.target.value)}
            placeholder="Dana Reyes"
            // A company name with nobody behind it is not something a college
            // can introduce a student to.
            hint="The actual person, not the company."
          />
          <TextField
            label="Their role"
            required
            value={mentorRole}
            onChange={(e) => setMentorRole(e.target.value)}
            placeholder="Director of Engineering"
            hint="What students are deciding whether they want to do."
          />
        </div>

        <Combobox
          label="What you can talk about"
          hint="Students see these. They are what someone decides you are worth an hour of their time about."
          options={topicVocabulary}
          value={topics}
          onChange={setTopics}
          max={8}
        />

        <TextAreaField
          label="What it looks like"
          required
          hint="Be concrete about the size of it. Vague offers get requests you did not mean to agree to."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <TextField
          label="Students at once"
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          hint="What you can genuinely take. You can pause the offer any time without withdrawing it."
        />

        {error && (
          <p role="alert" className="text-sm font-semibold text-crit-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
