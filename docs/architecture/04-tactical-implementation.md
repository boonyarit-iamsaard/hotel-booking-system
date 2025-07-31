# Section 4: Tactical Implementation—DDD and Hexagonal Architecture Patterns

## 4.1 Core DDD Tactical Patterns

Domain-Driven Design (DDD) provides a set of tactical patterns that help implement complex business domains. These patterns form the building blocks for creating a rich, expressive domain model that accurately reflects business processes and rules.

### 4.1.1 Entities and Value Objects

The foundation of any DDD implementation starts with correctly identifying and implementing Entities and Value Objects:

**Entities** are domain objects with a distinct identity that runs through time and different states. They are defined not by their attributes but by their identity. For example, in our hotel booking system, a `Reservation` is an Entity because it maintains its identity even as its status changes from "pending" to "confirmed."

**Value Objects** are immutable objects that describe aspects of the domain with no conceptual identity. They are defined by their attributes. In our hotel booking system, a `DateRange` is a Value Object because two date ranges with the same start and end dates are considered equal, regardless of whether they represent different reservations.

```typescript
// core/reservations/domain/entities/reservation.entity.ts
// Domain Layer - Entity Example
interface ReservationProps {
  guestId: string;
  dateRange: DateRange;
  roomBooking: RoomBooking;
  totalPrice: Price;
  status: ReservationStatus;
}

class Reservation extends Entity<ReservationProps> {
  private constructor(props: ReservationProps, id?: string) {
    super(props, id);
  }

  public static create(
    props: Omit<ReservationProps, "status">,
    id?: string
  ): Reservation {
    return new Reservation({ ...props, status: ReservationStatus.PENDING }, id);
  }

  public confirm(): void {
    if (this.props.status !== ReservationStatus.PENDING) {
      throw new Error("Only pending reservations can be confirmed.");
    }
    this.props.status = ReservationStatus.CONFIRMED;
    this.addDomainEvent(new ReservationConfirmedEvent(this.id));
  }

  public cancel(): void {
    if (this.props.status === ReservationStatus.CANCELLED) {
      throw new Error("Reservation is already cancelled.");
    }
    this.props.status = ReservationStatus.CANCELLED;
    this.addDomainEvent(new ReservationCancelledEvent(this.id));
  }
}

// core/reservations/domain/value-objects/date-range.vo.ts
// Domain Layer - Value Object Example
class DateRange extends ValueObject<{ checkIn: Date; checkOut: Date }> {
  constructor(props: { checkIn: Date; checkOut: Date }) {
    if (props.checkIn >= props.checkOut) {
      throw new Error("Check-out date must be after check-in date.");
    }
    super(props);
  }

  public overlapsWith(other: DateRange): boolean {
    return this.props.checkIn < other.props.checkOut &&
           this.props.checkOut > other.props.checkIn;
  }
}
```

### 4.1.2 Aggregates and Aggregate Roots

An **Aggregate** is a cluster of related domain objects that are treated as a single unit for data changes. The **Aggregate Root** is the entry point to the aggregate and is responsible for maintaining the consistency boundaries of the entire aggregate.

In our hotel booking system, the `Reservation` serves as an Aggregate Root, encapsulating all related information such as the guest, date range, booked rooms, and total price. All external access to objects within the aggregate must go through the Aggregate Root.

```typescript
// core/reservations/domain/entities/reservation.entity.ts
// Domain Layer - Aggregate Root Example
class Reservation extends Entity<ReservationProps> implements AggregateRoot {
  private constructor(props: ReservationProps, id?: string) {
    super(props, id);
  }

  // Business logic methods that enforce invariants
  public updateGuestInfo(guestId: string): void {
    // Business rule: Can only update guest info for pending reservations
    if (this.props.status !== ReservationStatus.PENDING) {
      throw new Error("Cannot update guest info for confirmed reservations.");
    }
    this.props.guestId = guestId;
  }

  public calculateTotalPrice(rateCalculator: RateCalculator): void {
    // Business logic that might involve domain services
    this.props.totalPrice = rateCalculator.calculate(
      this.props.dateRange,
      this.props.roomBooking
    );
  }
}
```

### 4.1.3 Domain Services

**Domain Services** contain business logic that doesn't naturally fit within an Entity or Value Object. They are stateless operations that work across multiple domain objects.

