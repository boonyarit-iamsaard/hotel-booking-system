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
```
