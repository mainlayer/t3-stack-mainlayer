import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
  /**
   * Get the currently authenticated user's profile.
   */
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }),

  /**
   * Update the authenticated user's display name.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { name: input.name },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      });
    }),

  /**
   * Get a summary of the user's account: profile + active subscription.
   */
  getAccountSummary: protectedProcedure.query(async ({ ctx }) => {
    const [user, activeSubscription] = await Promise.all([
      ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { id: true, name: true, email: true, image: true },
      }),
      ctx.db.subscription.findFirst({
        where: {
          userId: ctx.session.user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
          planId: true,
          planName: true,
          status: true,
          currentPeriodEnd: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return { user, activeSubscription };
  }),
});
