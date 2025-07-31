# Section 2: Technical Foundation—Architecture and Technology Decisions

## 2.1 Technology Stack Alignment with Strategic Design

The technical foundation supports the strategic design decisions outlined in Section 1, particularly the modular monolith approach and MVP-focused development strategy. The technology choices prioritize solo developer productivity, type safety, and architectural flexibility.

### Core Technology Decisions

**Modular Monolith Implementation:**

- **Monorepo Structure:** Turborepo for managing bounded contexts as separate packages
- **Module Boundaries:** Clear separation between MVP and post-MVP contexts
- **Shared Infrastructure:** Common utilities and types across contexts

**Full-Stack Type Safety:**

- **Frontend:** Next.js with TypeScript for type-safe UI development
- **API Layer:** tRPC for end-to-end type safety between client and server
- **Database:** PostgreSQL with Drizzle ORM for type-safe database operations
- **Validation:** Zod schemas shared across frontend and backend

**MVP-Focused Choices:**

- **Payment Processing:** Stripe integration (external service, minimal internal complexity)
- **Authentication:** better-auth library for comprehensive authentication solution
- **Email Service:** External email provider integration
- **UI Framework:** shadcn/ui for rapid, consistent UI development

## 2.2 Modular Monolith Architecture

The monorepo structure directly supports the bounded context organization defined in the strategic design. Each bounded context becomes a separate package, enabling independent development while maintaining system cohesion.

### Architectural Organization

**Application Layer:**

- Web application (Next.js) consuming bounded context packages
- Admin interface for hotel management
- API routes organized by bounded context

**Domain Layer (Individual Bounded Context Packages):**

**MVP Contexts (Core Domain Packages):**

| Package                | Strategic Context Name       | Domain Type   |
| ---------------------- | ---------------------------- | ------------- |
| `@hotel/reservations`  | Reservations & Booking       | Core          |
| `@hotel/inventory`     | Hotel & Room Management      | Supporting    |
| `@hotel/guests`        | Customer Identity & Access   | Supporting    |
| `@hotel/billing`       | Billing & Payments           | Supporting    |
| `@hotel/notifications` | Notification & Communication | Supporting    |
| `@hotel/shared`        | Shared domain utilities      | Shared Kernel |

**Post-MVP Contexts (Future Domain Packages):**

| Package               | Strategic Context Name     | Domain Type |
| --------------------- | -------------------------- | ----------- |
| `@hotel/revenue`      | Revenue Management         | Supporting  |
| `@hotel/analytics`    | Reporting & Analytics      | Supporting  |
| `@hotel/integrations` | External Integrations      | Supporting  |
| `@hotel/operations`   | Maintenance & Housekeeping | Supporting  |

**Infrastructure Layer:**

**Shared Infrastructure Packages:**

| Package           | Description                     |
| ----------------- | ------------------------------- |
| `@hotel/ui`       | UI component library            |
| `@hotel/database` | Database schemas and migrations |
| `@hotel/auth`     | Authentication utilities        |
| `@hotel/api`      | tRPC router definitions         |
| `@hotel/config`   | Configuration management        |
| `@hotel/utils`    | Shared utility functions        |
| `@hotel/types`    | Shared TypeScript definitions   |
| `@hotel/adapters` | External service integrations   |

### Project Structure Blueprint

```text
/
├── apps/
│   └── web/                          # Next.js frontend application
│
├── core/
│   ├── reservations/                 # @hotel/reservations - MVP: Core Domain
│   │   ├── domain/                   # Domain Layer (Inner Hexagon)
│   │   │   ├── entities/
│   │   │   ├── value-objects/
│   │   │   ├── services/
│   │   │   ├── events/
│   │   │   ├── repositories/
│   │   │   └── index.ts
│   │   ├── application/              # Application Layer
│   │   │   ├── commands/
│   │   │   ├── queries/
│   │   │   ├── handlers/
│   │   │   ├── services/
│   │   │   ├── ports/
│   │   │   └── index.ts
│   │   ├── infrastructure/            # Infrastructure Layer (Adapters)
│   │   │   ├── adapters/
│   │   │   ├── repositories/
│   │   │   └── index.ts
│   │   └── index.ts
│   │
│   ├── inventory/                    # @hotel/inventory - MVP: Supporting Domain
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── index.ts
│   │
│   ├── guests/                       # @hotel/guests - MVP: Supporting Domain
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── index.ts
│   │
│   ├── billing/                      # @hotel/billing - MVP: Supporting Domain
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── index.ts
│   │
│   ├── notifications/                # @hotel/notifications - MVP: Supporting Domain
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── index.ts
│   │
│   ├── shared/                       # @hotel/shared - Shared Kernel
│   │   ├── domain/
│   │   ├── utils/
│   │   └── index.ts
│   │
│   # POST-MVP CONTEXTS
│   ├── revenue/                      # @hotel/revenue - POST-MVP
│   ├── analytics/                    # @hotel/analytics - POST-MVP
│   ├── integrations/                 # @hotel/integrations - POST-MVP
│   └── operations/                   # @hotel/operations - POST-MVP
│
├── packages/
│   ├── ui/                           # @hotel/ui - Shared UI components
│   ├── database/                     # @hotel/database - Database schemas and migrations
│   │   ├── schemas/
│   │   ├── migrations/
│   │   ├── connection.ts
│   │   └── index.ts
│   ├── auth/                         # @hotel/auth - Authentication utilities (better-auth)
│   │   ├── auth.config.ts            # better-auth configuration
│   │   ├── providers/                # Authentication providers
│   │   ├── middleware.ts             # Auth middleware
│   │   ├── types.ts                  # Auth types
│   │   └── index.ts
│   ├── api/                          # @hotel/api - tRPC router definitions
│   │   ├── routers/
│   │   ├── middleware/
│   │   ├── root.router.ts
│   │   └── index.ts
│   ├── config/                       # @hotel/config - Configuration management
│   ├── utils/                        # @hotel/utils - Shared utility functions
│   ├── types/                        # @hotel/types - Shared TypeScript definitions
│   └── adapters/                     # @hotel/adapters - External service adapters
│       ├── stripe/
│       │   ├── stripe.adapter.ts
│       │   ├── webhook.handler.ts
│       │   └── index.ts
│       ├── email/
│       │   ├── email.adapter.ts
│       │   ├── templates/
│       │   └── index.ts
│       └── storage/
│
├── tools/
│   ├── eslint/                       # ESLint configurations
│   └── typescript/                   # TypeScript configurations
│
├── docs/                             # Project documentation
│   └── architecture/                 # Architecture decisions
│
├── package.json                      # Root package.json with workspaces
├── turbo.json                        # Turborepo pipeline configuration
└── README.md                         # Project documentation
```

