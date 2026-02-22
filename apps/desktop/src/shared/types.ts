export interface TerminalAPI {
	create: (id: string) => Promise<void>;
	write: (id: string, data: string) => Promise<void>;
	resize: (id: string, cols: number, rows: number) => Promise<void>;
	dispose: (id: string) => Promise<void>;
	onData: (id: string, callback: (data: string) => void) => () => void;
	onExit: (id: string, callback: (exitCode: number) => void) => () => void;
}

export interface TrpcAPI {
	request: (opts: { type: string; path: string; input?: unknown }) => Promise<unknown>;
}

export interface DialogAPI {
	openDirectory: () => Promise<string[] | null>;
}
