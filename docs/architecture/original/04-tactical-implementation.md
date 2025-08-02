# Section 4: Tactical Implementation—DDD and Hexagonal Architecture Patterns

## 4.1 Aggregate Implementation Patterns

### Reservation Aggregate Root

```typescript
// core/reservations/domain/aggregates/reservation.aggregate.ts
export class ReservationAggregate extends AggregateRoot {
  private constructor(
    private readonly id: ReservationId,
    private guestInfo: GuestInfo,
    private dateRange: DateRange,
    private roomBookings: RoomBooking[],
    private status: ReservationStatus,
    private totalAmount: Money,
    private confirmationNumber?: ConfirmationNumber
  ) {
    super();
  }

  public static create(
    guestInfo: GuestInfo,
    dateRange: DateRange,
    roomBookings: RoomBooking[]
  ): ReservationAggregate {
    const reservation = new ReservationAggregate(
      ReservationId.generate(),
      guestInfo,
      dateRange,
      roomBookings,
      ReservationStatus.PENDING,
      Money.zero()
    );

    reservation.addDomainEvent(
      new ReservationCreatedEvent(
        reservation.id,
        guestInfo.guestId,
        dateRange,
        roomBookings
      )
    );

    return reservation;
  }

  public confirm(paymentReference: PaymentReference): void {
    // Business invariant: Only pending reservations can be confirmed
    if (!this.status.isPending()) {
      throw new DomainException('Only pending reservations can be confirmed');
    }

    // Business rule: Payment must be provided
    if (!paymentReference) {
      throw new DomainException('Payment reference required for confirmation');
    }

    this.status = ReservationStatus.CONFIRMED;
    this.confirmationNumber = ConfirmationNumber.generate();

    this.addDomainEvent(
      new ReservationConfirmedEvent(
        this.id,
        this.confirmationNumber,
        paymentReference
      )
    );
  }

  public cancel(reason: CancellationReason): void {
    // Business rule: Cannot cancel already cancelled reservations
    if (this.status.isCancelled()) {
      throw new DomainException('Reservation is already cancelled');
    }

    // Business rule: Cannot cancel completed stays
    if (this.status.isCompleted()) {
      throw new DomainException('Cannot cancel completed reservations');
    }

    this.status = ReservationStatus.CANCELLED;

    this.addDomainEvent(
      new ReservationCancelledEvent(
        this.id,
        reason,
        this.dateRange,
        this.roomBookings
      )
    );
  }

  public calculateTotal(rateCalculator: RateCalculatorService): void {
    this.totalAmount = rateCalculator.calculate(
      this.dateRange,
      this.roomBookings
    );

    this.addDomainEvent(
      new ReservationTotalCalculatedEvent(this.id, this.totalAmount)
    );
  }

  // Business query methods
  public canBeModified(): boolean {
    return this.status.isPending() || this.status.isConfirmed();
  }

  public requiresPayment(): boolean {
    return this.status.isPending() && this.totalAmount.isPositive();
  }

  public isWithinCancellationPeriod(): boolean {
    const now = new Date();
    const checkIn = this.dateRange.checkInDate;
    const hoursDifference = (checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursDifference >= 24; // 24-hour cancellation policy
  }

  // Getters
  public getId(): ReservationId { return this.id; }
  public getStatus(): ReservationStatus { return this.status; }
  public getDateRange(): DateRange { return this.dateRange; }
  public getTotalAmount(): Money { return this.totalAmount; }
  public getConfirmationNumber(): ConfirmationNumber | undefined {
    return this.confirmationNumber;
  }
}
```

### Value Object Implementations

```typescript
// core/shared/domain/value-objects/money.vo.ts
export class Money extends ValueObject<{
  amount: number;
  currency: Currency;
}> {
  constructor(amount: number, currency: Currency = Currency.USD) {
    if (amount < 0) {
      throw new ValidationException('Money amount cannot be negative');
    }
    super({ amount, currency });
  }

  public static zero(currency: Currency = Currency.USD): Money {
    return new Money(0, currency);
  }

  public add(other: Money): Money {
    this.ensureSameCurrency(other);
    return new Money(this.props.amount + other.props.amount, this.props.currency);
  }

  public subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    const result = this.props.amount - other.props.amount;
    if (result < 0) {
      throw new DomainException('Insufficient funds');
    }
    return new Money(result, this.props.currency);
  }

  public multiply(factor: number): Money {
    return new Money(this.props.amount * factor, this.props.currency);
  }

  public isPositive(): boolean {
    return this.props.amount > 0;
  }

  public isZero(): boolean {
    return this.props.amount === 0;
  }

  public toCents(): number {
    return Math.round(this.props.amount * 100);
  }

  private ensureSameCurrency(other: Money): void {
    if (this.props.currency !== other.props.currency) {
      throw new DomainException('Cannot operate on different currencies');
    }
  }

  public get amount(): number { return this.props.amount; }
  public get currency(): Currency { return this.props.currency; }
}

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP'
}
```

