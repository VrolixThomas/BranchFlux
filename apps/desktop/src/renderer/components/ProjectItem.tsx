import type { Project } from "../../main/db/schema";

interface ProjectItemProps {
	project: Project;
	isSelected: boolean;
	onSelect: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}

export function ProjectItem({
	project,
	isSelected,
	onSelect,
	onContextMenu,
}: ProjectItemProps) {
	const isCloning = project.status === "cloning";
	const isError = project.status === "error";

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onSelect}
			onContextMenu={onContextMenu}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			className={[
				"flex items-center gap-2 px-3 py-1.5 rounded-[6px] cursor-pointer",
				"transition-all duration-[120ms]",
				isSelected
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			{/* Color dot */}
			<div
				className="size-2 shrink-0 rounded-full"
				style={{
					backgroundColor: isError
						? "var(--term-red)"
						: (project.color ?? "var(--text-quaternary)"),
				}}
			/>

			{/* Name and status */}
			<div className="min-w-0 flex-1">
				<div
					className={[
						"truncate text-[13px]",
						isCloning ? "opacity-60" : "",
					].join(" ")}
				>
					{project.name}
				</div>
				{isCloning && (
					<div className="text-[11px] text-[var(--text-quaternary)]">
						Cloning...
					</div>
				)}
			</div>
		</div>
	);
}
