import { useDiffStore } from "../stores/diff";
import { trpc } from "../trpc/client";
import { DiffEditor } from "./DiffEditor";

export function DiffViewerPanel() {
	const { activeDiff, openFile, diffMode, setDiffMode, closeDiff, maximizeDiff, maximizeTerminal, panelSizes, restoreSplit } =
		useDiffStore();

	const isMaximized = panelSizes[0] === 100;
	const isMinimized = panelSizes[0] === 0;

	// Compute ref for "before" side
	const baseRef = activeDiff
		? activeDiff.type === "pr"
			? `origin/${activeDiff.title}`
			: activeDiff.type === "branch"
				? activeDiff.baseBranch
				: "HEAD"
		: "HEAD";

	const headRef = activeDiff
		? activeDiff.type === "branch"
			? activeDiff.headBranch
			: "HEAD"
		: "HEAD";

	const repoPath = activeDiff?.repoPath ?? "";

	const originalQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: baseRef, filePath: openFile ?? "" },
		{ enabled: !!openFile && !!activeDiff, staleTime: 30_000 },
	);

	const modifiedQuery = trpc.diff.getFileContent.useQuery(
		{ repoPath, ref: headRef, filePath: openFile ?? "" },
		{ enabled: !!openFile && !!activeDiff, staleTime: 30_000 },
	);

	if (!activeDiff) return null;

	const title =
		activeDiff.type === "pr"
			? activeDiff.title
			: activeDiff.type === "branch"
				? `${activeDiff.baseBranch} → ${activeDiff.headBranch}`
				: "Working tree changes";

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
			{/* Panel header */}
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5">
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
					{title}
					{openFile && (
						<span className="ml-2 text-[var(--text-quaternary)]">{openFile}</span>
					)}
				</span>

				{/* Inline / split toggle */}
				<button
					type="button"
					onClick={() => setDiffMode(diffMode === "split" ? "inline" : "split")}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					title="Toggle inline/split view"
				>
					{diffMode === "split" ? "Inline" : "Split"}
				</button>

				{/* Maximize / restore */}
				<button
					type="button"
					onClick={isMaximized || isMinimized ? restoreSplit : maximizeDiff}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					title={isMaximized ? "Restore split" : "Maximize diff"}
				>
					{isMaximized ? "⊖" : "⤢"}
				</button>

				{/* Minimize to terminal */}
				{!isMinimized && (
					<button
						type="button"
						onClick={maximizeTerminal}
						className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
						title="Maximize terminal"
					>
						⊟
					</button>
				)}

				{/* Close */}
				<button
					type="button"
					onClick={closeDiff}
					className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-danger)]"
					title="Close diff viewer"
				>
					✕
				</button>
			</div>

			{/* Editor area */}
			<div className="flex-1 overflow-hidden">
				{!openFile ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Select a file from the file tree to view its diff
					</div>
				) : originalQuery.isLoading || modifiedQuery.isLoading ? (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
						Loading…
					</div>
				) : (
					<DiffEditor
						original={originalQuery.data?.content ?? ""}
						modified={modifiedQuery.data?.content ?? ""}
						language={originalQuery.data?.language ?? modifiedQuery.data?.language ?? "plaintext"}
						renderSideBySide={diffMode === "split"}
					/>
				)}
			</div>
		</div>
	);
}