```typescript
// core/reservations/domain/value-objects/date-range.vo.ts
export class DateRange extends ValueObject<{
  checkInDate: Date;
  checkOutDate: Date;
}> {
  constructor(checkInDate: Date, checkOutDate: Date) {
    if (checkInDate >= checkOutDate) {
      throw new ValidationException('Check-out date must be after check-in date');
    }

    if (checkInDate < new Date()) {
      throw new ValidationException('Check-in date cannot be in the past');
    }

    super({ checkInDate, checkOutDate });
  }

  public getNumberOfNights(): number {
    const timeDiff = this.props.checkOutDate.getTime() - this.props.checkInDate.getTime();
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  }

  public overlapsWith(other: DateRange): boolean {
    return this.props.checkInDate < other.props.checkOutDate &&
           this.props.checkOutDate > other.props.checkInDate;
  }

  public includes(date: Date): boolean {
    return date >= this.props.checkInDate && date < this.props.checkOutDate;
  }

  public extendCheckOut(newCheckOutDate: Date): DateRange {
    if (newCheckOutDate <= this.props.checkInDate) {
      throw new ValidationException('New check-out date must be after check-in');
    }
    return new DateRange(this.props.checkInDate, newCheckOutDate);
  }

  public get checkInDate(): Date { return this.props.checkInDate; }
  public get checkOutDate(): Date { return this.props.checkOutDate; }
}
```

## 4.2 Domain Service Implementations

### Booking Policy Service

```typescript
// core/reservations/domain/domain-services/booking-policy.service.ts
export class BookingPolicyService {
  constructor(
    private readonly minimumStayPolicy: MinimumStayPolicy,
    private readonly advanceBookingPolicy: AdvanceBookingPolicy,
    private readonly blackoutDatePolicy: BlackoutDatePolicy
  ) {}

  public async validateBooking(
    dateRange: DateRange,
    roomBookings: RoomBooking[],
    guestInfo: GuestInfo
  ): Promise<PolicyValidationResult> {
    const results: PolicyValidationResult[] = [];

    // Check minimum stay requirement
    results.push(this.minimumStayPolicy.validate(dateRange, roomBookings));

    // Check advance booking limits
    results.push(this.advanceBookingPolicy.validate(dateRange));

    // Check blackout dates
    results.push(await this.blackoutDatePolicy.validate(dateRange));

    // Combine all results
    const failedResults = results.filter(r => !r.isValid);
    if (failedResults.length > 0) {
      return PolicyValidationResult.failed(
        failedResults.map(r => r.reason).join('; ')
      );
    }

    return PolicyValidationResult.success();
  }

  public calculateCancellationPenalty(
    reservation: ReservationAggregate,
    cancellationDate: Date
  ): Money {
    const daysBefore = this.calculateDaysBeforeCheckIn(
      cancellationDate,
      reservation.getDateRange().checkInDate
    );

    // Cancellation policy:
    // - More than 7 days: no penalty
    // - 3-7 days: 50% penalty
    // - Less than 3 days: 100% penalty
    if (daysBefore >= 7) {
      return Money.zero();
    } else if (daysBefore >= 3) {
      return reservation.getTotalAmount().multiply(0.5);
    } else {
      return reservation.getTotalAmount();
    }
  }

  private calculateDaysBeforeCheckIn(cancellationDate: Date, checkInDate: Date): number {
    const timeDiff = checkInDate.getTime() - cancellationDate.getTime();
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  }
}
```

## 4.3 Use Case Implementation Pattern

### Create Reservation Use Case

