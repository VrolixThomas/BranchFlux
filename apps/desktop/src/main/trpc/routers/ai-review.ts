import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	getReviewDraft,
	getReviewDrafts,
	getSettings,
	queueReview,
} from "../../ai-review/orchestrator";
import { publishReview } from "../../ai-review/review-publisher";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import { publicProcedure, router } from "../index";

export const aiReviewRouter = router({
	getSettings: publicProcedure.query(() => {
		return getSettings();
	}),

	updateSettings: publicProcedure
		.input(
			z.object({
				cliPreset: z.enum(["claude", "gemini", "codex", "opencode"]).optional(),
				autoReviewEnabled: z.boolean().optional(),
				maxConcurrentReviews: z.number().min(1).max(10).optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();
			const updates: Record<string, unknown> = { updatedAt: now };

			if (input.cliPreset !== undefined) updates.cliPreset = input.cliPreset;
			if (input.autoReviewEnabled !== undefined)
				updates.autoReviewEnabled = input.autoReviewEnabled ? 1 : 0;
			if (input.maxConcurrentReviews !== undefined)
				updates.maxConcurrentReviews = input.maxConcurrentReviews;

			db.update(schema.aiReviewSettings)
				.set(updates)
				.where(eq(schema.aiReviewSettings.id, "default"))
				.run();

			return getSettings();
		}),

	getReviewDrafts: publicProcedure.query(() => {
		return getReviewDrafts();
	}),

	getReviewDraft: publicProcedure.input(z.object({ draftId: z.string() })).query(({ input }) => {
		return getReviewDraft(input.draftId);
	}),

	triggerReview: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				identifier: z.string(),
				title: z.string(),
				author: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
				repoPath: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			return queueReview(input);
		}),

	updateDraftComment: publicProcedure
		.input(
			z.object({
				commentId: z.string(),
				status: z.enum(["approved", "rejected", "edited"]),
				userEdit: z.string().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = { status: input.status };
			if (input.userEdit !== undefined) updates.userEdit = input.userEdit;

			db.update(schema.draftComments)
				.set(updates)
				.where(eq(schema.draftComments.id, input.commentId))
				.run();

			return { success: true };
		}),

	addUserComment: publicProcedure
		.input(
			z.object({
				reviewDraftId: z.string(),
				filePath: z.string(),
				lineNumber: z.number().optional(),
				body: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const id = randomUUID();
			const now = new Date();

			db.insert(schema.draftComments)
				.values({
					id,
					reviewDraftId: input.reviewDraftId,
					filePath: input.filePath,
					lineNumber: input.lineNumber ?? null,
					body: input.body,
					status: "approved", // User's own comments are pre-approved
					createdAt: now,
				})
				.run();

			return { id, status: "approved" };
		}),

	submitReview: publicProcedure
		.input(z.object({ draftId: z.string() }))
		.mutation(async ({ input }) => {
			return publishReview(input.draftId);
		}),

	dismissReview: publicProcedure.input(z.object({ draftId: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(schema.draftComments)
			.where(eq(schema.draftComments.reviewDraftId, input.draftId))
			.run();
		db.delete(schema.reviewDrafts).where(eq(schema.reviewDrafts.id, input.draftId)).run();
		return { success: true };
	}),
});
