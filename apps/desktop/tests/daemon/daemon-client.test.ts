import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "../../src/main/terminal/daemon-client";

const TEST_SOCKET = join(tmpdir(), `branchflux-client-test-${process.pid}.sock`);

function startMockDaemon(): Promise<{ server: Server; lastSocket: () => Socket | null }> {
	return new Promise((resolve) => {
		let lastSock: Socket | null = null;
		const server = createServer((socket) => {
			lastSock = socket;
			// Send ready
			socket.write(`${JSON.stringify({ type: "ready" })}\n`);
			// Handle list request → respond with one live session
			let buf = "";
			socket.on("data", (chunk) => {
				buf += chunk.toString();
				let nl: number;
				while ((nl = buf.indexOf("\n")) !== -1) {
					const line = buf.slice(0, nl).trim();
					buf = buf.slice(nl + 1);
					if (!line) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.type === "list") {
							socket.write(
								`${JSON.stringify({ type: "sessions", sessions: [{ id: "term-1", cwd: "/tmp", pid: 99 }] })}\n`
							);
						}
					} catch {}
				}
			});
		});
		server.listen(TEST_SOCKET, () => resolve({ server, lastSocket: () => lastSock }));
	});
}

describe("DaemonClient", () => {
	let daemon: { server: Server; lastSocket: () => Socket | null };
	let client: DaemonClient;

	beforeEach(async () => {
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		daemon = await startMockDaemon();
		client = new DaemonClient(TEST_SOCKET);
		await client.connect();
	});

	afterEach(() => {
		client.disconnect();
		daemon.server.close();
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
	});

	test("hasLiveSession returns true for daemon-reported sessions", () => {
		expect(client.hasLiveSession("term-1")).toBe(true);
	});

	test("hasLiveSession returns false for unknown sessions", () => {
		expect(client.hasLiveSession("term-99")).toBe(false);
	});

	test("setQuitting prevents dispose from sending a message", async () => {
		const sent: string[] = [];
		const sock = daemon.lastSocket();
		if (sock) {
			sock.on("data", (chunk) => sent.push(chunk.toString()));
		}

		client.setQuitting();
		client.dispose("term-1");

		await new Promise<void>((r) => setTimeout(r, 80));
		expect(sent.some((s) => s.includes('"dispose"'))).toBe(false);
	});

	test("create sends a create message to the daemon", async () => {
		const sent: string[] = [];
		const sock = daemon.lastSocket();
		if (sock) {
			sock.on("data", (chunk) => sent.push(chunk.toString()));
		}

		await client.create(
			"new-term",
			"/home/user",
			() => {},
			() => {}
		);

		await new Promise<void>((r) => setTimeout(r, 80));
		const combined = sent.join("");
		expect(combined).toContain('"create"');
		expect(combined).toContain('"new-term"');
	});

	test("reconnects after daemon connection is lost", async () => {
		// Destroy the current daemon server to simulate crash
		const sock = daemon.lastSocket();
		sock?.destroy();
		daemon.server.close();

		// Wait for client to detect close
		await new Promise<void>((r) => setTimeout(r, 200));

		// Start new mock daemon on same socket
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		daemon = await startMockDaemon();

		// Wait for reconnection (first attempt at 1s backoff)
		await new Promise<void>((r) => setTimeout(r, 2_000));

		// After reconnect, client should have refreshed session list
		expect(client.hasLiveSession("term-1")).toBe(true);
	}, 10_000);
});
