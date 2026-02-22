import type { DialogAPI, TerminalAPI, TrpcAPI } from "../shared/types";

export interface ElectronAPI {
	terminal: TerminalAPI;
	trpc: TrpcAPI;
	dialog: DialogAPI;
}

declare global {
	interface Window {
		electron: ElectronAPI;
	}
}