```typescript
// core/reservations/domain/services/availability.service.ts
// Domain Layer - Domain Service Example
interface AvailabilityService {
  checkRoomAvailability(
    roomTypeId: string,
    dateRange: DateRange
  ): Promise<boolean>;

  reserveRoom(
    roomTypeId: string,
    dateRange: DateRange,
    reservationId: string
  ): Promise<void>;
}

// core/reservations/domain/services/booking-policy.service.ts
class BookingPolicyService {
  private readonly policies: BookingPolicy[];

  public validateBooking(
    reservation: Reservation,
    guest: Guest
  ): ValidationResult {
    // Complex business logic that spans multiple entities
    for (const policy of this.policies) {
      const result = policy.validate(reservation, guest);
      if (!result.isValid) {
        return result;
      }
    }
    return ValidationResult.valid();
  }
}
```

### 4.1.4 Domain Events

**Domain Events** represent something that happened in the domain that domain experts care about. They are used to communicate between aggregates and to trigger side effects.

```typescript
// core/shared/domain/events/domain-event.base.ts
// Domain Layer - Domain Event Example
interface DomainEvent {
  eventId: string;
  occurredOn: Date;
}

// core/reservations/domain/events/reservation-confirmed.event.ts
class ReservationConfirmedEvent implements DomainEvent {
  public readonly eventId: string;
  public readonly occurredOn: Date;
  public readonly reservationId: string;
  public readonly confirmationDate: Date;

  constructor(reservationId: string) {
    this.eventId = generateId();
    this.occurredOn = new Date();
    this.reservationId = reservationId;
    this.confirmationDate = new Date();
  }
}
```

## 4.2 Hexagonal Architecture Patterns

Hexagonal Architecture (also known as Ports and Adapters) is a structural pattern that isolates the core business logic from external concerns. It emphasizes dependency inversion and clear separation of concerns.

### 4.2.1 Ports and Adapters

**Ports** are interfaces defined in the domain layer that represent contracts for external interactions. **Adapters** are implementations of these ports in the infrastructure layer.

```typescript
// core/reservations/domain/repositories/reservation.repository.ts
// Domain Layer - Port Definition
interface ReservationRepository {
  findById(id: string): Promise<Reservation | null>;
  save(reservation: Reservation): Promise<void>;
  findByGuestId(guestId: string): Promise<Reservation[]>;
}

// core/reservations/application/services/reservation.service.ts
// Domain Layer - Application Service using Port
class ReservationService {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly eventPublisher: DomainEventPublisher
  ) {}

  public async confirmReservation(reservationId: string): Promise<void> {
    const reservation = await this.reservationRepository.findById(reservationId);
    if (!reservation) {
      throw new Error("Reservation not found");
    }

    reservation.confirm();
    await this.reservationRepository.save(reservation);

    // Publish domain events after successful persistence
    this.eventPublisher.publishAll(reservation.getDomainEvents());
  }
}
```

### 4.2.2 Dependency Inversion Principle

The Dependency Inversion Principle is crucial in Hexagonal Architecture. High-level modules (domain) should not depend on low-level modules (infrastructure). Both should depend on abstractions.

```typescript
// core/reservations/application/services/reservation.service.ts
// Domain Layer - Depends on abstraction (port)
class ReservationService {
  constructor(
    private readonly reservationRepository: ReservationRepository  // Port
  ) {}
}

// core/reservations/infrastructure/repositories/database-reservation.repository.ts
// Infrastructure Layer - Implements the abstraction (adapter)
class DatabaseReservationRepository implements ReservationRepository {
  constructor(private readonly databaseConnection: DatabaseConnection) {}

  public async save(reservation: Reservation): Promise<void> {
    // Implementation details hidden behind the port interface
    // Could be any database technology
  }
}
```

## 4.3 Application Layer Patterns

The Application Layer orchestrates the domain objects to fulfill use cases. It's responsible for transaction management, security, and communication with external systems.

### 4.3.1 Use Cases and Handlers

Use cases represent application-specific business logic that coordinates domain objects. They typically follow either the Command/Query pattern or the more general Use Case pattern.

```typescript
// core/shared/application/cqrs/command.base.ts
// Application Layer - Command
interface Command<T> {
  execute(): Promise<T>;
}

// core/reservations/application/commands/confirm-reservation.command.ts
class ConfirmReservationCommand implements Command<void> {
  constructor(
    public readonly reservationId: string
  ) {}
}

// core/reservations/application/handlers/confirm-reservation.handler.ts
// Application Layer - Command Handler
class ConfirmReservationHandler {
  constructor(
    private readonly reservationService: ReservationService
  ) {}

  public async handle(command: ConfirmReservationCommand): Promise<void> {
    await this.reservationService.confirmReservation(command.reservationId);
  }
}
```

### 4.3.2 Application Services

Application Services act as the main entry point for use cases. They coordinate between domain objects and infrastructure services.

