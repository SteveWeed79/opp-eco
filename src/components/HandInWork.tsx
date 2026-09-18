"use client";

import { useState, useTransition } from "react";
import { PackageCheck } from "lucide-react";
import {
  Button,
  FileUpload,
  Modal,
  TextAreaField,
  useToast,
  type AttachedFile,
} from "@/components/ui";
import { MIN_SUMMARY } from "@/domain/deliverable";
import { UPLOAD_PURPOSES } from "@/services/uploads/validation";

/**
 * The micro track's central act, which the product has never had.
 *
 * `Application.deliverableSubmitted` has guarded the employer's *Accept
 * deliverable* transition since the first migration and was written only by the
 * seed — so the gate existed and this is the thing that opens it.
 *
 * **The dialog says what acceptance means, because the learner cannot see the
 * employer's side.** Handing in is not "finished": it starts somebody else's
 * decision, and that decision is also the evaluation the college reads when it
 * awards the credit. A learner who thinks they have finished and hears nothing
 * for a week is the failure this sentence is trying to prevent.
 *
 * A resubmission uses the same control with a different label, because it is
 * the same act — the round is the server's business, not a second button.
 */
export function HandInWork({
  applicationId,
  projectTitle,
  /** What they were asked to change, when this is a second go. */
  revisionAsked,
  round,
  uploadsRefused,
  action,
}: {
  applicationId: string;
  projectTitle: string;
  revisionAsked?: string;
  round?: number;
  /**
   * Why this deployment will not take a file, when it will not.
   *
   * Passed from the server rather than discovered by trying: a learner who
   * picks a file, writes a summary and is then told the deployment has no
   * malware scanner has wasted the only effort they were going to make.
   */
  uploadsRefused?: string | null;
  action: (form: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const again = Boolean(revisionAsked);

  function close() {
    setOpen(false);
    setSummary("");
    setFiles([]);
  }

  function confirm() {
    startTransition(async () => {
      const form = new FormData();
      form.set("applicationId", applicationId);
      form.set("summary", summary);
      // Only when the browser actually handed the bytes over. A chip rendered
      // from a name and a size has no `file` behind it.
      if (files[0]?.file) form.set("file", files[0].file);
      const result = await action(form);
      if (result.ok) {
        close();
        toast.show(
          "success",
          again
            ? "Handed in again. The employer has been told."
            : "Handed in. The employer has been told.",
        );
      } else {
        toast.show("error", result.error ?? "Could not hand that in.");
      }
    });
  }

  const short = summary.trim().length > 0 && summary.trim().length < MIN_SUMMARY;

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        {again ? "Hand in again" : "Hand in your work"}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={again ? "Hand in the revised work" : "Hand in your work"}
        description={`${projectTitle}. The employer reads this and either takes the work or tells you what to change.`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!summary.trim() || short || pending}
            >
              {pending ? "Sending…" : "Hand it in"}
            </Button>
          </>
        }
      >
        {revisionAsked && (
          <div className="mb-4 rounded-xl border border-warn-100 bg-warn-50 p-4">
            <p className="text-xs font-semibold text-ink-950">
              What they asked for{round ? ` after round ${round}` : ""}
            </p>
            <p className="mt-1 text-sm text-ink-700 whitespace-pre-line">
              {revisionAsked}
            </p>
          </div>
        )}

        <TextAreaField
          label="What you are handing in"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={5}
          required
          hint="What you did and what they should look at first. This is what the employer sees before anything else."
          error={short ? "Say a little more than that." : undefined}
        />

        <div className="mt-4">
          {uploadsRefused ? (
            // Said plainly rather than by hiding the control. The learner can
            // still hand in — the summary is the required part — and an
            // operator reading over their shoulder gets the actual reason.
            <p className="text-xs text-ink-500 rounded-lg border border-line bg-ink-50 px-3 py-2">
              {uploadsRefused} You can still hand in — describe the work above
              and send the file another way.
            </p>
          ) : (
            <FileUpload
              label="Attach the work (optional)"
              hint="A brief, a spreadsheet, a mockup — or leave it off and link to it in the description."
              maxBytes={UPLOAD_PURPOSES.deliverable.maxBytes}
              files={files}
              onChange={setFiles}
            />
          )}
        </div>

        <p className="mt-4 text-xs text-ink-500 flex items-start gap-2">
          <PackageCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          Handing in does not finish the placement — the employer accepting it
          does, and what they write when they accept is the evaluation your
          college reads when it awards the credit.
        </p>
      </Modal>
    </>
  );
}
