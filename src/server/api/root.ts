import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { billingRouter } from "~/server/api/routers/billing";
import { userRouter } from "~/server/api/routers/user";

/**
 * The application's root tRPC router.
 * Add new routers here.
 */
export const appRouter = createTRPCRouter({
  billing: billingRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Server-side caller — use in React Server Components.
 * @example
 * const trpc = createCaller(createContext);
 * const plans = await trpc.billing.getPlans();
 */
export const createCaller = createCallerFactory(appRouter);
