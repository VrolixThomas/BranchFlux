import { router } from "../index";
import { projectsRouter } from "./projects";

export const appRouter = router({
	projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
