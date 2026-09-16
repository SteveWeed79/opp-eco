import { describe, expect, it, afterEach } from "vitest";
import net from "node:net";
import { EICAR_SIGNATURE } from "./scanning";
import {
  ScannerUnavailableError,
  clamavScanner,
  verdictFrom,
} from "./clamav";

/**
 * The clamd conversation, against a socket that speaks it.
 *
 * A fake daemon rather than a mocked module, because the thing most likely to
 * be wrong here is the framing — a big-endian length prefix, a zero-length
 * chunk to finish — and mocking the socket would assert my own idea of the
 * protocol back at me. This server reassembles the stream the way clamd does
 * and fails if the framing is off, so the test would catch a chunk header
 * written little-endian.
 */

/**
 * How the fake daemon answers once it has the whole stream.
 *
 *  - a string: reply and close, which is what clamd does.
 *  - `"hang-up"`: close without answering.
 *  - `"stay-silent"`: hold the connection open and say nothing, which is the
 *    case a hang-up does *not* cover — the client has to notice by itself.
 */
type Reply = string | "hang-up" | "stay-silent";

interface FakeClamd {
  port: number;
  /** What the daemon received, reassembled from the length-prefixed chunks. */
  received: () => Buffer;
  close: () => Promise<void>;
}

const servers: FakeClamd[] = [];

async function fakeClamd(reply: (body: Buffer) => Reply): Promise<FakeClamd> {
  let assembled = Buffer.alloc(0);

  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let sawCommand = false;

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!sawCommand) {
        const end = buffer.indexOf(0);
        if (end === -1) return;
        const command = buffer.subarray(0, end).toString("utf8");
        if (command !== "zINSTREAM") {
          socket.end("UNKNOWN COMMAND\0");
          return;
        }
        sawCommand = true;
        buffer = buffer.subarray(end + 1);
      }

      // Length-prefixed chunks until a zero length.
      for (;;) {
        if (buffer.length < 4) return;
        const size = buffer.readUInt32BE(0);
        if (size === 0) {
          const answer = reply(assembled);
          if (answer === "hang-up") socket.destroy();
          else if (answer !== "stay-silent") socket.end(answer);
          return;
        }
        if (buffer.length < 4 + size) return;
        assembled = Buffer.concat([assembled, buffer.subarray(4, 4 + size)]);
        buffer = buffer.subarray(4 + size);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  const handle: FakeClamd = {
    port,
    received: () => assembled,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  servers.push(handle);
  return handle;
}

afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

describe("reading a verdict", () => {
  it("takes OK as clean", () => {
    expect(verdictFrom("stream: OK\0")).toBe("clean");
  });

  it("takes FOUND as infected", () => {
    expect(verdictFrom("stream: Eicar-Test-Signature FOUND\0")).toBe("infected");
  });

  it("refuses to read an error as a verdict", () => {
    // The whole point of the file. "Size limit exceeded" means the daemon did
    // not look at the bytes, and calling that clean is how an unscanned file
    // becomes a downloadable one.
    expect(() => verdictFrom("INSTREAM size limit exceeded. ERROR\0")).toThrow(
      ScannerUnavailableError,
    );
  });

  it("refuses to read silence as a verdict", () => {
    expect(() => verdictFrom("")).toThrow(ScannerUnavailableError);
  });
});

describe("scanning over a socket", () => {
  it("streams the file and reports clean", async () => {
    const daemon = await fakeClamd(() => "stream: OK\0");
    const scanner = clamavScanner({ host: "127.0.0.1", port: daemon.port });

    const payload = new Uint8Array(Buffer.from("%PDF-1.7 a perfectly ordinary file"));
    expect(await scanner.scan(payload)).toBe("clean");
    // The daemon got the bytes, intact and in order — which is the framing
    // working, not just the connection.
    expect(daemon.received().equals(Buffer.from(payload))).toBe(true);
  });

  it("reassembles a file larger than one chunk", async () => {
    const daemon = await fakeClamd(() => "stream: OK\0");
    const scanner = clamavScanner({
      host: "127.0.0.1",
      port: daemon.port,
      chunkBytes: 1024,
    });

    // Deliberately not a multiple of the chunk size: an off-by-one in the last
    // slice is the mistake this shape catches.
    const payload = new Uint8Array(5000).map((_, i) => i % 251);
    expect(await scanner.scan(payload)).toBe("clean");
    expect(daemon.received().length).toBe(5000);
    expect(daemon.received().equals(Buffer.from(payload))).toBe(true);
  });

  it("reports infected when the daemon finds something", async () => {
    const daemon = await fakeClamd((body) =>
      body.toString("latin1").includes(EICAR_SIGNATURE)
        ? "stream: Eicar-Test-Signature FOUND\0"
        : "stream: OK\0",
    );
    const scanner = clamavScanner({ host: "127.0.0.1", port: daemon.port });

    expect(
      await scanner.scan(new Uint8Array(Buffer.from(EICAR_SIGNATURE, "latin1"))),
    ).toBe("infected");
  });

  it("throws when nothing is listening, rather than passing the file", async () => {
    // Port 1 on loopback: nothing binds it and the connection is refused
    // immediately, so this does not wait on a timeout.
    const scanner = clamavScanner({ host: "127.0.0.1", port: 1, timeoutMs: 2000 });
    await expect(scanner.scan(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      ScannerUnavailableError,
    );
  });

  it("throws when the daemon hangs up without answering", async () => {
    const daemon = await fakeClamd(() => "hang-up");
    const scanner = clamavScanner({ host: "127.0.0.1", port: daemon.port });
    await expect(scanner.scan(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      ScannerUnavailableError,
    );
  });

  it("times out rather than waiting forever on a daemon that never replies", async () => {
    // Accepts the stream, holds the connection open, and never answers. A
    // hang-up would surface as a closed socket; this is the case where nothing
    // happens at all, and only the client's own clock ends it.
    const daemon = await fakeClamd(() => "stay-silent");
    const scanner = clamavScanner({
      host: "127.0.0.1",
      port: daemon.port,
      timeoutMs: 150,
    });
    await expect(scanner.scan(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /timed out/,
    );
  });
});
