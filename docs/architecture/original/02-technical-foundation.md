# Section 2: Technical Foundation—Architecture and Technology Decisions

## 2.1 Technology Stack Alignment with Strategic Design

The technical foundation supports the strategic design decisions, particularly the modular monolith approach and MVP-focused development strategy.

### Core Technology Decisions

**Full-Stack Type Safety:**

- **Frontend:** Next.js 14 with App Router and TypeScript
- **API Layer:** tRPC for end-to-end type safety
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod schemas shared across frontend and backend
- **UI Framework:** shadcn/ui with Tailwind CSS

**Modular Monolith Implementation:**

- **Monorepo:** Turborepo for package management and build optimization
- **Module Boundaries:** Clear separation between bounded contexts
- **Shared Infrastructure:** Common utilities, types, and configurations

**MVP-Focused External Services:**

- **Authentication:** Custom JWT implementation with refresh tokens
- **Payment Processing:** Stripe for secure payment handling
- **Email Service:** Resend for transactional emails
- **File Storage:** Local storage for MVP, S3 for production

**Development & Deployment:**

- **Database:** PostgreSQL for ACID compliance and complex queries
- **Deployment:** Vercel for simple deployment and scaling
- **Monitoring:** Built-in Vercel analytics and logging
- **Testing:** Vitest for unit tests, Playwright for E2E testing

## 2.2 Modular Monolith Architecture

### Project Structure Blueprint

```text
hotel-booking-system/
├── apps/
│   └── web/                          # Next.js frontend application
│       ├── src/
│       │   ├── app/                  # Next.js App Router
│       │   ├── components/           # App-specific components
│       │   ├── lib/                  # App utilities and configurations
│       │   └── hooks/                # React hooks
│       ├── public/                   # Static assets
│       └── package.json
│
├── core/                             # Domain Contexts (Bounded Contexts)
│   ├── reservations/                 # @hotel/reservations - Core Domain
│   │   ├── domain/
│   │   │   ├── aggregates/           # Aggregate roots
│   │   │   ├── entities/             # Domain entities
│   │   │   ├── value-objects/        # Immutable value objects
│   │   │   ├── domain-services/      # Domain business logic
│   │   │   ├── domain-events/        # Domain events
│   │   │   ├── repositories/         # Repository interfaces
│   │   │   ├── specifications/       # Business rule specifications
│   │   │   └── index.ts
│   │   ├── application/
│   │   │   ├── use-cases/            # Application use cases
│   │   │   ├── query-services/       # Read-side queries
│   │   │   ├── ports/                # Outbound ports
│   │   │   ├── event-handlers/       # Domain event handlers
│   │   │   └── index.ts
│   │   ├── infrastructure/
│   │   │   ├── persistence/          # Database implementations
│   │   │   ├── adapters/             # External service adapters
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── inventory/                    # @hotel/inventory - Supporting Domain
│   ├── billing/                      # @hotel/billing - Supporting Domain
│   ├── guests/                       # @hotel/guests - Supporting Domain
│   ├── notifications/                # @hotel/notifications - Generic Domain
│   │
│   ├── shared/                       # @hotel/shared - Shared Kernel
│   │   ├── domain/
│   │   │   ├── value-objects/        # Shared value objects
│   │   │   ├── events/               # Base event classes
│   │   │   ├── exceptions/           # Domain exceptions
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   # POST-MVP CONTEXTS
│   ├── revenue/                      # @hotel/revenue - Future
│   ├── analytics/                    # @hotel/analytics - Future
│   ├── integrations/                 # @hotel/integrations - Future
│   └── operations/                   # @hotel/operations - Future
│
├── packages/                         # Infrastructure Packages
│   ├── database/                     # @hotel/database
│   │   ├── schemas/                  # Drizzle schemas per context
│   │   ├── migrations/               # Database migrations
│   │   ├── connection.ts             # Database connection setup
│   │   └── index.ts
│   │
│   ├── api/                          # @hotel/api
│   │   ├── routers/                  # tRPC routers per context
│   │   ├── middleware/               # API middleware
│   │   ├── root.router.ts            # Main tRPC router
│   │   └── index.ts
│   │
│   ├── auth/                         # @hotel/auth
│   │   ├── jwt.service.ts            # JWT token management
│   │   ├── auth.middleware.ts        # Authentication middleware
│   │   ├── types.ts                  # Auth types
│   │   └── index.ts
│   │
│   ├── events/                       # @hotel/events
│   │   ├── event-bus.ts              # Event bus implementation
│   │   ├── integration-events/       # Cross-context events
│   │   └── index.ts
│   │
│   ├── adapters/                     # @hotel/adapters
│   │   ├── stripe/                   # Stripe payment adapter
│   │   ├── email/                    # Email service adapter
│   │   └── index.ts
│   │
│   ├── ui/                           # @hotel/ui
│   │   ├── components/               # Shared UI components
│   │   ├── hooks/                    # Shared React hooks
│   │   └── index.ts
│   │
│   ├── utils/                        # @hotel/utils
│   ├── types/                        # @hotel/types
│   └── config/                       # @hotel/config
│
├── tools/                            # Development tools
│   ├── eslint/                       # ESLint configurations
│   └── typescript/                   # TypeScript configurations
│
├── docs/                             # Documentation
├── package.json                      # Root package.json
├── turbo.json                        # Turborepo configuration
└── README.md
```

