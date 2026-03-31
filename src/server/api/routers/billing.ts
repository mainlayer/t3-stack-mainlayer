import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { mainlayer, MainlayerError, type Plan } from "~/lib/mainlayer";

/**
 * Local plan definitions — used as fallback when Mainlayer API is unreachable.
 * Update resource_id values with your actual Mainlayer resource IDs.
 * Get these from https://dashboard.mainlayer.fr/resources
 */
const LOCAL_PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Perfect for indie developers and small projects.",
    price_usd_cents: 900,
    interval: "month",
    features: [
      "Up to 1,000 API calls per month",
      "1 project",
      "Email support",
      "Basic analytics",
    ],
    resource_id: process.env.MAINLAYER_RESOURCE_STARTER ?? "res_starter",
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing teams that need more power.",
    price_usd_cents: 2900,
    interval: "month",
    features: [
      "Up to 50,000 API calls per month",
      "10 projects",
      "Priority support",
      "Advanced analytics",
      "Custom webhooks",
    ],
    resource_id: process.env.MAINLAYER_RESOURCE_PRO ?? "res_pro",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale with dedicated support.",
    price_usd_cents: 9900,
    interval: "month",
    features: [
      "Unlimited API calls",
      "Unlimited projects",
      "Dedicated support",
      "Custom integrations",
      "Priority SLA",
    ],
    resource_id: process.env.MAINLAYER_RESOURCE_ENTERPRISE ?? "res_enterprise",
  },
];

function getPlanById(planId: string): Plan {
  const plan = LOCAL_PLANS.find((p) => p.id === planId);
  if (!plan) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown plan: ${planId}`,
    });
  }
  return plan;
}

export const billingRouter = createTRPCRouter({
  /**
   * List available subscription plans.
   * Public endpoint for landing page pricing display.
   */
  getPlans: publicProcedure.query(async () => {
    // Try fetching fresh plans from Mainlayer, fallback to local definitions
    try {
      // If you implement a listPlans method, use it here
      return LOCAL_PLANS;
    } catch {
      return LOCAL_PLANS;
    }
  }),

  /**
   * Get pricing breakdown for a specific plan.
   */
  getPlanDetails: publicProcedure
    .input(z.object({ planId: z.string() }))
    .query(({ input }) => {
      const plan = getPlanById(input.planId);
      return plan;
    }),

  /**
   * Create a subscription for the authenticated user.
   * Performs duplicate check and syncs with Mainlayer API.
   */
  createSubscription: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const plan = getPlanById(input.planId);
      const userId = ctx.session.user.id;

      // Check for existing active subscription
      const existing = await ctx.db.subscription.findFirst({
        where: {
          userId,
          planId: plan.id,
          status: "ACTIVE",
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have an active subscription for this plan.",
        });
      }

      // Create subscription via Mainlayer
      let subscription;
      try {
        subscription = await mainlayer.createSubscription(
          plan.resource_id,
          userId
        );
      } catch (error) {
        const message =
          error instanceof MainlayerError
            ? error.message
            : "Failed to create subscription";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }

      // Persist in local database
      const record = await ctx.db.subscription.create({
        data: {
          userId,
          planId: plan.id,
          planName: plan.name,
          mainlayerResourceId: plan.resource_id,
          mainlayerSubscriptionId: subscription.subscription_id,
          status: subscription.status === "active" ? "ACTIVE" : "PENDING",
          currentPeriodStart: new Date(subscription.current_period_start),
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end)
            : null,
        },
      });

      return record;
    }),

  /**
   * Get the user's current subscription.
   * Optionally syncs with Mainlayer API for fresh status.
   */
  getCurrentSubscription: protectedProcedure
    .input(z.object({ sync: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findFirst({
        where: {
          userId: ctx.session.user.id,
          status: { in: ["ACTIVE", "PENDING"] },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!subscription) {
        return null;
      }

      // Sync with Mainlayer if requested
      if (input?.sync) {
        try {
          const fresh = await mainlayer.getSubscription(
            subscription.mainlayerResourceId,
            ctx.session.user.id
          );

          if (fresh) {
            const statusMap: Record<string, string> = {
              active: "ACTIVE",
              pending: "PENDING",
              canceled: "CANCELED",
              past_due: "PAST_DUE",
            };

            await ctx.db.subscription.update({
              where: { id: subscription.id },
              data: {
                status: statusMap[fresh.status] || "PENDING",
                currentPeriodEnd: fresh.current_period_end
                  ? new Date(fresh.current_period_end)
                  : null,
              },
            });
          }
        } catch {
          // Ignore sync errors, return cached data
        }
      }

      return subscription;
    }),

  /**
   * Cancel the user's active subscription.
   */
  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findUnique({
        where: { id: input.subscriptionId },
      });

      if (!subscription) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subscription not found.",
        });
      }

      if (subscription.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You cannot cancel another user's subscription.",
        });
      }

      if (subscription.status === "CANCELED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subscription is already canceled.",
        });
      }

      // Cancel via Mainlayer API
      try {
        if (subscription.mainlayerSubscriptionId) {
          await mainlayer.cancelSubscription(
            subscription.mainlayerSubscriptionId
          );
        }
      } catch (error) {
        const message =
          error instanceof MainlayerError
            ? error.message
            : "Failed to cancel subscription";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }

      // Update local record
      const updated = await ctx.db.subscription.update({
        where: { id: input.subscriptionId },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
        },
      });

      return updated;
    }),

  /**
   * Get subscription history for the authenticated user.
   */
  getSubscriptionHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(100).default(10),
          offset: z.number().int().nonnegative().default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 10;
      const offset = input?.offset ?? 0;

      const [subscriptions, total] = await Promise.all([
        ctx.db.subscription.findMany({
          where: { userId: ctx.session.user.id },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        ctx.db.subscription.count({
          where: { userId: ctx.session.user.id },
        }),
      ]);

      return {
        subscriptions,
        total,
        limit,
        offset,
      };
    }),
});
