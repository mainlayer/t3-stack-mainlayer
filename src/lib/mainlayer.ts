/**
 * Mainlayer client — billing and subscription management for AI-powered SaaS.
 * Base URL: https://api.mainlayer.xyz
 * Docs: https://docs.mainlayer.xyz
 */

const MAINLAYER_API_URL =
  process.env.MAINLAYER_API_URL ?? "https://api.mainlayer.xyz";

function getApiKey(): string {
  const key = process.env.MAINLAYER_API_KEY;
  if (!key) {
    throw new Error(
      "MAINLAYER_API_KEY is not set. Add it to your .env file."
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
  if (!response.ok) {
    const body = await response.text();
    throw new MainlayerError(
      `Mainlayer API error ${response.status}: ${body}`,
      response.status
    );
  }
  return response.json() as Promise<T>;
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
  }
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface CreateSubscriptionResponse {
  subscription_id: string;
  resource_id: string;
  payer_wallet: string;
  status: "active" | "pending" | "failed";
  created_at: string;
}

export interface SubscriptionStatusResponse {
  subscription_id: string;
  resource_id: string;
  payer_wallet: string;
  status: "active" | "canceled" | "past_due" | "trialing" | "incomplete";
  current_period_start: string;
  current_period_end: string | null;
  canceled_at: string | null;
}

export interface CancelSubscriptionResponse {
  subscription_id: string;
  status: "canceled";
  canceled_at: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  price_usd_cents: number;
  interval: "month" | "year";
  features: string[];
  resource_id: string;
}

export interface ListPlansResponse {
  plans: Plan[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const mainlayer = {
  /**
   * Create a new subscription for a user.
   * @param resourceId - The Mainlayer resource ID representing the plan/product.
   * @param payerWallet - The payer's wallet or payment identifier.
   */
  async createSubscription(
    resourceId: string,
    payerWallet: string
  ): Promise<CreateSubscriptionResponse> {
    const response = await fetch(`${MAINLAYER_API_URL}/pay`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        resource_id: resourceId,
        payer_wallet: payerWallet,
      }),
    });
    return handleResponse<CreateSubscriptionResponse>(response);
  },

  /**
   * Check the subscription status for a given resource and payer.
   */
  async checkSubscription(
    resourceId: string,
    payerWallet: string
  ): Promise<SubscriptionStatusResponse> {
    const params = new URLSearchParams({
      resource_id: resourceId,
      payer_wallet: payerWallet,
    });
    const response = await fetch(
      `${MAINLAYER_API_URL}/subscriptions/status?${params.toString()}`,
      {
        method: "GET",
        headers: buildHeaders(),
      }
    );
    return handleResponse<SubscriptionStatusResponse>(response);
  },

  /**
   * Cancel an active subscription by its ID.
   */
  async cancelSubscription(
    subscriptionId: string
  ): Promise<CancelSubscriptionResponse> {
    const response = await fetch(
      `${MAINLAYER_API_URL}/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        headers: buildHeaders(),
      }
    );
    return handleResponse<CancelSubscriptionResponse>(response);
  },

  /**
   * List all available plans/products defined in your Mainlayer dashboard.
   */
  async listPlans(): Promise<ListPlansResponse> {
    const response = await fetch(`${MAINLAYER_API_URL}/plans`, {
      method: "GET",
      headers: buildHeaders(),
    });
    return handleResponse<ListPlansResponse>(response);
  },
};