```typescript
// core/reservations/application/use-cases/create-reservation/create-reservation.use-case.ts
export class CreateReservationUseCase implements UseCase<CreateReservationRequest, CreateReservationResponse> {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly roomAvailabilityPort: RoomAvailabilityPort,
    private readonly bookingPolicyService: BookingPolicyService,
    private readonly rateCalculatorService: RateCalculatorService,
    private readonly eventBus: DomainEventBus
  ) {}

  async execute(request: CreateReservationRequest): Promise<CreateReservationResponse> {
    // 1. Validate input
    this.validateRequest(request);

    // 2. Create domain objects
    const guestInfo = new GuestInfo(
      new GuestId(request.guestId),
      request.guestName,
      new Email(request.guestEmail),
      new Phone(request.guestPhone)
    );

    const dateRange = new DateRange(
      new Date(request.checkInDate),
      new Date(request.checkOutDate)
    );

    const roomBookings = request.roomRequests.map(req =>
      new RoomBooking(
        new RoomTypeId(req.roomTypeId),
        req.quantity,
        req.specialRequests
      )
    );

    // 3. Check business rules
    const policyValidation = await this.bookingPolicyService.validateBooking(
      dateRange,
      roomBookings,
      guestInfo
    );

    if (!policyValidation.isValid) {
      throw new BusinessRuleViolationException(policyValidation.reason);
    }

    // 4. Check room availability
    const availabilityCheck = await this.roomAvailabilityPort.checkAvailability(
      dateRange,
      roomBookings
    );

    if (!availabilityCheck.isAvailable) {
      throw new RoomsNotAvailableException(
        `Requested rooms not available for ${dateRange.checkInDate} to ${dateRange.checkOutDate}`
      );
    }

    // 5. Create reservation aggregate
    const reservation = ReservationAggregate.create(
      guestInfo,
      dateRange,
      roomBookings
    );

    // 6. Calculate pricing
    reservation.calculateTotal(this.rateCalculatorService);

    // 7. Reserve rooms (hold inventory)
    await this.roomAvailabilityPort.holdRooms(
      dateRange,
      roomBookings,
      reservation.getId(),
      this.getHoldExpirationTime()
    );

    // 8. Persist reservation
    await this.reservationRepository.save(reservation);

    // 9. Publish domain events
    await this.eventBus.publishEvents(reservation.getUncommittedEvents());
    reservation.markEventsAsCommitted();

    return new CreateReservationResponse(
      reservation.getId().value,
      reservation.getTotalAmount(),
      this.getHoldExpirationTime()
    );
  }

  private validateRequest(request: CreateReservationRequest): void {
    if (!request.guestId || !request.guestName || !request.guestEmail) {
      throw new ValidationException('Guest information is required');
    }

    if (!request.checkInDate || !request.checkOutDate) {
      throw new ValidationException('Check-in and check-out dates are required');
    }

    if (!request.roomRequests || request.roomRequests.length === 0) {
      throw new ValidationException('At least one room must be requested');
    }
  }

  private getHoldExpirationTime(): Date {
    // Hold rooms for 15 minutes
    return new Date(Date.now() + 15 * 60 * 1000);
  }
}

// DTOs
export interface CreateReservationRequest {
  guestId: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  checkInDate: string;
  checkOutDate: string;
  roomRequests: RoomRequest[];
}

export interface RoomRequest {
  roomTypeId: string;
  quantity: number;
  specialRequests?: string;
}

export class CreateReservationResponse {
  constructor(
    public readonly reservationId: string,
    public readonly totalAmount: Money,
    public readonly holdExpiresAt: Date
  ) {}
}
```

## 4.4 Specification Pattern Implementation

### Business Rule Specifications