### MVP vs Post-MVP Package Organization

**Core Domain Packages (Individual Bounded Contexts):**

**Domain Packages (MVP):**

- `@hotel/reservations` - Core reservation and booking domain (Reservations & Booking)
- `@hotel/inventory` - Room and hotel inventory management (Hotel & Room Management)
- `@hotel/guests` - Guest management and authentication (Customer Identity & Access)
- `@hotel/billing` - Payment processing and financial transactions (Billing & Payments)
- `@hotel/notifications` - Email notifications and messaging (Notification & Communication)
- `@hotel/shared` - Shared domain concepts and utilities

**Domain Packages (Post-MVP):**

- `@hotel/revenue` - Dynamic pricing and revenue optimization (Revenue Management)
- `@hotel/analytics` - Business intelligence and reporting (Reporting & Analytics)
- `@hotel/integrations` - External API integrations and channel management (External Integrations)
- `@hotel/operations` - Housekeeping and maintenance workflows (Maintenance & Housekeeping)

**Infrastructure Packages (MVP):**

- `@hotel/ui` - Shared UI components
- `@hotel/db` - Database schemas and migrations
- `@hotel/auth` - Authentication utilities using better-auth library
- `@hotel/api` - tRPC router definitions
- `@hotel/config` - Configuration management
- `@hotel/utils` - Shared utility functions
- `@hotel/types` - Shared TypeScript definitions

**External Adapters Package:**

- `@hotel/adapters` - External service adapters
  - Stripe integration (MVP)
  - Email service integration (MVP)
  - File storage integration (Post-MVP)

### Domain-Driven Design Implementation

Each bounded context is implemented as a separate package following DDD tactical patterns:

**Domain Layer Patterns:**

- **Entities and Aggregates:** Core business objects with identity and lifecycle
- **Value Objects:** Immutable objects representing descriptive aspects
- **Domain Services:** Business logic that doesn't naturally fit within entities
- **Repository Interfaces:** Abstractions for data persistence

**Architectural Principles:**

- **Dependency Inversion:** Domain layer has no dependencies on infrastructure
- **Clean Architecture:** Clear separation between domain, application, and infrastructure layers
- **Bounded Context Isolation:** Each context package is independently deployable
- **Shared Kernel:** Common domain concepts shared across contexts

## 2.3 Data Architecture and Consistency

### Database Design Strategy

**Schema Organization:**

- **Schema-per-Context:** Logical separation of bounded contexts within PostgreSQL
- **Shared Tables:** Common entities (e.g., audit logs) in shared schema
- **Migration Strategy:** Context-specific migrations with dependency management

**Consistency Patterns:**

- **Strong Consistency:** Within bounded context boundaries using ACID transactions
- **Eventual Consistency:** Between contexts using domain events and outbox pattern
- **Concurrency Control:** Optimistic locking for reservation conflicts

### Integration Patterns

**Internal Communication:**

- **Direct Package Imports:** For MVP contexts within the monolith
- **Event-Driven Architecture:** Domain events for loose coupling
- **Anti-Corruption Layers:** Protecting context boundaries

**External Service Integration:**

- **Stripe API:** Payment processing with webhook handling
- **Email Services:** Transactional email delivery
- **Future Integrations:** OTA connections and third-party APIs

## 2.4 Development and Deployment Strategy

### MVP Development Approach

**Incremental Development:**

- Start with core MVP contexts (Reservations, Rooms, Guests, Payments, Notifications)
- Implement basic functionality before adding complexity
- Use static pricing initially, defer dynamic pricing to post-MVP
- Focus on direct bookings before external integrations

**Testing Strategy:**

- **Unit Tests:** Domain logic testing within each bounded context
- **Integration Tests:** Context interaction and external service integration
- **End-to-End Tests:** Critical user journeys (booking flow, payment processing)

**Deployment Considerations:**

- **Single Deployment Unit:** Monolith deployment for MVP simplicity
- **Database Migrations:** Context-aware migration strategy
- **Environment Management:** Development, staging, and production environments
- **Monitoring:** Application performance and business metrics

### Future Scalability

**Microservice Extraction Path:**

- **Payment Context:** First candidate due to compliance and scaling needs
- **External Integrations:** Isolation of third-party dependencies
- **Analytics Context:** Independent scaling for reporting workloads

**Technical Evolution:**

- **Event-Driven Architecture:** Transition from direct calls to event-based communication
- **API Gateway:** Introduction for external API management
- **Service Mesh:** Advanced networking and observability for microservices

This technical foundation provides a solid base for implementing the strategic design while maintaining flexibility for future evolution and scaling needs.
