/**
 * Mainlayer client — payment infrastructure for AI agents.
 * Base URL: https://api.mainlayer.fr
 * Docs: https://docs.mainlayer.fr
 *
 * This module provides type-safe API calls to Mainlayer for managing subscriptions,
 * plans, and resources. All errors are wrapped in MainlayerError for consistent handling.
 */

const MAINLAYER_API_URL =
  process.env.MAINLAYER_API_URL ?? "https://api.mainlayer.fr";

function getApiKey(): string {
  const key = process.env.MAINLAYER_API_KEY;
  if (!key) {
    throw new Error(
      "MAINLAYER_API_KEY is not configured. Set it in your .env.local file."
    );
  }
  return key;
}

function buildHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getApiKey()}`,
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  const body = await response.text();

  if (!response.ok) {
    let message = `API error (${response.status})`;
    try {
      const json = JSON.parse(body);
      message = json.error?.message || json.message || message;
    } catch {
      message = body || message;
    }
    throw new MainlayerError(message, response.status);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new MainlayerError(
      "Invalid JSON response from Mainlayer API",
      response.status
    );
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class MainlayerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "MainlayerError";
    Object.setPrototypeOf(this, MainlayerError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | "active"
  | "pending"
  | "failed"
  | "canceled"
  | "past_due"
  | "trialing"
  | "incomplete";

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_usd_cents: number;
  interval: "month" | "year";
  features: string[];
  resource_id: string;
}

export interface Subscription {
  subscription_id: string;
  resource_id: string;
  status: SubscriptionStatus;
  created_at: string;
  current_period_start: string;
  current_period_end: string | null;
  canceled_at: string | null;
}

// ---------------------------------------------------------------------------
// Mainlayer API Client
// ---------------------------------------------------------------------------

export const mainlayer = {
  /**
   * Create a new subscription for a user.
   * @throws MainlayerError on API failure
   */
  async createSubscription(
    resourceId: string,
    userId: string
  ): Promise<Subscription> {
    const response = await fetch(`${MAINLAYER_API_URL}/subscriptions/approve`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        resource_id: resourceId,
        user_id: userId,
      }),
    });
    return handleResponse<Subscription>(response);
  },

  /**
   * Get subscription details by resource and user.
   * @throws MainlayerError on API failure
   */
  async getSubscription(
    resourceId: string,
    userId: string
  ): Promise<Subscription | null> {
    try {
      const params = new URLSearchParams({
        resource_id: resourceId,
        user_id: userId,
      });
      const response = await fetch(
        `${MAINLAYER_API_URL}/subscriptions/status?${params.toString()}`,
        {
          method: "GET",
          headers: buildHeaders(),
        }
      );
      return handleResponse<Subscription>(response);
    } catch (error) {
      if (error instanceof MainlayerError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * Cancel an active subscription.
   * @throws MainlayerError on API failure
   */
  async cancelSubscription(subscriptionId: string): Promise<Subscription> {
    const response = await fetch(
      `${MAINLAYER_API_URL}/subscriptions/cancel`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          subscription_id: subscriptionId,
        }),
      }
    );
    return handleResponse<Subscription>(response);
  },

  /**
   * Activate a pending resource subscription.
   * @throws MainlayerError on API failure
   */
  async activateResource(resourceId: string): Promise<{ resource_id: string; status: string }> {
    const response = await fetch(
      `${MAINLAYER_API_URL}/resources/${resourceId}/activate`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify({}),
      }
    );
    return handleResponse(response);
  },

  /**
   * Get all plans for a resource.
   * @throws MainlayerError on API failure
   */
  async listResourcePlans(resourceId: string): Promise<Plan[]> {
    const response = await fetch(
      `${MAINLAYER_API_URL}/resources/${resourceId}/plans`,
      {
        method: "GET",
        headers: buildHeaders(),
      }
    );
    const result = await handleResponse<{ plans?: Plan[]; data?: Plan[] }>(response);
    return result.plans ?? result.data ?? [];
  },
};