```typescript
// core/reservations/domain/specifications/can-book.specification.ts
export class CanBookSpecification extends CompositeSpecification<BookingContext> {
  constructor(
    private readonly minimumStaySpec: MinimumStaySpecification,
    private readonly advanceBookingSpec: AdvanceBookingSpecification,
    private readonly blackoutDateSpec: BlackoutDateSpecification
  ) {
    super();
  }

  public isSatisfiedBy(context: BookingContext): boolean {
    return this.minimumStaySpec.isSatisfiedBy(context) &&
           this.advanceBookingSpec.isSatisfiedBy(context) &&
           this.blackoutDateSpec.isSatisfiedBy(context);
  }

  public getFailureReason(context: BookingContext): string {
    const reasons: string[] = [];

    if (!this.minimumStaySpec.isSatisfiedBy(context)) {
      reasons.push(this.minimumStaySpec.getFailureReason(context));
    }

    if (!this.advanceBookingSpec.isSatisfiedBy(context)) {
      reasons.push(this.advanceBookingSpec.getFailureReason(context));
    }

    if (!this.blackoutDateSpec.isSatisfiedBy(context)) {
      reasons.push(this.blackoutDateSpec.getFailureReason(context));
    }

    return reasons.join('; ');
  }
}

// Individual specifications
export class MinimumStaySpecification extends Specification<BookingContext> {
  public isSatisfiedBy(context: BookingContext): boolean {
    const nights = context.dateRange.getNumberOfNights();
    const minimumNights = this.getMinimumNightsForRoomTypes(context.roomBookings);
    return nights >= minimumNights;
  }

  public getFailureReason(context: BookingContext): string {
    const minimumNights = this.getMinimumNightsForRoomTypes(context.roomBookings);
    return `Minimum stay of ${minimumNights} nights required`;
  }

  private getMinimumNightsForRoomTypes(roomBookings: RoomBooking[]): number {
    // Business logic: different room types may have different minimum stays
    return Math.max(...roomBookings.map(booking =>
      this.getMinimumNightsForRoomType(booking.roomTypeId)
    ));
  }

  private getMinimumNightsForRoomType(roomTypeId: RoomTypeId): number {
    // This could be configurable or come from room type settings
    return 1; // Default minimum stay
  }
}

export interface BookingContext {
  dateRange: DateRange;
  roomBookings: RoomBooking[];
  guestInfo: GuestInfo;
}
```

## 4.5 Event-Driven Integration Patterns

### Integration Events

```typescript
// packages/events/integration-events/reservation-events.ts
export class ReservationConfirmedIntegrationEvent extends IntegrationEvent {
  constructor(
    public readonly reservationId: string,
    public readonly guestId: string,
    public readonly guestEmail: string,
    public readonly confirmationNumber: string,
    public readonly totalAmount: number,
    public readonly currency: string,
    public readonly checkInDate: Date,
    public readonly checkOutDate: Date,
    public readonly roomBookings: IntegrationRoomBooking[]
  ) {
    super('ReservationConfirmed', 1);
  }
}

export class ReservationCancelledIntegrationEvent extends IntegrationEvent {
  constructor(
    public readonly reservationId: string,
    public readonly guestId: string,
    public readonly cancellationReason: string,
    public readonly refundAmount: number,
    public readonly currency: string,
    public readonly roomBookings: IntegrationRoomBooking[]
  ) {
    super('ReservationCancelled', 1);
  }
}

export interface IntegrationRoomBooking {
  roomTypeId: string;
  quantity: number;
  checkInDate: Date;
  checkOutDate: Date;
}
```

### Event Handlers

```typescript
// core/billing/application/event-handlers/reservation-confirmed.handler.ts
export class ReservationConfirmedHandler {
  constructor(
    private readonly processPaymentUseCase: ProcessPaymentUseCase
  ) {}

  async handle(event: ReservationConfirmedIntegrationEvent): Promise<void> {
    try {
      await this.processPaymentUseCase.execute({
        reservationId: event.reservationId,
        amount: event.totalAmount,
        currency: event.currency,
        guestId: event.guestId,
        description: `Payment for reservation ${event.confirmationNumber}`
      });
    } catch (error) {
      // Log error and potentially trigger compensation
      console.error('Failed to process payment for reservation:', error);
      // Could publish PaymentFailedEvent for compensation
    }
  }
}

// core/notifications/application/event-handlers/send-confirmation-email.handler.ts
export class SendConfirmationEmailHandler {
  constructor(
    private readonly sendEmailUseCase: SendEmailUseCase,
    private readonly emailTemplateService: EmailTemplateService
  ) {}

  async handle(event: ReservationConfirmedIntegrationEvent): Promise<void> {
    const emailContent = await this.emailTemplateService.generateConfirmationEmail({
      guestName: event.guestId, // Would need to lookup actual name
      confirmationNumber: event.confirmationNumber,
      checkInDate: event.checkInDate,
      checkOutDate: event.checkOutDate,
      totalAmount: event.totalAmount,
      currency: event.currency
    });

    await this.sendEmailUseCase.execute({
      to: event.guestEmail,
      subject: `Booking Confirmation - ${event.confirmationNumber}`,
      htmlContent: emailContent
    });
  }
}
```

### Event Bus Implementation

