import type { Pane } from "../../../shared/pane-types";
import { getAllPanes, usePaneStore } from "../../stores/pane-store";
import { PaneContent } from "./PaneContent";
import { PaneTabBar } from "./PaneTabBar";

export function PaneContainer({
	pane,
	workspaceId,
	savedScrollback,
}: {
	pane: Pane;
	workspaceId: string;
	savedScrollback: Record<string, string>;
}) {
	const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const isFocused = focusedPaneId === pane.id;
	const allPanes = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		return layout ? getAllPanes(layout) : [];
	});
	const paneIndex = allPanes.findIndex((p) => p.id === pane.id) + 1;

	return (
		<div
			className={`flex h-full flex-col overflow-hidden ${isFocused ? "ring-1 ring-[var(--accent)]" : ""}`}
			onMouseDown={() => setFocusedPane(pane.id)}
		>
			<PaneTabBar pane={pane} workspaceId={workspaceId} paneIndex={paneIndex} />
			<PaneContent pane={pane} savedScrollback={savedScrollback} />
		</div>
	);
}