```typescript
// core/reservations/application/services/booking.service.ts
// Application Layer - Application Service
class BookingApplicationService {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly availabilityService: AvailabilityService,
    private readonly guestRepository: GuestRepository,
    private readonly eventPublisher: DomainEventPublisher
  ) {}

  public async createReservation(
    guestId: string,
    roomTypeId: string,
    checkIn: Date,
    checkOut: Date
  ): Promise<string> {
    // 1. Retrieve domain objects
    const guest = await this.guestRepository.findById(guestId);
    if (!guest) {
      throw new Error("Guest not found");
    }

    // 2. Validate business rules
    const dateRange = new DateRange({ checkIn, checkOut });
    const isAvailable = await this.availabilityService.checkRoomAvailability(
      roomTypeId,
      dateRange
    );

    if (!isAvailable) {
      throw new Error("Room not available for selected dates");
    }

    // 3. Create and persist domain object
    const reservation = Reservation.create({
      guestId,
      dateRange,
      roomBooking: new RoomBooking({ roomTypeId, quantity: 1 }),
      totalPrice: Price.zero()
    });

    await this.reservationRepository.save(reservation);

    // 4. Publish domain events
    this.eventPublisher.publishAll(reservation.getDomainEvents());

    return reservation.id;
  }
}
```

## 4.4 Integration Patterns

### 4.4.1 Anti-Corruption Layer

An Anti-Corruption Layer (ACL) is used to prevent the corruption of one bounded context by another. It translates between different models and protects the integrity of the domain.

```typescript
// core/reservations/infrastructure/adapters/guest.adapter.ts
// Infrastructure Layer - Anti-Corruption Layer
class GuestAdapter {
  constructor(private readonly externalGuestService: ExternalGuestService) {}

  public async getGuestProfile(guestId: string): Promise<GuestProfile> {
    // Translate from external model to internal domain model
    const externalProfile = await this.externalGuestService.getProfile(guestId);

    return new GuestProfile({
      id: externalProfile.id,
      name: `${externalProfile.firstName} ${externalProfile.lastName}`,
      email: externalProfile.primaryEmail,
      phone: externalProfile.mobilePhone
    });
  }
}
```

### 4.4.2 Event-Driven Communication

Event-driven communication enables loose coupling between bounded contexts while maintaining consistency.

```typescript
// core/shared/domain/events/event-publisher.ts
// Domain Layer - Event Publisher
interface DomainEventPublisher {
  publish(event: DomainEvent): void;
  publishAll(events: DomainEvent[]): void;
}

// core/shared/infrastructure/events/in-memory-event-bus.ts
// Infrastructure Layer - Event Bus Implementation
class InMemoryEventBus implements DomainEventPublisher {
  private subscribers: Map<string, Function[]> = new Map();

  public subscribe<T extends DomainEvent>(eventType: string, handler: (event: T) => void): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType)!.push(handler);
  }

  public publish(event: DomainEvent): void {
    const eventType = event.constructor.name;
    const handlers = this.subscribers.get(eventType) || [];
    handlers.forEach(handler => handler(event));
  }

  public publishAll(events: DomainEvent[]): void {
    events.forEach(event => this.publish(event));
  }
}
```

## 4.5 Implementation Structure

The implementation follows a clear structure that maintains separation of concerns:

```text
bounded-context/
├── domain/                    # Pure domain logic
│   ├── entities/              # Domain entities and aggregates
│   ├── value-objects/         # Immutable value objects
│   ├── services/              # Domain services
│   ├── events/                # Domain events
│   ├── repositories/          # Repository interfaces (ports)
│   └── index.ts               # Public domain interface
├── application/               # Use cases and application services
│   ├── commands/              # Command objects
│   ├── queries/               # Query objects
│   ├── handlers/              # Command/query handlers
│   ├── services/              # Application services
│   ├── ports/                 # Application service interfaces
│   └── index.ts               # Public application interface
└── infrastructure/            # Technology-specific implementations
    ├── adapters/              # Adapter implementations
    ├── repositories/          # Repository implementations
    └── index.ts               # Public infrastructure interface
```

## 4.6 Key Benefits of This Approach

1. **Domain Purity**: Business logic is isolated from technical concerns
2. **Testability**: Domain logic can be tested in isolation
3. **Flexibility**: Easy to swap infrastructure implementations
4. **Maintainability**: Clear boundaries make code easier to understand and modify
5. **Scalability**: Can evolve from modular monolith to microservices
6. **Team Autonomy**: Different teams can work on different bounded contexts

This tactical implementation demonstrates how DDD and Hexagonal Architecture patterns work together to create a maintainable, testable, and scalable system that truly reflects the business domain.