```typescript
// packages/events/implementations/in-memory-event-bus.ts
export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private readonly logger = new Logger('EventBus');

  async publish<T extends IntegrationEvent>(event: T): Promise<void> {
    const eventType = event.eventType;
    const eventHandlers = this.handlers.get(eventType) || [];

    this.logger.info(`Publishing event ${eventType} with ${eventHandlers.length} handlers`);

    // Execute handlers in parallel with error isolation
    const promises = eventHandlers.map(async (handler) => {
      try {
        await handler.handle(event);
      } catch (error) {
        this.logger.error(`Handler failed for event ${eventType}:`, error);
        // In production, you might want to implement retry logic or dead letter queue
      }
    });

    await Promise.allSettled(promises);
  }

  subscribe<T extends IntegrationEvent>(
    eventType: string,
    handler: EventHandler<T>
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    this.handlers.get(eventType)!.push(handler);
    this.logger.info(`Subscribed handler to event ${eventType}`);
  }

  // For testing purposes
  getHandlerCount(eventType: string): number {
    return this.handlers.get(eventType)?.length || 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface EventHandler<T extends IntegrationEvent = IntegrationEvent> {
  handle(event: T): Promise<void>;
}
```

## 4.6 Repository Implementation Patterns

### Repository Interface (Port)

```typescript
// core/reservations/domain/repositories/reservation.repository.ts
export interface ReservationRepository {
  findById(id: ReservationId): Promise<ReservationAggregate | null>;
  findByGuestId(guestId: GuestId): Promise<ReservationAggregate[]>;
  findByConfirmationNumber(confirmationNumber: ConfirmationNumber): Promise<ReservationAggregate | null>;
  findByDateRange(dateRange: DateRange): Promise<ReservationAggregate[]>;
  save(reservation: ReservationAggregate): Promise<void>;
  delete(reservation: ReservationAggregate): Promise<void>;
}
```

### Repository Implementation (Adapter)

```typescript
// core/reservations/infrastructure/persistence/reservation.repository.impl.ts
export class DrizzleReservationRepository implements ReservationRepository {
  constructor(
    private readonly db: DrizzleDatabase,
    private readonly eventStore: EventStore
  ) {}

  async findById(id: ReservationId): Promise<ReservationAggregate | null> {
    const events = await this.eventStore.getEvents(id.value, 'Reservation');

    if (events.length === 0) {
      return null;
    }

    return this.rehydrateFromEvents(events);
  }

  async findByConfirmationNumber(
    confirmationNumber: ConfirmationNumber
  ): Promise<ReservationAggregate | null> {
    // Query projection table for performance
    const projection = await this.db
      .select()
      .from(reservationProjections)
      .where(eq(reservationProjections.confirmationNumber, confirmationNumber.value))
      .limit(1);

    if (projection.length === 0) {
      return null;
    }

    return this.findById(new ReservationId(projection[0].id));
  }

  async save(reservation: ReservationAggregate): Promise<void> {
    const uncommittedEvents = reservation.getUncommittedEvents();

    if (uncommittedEvents.length === 0) {
      return;
    }

    // Save events to event store
    await this.eventStore.saveEvents(
      reservation.getId().value,
      'Reservation',
      uncommittedEvents,
      reservation.getVersion()
    );

    // Update projection
    await this.updateProjection(reservation);

    reservation.markEventsAsCommitted();
  }

  private async updateProjection(reservation: ReservationAggregate): Promise<void> {
    const projectionData = {
      id: reservation.getId().value,
      guestId: reservation.getGuestInfo().guestId.value,
      status: reservation.getStatus().value,
      checkInDate: reservation.getDateRange().checkInDate,
      checkOutDate: reservation.getDateRange().checkOutDate,
      totalAmount: reservation.getTotalAmount().amount,
      currency: reservation.getTotalAmount().currency,
      confirmationNumber: reservation.getConfirmationNumber()?.value,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.db
      .insert(reservationProjections)
      .values(projectionData)
      .onConflictDoUpdate({
        target: reservationProjections.id,
        set: {
          status: projectionData.status,
          totalAmount: projectionData.totalAmount,
          confirmationNumber: projectionData.confirmationNumber,
          updatedAt: projectionData.updatedAt
        }
      });
  }

  private rehydrateFromEvents(events: DomainEvent[]): ReservationAggregate {
    // Replay events to rebuild aggregate state
    // This is a simplified version - in production you'd want more sophisticated event sourcing
    const firstEvent = events[0] as ReservationCreatedEvent;

    const reservation = ReservationAggregate.fromSnapshot({
      id: new ReservationId(firstEvent.aggregateId),
      guestInfo: firstEvent.guestInfo,
      dateRange: firstEvent.dateRange,
      roomBookings: firstEvent.roomBookings,
      status: ReservationStatus.PENDING,
      totalAmount: Money.zero()
    });

    // Apply subsequent events
    events.slice(1).forEach(event => {
      reservation.applyEvent(event);
    });

    return reservation;
  }
}
```

