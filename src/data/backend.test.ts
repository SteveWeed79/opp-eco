/**
 * Which data layer a process gets, and what a read-only one does to a write.
 *
 * The resolution itself is one `if`, and the interesting half is what happens
 * after it: `ReadOnlyError` carries a sentence written for someone looking at
 * the screen, and for as long as nothing caught it that sentence went nowhere.
 * A demonstration pointed at a read-only database answered every click with an
 * unhandled server error instead of "browse freely".
 */

import { describe, it, expect } from "vitest";
import { ReadOnlyError, readOnlyStore } from "./backend";
import { attemptWrite } from "@/app/_actions/transition";

describe("a read-only deployment", () => {
  it("refuses before a unit of work is even assembled", async () => {
    let assembled = false;
    await expect(
      readOnlyStore().transaction(() => {
        assembled = true;
      }),
    ).rejects.toBeInstanceOf(ReadOnlyError);

    // The guard runs before `work`, so no statement is staged and no
    // connection is taken.
    expect(assembled).toBe(false);
  });

  it("explains itself to the person who clicked", async () => {
    const result = await attemptWrite(() =>
      // `work` is synchronous by contract — a caller that could await
      // mid-transaction would hold a connection across a round trip.
      readOnlyStore().transaction(() => ({ ok: true })),
    );

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error");
    const { error } = result as { error: string };
    expect(error).toMatch(/read-only database/);
    expect(error).toMatch(/browse freely/);
  });

  it("converts only that refusal, and never a fault", async () => {
    // Swallowing anything else here would hide a real failure from the logs
    // and report it to the caller as a policy decision.
    await expect(
      attemptWrite(async () => {
        throw new TypeError("column does not exist");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});
