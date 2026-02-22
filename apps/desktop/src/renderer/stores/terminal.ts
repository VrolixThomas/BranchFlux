import { create } from "zustand";

export interface TerminalTab {
	id: string;
	workspaceId: string | null;
	title: string;
	cwd: string;
}

interface TerminalStore {
	tabs: TerminalTab[];
	activeTabId: string | null;
	addTab: (cwd?: string) => string;
	removeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (id: string, title: string) => void;
	openWorkspace: (workspaceId: string, cwd: string, title: string) => string;
	closeWorkspace: (workspaceId: string) => void;
	getTabByWorkspace: (workspaceId: string) => TerminalTab | undefined;
}

let counter = 0;

export const useTerminalStore = create<TerminalStore>((set, get) => ({
	tabs: [],
	activeTabId: null,

	addTab: (cwd?: string) => {
		const id = `terminal-${++counter}`;
		set((state) => ({
			tabs: [
				...state.tabs,
				{ id, workspaceId: null, title: `Terminal ${counter}`, cwd: cwd ?? "" },
			],
			activeTabId: id,
		}));
		return id;
	},

	removeTab: (id) => {
		set((state) => {
			const filtered = state.tabs.filter((t) => t.id !== id);
			let nextActive = state.activeTabId;
			if (state.activeTabId === id) {
				const idx = state.tabs.findIndex((t) => t.id === id);
				nextActive = filtered[Math.min(idx, filtered.length - 1)]?.id ?? null;
			}
			return { tabs: filtered, activeTabId: nextActive };
		});
	},

	setActiveTab: (id) => set({ activeTabId: id }),

	updateTabTitle: (id, title) =>
		set((state) => ({
			tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
		})),

	openWorkspace: (workspaceId, cwd, title) => {
		const existing = get().getTabByWorkspace(workspaceId);
		if (existing) {
			set({ activeTabId: existing.id });
			return existing.id;
		}
		const id = `terminal-ws-${++counter}`;
		set((state) => ({
			tabs: [...state.tabs, { id, workspaceId, title, cwd }],
			activeTabId: id,
		}));
		return id;
	},

	closeWorkspace: (workspaceId) => {
		const tab = get().getTabByWorkspace(workspaceId);
		if (tab) {
			get().removeTab(tab.id);
		}
	},

	getTabByWorkspace: (workspaceId) => {
		return get().tabs.find((t) => t.workspaceId === workspaceId);
	},
}));
