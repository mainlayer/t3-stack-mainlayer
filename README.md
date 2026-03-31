# T3 Stack + Mainlayer SaaS Starter

A production-ready SaaS boilerplate built with the [T3 Stack](https://create.t3.gg/) (Next.js, tRPC, Prisma, TypeScript) and integrated with [Mainlayer](https://mainlayer.fr) payment infrastructure.

## Features

- **Authentication**: NextAuth.js with email/password and OAuth providers
- **Database**: PostgreSQL with Prisma ORM
- **API**: tRPC for type-safe client-server communication
- **Billing**: Mainlayer subscription management with three-tier plans (Starter, Pro, Enterprise)
- **Styling**: Tailwind CSS with shadcn/ui components
- **Testing**: Vitest + React Testing Library setup

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url> my-saas
cd my-saas
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
```

Configure the following in `.env.local`:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/mainlayer_saas"

# NextAuth
NEXTAUTH_SECRET="generate with: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"

# Mainlayer API
MAINLAYER_API_KEY="your-api-key-from-dashboard.mainlayer.fr"
MAINLAYER_API_URL="https://api.mainlayer.fr"

# Resource IDs (get from https://dashboard.mainlayer.fr/resources)
MAINLAYER_RESOURCE_STARTER="res_starter_xxx"
MAINLAYER_RESOURCE_PRO="res_pro_xxx"
MAINLAYER_RESOURCE_ENTERPRISE="res_enterprise_xxx"

# OAuth (optional)
GITHUB_ID="your-github-oauth-id"
GITHUB_SECRET="your-github-oauth-secret"
```

### 3. Database

```bash
npx prisma migrate dev
npx prisma generate
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
  ├── app/                 # Next.js app router
  ├── lib/
  │   └── mainlayer.ts    # Mainlayer API client
  ├── server/
  │   ├── api/
  │   │   ├── routers/
  │   │   │   ├── billing.ts    # Subscription management
  │   │   │   └── user.ts       # User endpoints
  │   │   └── trpc.ts
  │   ├── auth.ts          # NextAuth configuration
  │   └── db.ts            # Prisma client
  └── components/          # React components

prisma/
  ├── schema.prisma        # Data models
  └── migrations/

tests/                      # Test files
```

## Key Files

### `src/lib/mainlayer.ts`

Type-safe Mainlayer API client with error handling:

```typescript
// Create a subscription
const subscription = await mainlayer.createSubscription(
  "res_pro_xxx",
  "user_id"
);

// Get subscription status
const current = await mainlayer.getSubscription(
  "res_pro_xxx",
  "user_id"
);

// Cancel subscription
await mainlayer.cancelSubscription(subscription.subscription_id);

// List plans for a resource
const plans = await mainlayer.listResourcePlans("res_pro_xxx");
```

### `src/server/api/routers/billing.ts`

tRPC endpoints for billing operations:

- `billing.getPlans()` — List all pricing plans
- `billing.getPlanDetails()` — Get details for a specific plan
- `billing.createSubscription()` — Create a subscription for authenticated user
- `billing.getCurrentSubscription()` — Get user's active subscription with optional sync
- `billing.cancelSubscription()` — Cancel user's subscription
- `billing.getSubscriptionHistory()` — Get user's subscription history with pagination

### `prisma/schema.prisma`

Database models include:

```prisma
model Subscription {
  id                    String @id @default(cuid())
  userId                String
  planId                String
  planName              String
  mainlayerResourceId   String
  mainlayerSubscriptionId String?
  status                String  // "ACTIVE", "PENDING", "CANCELED", "PAST_DUE"
  currentPeriodStart    DateTime
  currentPeriodEnd      DateTime?
  canceledAt            DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  user                  User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, planId])
}
```

## Usage Examples

### Check User's Current Subscription

```typescript
const { data: subscription } = await trpc.billing.getCurrentSubscription.useQuery();

if (subscription?.status === "ACTIVE") {
  // User has active subscription
  const plan = LOCAL_PLANS.find(p => p.id === subscription.planId);
  console.log(`User subscribed to: ${plan?.name}`);
}
```

### Upgrade Plan

```typescript
const { mutate: upgrade } = trpc.billing.createSubscription.useMutation();

upgrade(
  { planId: "pro" },
  {
    onSuccess: (subscription) => {
      console.log("Upgraded to Pro!");
      // Redirect or show success message
    },
  }
);
```

### Cancel Subscription

```typescript
const { mutate: cancel } = trpc.billing.cancelSubscription.useMutation();

cancel(
  { subscriptionId: "sub_id" },
  {
    onSuccess: () => {
      console.log("Subscription canceled");
      // Refresh or redirect
    },
  }
);
```

## Plan Configuration

Plans are defined in `src/server/api/routers/billing.ts`:

```typescript
const LOCAL_PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "...",
    price_usd_cents: 900,      // $9.00/month
    interval: "month",
    features: ["Up to 1,000 API calls/month", ...],
    resource_id: process.env.MAINLAYER_RESOURCE_STARTER!,
  },
  // ... pro and enterprise
];
```

Update `resource_id` values with your actual Mainlayer resource IDs from the dashboard.

## API Reference

### Mainlayer Client

All methods in `src/lib/mainlayer.ts` throw `MainlayerError` on failure:

```typescript
try {
  const sub = await mainlayer.createSubscription(resourceId, userId);
} catch (error) {
  if (error instanceof MainlayerError) {
    console.error(`API error (${error.statusCode}): ${error.message}`);
  }
}
```

### tRPC Procedures

All protected procedures require authentication. Public procedures are marked explicitly.

Error codes follow standard tRPC patterns:
- `BAD_REQUEST` — Invalid input
- `CONFLICT` — Duplicate subscription
- `NOT_FOUND` — Resource doesn't exist
- `FORBIDDEN` — Authorization failed
- `INTERNAL_SERVER_ERROR` — API failure

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

## Database Migrations

```bash
# Create a new migration
npx prisma migrate dev --name add_feature

# Push schema to database (development only)
npx prisma db push

# Reset database (development only)
npx prisma migrate reset
```

## Deployment

### Environment Variables

Set these on your hosting platform (Vercel, Fly, Heroku, etc.):

```
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
MAINLAYER_API_KEY
MAINLAYER_API_URL
MAINLAYER_RESOURCE_STARTER
MAINLAYER_RESOURCE_PRO
MAINLAYER_RESOURCE_ENTERPRISE
```

### Build & Start

```bash
npm run build
npm start
```

### Database

Run migrations before deploying:

```bash
npx prisma migrate deploy
```

## Troubleshooting

### "MAINLAYER_API_KEY is not configured"

Ensure `MAINLAYER_API_KEY` is set in `.env.local`. Get it from https://dashboard.mainlayer.fr/settings/api-keys

### Plan not found

Verify `MAINLAYER_RESOURCE_*` environment variables match your actual resource IDs. Check the Mainlayer dashboard.

### Subscription sync fails

This is normal — the router gracefully falls back to cached data. Retry with `sync: true` in the query.

## Security

- **API Keys**: Never commit `.env.local` — use `.env.example` as template
- **User Auth**: Always check `ctx.session.user.id` in protected procedures
- **Validation**: All inputs are validated with Zod schemas
- **Database**: Prisma prevents SQL injection

## Support

- **Mainlayer Docs**: https://docs.mainlayer.fr
- **T3 Stack Docs**: https://create.t3.gg
- **NextAuth.js Docs**: https://next-auth.js.org
- **Prisma Docs**: https://www.prisma.io/docs

## License

MIT
