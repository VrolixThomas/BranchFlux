import simpleGit from "simple-git";
import { z } from "zod";
import { detectLanguage, parseUnifiedDiff } from "../../git/operations";
import { publicProcedure, router } from "../index";

function computeStats(files: ReturnType<typeof parseUnifiedDiff>) {
	return {
		added: files.filter((f) => f.status === "added").length,
		removed: files.filter((f) => f.status === "deleted").length,
		changed: files.filter((f) => f.status !== "added" && f.status !== "deleted").length,
	};
}

export const diffRouter = router({
	getBranchDiff: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				baseBranch: z.string(),
				headBranch: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);
			const rawDiff = await git.diff([
				`${input.baseBranch}...${input.headBranch}`,
				"--unified=3",
				"--no-color",
			]);
			const files = parseUnifiedDiff(rawDiff);
			return { files, stats: computeStats(files) };
		}),

	getWorkingTreeDiff: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);
			// HEAD diff includes both staged and unstaged changes
			const rawDiff = await git.diff(["HEAD", "--unified=3", "--no-color"]);
			const files = parseUnifiedDiff(rawDiff);
			return { files, stats: computeStats(files) };
		}),

	getFileContent: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				ref: z.string(),
				filePath: z.string(),
			}),
		)
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);
			try {
				const content = await git.show([`${input.ref}:${input.filePath}`]);
				return { content, language: detectLanguage(input.filePath) };
			} catch {
				// File doesn't exist at this ref (e.g. newly added file has no "original")
				return { content: "", language: detectLanguage(input.filePath) };
			}
		}),
});
