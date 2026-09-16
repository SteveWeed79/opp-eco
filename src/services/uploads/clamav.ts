/**
 * A real malware scanner: clamd, spoken directly.
 *
 * ClamAV's daemon takes a stream on a socket and answers with a verdict. The
 * protocol is small enough to implement here — a command, length-prefixed
 * chunks, a terminator, one line back — which is why this has no dependency.
 * A client library for four screenfuls of framing is a supply-chain surface
 * bought for nothing, and this is the one place in the application that
 * handles bytes from the internet.
 *
 * **It throws rather than guessing.** A scanner that cannot be reached, times
 * out, or answers something unrecognised raises, and `scanStoredFile` leaves
 * the file quarantined. Failing open on a malware check is the same as not
 * having one, and the failure mode people actually ship is a scanner that has
 * been down for a month while uploads kept succeeding.
 */

import net from "node:net";
import type { Scanner } from "./scanning";
import type { ScanStatus } from "./storage";

export interface ClamAvOptions {
  host: string;
  port: number;
  /**
   * Covers the whole exchange, not one socket event. A scan of a 20MB
   * deliverable against a cold daemon is seconds, not milliseconds.
   */
  timeoutMs?: number;
  /**
   * clamd reads length-prefixed chunks. 64KB is what its own clients use; the
   * daemon's `StreamMaxLength` bounds the total, not the chunk.
   */
  chunkBytes?: number;
}

export const CLAMAV_DEFAULTS = {
  port: 3310,
  timeoutMs: 30_000,
  chunkBytes: 64 * 1024,
} as const;

export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerUnavailableError";
  }
}

/**
 * Read a clamd reply.
 *
 * Exported for the tests, which is worth doing rather than testing it only
 * through a socket: the interesting cases are the replies, and they are
 * strings.
 */
export function verdictFrom(reply: string): ScanStatus {
  const line = reply.replace(/\0+$/, "").trim();

  // `stream: OK`
  if (/\bOK$/.test(line)) return "clean";
  // `stream: Eicar-Signature FOUND` — the signature name is deliberately not
  // returned. It is attacker-influenced text, it would end up in a log and a
  // UI message, and nothing in this product does anything different for one
  // signature than another.
  if (/\bFOUND$/.test(line)) return "infected";

  // `INSTREAM size limit exceeded. ERROR`, and everything else. Not a verdict:
  // treating an error as "clean" is the bug this whole file exists to avoid.
  throw new ScannerUnavailableError(`clamd said: ${line || "(nothing)"}`);
}

export function clamavScanner(options: ClamAvOptions): Scanner {
  const host = options.host;
  const port = options.port;
  const timeoutMs = options.timeoutMs ?? CLAMAV_DEFAULTS.timeoutMs;
  const chunkBytes = options.chunkBytes ?? CLAMAV_DEFAULTS.chunkBytes;

  return {
    name: `clamav:${host}:${port}`,
    scan(data) {
      return new Promise<ScanStatus>((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          fn();
        };

        const fail = (message: string) =>
          finish(() => reject(new ScannerUnavailableError(message)));

        socket.setTimeout(timeoutMs);
        socket.on("timeout", () => fail(`clamd at ${host}:${port} timed out`));
        socket.on("error", (error) =>
          fail(`clamd at ${host}:${port} is unreachable: ${error.message}`),
        );
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));

        socket.on("close", () => {
          if (settled) return;
          settled = true;
          try {
            resolve(verdictFrom(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });

        socket.on("connect", () => {
          // `z` prefix: the command is null-terminated rather than
          // newline-terminated, which is the form clamd's own docs recommend
          // because it cannot be confused by a newline in what follows.
          socket.write("zINSTREAM\0");

          for (let at = 0; at < data.length; at += chunkBytes) {
            const slice = data.subarray(at, Math.min(at + chunkBytes, data.length));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(slice.length, 0);
            socket.write(header);
            socket.write(Buffer.from(slice));
          }

          // A zero-length chunk ends the stream and asks for the verdict.
          const terminator = Buffer.alloc(4);
          terminator.writeUInt32BE(0, 0);
          socket.write(terminator);
        });
      });
    },
  };
}