## 4.7 External Service Adapter Patterns

### Stripe Payment Adapter

```typescript
// packages/adapters/stripe/stripe.adapter.ts
export class StripePaymentAdapter implements PaymentGatewayPort {
  constructor(
    private readonly stripe: Stripe,
    private readonly logger: Logger
  ) {}

  async createPaymentIntent(request: CreatePaymentIntentRequest): Promise<PaymentIntentResult> {
    try {
      const stripeIntent = await this.stripe.paymentIntents.create({
        amount: request.amount.toCents(),
        currency: request.amount.currency.toLowerCase(),
        metadata: {
          reservationId: request.reservationId,
          guestId: request.guestId,
          hotelBooking: 'true'
        },
        description: request.description
      });

      return PaymentIntentResult.success({
        paymentIntentId: stripeIntent.id,
        clientSecret: stripeIntent.client_secret!,
        status: this.mapStripeStatus(stripeIntent.status)
      });

    } catch (error) {
      this.logger.error('Failed to create Stripe payment intent:', error);
      return PaymentIntentResult.failure('Failed to create payment intent');
    }
  }

  async confirmPayment(paymentIntentId: string): Promise<PaymentConfirmationResult> {
    try {
      const stripeIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

      return PaymentConfirmationResult.fromStripeStatus(
        stripeIntent.status,
        stripeIntent.charges.data[0]?.id
      );

    } catch (error) {
      this.logger.error('Failed to confirm payment:', error);
      return PaymentConfirmationResult.failure('Payment confirmation failed');
    }
  }

  async processRefund(request: ProcessRefundRequest): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: request.paymentIntentId,
        amount: request.refundAmount.toCents(),
        reason: this.mapRefundReason(request.reason),
        metadata: {
          reservationId: request.reservationId,
          refundType: request.reason
        }
      });

      return RefundResult.success({
        refundId: refund.id,
        amount: Money.fromCents(refund.amount, request.refundAmount.currency),
        status: this.mapRefundStatus(refund.status)
      });

    } catch (error) {
      this.logger.error('Failed to process refund:', error);
      return RefundResult.failure('Refund processing failed');
    }
  }

  async handleWebhook(
    payload: string,
    signature: string,
    secret: string
  ): Promise<WebhookHandleResult> {
    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, secret);

      const webhookEvent = this.mapWebhookEvent(event);
      return WebhookHandleResult.success(webhookEvent);

    } catch (error) {
      this.logger.error('Webhook signature verification failed:', error);
      return WebhookHandleResult.failure('Invalid webhook signature');
    }
  }

  private mapStripeStatus(stripeStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'requires_payment_method': PaymentStatus.PENDING,
      'requires_confirmation': PaymentStatus.PENDING,
      'requires_action': PaymentStatus.REQUIRES_ACTION,
      'processing': PaymentStatus.PROCESSING,
      'succeeded': PaymentStatus.SUCCEEDED,
      'canceled': PaymentStatus.CANCELED
    };

    return statusMap[stripeStatus] || PaymentStatus.UNKNOWN;
  }

  private mapRefundReason(reason: RefundReason): Stripe.RefundCreateParams.Reason {
    const reasonMap: Record<RefundReason, Stripe.RefundCreateParams.Reason> = {
      [RefundReason.CUSTOMER_REQUEST]: 'requested_by_customer',
      [RefundReason.DUPLICATE]: 'duplicate',
      [RefundReason.FRAUDULENT]: 'fraudulent'
    };

    return reasonMap[reason] || 'requested_by_customer';
  }
}
```

## 4.8 API Layer Implementation

### tRPC Router Implementation