### Package Dependencies and Boundaries

**Dependency Rules:**

1. **Domain Layer:** No dependencies on infrastructure or application layers
2. **Application Layer:** Can depend on domain layer only
3. **Infrastructure Layer:** Can depend on domain and application layers
4. **Web App:** Can depend on all packages but should prefer application layer
5. **Cross-Context:** Only through shared kernel or integration events

**Package Dependency Flow:**

```text
@hotel/web
├── @hotel/api (tRPC routers)
├── @hotel/ui (shared components)
├── @hotel/auth (authentication)
└── @hotel/* (domain contexts)

@hotel/reservations
├── @hotel/shared (shared kernel)
├── @hotel/database (persistence)
├── @hotel/events (event bus)
└── @hotel/adapters (external services)

@hotel/shared
├── @hotel/types (shared types)
└── @hotel/utils (utility functions)
```

## 2.3 Data Architecture and Consistency

### Database Design Strategy

**Schema Organization:**

```sql
-- Schema per bounded context
CREATE SCHEMA reservations;
CREATE SCHEMA inventory;
CREATE SCHEMA billing;
CREATE SCHEMA guests;
CREATE SCHEMA notifications;
CREATE SCHEMA shared;

-- Context-specific tables
CREATE TABLE reservations.reservations (...);
CREATE TABLE inventory.room_types (...);
CREATE TABLE billing.payments (...);
```

**Consistency Patterns:**

- **Strong Consistency:** Within aggregate boundaries using ACID transactions
- **Eventual Consistency:** Between contexts using domain events and saga patterns
- **Event Sourcing:** For reservation aggregate to maintain complete audit trail

### Event Store Implementation

```sql
-- Event store for aggregates
CREATE TABLE shared.domain_events (
    event_id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    event_version INTEGER NOT NULL,
    occurred_on TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(aggregate_id, event_version)
);

-- Integration events for cross-context communication
CREATE TABLE shared.integration_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0
);
```

## 2.4 Authentication and Authorization Strategy

### JWT-Based Authentication

```typescript
// packages/auth/jwt.service.ts
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserClaims {
  userId: string;
  email: string;
  roles: string[];
}

export class JWTService {
  generateTokens(user: UserClaims): AuthTokens {
    const accessToken = jwt.sign(user, process.env.JWT_SECRET!, {
      expiresIn: '15m'
    });

    const refreshToken = jwt.sign(
      { userId: user.userId },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: '7d' }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60 * 1000 // 15 minutes
    };
  }
}
```

### Role-Based Authorization

```typescript
// core/shared/domain/value-objects/user-identity.vo.ts
export class UserIdentity extends ValueObject<{
  id: string;
  email: string;
  roles: UserRole[];
}> {
  public hasRole(role: UserRole): boolean {
    return this.props.roles.includes(role);
  }

  public canManageReservations(): boolean {
    return this.hasRole(UserRole.ADMIN) || this.hasRole(UserRole.STAFF);
  }
}

export enum UserRole {
  GUEST = 'guest',
  STAFF = 'staff',
  ADMIN = 'admin'
}
```

## 2.5 External Service Integration

### Stripe Payment Integration

```typescript
// packages/adapters/stripe/stripe.adapter.ts
export class StripePaymentAdapter implements PaymentGatewayPort {
  constructor(private stripe: Stripe) {}

  async createPaymentIntent(request: CreatePaymentRequest): Promise<PaymentIntent> {
    const stripeIntent = await this.stripe.paymentIntents.create({
      amount: request.amount.cents,
      currency: request.amount.currency.toLowerCase(),
      metadata: {
        reservationId: request.reservationId,
        guestId: request.guestId
      }
    });

    return PaymentIntent.fromStripeIntent(stripeIntent);
  }

  async confirmPayment(paymentIntentId: string): Promise<PaymentResult> {
    const stripeIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return PaymentResult.fromStripeStatus(stripeIntent.status);
  }
}
```

### Email Service Integration

```typescript
// packages/adapters/email/resend.adapter.ts
export class ResendEmailAdapter implements EmailServicePort {
  constructor(private resend: Resend) {}

  async sendEmail(request: SendEmailRequest): Promise<void> {
    await this.resend.emails.send({
      from: 'noreply@yourhotel.com',
      to: request.recipient.email,
      subject: request.subject,
      html: request.htmlContent
    });
  }
}
```
