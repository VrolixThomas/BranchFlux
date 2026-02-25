import { useShallow } from "zustand/react/shallow";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Terminal, scrollbackRegistry } from "./Terminal";
import { TerminalTabs } from "./TerminalTabs";
import { useTerminalStore } from "../stores/terminal";
import { useDiffStore } from "../stores/diff";
import { DiffViewerPanel } from "./DiffViewerPanel";

interface MainContentAreaProps {
	savedScrollback: Record<string, string>;
}

export function MainContentArea({ savedScrollback }: MainContentAreaProps) {
	const visibleTabs = useTerminalStore(useShallow((s) => s.getVisibleTabs()));
	const activeTabId = useTerminalStore((s) => s.activeTabId);
	const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId);
	const { isPanelOpen, panelSizes, setPanelSizes } = useDiffStore();

	const terminalContent = (
		<div className="flex flex-col h-full">
			<TerminalTabs />
			<div className="relative flex-1 overflow-hidden">
				{!activeWorkspaceId && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Select a workspace to open a terminal
					</div>
				)}
				{activeWorkspaceId && visibleTabs.length === 0 && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						No terminals open — click + to create one
					</div>
				)}
				{visibleTabs.map((tab) => (
					<div
						key={tab.id}
						className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
					>
						<Terminal
							id={tab.id}
							cwd={tab.cwd || undefined}
							initialContent={savedScrollback[tab.id]}
						/>
					</div>
				))}
			</div>
		</div>
	);

	if (!isPanelOpen) {
		return <main className="flex min-w-0 flex-1 flex-col">{terminalContent}</main>;
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
			<PanelGroup
				direction="vertical"
				onLayout={(sizes) => setPanelSizes(sizes as [number, number])}
			>
				<Panel defaultSize={panelSizes[0]} minSize={15}>
					<DiffViewerPanel />
				</Panel>
				<PanelResizeHandle className="h-px bg-[var(--bg-overlay)] hover:bg-[var(--accent)] transition-colors cursor-row-resize" />
				<Panel defaultSize={panelSizes[1]} minSize={15} className="flex flex-col">
					{terminalContent}
				</Panel>
			</PanelGroup>
		</main>
	);
}