```typescript
// packages/api/routers/reservations.router.ts
export const reservationsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createReservationSchema)
    .mutation(async ({ input, ctx }) => {
      const useCase = container.get<CreateReservationUseCase>('CreateReservationUseCase');

      try {
        const result = await useCase.execute({
          guestId: ctx.user.id,
          guestName: input.guestName,
          guestEmail: ctx.user.email,
          guestPhone: input.guestPhone,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          roomRequests: input.roomRequests
        });

        return {
          success: true,
          data: {
            reservationId: result.reservationId,
            totalAmount: result.totalAmount.amount,
            currency: result.totalAmount.currency,
            holdExpiresAt: result.holdExpiresAt
          }
        };
      } catch (error) {
        if (error instanceof BusinessRuleViolationException) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message
          });
        }

        if (error instanceof RoomsNotAvailableException) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Selected rooms are not available'
          });
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create reservation'
        });
      }
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const queryService = container.get<ReservationQueryService>('ReservationQueryService');

      const reservation = await queryService.getReservationById(input.id);

      if (!reservation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Reservation not found'
        });
      }

      // Authorization check
      if (reservation.guestId !== ctx.user.id && !ctx.user.hasRole('ADMIN')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied'
        });
      }

      return reservation;
    }),

  cancel: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const useCase = container.get<CancelReservationUseCase>('CancelReservationUseCase');

      await useCase.execute({
        reservationId: input.id,
        cancellationReason: input.reason || 'Guest requested cancellation',
        requestedBy: ctx.user.id
      });

      return { success: true };
    })
});

// Zod schemas for validation
const createReservationSchema = z.object({
  guestName: z.string().min(1, 'Guest name is required'),
  guestPhone: z.string().optional(),
  checkInDate: z.string().datetime(),
  checkOutDate: z.string().datetime(),
  roomRequests: z.array(z.object({
    roomTypeId: z.string().uuid(),
    quantity: z.number().positive(),
    specialRequests: z.string().optional()
  })).min(1, 'At least one room must be requested')
});
```

## 4.9 Dependency Injection Setup

### Container Configuration

```typescript
// packages/config/container.ts
export class DIContainer {
  private container = new Container();

  constructor() {
    this.setupBindings();
  }

  private setupBindings(): void {
    // Infrastructure
    this.container.bind<DrizzleDatabase>('Database').to(DatabaseConnection);
    this.container.bind<EventBus>('EventBus').to(InMemoryEventBus).inSingletonScope();
    this.container.bind<PaymentGatewayPort>('PaymentGateway').to(StripePaymentAdapter);
    this.container.bind<EmailServicePort>('EmailService').to(ResendEmailAdapter);

    // Repositories
    this.container.bind<ReservationRepository>('ReservationRepository')
      .to(DrizzleReservationRepository);
    this.container.bind<RoomTypeRepository>('RoomTypeRepository')
      .to(DrizzleRoomTypeRepository);

    // Domain Services
    this.container.bind<BookingPolicyService>('BookingPolicyService')
      .to(BookingPolicyService);
    this.container.bind<RateCalculatorService>('RateCalculatorService')
      .to(RateCalculatorService);

    // Use Cases
    this.container.bind<CreateReservationUseCase>('CreateReservationUseCase')
      .to(CreateReservationUseCase);
    this.container.bind<ConfirmReservationUseCase>('ConfirmReservationUseCase')
      .to(ConfirmReservationUseCase);

    // Event Handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    const eventBus = this.container.get<EventBus>('EventBus');

    // Billing context handlers
    eventBus.subscribe(
      'ReservationConfirmed',
      this.container.get<ReservationConfirmedHandler>('ReservationConfirmedHandler')
    );

    // Notification context handlers
    eventBus.subscribe(
      'ReservationConfirmed',
      this.container.get<SendConfirmationEmailHandler>('SendConfirmationEmailHandler')
    );
  }

  get<T>(identifier: string): T {
    return this.container.get<T>(identifier);
  }
}

export const container = new DIContainer();
```

## 4.10 Testing Strategy

### Domain Testing

