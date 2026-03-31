import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { mainlayer, type Plan } from "~/lib/mainlayer";

// ---------------------------------------------------------------------------
// Hardcoded plan definitions — replace resource_id values with your real
// Mainlayer resource IDs from https://app.mainlayer.fr
// ---------------------------------------------------------------------------
const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Perfect for indie developers and small projects.",
    price_usd_cents: 900,
    interval: "month",
    features: [
      "Up to 1,000 API calls / month",
      "1 project",
      "Email support",
      "Basic analytics",
    ],
    resource_id: process.env.MAINLAYER_RESOURCE_STARTER ?? "resource_starter",
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing teams that need more power.",
    price_usd_cents: 2900,
    interval: "month",
    features: [
      "Up to 50,000 API calls / month",
      "10 projects",
      "Priority support",
      "Advanced analytics",
      "Custom webhooks",
    ],
    resource_id: process.env.MAINLAYER_RESOURCE_PRO ?? "resource_pro",
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
      "Dedicated support SLA",
      "Custom integrations",
      "SSO / SAML",
      "SLA guarantee",
    ],
    resource_id:
      process.env.MAINLAYER_RESOURCE_ENTERPRISE ?? "resource_enterprise",
  },
];

export const billingRouter = createTRPCRouter({
  /**
   * List all available subscription plans.
   * Public endpoint — no auth required so the landing page can show pricing.
   */
  getPlans: publicProcedure.query(async () => {
    // Attempt to fetch live plans from Mainlayer; fall back to local definitions.
    try {
      const { plans } = await mainlayer.listPlans();
      return plans;
    } catch {
      // During development or if the API key is not yet configured, return
      // the hardcoded plan definitions so the UI still renders correctly.
      return PLANS;
    }
  }),

  /**
   * Create a Mainlayer subscription for the authenticated user.
   */
  subscribe: protectedProcedure
    .input(
      z.object({
        planId: z.string().min(1),
        payerWallet: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const plan = PLANS.find((p) => p.id === input.planId);
      if (!plan) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown plan: ${input.planId}`,
        });
      }

      // Check whether the user already has an active subscription for this plan.
      const existing = await ctx.db.subscription.findFirst({
        where: {
          userId: ctx.session.user.id,
          mainlayerResourceId: plan.resource_id,
          status: "ACTIVE",
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have an active subscription for this plan.",
        });
      }

      // Call Mainlayer to create the subscription.
      const result = await mainlayer.createSubscription(
        plan.resource_id,
        input.payerWallet
      );

      if (result.status === "failed") {
        throw new TRPCError({
          code: "PAYMENT_REQUIRED",
          message: "Subscription creation failed. Please try again.",
        });
      }

      // Persist subscription record in our database.
      const subscription = await ctx.db.subscription.create({
        data: {
          userId: ctx.session.user.id,
          mainlayerResourceId: plan.resource_id,
          payerWallet: input.payerWallet,
          planId: plan.id,
          planName: plan.name,
          status: result.status === "active" ? "ACTIVE" : "INCOMPLETE",
        },
      });

      return {
        subscription,
        mainlayerSubscriptionId: result.subscription_id,
      };
    }),

  /**
   * Get the current subscription status for the authenticated user.
   * Optionally syncs status with Mainlayer for freshness.
   */
  getSubscriptionStatus: protectedProcedure
    .input(
      z.object({
        sync: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findFirst({
        where: { userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
      });

      if (!subscription) {
        return { subscription: null, synced: false };
      }

      // Optionally refresh from Mainlayer.
      if (input.sync) {
        try {
          const live = await mainlayer.checkSubscription(
            subscription.mainlayerResourceId,
            subscription.payerWallet
          );

          const statusMap: Record<string, "ACTIVE" | "CANCELED" | "PAST_DUE" | "TRIALING" | "INCOMPLETE"> = {
            active: "ACTIVE",
            canceled: "CANCELED",
            past_due: "PAST_DUE",
            trialing: "TRIALING",
            incomplete: "INCOMPLETE",
          };

          const mappedStatus = statusMap[live.status] ?? "INCOMPLETE";

          const updated = await ctx.db.subscription.update({
            where: { id: subscription.id },
            data: {
              status: mappedStatus,
              currentPeriodEnd: live.current_period_end
                ? new Date(live.current_period_end)
                : null,
              canceledAt: live.canceled_at ? new Date(live.canceled_at) : null,
            },
          });

          return { subscription: updated, synced: true };
        } catch {
          // If the Mainlayer sync fails, return cached data rather than erroring.
          return { subscription, synced: false };
        }
      }

      return { subscription, synced: false };
    }),

  /**
   * Cancel the user's active subscription.
   */
  cancelSubscription: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.string().cuid(),
        mainlayerSubscriptionId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const subscription = await ctx.db.subscription.findUnique({
        where: { id: input.subscriptionId },
      });

      if (!subscription) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found." });
      }

      if (subscription.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your subscription." });
      }

      if (subscription.status === "CANCELED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Subscription is already canceled.",
        });
      }

      // Cancel on Mainlayer.
      await mainlayer.cancelSubscription(input.mainlayerSubscriptionId);

      // Update local record.
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
   * List all subscriptions for the current user (history).
   */
  getSubscriptionHistory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.subscription.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
    });
  }),
});
