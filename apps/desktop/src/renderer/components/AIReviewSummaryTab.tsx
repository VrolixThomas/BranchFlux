import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function AIReviewSummaryTab({ draftId }: { draftId: string }) {
	const { data, isLoading } = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId },
		{ staleTime: 10_000 }
	);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-[13px] text-[var(--text-quaternary)]">Loading summary…</div>
			</div>
		);
	}

	if (!data?.summaryMarkdown) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-[13px] text-[var(--text-quaternary)]">
					No summary available for this review.
				</div>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto bg-[var(--bg-base)]">
			<div className="mx-auto max-w-[720px] px-8 py-6">
				<div className="mb-4 flex items-center gap-2">
					<span className="ai-badge">AI</span>
					<span className="text-[12px] font-medium text-[var(--text-secondary)]">
						Review Summary
					</span>
				</div>
				<MarkdownRenderer content={data.summaryMarkdown} />
			</div>
		</div>
	);
}