```typescript
// core/reservations/domain/__tests__/reservation.aggregate.test.ts
describe('ReservationAggregate', () => {
  let guestInfo: GuestInfo;
  let dateRange: DateRange;
  let roomBookings: RoomBooking[];

  beforeEach(() => {
    guestInfo = new GuestInfo(
      new GuestId('guest-123'),
      'John Doe',
      new Email('john@example.com'),
      new Phone('+1234567890')
    );

    dateRange = new DateRange(
      new Date('2024-12-01'),
      new Date('2024-12-03')
    );

    roomBookings = [
      new RoomBooking(new RoomTypeId('deluxe-king'), 1)
    ];
  });

  describe('create', () => {
    it('should create a new reservation with PENDING status', () => {
      const reservation = ReservationAggregate.create(
        guestInfo,
        dateRange,
        roomBookings
      );

      expect(reservation.getStatus().isPending()).toBe(true);
      expect(reservation.getUncommittedEvents()).toHaveLength(1);
      expect(reservation.getUncommittedEvents()[0]).toBeInstanceOf(ReservationCreatedEvent);
    });
  });

  describe('confirm', () => {
    it('should confirm a pending reservation', () => {
      const reservation = ReservationAggregate.create(guestInfo, dateRange, roomBookings);
      const paymentReference = new PaymentReference('pay_123');

      reservation.confirm(paymentReference);

      expect(reservation.getStatus().isConfirmed()).toBe(true);
      expect(reservation.getConfirmationNumber()).toBeDefined();
      expect(reservation.getUncommittedEvents()).toHaveLength(2);
    });

    it('should throw error when confirming non-pending reservation', () => {
      const reservation = ReservationAggregate.create(guestInfo, dateRange, roomBookings);
      reservation.confirm(new PaymentReference('pay_123'));

      expect(() => {
        reservation.confirm(new PaymentReference('pay_456'));
      }).toThrow('Only pending reservations can be confirmed');
    });
  });
});
```

### Use Case Testing

```typescript
// core/reservations/application/__tests__/create-reservation.use-case.test.ts
describe('CreateReservationUseCase', () => {
  let useCase: CreateReservationUseCase;
  let mockReservationRepo: jest.Mocked<ReservationRepository>;
  let mockRoomAvailability: jest.Mocked<RoomAvailabilityPort>;
  let mockBookingPolicy: jest.Mocked<BookingPolicyService>;
  let mockRateCalculator: jest.Mocked<RateCalculatorService>;
  let mockEventBus: jest.Mocked<DomainEventBus>;

  beforeEach(() => {
    mockReservationRepo = createMock<ReservationRepository>();
    mockRoomAvailability = createMock<RoomAvailabilityPort>();
    mockBookingPolicy = createMock<BookingPolicyService>();
    mockRateCalculator = createMock<RateCalculatorService>();
    mockEventBus = createMock<DomainEventBus>();

    useCase = new CreateReservationUseCase(
      mockReservationRepo,
      mockRoomAvailability,
      mockBookingPolicy,
      mockRateCalculator,
      mockEventBus
    );
  });

  it('should create reservation when all validations pass', async () => {
    // Arrange
    const request: CreateReservationRequest = {
      guestId: 'guest-123',
      guestName: 'John Doe',
      guestEmail: 'john@example.com',
      checkInDate: '2024-12-01T15:00:00Z',
      checkOutDate: '2024-12-03T11:00:00Z',
      roomRequests: [{
        roomTypeId: 'deluxe-king',
        quantity: 1
      }]
    };

    mockBookingPolicy.validateBooking.mockResolvedValue(PolicyValidationResult.success());
    mockRoomAvailability.checkAvailability.mockResolvedValue({ isAvailable: true });
    mockRateCalculator.calculate.mockReturnValue(new Money(200));

    // Act
    const result = await useCase.execute(request);

    // Assert
    expect(result.reservationId).toBeDefined();
    expect(mockReservationRepo.save).toHaveBeenCalledTimes(1);
    expect(mockEventBus.publishEvents).toHaveBeenCalledTimes(1);
  });

  it('should throw RoomsNotAvailableException when rooms are not available', async () => {
    // Arrange
    const request: CreateReservationRequest = {
      guestId: 'guest-123',
      guestName: 'John Doe',
      guestEmail: 'john@example.com',
      checkInDate: '2024-12-01T15:00:00Z',
      checkOutDate: '2024-12-03T11:00:00Z',
      roomRequests: [{
        roomTypeId: 'deluxe-king',
        quantity: 1
      }]
    };

    mockBookingPolicy.validateBooking.mockResolvedValue(PolicyValidationResult.success());
    mockRoomAvailability.checkAvailability.mockResolvedValue({ isAvailable: false });

    // Act & Assert
    await expect(useCase.execute(request)).rejects.toThrow(RoomsNotAvailableException);
    expect(mockReservationRepo.save).not.toHaveBeenCalled();
  });
});
```
