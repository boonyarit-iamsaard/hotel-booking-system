# 4. Tactical Implementation - DDD Patterns in Go

## 4.1 Core DDD Tactical Patterns in Go

### 4.1.1 Advanced Entity Implementation

```go
// internal/shared/domain/entity.go
package domain

import (
    "reflect"
    "time"
)

// Entity represents a domain entity with identity
type Entity struct {
    id        string
    version   int       // ADD this field
    createdAt time.Time
    updatedAt time.Time
    events    []Event
}

// NewEntity creates a new entity
func NewEntity(id string) *Entity {
    now := time.Now()
    return &Entity{
        id:        id,
        createdAt: now,
        updatedAt: now,
        events:    make([]Event, 0),
    }
}

// ID returns the entity ID
func (e *Entity) ID() string {
    return e.id
}

// CreatedAt returns the creation time
func (e *Entity) CreatedAt() time.Time {
    return e.createdAt
}

// UpdatedAt returns the last update time
func (e *Entity) UpdatedAt() time.Time {
    return e.updatedAt
}

// AddEvent adds a domain event
func (e *Entity) AddEvent(event Event) {
    e.events = append(e.events, event)
}

// GetEvents returns and clears domain events
func (e *Entity) GetEvents() []Event {
    events := make([]Event, len(e.events))
    copy(events, e.events)
    e.events = e.events[:0]
    return events
}

// Equals compares two entities by ID
func (e *Entity) Equals(other *Entity) bool {
    if other == nil {
        return false
    }
    return e.id == other.id
}

// Touch updates the updatedAt timestamp
func (e *Entity) Touch() {
    e.updatedAt = time.Now()
}

// ADD these methods to the existing Entity
func (e *Entity) Version() int {
    return e.version
}

func (e *Entity) IncrementVersion() {
    e.version++
    e.updatedAt = time.Now()
}

// internal/reservation/domain/entity/reservation.go - Enhanced version
package entity

import (
    "fmt"
    "time"

    "hotel-booking/internal/reservation/domain/event"
    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/shared/domain"
)

// Reservation represents a hotel reservation aggregate root
type Reservation struct {
    domain.Entity
    guestID       string
    dateRange     valueobject.DateRange
    roomBooking   valueobject.RoomBooking
    totalPrice    valueobject.Money
    status        valueobject.BookingStatus
    policyVersion int // For optimistic locking
}

// NewReservation creates a new reservation
func NewReservation(
    id string,
    guestID string,
    dateRange valueobject.DateRange,
    roomBooking valueobject.RoomBooking,
    totalPrice valueobject.Money,
) *Reservation {
    reservation := &Reservation{
        Entity:        *domain.NewEntity(id),
        guestID:       guestID,
        dateRange:     dateRange,
        roomBooking:   roomBooking,
        totalPrice:    totalPrice,
        status:        valueobject.BookingStatusPending,
        policyVersion: 1,
    }

    // Add creation event
    reservation.AddEvent(event.NewReservationCreated(
        reservation.ID(),
        guestID,
        dateRange,
        roomBooking,
    ))

    return reservation
}

// Confirm confirms the reservation following business rules
func (r *Reservation) Confirm() error {
    if r.status != valueobject.BookingStatusPending {
        return domain.NewBusinessRuleViolation(
            fmt.Sprintf("cannot confirm reservation in status %s", r.status),
        )
    }

    // Apply business rules
    if time.Now().After(r.dateRange.CheckIn()) {
        return domain.NewBusinessRuleViolation("cannot confirm past reservation")
    }

    r.status = valueobject.BookingStatusConfirmed
    r.Touch()

    // Add confirmation event
    r.AddEvent(event.NewReservationConfirmed(r.ID(), time.Now()))

    return nil
}

// Cancel cancels the reservation with business logic
func (r *Reservation) Cancel(reason string) error {
    if r.status == valueobject.BookingStatusCancelled {
        return domain.NewBusinessRuleViolation("reservation already cancelled")
    }

    if r.status == valueobject.BookingStatusCompleted {
        return domain.NewBusinessRuleViolation("cannot cancel completed reservation")
    }

    r.status = valueobject.BookingStatusCancelled
    r.Touch()

    // Add cancellation event
    r.AddEvent(event.NewReservationCancelled(r.ID(), reason, time.Now()))

    return nil
}

// UpdateGuestInfo updates guest information with validation
func (r *Reservation) UpdateGuestInfo(newGuestID string) error {
    if r.status != valueobject.BookingStatusPending {
        return domain.NewBusinessRuleViolation("can only update guest info for pending reservations")
    }

    if newGuestID == "" {
        return domain.NewValidationError("guest ID cannot be empty")
    }

    oldGuestID := r.guestID
    r.guestID = newGuestID
    r.Touch()

    // Add guest update event
    r.AddEvent(event.NewGuestInfoUpdated(r.ID(), oldGuestID, newGuestID))

    return nil
}

// ApplyDiscount applies a discount to the reservation
func (r *Reservation) ApplyDiscount(discount valueobject.Discount) error {
    if r.status != valueobject.BookingStatusPending {
        return domain.NewBusinessRuleViolation("can only apply discount to pending reservations")
    }

    discountedPrice, err := discount.Apply(r.totalPrice)
    if err != nil {
        return fmt.Errorf("failed to apply discount: %w", err)
    }

    originalPrice := r.totalPrice
    r.totalPrice = discountedPrice
    r.Touch()

    // Add discount event
    r.AddEvent(event.NewDiscountApplied(r.ID(), originalPrice, discountedPrice, discount))

    return nil
}

// CanModify checks if the reservation can be modified
func (r *Reservation) CanModify() bool {
    return r.status == valueobject.BookingStatusPending || r.status == valueobject.BookingStatusConfirmed
}

// IsActive checks if the reservation is currently active
func (r *Reservation) IsActive() bool {
    now := time.Now()
    return r.status == valueobject.BookingStatusConfirmed &&
           now.After(r.dateRange.CheckIn()) &&
           now.Before(r.dateRange.CheckOut())
}

// DaysUntilCheckIn returns days until check-in
func (r *Reservation) DaysUntilCheckIn() int {
    days := int(time.Until(r.dateRange.CheckIn()).Hours() / 24)
    if days < 0 {
        return 0
    }
    return days
}

// Getters
func (r *Reservation) GuestID() string                        { return r.guestID }
func (r *Reservation) DateRange() valueobject.DateRange       { return r.dateRange }
func (r *Reservation) RoomBooking() valueobject.RoomBooking   { return r.roomBooking }
func (r *Reservation) TotalPrice() valueobject.Money          { return r.totalPrice }
func (r *Reservation) Status() valueobject.BookingStatus      { return r.status }
func (r *Reservation) PolicyVersion() int                     { return r.policyVersion }
```

### 4.1.2 Advanced Value Objects

```go
// internal/reservation/domain/valueobject/money.go - Enhanced version
package valueobject

import (
    "fmt"
    "math/big"
    "strings"
)

// Money represents monetary value with currency
type Money struct {
    amount   *big.Rat
    currency Currency
}

// Currency represents a currency code
type Currency string

const (
    USD Currency = "USD"
    EUR Currency = "EUR"
    GBP Currency = "GBP"
)

// NewMoney creates a new money value with validation
func NewMoney(amountCents int64, currency Currency) (Money, error) {
    if !currency.IsValid() {
        return Money{}, fmt.Errorf("invalid currency: %s", currency)
    }

    // Store as rational number for precision
    rat := big.NewRat(amountCents, 100)

    return Money{
        amount:   rat,
        currency: currency,
    }, nil
}

// Add adds two money values (same currency required)
func (m Money) Add(other Money) (Money, error) {
    if m.currency != other.currency {
        return Money{}, fmt.Errorf("cannot add different currencies: %s and %s", m.currency, other.currency)
    }

    result := new(big.Rat)
    result.Add(m.amount, other.amount)

    return Money{
        amount:   result,
        currency: m.currency,
    }, nil
}

// Subtract subtracts two money values
func (m Money) Subtract(other Money) (Money, error) {
    if m.currency != other.currency {
        return Money{}, fmt.Errorf("cannot subtract different currencies: %s and %s", m.currency, other.currency)
    }

    result := new(big.Rat)
    result.Sub(m.amount, other.amount)

    if result.Sign() < 0 {
        return Money{}, fmt.Errorf("result cannot be negative")
    }

    return Money{
        amount:   result,
        currency: m.currency,
    }, nil
}

// Multiply multiplies money by a factor
func (m Money) Multiply(factor float64) Money {
    result := new(big.Rat)
    factorRat := big.NewRat(int64(factor*10000), 10000)
    result.Mul(m.amount, factorRat)

    return Money{
        amount:   result,
        currency: m.currency,
    }
}

// GreaterThan compares if this money is greater than other
func (m Money) GreaterThan(other Money) bool {
    if m.currency != other.currency {
        return false // Cannot compare different currencies
    }
    return m.amount.Cmp(other.amount) > 0
}

// LessThan compares if this money is less than other
func (m Money) LessThan(other Money) bool {
    if m.currency != other.currency {
        return false
    }
    return m.amount.Cmp(other.amount) < 0
}

// Equals compares two money values for equality
func (m Money) Equals(other Money) bool {
    return m.currency == other.currency && m.amount.Cmp(other.amount) == 0
}

// ToFloat returns the amount as float64
func (m Money) ToFloat() float64 {
    f, _ := m.amount.Float64()
    return f
}

// String returns string representation
func (m Money) String() string {
    return fmt.Sprintf("%.2f %s", m.ToFloat(), m.currency)
}

// Getters
func (m Money) Amount() *big.Rat { return new(big.Rat).Set(m.amount) }
func (m Money) Currency() Currency { return m.currency }

// IsValid validates currency code
func (c Currency) IsValid() bool {
    validCurrencies := []Currency{USD, EUR, GBP}
    for _, valid := range validCurrencies {
        if c == valid {
            return true
        }
    }
    return false
}

// String returns currency as string
func (c Currency) String() string {
    return string(c)
}

// IsZero checks if the money amount is zero
func (m Money) IsZero() bool {
    return m.amount.Sign() == 0
}

// IsPositive checks if the money amount is positive
func (m Money) IsPositive() bool {
    return m.amount.Sign() > 0
}

// IsNegative checks if the money amount is negative
func (m Money) IsNegative() bool {
    return m.amount.Sign() < 0
}

// Percentage calculates a percentage of the money amount
func (m Money) Percentage(percent float64) Money {
    if percent < 0 || percent > 100 {
        return Money{amount: big.NewRat(0, 1), currency: m.currency}
    }

    return m.Multiply(percent / 100)
}

// Split splits money into equal parts
func (m Money) Split(parts int) ([]Money, Money) {
    if parts <= 0 {
        return nil, m
    }

    // Use integer division for cents to avoid precision loss with floats
    totalCents, _ := new(big.Int).SetString(m.amount.FloatString(0), 10)
    partCents := new(big.Int).Div(totalCents, big.NewInt(int64(parts)))
    remainderCents := new(big.Int).Mod(totalCents, big.NewInt(int64(parts)))

    result := make([]Money, parts)
    for i := 0; i < parts; i++ {
        result[i], _ = NewMoney(partCents.Int64(), m.currency)
    }

    // Distribute the remainder
    for i := 0; i < int(remainderCents.Int64()); i++ {
        oneCent, _ := NewMoney(1, m.currency)
        result[i], _ = result[i].Add(oneCent)
    }

    remainder, _ := NewMoney(remainderCents.Int64(), m.currency)
    return result, remainder
}

// ADD currency conversion support
func (m Money) ConvertTo(targetCurrency Currency, exchangeRate float64) (Money, error) {
    if exchangeRate <= 0 {
        return Money{}, fmt.Errorf("exchange rate must be positive")
    }

    convertedAmount := m.Multiply(exchangeRate)
    return Money{
        amount:   convertedAmount.amount,
        currency: targetCurrency,
    }, nil
}

// internal/reservation/domain/valueobject/discount.go
package valueobject

import (
    "fmt"
)

// DiscountType represents the type of discount
type DiscountType string

const (
    DiscountTypePercentage DiscountType = "percentage"
    DiscountTypeFixed      DiscountType = "fixed"
)

// Discount represents a discount that can be applied to a reservation
type Discount struct {
    discountType DiscountType
    value        float64
    maxAmount    *Money // Optional maximum discount amount
    minAmount    *Money // Optional minimum order amount
}

// NewPercentageDiscount creates a percentage-based discount
func NewPercentageDiscount(percentage float64, maxAmount *Money) (Discount, error) {
    if percentage < 0 || percentage > 100 {
        return Discount{}, fmt.Errorf("percentage must be between 0 and 100")
    }

    return Discount{
        discountType: DiscountTypePercentage,
        value:        percentage,
        maxAmount:    maxAmount,
    }, nil
}

// NewFixedDiscount creates a fixed amount discount
func NewFixedDiscount(amount Money, minAmount *Money) (Discount, error) {
    if amount.IsNegative() {
        return Discount{}, fmt.Errorf("discount amount cannot be negative")
    }
    return Discount{
        discountType: DiscountTypeFixed,
        value:        amount.ToFloat(), // Keep for simplicity, but logic uses fixed amount
        maxAmount:    &amount,          // Store the actual Money value here
        minAmount:    minAmount,
    }, nil
}

// Apply applies the discount to a money amount
func (d Discount) Apply(original Money) (Money, error) {
    // Check minimum amount requirement
    if d.minAmount != nil && original.LessThan(*d.minAmount) {
        return Money{}, fmt.Errorf("order amount does not meet minimum requirement")
    }

    var discountAmount Money
    var err error

    switch d.discountType {
    case DiscountTypePercentage:
        discountAmount = original.Multiply(d.value / 100)

        // Apply maximum discount limit
        if d.maxAmount != nil && discountAmount.GreaterThan(*d.maxAmount) {
            discountAmount = *d.maxAmount
        }

    case DiscountTypeFixed:
        if d.maxAmount == nil {
            return Money{}, fmt.Errorf("fixed discount amount not set")
        }
        discountAmount = *d.maxAmount

        // Cannot discount more than the original amount
        if discountAmount.GreaterThan(original) {
            discountAmount = original
        }
    }

    return original.Subtract(discountAmount)
}

// GetDiscountAmount calculates the discount amount without applying it
func (d Discount) GetDiscountAmount(original Money) (Money, error) {
    discounted, err := d.Apply(original)
    if err != nil {
        return Money{}, err
    }

    return original.Subtract(discounted)
}

// Getters
func (d Discount) Type() DiscountType { return d.discountType }
func (d Discount) Value() float64     { return d.value }
func (d Discount) MaxAmount() *Money  { return d.maxAmount }
func (d Discount) MinAmount() *Money  { return d.minAmount }
```

### 4.1.3 Domain Services

```go
// internal/reservation/domain/service/booking_policy.go
package service

import (
    "context"
    "fmt"
    "time"

    "hotel-booking/internal/reservation/domain/entity"
    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/guest/domain/entity" // Guest entity from guest context
    "hotel-booking/internal/shared/domain"
)

// BookingPolicyService enforces business rules for bookings
type BookingPolicyService struct {
    policies []BookingPolicy
}

// BookingPolicy represents a single booking policy
type BookingPolicy interface {
    Validate(ctx context.Context, reservation *entity.Reservation, guest *guestentity.Guest) error
    Name() string
}

// NewBookingPolicyService creates a new booking policy service
func NewBookingPolicyService() *BookingPolicyService {
    return &BookingPolicyService{
        policies: []BookingPolicy{
            &MinimumAdvanceBookingPolicy{minDays: 1},
            &MaximumAdvanceBookingPolicy{maxDays: 365},
            &MinimumStayPolicy{minNights: 1},
            &MaximumStayPolicy{maxNights: 30},
            &GuestValidationPolicy{},
        },
    }
}

// ValidateBooking validates a reservation against all policies
func (s *BookingPolicyService) ValidateBooking(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    for _, policy := range s.policies {
        if err := policy.Validate(ctx, reservation, guest); err != nil {
            return fmt.Errorf("policy violation (%s): %w", policy.Name(), err)
        }
    }
    return nil
}

// AddPolicy adds a new booking policy
func (s *BookingPolicyService) AddPolicy(policy BookingPolicy) {
    s.policies = append(s.policies, policy)
}

// Concrete Policy Implementations

// MinimumAdvanceBookingPolicy ensures bookings are made with minimum advance notice
type MinimumAdvanceBookingPolicy struct {
    minDays int
}

func (p *MinimumAdvanceBookingPolicy) Name() string {
    return "MinimumAdvanceBooking"
}

func (p *MinimumAdvanceBookingPolicy) Validate(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    daysUntilCheckIn := reservation.DaysUntilCheckIn()
    if daysUntilCheckIn < p.minDays {
        return domain.NewBusinessRuleViolation(
            fmt.Sprintf("booking must be made at least %d days in advance", p.minDays),
        )
    }
    return nil
}

// MaximumAdvanceBookingPolicy ensures bookings aren't made too far in advance
type MaximumAdvanceBookingPolicy struct {
    maxDays int
}

func (p *MaximumAdvanceBookingPolicy) Name() string {
    return "MaximumAdvanceBooking"
}

func (p *MaximumAdvanceBookingPolicy) Validate(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    daysUntilCheckIn := reservation.DaysUntilCheckIn()
    if daysUntilCheckIn > p.maxDays {
        return domain.NewBusinessRuleViolation(
            fmt.Sprintf("booking cannot be made more than %d days in advance", p.maxDays),
        )
    }
    return nil
}

// MinimumStayPolicy ensures minimum stay requirements
type MinimumStayPolicy struct {
    minNights int
}

func (p *MinimumStayPolicy) Name() string {
    return "MinimumStay"
}

func (p *MinimumStayPolicy) Validate(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    nights := reservation.DateRange().Nights()
    if nights < p.minNights {
        return domain.NewBusinessRuleViolation(
            fmt.Sprintf("minimum stay is %d nights", p.minNights),
        )
    }
    return nil
}

// MaximumStayPolicy ensures maximum stay limits
type MaximumStayPolicy struct {
    maxNights int
}

func (p *MaximumStayPolicy) Name() string {
    return "MaximumStay"
}

func (p *MaximumStayPolicy) Validate(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    nights := reservation.DateRange().Nights()
    if nights > p.maxNights {
        return domain.NewBusinessRuleViolation(
            fmt.Sprintf("maximum stay is %d nights", p.maxNights),
        )
    }
    return nil
}

// GuestValidationPolicy validates guest information
type GuestValidationPolicy struct{}

func (p *GuestValidationPolicy) Name() string {
    return "GuestValidation"
}

func (p *GuestValidationPolicy) Validate(
    ctx context.Context,
    reservation *entity.Reservation,
    guest *guestentity.Guest,
) error {
    if guest == nil {
        return domain.NewValidationError("guest information is required")
    }

    if !guest.IsActive() {
        return domain.NewBusinessRuleViolation("guest account is not active")
    }

    if guest.IsBlacklisted() {
        return domain.NewBusinessRuleViolation("guest is not allowed to make bookings")
    }

    return nil
}

// internal/reservation/domain/service/rate_calculator.go
package service

import (
    "context"
    "context"
    "encoding/json"
    "fmt"
    "sync"
    "time"

    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/inventory/domain/entity" // Room type from inventory context
)

// RateCalculatorService calculates pricing for reservations
type RateCalculatorService struct {
    baseRates            map[string]valueobject.Money
    seasonalMultipliers  map[string]float64
    dayOfWeekMultipliers map[time.Weekday]float64
    cache                Cache
    metricsCollector     MetricsCollector
}

// NewRateCalculatorService creates a new rate calculator service
func NewRateCalculatorService() *RateCalculatorService {
    return &RateCalculatorService{
        baseRates: make(map[string]valueobject.Money),
        seasonalMultipliers: map[string]float64{
            "low":    0.8,
            "medium": 1.0,
            "high":   1.5,
            "peak":   2.0,
        },
        dayOfWeekMultipliers: map[time.Weekday]float64{
            time.Monday:    0.9,
            time.Tuesday:   0.9,
            time.Wednesday: 0.9,
            time.Thursday: 0.9,
            time.Friday:   1.1,
            time.Saturday: 1.3,
            time.Sunday:   1.2,
        },
    }
}

// CalculateRate calculates the total rate for a reservation
func (s *RateCalculatorService) CalculateRate(
    ctx context.Context,
    roomType *inventoryentity.RoomType,
    dateRange valueobject.DateRange,
    guestCount int,
) (valueobject.Money, error) {
    start := time.Now()
    defer func() {
        s.metricsCollector.RecordDuration("rate_calculation", time.Since(start))
    }()

    // ADD cache check
    cacheKey := fmt.Sprintf("rate:%s:%s:%d",
        roomType.ID(),
        dateRange.String(),
        guestCount)

    if cachedRate, err := s.cache.Get(ctx, cacheKey); err == nil {
        var rate valueobject.Money
        if json.Unmarshal([]byte(cachedRate), &rate) == nil {
            s.metricsCollector.IncrementCounter("rate_calculation_cache_hit")
            return rate, nil
        }
    }

    s.metricsCollector.IncrementCounter("rate_calculation_cache_miss")

    baseRate := s.getBaseRate(roomType.ID())
    if baseRate.ToFloat() == 0 {
        return valueobject.Money{}, fmt.Errorf("no base rate found for room type %s", roomType.ID())
    }

    totalAmount := valueobject.Money{}
    currentDate := dateRange.CheckIn()

    for currentDate.Before(dateRange.CheckOut()) {
        dailyRate := s.calculateDailyRate(baseRate, currentDate, guestCount)

        var err error
        totalAmount, err = totalAmount.Add(dailyRate)
        if err != nil {
            return valueobject.Money{}, fmt.Errorf("failed to add daily rate: %w", err)
        }

        currentDate = currentDate.AddDate(0, 0, 1)
    }

    // Apply taxes
    totalWithTax := s.applyTaxes(totalAmount)

    // ADD cache storage
    if rateBytes, err := json.Marshal(totalWithTax); err == nil {
        s.cache.Set(ctx, cacheKey, string(rateBytes), 1*time.Hour)
    }

    return totalWithTax, nil
}

// ADD bulk rate calculation for performance
func (s *RateCalculatorService) CalculateRatesForMultipleRooms(
    ctx context.Context,
    roomTypes []*inventoryentity.RoomType,
    dateRange valueobject.DateRange,
    guestCount int,
) (map[string]valueobject.Money, error) {
    results := make(map[string]valueobject.Money)
    errors := make([]error, 0)

    // Use goroutines for parallel calculation
    type result struct {
        roomTypeID string
        rate       valueobject.Money
        err        error
    }

    resultChan := make(chan result, len(roomTypes))

    for _, roomType := range roomTypes {
        go func(ctx context.Context, rt *inventoryentity.RoomType) {
            defer wg.Done()
            rate, err := s.CalculateRate(ctx, rt, dateRange, guestCount)
            resultChan <- result{
                roomTypeID: rt.ID(),
                rate:       rate,
                err:        err,
            }
        }(ctx, roomType)
    }

    // Collect results
    for i := 0; i < len(roomTypes); i++ {
        res := <-resultChan
        if res.err != nil {
            errors = append(errors, res.err)
        } else {
            results[res.roomTypeID] = res.rate
        }
    }

    if len(errors) > 0 {
        return results, fmt.Errorf("failed to calculate rates for some room types: %v", errors)
    }

    return results, nil
}

// calculateDailyRate calculates the rate for a single day
func (s *RateCalculatorService) calculateDailyRate(
    baseRate valueobject.Money,
    date time.Time,
    guestCount int,
) valueobject.Money {
    rate := baseRate

    // Apply seasonal multiplier
    season := s.getSeason(date)
    if multiplier, exists := s.seasonalMultipliers[season]; exists {
        rate = rate.Multiply(multiplier)
    }

    // Apply day of week multiplier
    if multiplier, exists := s.dayOfWeekMultipliers[date.Weekday()]; exists {
        rate = rate.Multiply(multiplier)
    }

    // Apply guest count multiplier (additional charge for extra guests)
    if guestCount > 2 {
        extraGuests := guestCount - 2
        rate = rate.Multiply(1.0 + float64(extraGuests)*0.1) // 10% per extra guest
    }

    return rate
}

// applyTaxes applies taxes to the total amount
func (s *RateCalculatorService) applyTaxes(amount valueobject.Money) valueobject.Money {
    taxRate := 0.12 // 12% tax rate
    return amount.Multiply(1.0 + taxRate)
}

// getSeason determines the season based on date
func (s *RateCalculatorService) getSeason(date time.Time) string {
    month := date.Month()

    switch {
    case month >= 12 || month <= 2: // Winter
        return "low"
    case month >= 3 && month <= 5: // Spring
        return "medium"
    case month >= 6 && month <= 8: // Summer
        return "high"
    case month >= 9 && month <= 11: // Fall
        return "medium"
    default:
        return "medium"
    }
}

// getBaseRate gets the base rate for a room type
func (s *RateCalculatorService) getBaseRate(roomTypeID string) valueobject.Money {
    if rate, exists := s.baseRates[roomTypeID]; exists {
        return rate
    }

    // Default rate if not found
    defaultRate, _ := valueobject.NewMoney(10000, valueobject.USD)
    return defaultRate
}

// SetBaseRate sets the base rate for a room type
func (s *RateCalculatorService) SetBaseRate(roomTypeID string, rate valueobject.Money) {
    s.baseRates[roomTypeID] = rate
}
```

### 4.1.4 Domain Events

```go
// internal/reservation/domain/event/reservation_events.go
package event

import (
    "time"

    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/shared/domain"
)

// ReservationCreated represents a reservation creation event
type ReservationCreated struct {
    domain.BaseEvent
    GuestID     string                    `json:"guest_id"`
    DateRange   valueobject.DateRange     `json:"date_range"`
    RoomBooking valueobject.RoomBooking   `json:"room_booking"`
    TotalPrice  valueobject.Money         `json:"total_price"`
}

// NewReservationCreated creates a new reservation created event
func NewReservationCreated(
    reservationID string,
    guestID string,
    dateRange valueobject.DateRange,
    roomBooking valueobject.RoomBooking,
) ReservationCreated {
    return ReservationCreated{
        BaseEvent:   domain.NewBaseEvent("ReservationCreated", reservationID),
        GuestID:     guestID,
        DateRange:   dateRange,
        RoomBooking: roomBooking,
    }
}

// ReservationConfirmed represents a reservation confirmation event
type ReservationConfirmed struct {
    domain.BaseEvent
    ConfirmedAt time.Time `json:"confirmed_at"`
}

// NewReservationConfirmed creates a new reservation confirmed event
func NewReservationConfirmed(reservationID string, confirmedAt time.Time) ReservationConfirmed {
    return ReservationConfirmed{
        BaseEvent:   domain.NewBaseEvent("ReservationConfirmed", reservationID),
        ConfirmedAt: confirmedAt,
    }
}

// ReservationCancelled represents a reservation cancellation event
type ReservationCancelled struct {
    domain.BaseEvent
    Reason      string    `json:"reason"`
    CancelledAt time.Time `json:"cancelled_at"`
}

// NewReservationCancelled creates a new reservation cancelled event
func NewReservationCancelled(reservationID string, reason string, cancelledAt time.Time) ReservationCancelled {
    return ReservationCancelled{
        BaseEvent:   domain.NewBaseEvent("ReservationCancelled", reservationID),
        Reason:      reason,
        CancelledAt: cancelledAt,
    }
}

// GuestInfoUpdated represents a guest information update event
type GuestInfoUpdated struct {
    domain.BaseEvent
    OldGuestID string `json:"old_guest_id"`
    NewGuestID string `json:"new_guest_id"`
}

// NewGuestInfoUpdated creates a new guest info updated event
func NewGuestInfoUpdated(reservationID string, oldGuestID string, newGuestID string) GuestInfoUpdated {
    return GuestInfoUpdated{
        BaseEvent:  domain.NewBaseEvent("GuestInfoUpdated", reservationID),
        OldGuestID: oldGuestID,
        NewGuestID: newGuestID,
    }
}

// DiscountApplied represents a discount application event
type DiscountApplied struct {
    domain.BaseEvent
    OriginalPrice   valueobject.Money    `json:"original_price"`
    DiscountedPrice valueobject.Money    `json:"discounted_price"`
    Discount        valueobject.Discount `json:"discount"`
}

// NewDiscountApplied creates a new discount applied event
func NewDiscountApplied(
    reservationID string,
    originalPrice valueobject.Money,
    discountedPrice valueobject.Money,
    discount valueobject.Discount,
) DiscountApplied {
    return DiscountApplied{
        BaseEvent:       domain.NewBaseEvent("DiscountApplied", reservationID),
        OriginalPrice:   originalPrice,
        DiscountedPrice: discountedPrice,
        Discount:        discount,
    }
}
```

### 4.1.5 Event Handling and Messaging

```go
// internal/shared/infrastructure/messaging/event_bus.go
package messaging

import (
    "context"
    "fmt"
    "log"
    "reflect"
    "sync"

    "hotel-booking/internal/shared/domain"
)

// EventHandler represents a function that handles domain events
type EventHandler func(ctx context.Context, event domain.Event) error

// EventBus provides event publishing and subscription capabilities
type EventBus struct {
    handlers map[string][]EventHandler
    mutex    sync.RWMutex
}

// NewEventBus creates a new event bus
func NewEventBus() *EventBus {
    return &EventBus{
        handlers: make(map[string][]EventHandler),
    }
}

// Subscribe registers an event handler for a specific event type
func (eb *EventBus) Subscribe(eventType string, handler EventHandler) {
    eb.mutex.Lock()
    defer eb.mutex.Unlock()

    if _, exists := eb.handlers[eventType]; !exists {
        eb.handlers[eventType] = make([]EventHandler, 0)
    }

    eb.handlers[eventType] = append(eb.handlers[eventType], handler)
    log.Printf("Subscribed handler for event type: %s", eventType)
}

// Publish publishes an event to all registered handlers
func (eb *EventBus) Publish(ctx context.Context, event domain.Event) error {
    eb.mutex.RLock()
    handlers := eb.handlers[event.EventType()]
    eb.mutex.RUnlock()

    if len(handlers) == 0 {
        log.Printf("No handlers registered for event type: %s", event.EventType())
        return nil
    }

    // Execute handlers concurrently
    var wg sync.WaitGroup
    errorsChan := make(chan error, len(handlers))

    for _, handler := range handlers {
        wg.Add(1)
        go func(h EventHandler) {
            defer wg.Done()
            if err := h(ctx, event); err != nil {
                errorsChan <- fmt.Errorf("handler error for event %s: %w", event.EventType(), err)
            }
        }(handler)
    }

    wg.Wait()
    close(errorsChan)

    // Collect errors
    var errors []error
    for err := range errorsChan {
        errors = append(errors, err)
        log.Printf("Event handler error: %v", err)
    }

    if len(errors) > 0 {
        return fmt.Errorf("event handling failed with %d errors", len(errors))
    }

    log.Printf("Successfully published event: %s (ID: %s)", event.EventType(), event.EventID())
    return nil
}

// PublishAll publishes multiple events
func (eb *EventBus) PublishAll(ctx context.Context, events []domain.Event) error {
    for _, event := range events {
        if err := eb.Publish(ctx, event); err != nil {
            return err
        }
    }
    return nil
}

// ADD this method to the existing EventBus struct

// PublishWithRetry publishes events with retry mechanism
func (eb *EventBus) PublishWithRetry(ctx context.Context, event domain.Event, maxRetries int) error {
    var lastErr error

    for attempt := 0; attempt <= maxRetries; attempt++ {
        if attempt > 0 {
            // Exponential backoff
            backoff := time.Duration(attempt*attempt) * time.Second
            time.Sleep(backoff)
        }

        if err := eb.Publish(ctx, event); err != nil {
            lastErr = err
            log.Printf("Event publish attempt %d failed: %v", attempt+1, err)
            continue
        }

        return nil
    }

    return fmt.Errorf("failed to publish event after %d attempts: %w", maxRetries+1, lastErr)
}

// GetEventType returns the event type from an event instance
func GetEventType(event domain.Event) string {
    return reflect.TypeOf(event).Name()
}

// internal/shared/infrastructure/messaging/outbox.go
package messaging

import (
    "context"
    "encoding/json"
    "fmt"
    "reflect"
    "time"

    "gorm.io/gorm"

    "hotel-booking/internal/shared/domain"
)

// OutboxEvent represents an event stored in the outbox
type OutboxEvent struct {
    ID          string    `gorm:"primaryKey;type:uuid"`
    EventType   string    `gorm:"not null"`
    EventData   string    `gorm:"type:jsonb;not null"`
    AggregateID string    `gorm:"not null"`
    CreatedAt   time.Time
    ProcessedAt *time.Time
    Retries     int `gorm:"default:0"`
}

// TableName specifies the table name for GORM
func (OutboxEvent) TableName() string {
    return "shared.outbox_events"
}

// OutboxPublisher implements the outbox pattern for reliable event publishing
type OutboxPublisher struct {
    db           *gorm.DB
    eventBus     *EventBus
    typeRegistry map[string]reflect.Type
}

// NewOutboxPublisher creates a new outbox publisher
func NewOutboxPublisher(db *gorm.DB, eventBus *EventBus) *OutboxPublisher {
    return &OutboxPublisher{
        db:           db,
        eventBus:     eventBus,
        typeRegistry: make(map[string]reflect.Type),
    }
}

// Publish stores events in the outbox for later processing
func (op *OutboxPublisher) Publish(ctx context.Context, event domain.Event) error {
    eventData, err := json.Marshal(event)
    if err != nil {
        return fmt.Errorf("failed to marshal event: %w", err)
    }

    outboxEvent := OutboxEvent{
        ID:          event.EventID(),
        EventType:   event.EventType(),
        EventData:   string(eventData),
        AggregateID: event.AggregateID(),
        CreatedAt:   event.OccurredOn(),
    }

    if err := op.db.WithContext(ctx).Create(&outboxEvent).Error; err != nil {
        return fmt.Errorf("failed to store event in outbox: %w", err)
    }

    return nil
}

// RegisterEventType registers an event type for deserialization
func (op *OutboxPublisher) RegisterEventType(event domain.Event) {
    eventType := reflect.TypeOf(event).Elem()
    op.typeRegistry[event.EventType()] = eventType
}

// ProcessOutboxEvents processes unprocessed events from the outbox
func (op *OutboxPublisher) ProcessOutboxEvents(ctx context.Context) error {
    var events []OutboxEvent

    // Get unprocessed events
    if err := op.db.WithContext(ctx).
        Where("processed_at IS NULL AND retries < ?", 3).
        Order("created_at ASC").
        Limit(100).
        Find(&events).Error; err != nil {
        return fmt.Errorf("failed to fetch outbox events: %w", err)
    }

    for _, outboxEvent := range events {
        if err := op.processEvent(ctx, outboxEvent); err != nil {
            log.Printf("Failed to process outbox event %s: %v", outboxEvent.ID, err)

            // Increment retry count
            op.db.WithContext(ctx).Model(&outboxEvent).UpdateColumn("retries", outboxEvent.Retries+1)
        } else {
            // Mark as processed
            now := time.Now()
            op.db.WithContext(ctx).Model(&outboxEvent).UpdateColumn("processed_at", &now)
        }
    }

    return nil
}

// processEvent processes a single outbox event
func (op *OutboxPublisher) processEvent(ctx context.Context, outboxEvent OutboxEvent) error {
    // Look up the event type from the registry
    eventType, ok := op.typeRegistry[outboxEvent.EventType]
    if !ok {
        return fmt.Errorf("unknown event type: %s", outboxEvent.EventType)
    }

    // Create a new instance of the event type
    event := reflect.New(eventType).Interface().(domain.Event)

    // Deserialize the event data into the new instance
    if err := json.Unmarshal([]byte(outboxEvent.EventData), &event); err != nil {
        return fmt.Errorf("failed to unmarshal event data: %w", err)
    }

    // Publish the fully typed event
    return op.eventBus.Publish(ctx, event)
}

// Event Handlers for Cross-Context Communication

// internal/reservation/infrastructure/messaging/event_handlers.go
package messaging

import (
    "context"
    "log"

    "hotel-booking/internal/reservation/domain/event"
    "hotel-booking/internal/shared/domain"
    "hotel-booking/internal/notification/application/service"
    "hotel-booking/internal/billing/application/service"
)

// ReservationEventHandlers contains handlers for reservation events
type ReservationEventHandlers struct {
    notificationService *notificationservice.NotificationService
    billingService      *billingservice.BillingService
}

// NewReservationEventHandlers creates new reservation event handlers
func NewReservationEventHandlers(
    notificationService *notificationservice.NotificationService,
    billingService *billingservice.BillingService,
) *ReservationEventHandlers {
    return &ReservationEventHandlers{
        notificationService: notificationService,
        billingService:      billingService,
    }
}

// HandleReservationCreated handles reservation created events
func (h *ReservationEventHandlers) HandleReservationCreated(ctx context.Context, event domain.Event) error {
    reservationCreated, ok := event.(*event.ReservationCreated)
    if !ok {
        return fmt.Errorf("invalid event type for ReservationCreated handler, got %T", event)
    }

    log.Printf("Handling ReservationCreated event for reservation: %s", reservationCreated.AggregateID())

    // Send booking confirmation notification
    if err := h.notificationService.SendBookingConfirmation(ctx, reservationCreated.AggregateID()); err != nil {
        return fmt.Errorf("failed to send booking confirmation: %w", err)
    }

    return nil
}

// HandleReservationConfirmed handles reservation confirmed events
func (h *ReservationEventHandlers) HandleReservationConfirmed(ctx context.Context, event domain.Event) error {
    reservationConfirmed, ok := event.(event.ReservationConfirmed)
    if !ok {
        return fmt.Errorf("invalid event type for ReservationConfirmed handler")
    }

    log.Printf("Handling ReservationConfirmed event for reservation: %s", reservationConfirmed.AggregateID())

    // Process payment
    if err := h.billingService.ProcessPayment(ctx, reservationConfirmed.AggregateID()); err != nil {
        return fmt.Errorf("failed to process payment: %w", err)
    }

    // Send confirmation notification
    if err := h.notificationService.SendReservationConfirmation(ctx, reservationConfirmed.AggregateID()); err != nil {
        return fmt.Errorf("failed to send confirmation notification: %w", err)
    }

    return nil
}

// HandleReservationCancelled handles reservation cancelled events
func (h *ReservationEventHandlers) HandleReservationCancelled(ctx context.Context, event domain.Event) error {
    reservationCancelled, ok := event.(event.ReservationCancelled)
    if !ok {
        return fmt.Errorf("invalid event type for ReservationCancelled handler")
    }

    log.Printf("Handling ReservationCancelled event for reservation: %s", reservationCancelled.AggregateID())

    // Process refund if applicable
    if err := h.billingService.ProcessRefund(ctx, reservationCancelled.AggregateID()); err != nil {
        log.Printf("Failed to process refund (non-critical): %v", err)
    }

    // Send cancellation notification
    if err := h.notificationService.SendCancellationNotification(ctx, reservationCancelled.AggregateID()); err != nil {
        return fmt.Errorf("failed to send cancellation notification: %w", err)
    }

    return nil
}
```

## 4.2 Integration Patterns and Anti-Corruption Layers

### 4.2.1 Anti-Corruption Layer Implementation

```go
// internal/reservation/infrastructure/anticorruption/guest_adapter.go
package anticorruption

import (
    "context"
    "fmt"

    "hotel-booking/internal/guest/domain/entity" // External guest entity
    "hotel-booking/internal/reservation/domain/valueobject"
)

// GuestAdapter translates between guest context and reservation context
type GuestAdapter struct {
    guestService GuestService // Interface to guest bounded context
}

// GuestService defines the interface to the guest bounded context
type GuestService interface {
    GetGuest(ctx context.Context, guestID string) (*entity.Guest, error)
    ValidateGuest(ctx context.Context, guestID string) error
}

// NewGuestAdapter creates a new guest adapter
func NewGuestAdapter(guestService GuestService) *GuestAdapter {
    return &GuestAdapter{
        guestService: guestService,
    }
}

// GetGuestInfo retrieves and translates guest information for reservation context
func (ga *GuestAdapter) GetGuestInfo(ctx context.Context, guestID string) (*valueobject.GuestInfo, error) {
    // Get full guest entity from guest context
    guest, err := ga.guestService.GetGuest(ctx, guestID)
    if err != nil {
        return nil, fmt.Errorf("failed to get guest: %w", err)
    }

    if guest == nil {
        return nil, fmt.Errorf("guest not found: %s", guestID)
    }

    // Translate to reservation context's simplified guest representation
    guestInfo := valueobject.NewGuestInfo(
        guest.ID(),
        guest.FullName(),
        guest.Email(),
        guest.Phone(),
    )

    return guestInfo, nil
}

// ValidateGuestForBooking validates if guest can make bookings
func (ga *GuestAdapter) ValidateGuestForBooking(ctx context.Context, guestID string) error {
    return ga.guestService.ValidateGuest(ctx, guestID)
}

// internal/billing/infrastructure/anticorruption/stripe_adapter.go
package anticorruption

import (
    "context"
    "fmt"
    "strconv"

    "github.com/stripe/stripe-go/v75"
    "github.com/stripe/stripe-go/v75/paymentintent"
    "github.com/stripe/stripe-go/v75/refund"

    "hotel-booking/internal/billing/domain/entity"
    "hotel-booking/internal/billing/domain/valueobject"
)

// StripeAdapter protects the billing domain from Stripe's external model
type StripeAdapter struct {
    apiKey         string
    circuitBreaker *CircuitBreaker // ADD this field
}

// UPDATE the constructor
func NewStripeAdapter(apiKey string, circuitBreaker *CircuitBreaker) *StripeAdapter {
    stripe.Key = apiKey
    return &StripeAdapter{
        apiKey:         apiKey,
        circuitBreaker: circuitBreaker, // ADD this
    }
}

// UPDATE the CreatePaymentIntent method to use circuit breaker
func (sa *StripeAdapter) CreatePaymentIntent(
    ctx context.Context,
    amount valueobject.Money,
    reservationID string,
    customerEmail string,
) (*entity.Payment, error) {
    var result *entity.Payment
    var err error

    // ADD circuit breaker execution
    cbErr := sa.circuitBreaker.Execute(func() error {
        result, err = sa.createPaymentIntentInternal(ctx, amount, reservationID, customerEmail)
        return err
    })

    if cbErr != nil {
        return nil, fmt.Errorf("circuit breaker error: %w", cbErr)
    }

    return result, err
}

// ConfirmPaymentIntent confirms a payment intent
func (sa *StripeAdapter) ConfirmPaymentIntent(
    ctx context.Context,
    paymentIntentID string,
    paymentMethodID string,
) (*entity.Payment, error) {
    params := &stripe.PaymentIntentConfirmParams{
        PaymentMethod: stripe.String(paymentMethodID),
    }

    pi, err := paymentintent.Confirm(paymentIntentID, params)
    if err != nil {
        return nil, fmt.Errorf("stripe payment confirmation failed: %w", err)
    }

    // Extract reservation ID from metadata
    reservationID := pi.Metadata["reservation_id"]
    if reservationID == "" {
        return nil, fmt.Errorf("reservation_id not found in payment metadata")
    }

    // Convert Stripe amount back to domain money
    amount, err := valueobject.NewMoney(
        pi.Amount,
        valueobject.Currency(pi.Currency),
    )
    if err != nil {
        return nil, fmt.Errorf("failed to create money from Stripe amount: %w", err)
    }

    paymentStatus := sa.translateStripeStatus(pi.Status)
    customerEmail := ""
    if pi.ReceiptEmail != nil {
        customerEmail = *pi.ReceiptEmail
    }

    payment := entity.NewPayment(
        pi.ID,
        reservationID,
        amount,
        paymentStatus,
        customerEmail,
    )

    return payment, nil
}

// ProcessRefund processes a refund through Stripe
func (sa *StripeAdapter) ProcessRefund(
    ctx context.Context,
    paymentIntentID string,
    refundAmount valueobject.Money,
    reason string,
) error {
    refundParams := &stripe.RefundParams{
        PaymentIntent: stripe.String(paymentIntentID),
        Amount:        stripe.Int64(int64(refundAmount.ToFloat() * 100)),
        Reason:        stripe.String(reason),
    }

    _, err := refund.New(refundParams)
    if err != nil {
        return fmt.Errorf("stripe refund failed: %w", err)
    }

    return nil
}

// translateStripeStatus translates Stripe status to domain status
func (sa *StripeAdapter) translateStripeStatus(stripeStatus stripe.PaymentIntentStatus) valueobject.PaymentStatus {
    switch stripeStatus {
    case stripe.PaymentIntentStatusRequiresPaymentMethod:
        return valueobject.PaymentStatusPending
    case stripe.PaymentIntentStatusRequiresConfirmation:
        return valueobject.PaymentStatusPending
    case stripe.PaymentIntentStatusRequiresAction:
        return valueobject.PaymentStatusPending
    case stripe.PaymentIntentStatusProcessing:
        return valueobject.PaymentStatusProcessing
    case stripe.PaymentIntentStatusSucceeded:
        return valueobject.PaymentStatusCompleted
    case stripe.PaymentIntentStatusCanceled:
        return valueobject.PaymentStatusCancelled
    default:
        return valueobject.PaymentStatusFailed
    }
}
```

## 4.3 Testing Strategies

### 4.3.1 Domain Layer Testing

```go
// internal/reservation/domain/entity/reservation_test.go
package entity_test

import (
    "fmt"
    "math/rand"
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"

    "hotel-booking/internal/reservation/domain/entity"
    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/shared/domain"
)

func TestReservation_NewReservation(t *testing.T) {
    // Given
    guestID := "guest-123"
    checkIn := time.Now().AddDate(0, 0, 7)  // 7 days from now
    checkOut := time.Now().AddDate(0, 0, 10) // 10 days from now

    dateRange, err := valueobject.NewDateRange(checkIn, checkOut)
    require.NoError(t, err)

    roomBooking := valueobject.NewRoomBooking("room-type-1", 1)
    totalPrice, err := valueobject.NewMoney(30000, valueobject.USD)
    require.NoError(t, err)

    // When
    reservation := entity.NewReservation("res-123", guestID, dateRange, roomBooking, totalPrice)

    // Then
    assert.Equal(t, "res-123", reservation.ID())
    assert.Equal(t, guestID, reservation.GuestID())
    assert.Equal(t, dateRange, reservation.DateRange())
    assert.Equal(t, roomBooking, reservation.RoomBooking())
    assert.Equal(t, totalPrice, reservation.TotalPrice())
    assert.Equal(t, valueobject.BookingStatusPending, reservation.Status())

    // Should have creation event
    events := reservation.GetEvents()
    assert.Len(t, events, 1)
    assert.Equal(t, "ReservationCreated", events[0].EventType())
}

func TestReservation_Confirm_Success(t *testing.T) {
    // Given
    reservation := createTestReservation(t)

    // When
    err := reservation.Confirm()

    // Then
    assert.NoError(t, err)
    assert.Equal(t, valueobject.BookingStatusConfirmed, reservation.Status())

    // Should have confirmation event
    events := reservation.GetEvents()
    assert.Len(t, events, 1)
    assert.Equal(t, "ReservationConfirmed", events[0].EventType())
}

func TestReservation_Confirm_FailsWhenNotPending(t *testing.T) {
    // Given
    reservation := createTestReservation(t)
    err := reservation.Confirm()
    require.NoError(t, err)

    // When - try to confirm again
    err = reservation.Confirm()

    // Then
    assert.Error(t, err)
    assert.IsType(t, &domain.BusinessRuleViolation{}, err)
    assert.Contains(t, err.Error(), "cannot confirm reservation in status")
}

func TestReservation_Cancel_Success(t *testing.T) {
    // Given
    reservation := createTestReservation(t)

    // When
    err := reservation.Cancel("Customer request")

    // Then
    assert.NoError(t, err)
    assert.Equal(t, valueobject.BookingStatusCancelled, reservation.Status())

    // Should have cancellation event
    events := reservation.GetEvents()
    assert.Len(t, events, 1)
    assert.Equal(t, "ReservationCancelled", events[0].EventType())
}

func TestReservation_ApplyDiscount_Success(t *testing.T) {
    // Given
    reservation := createTestReservation(t)
    discount, err := valueobject.NewPercentageDiscount(10.0, nil) // 10% discount
    require.NoError(t, err)

    originalPrice := reservation.TotalPrice()

    // When
    err = reservation.ApplyDiscount(discount)

    // Then
    assert.NoError(t, err)
    assert.True(t, reservation.TotalPrice().LessThan(originalPrice))

    // Should have discount event
    events := reservation.GetEvents()
    assert.Len(t, events, 1)
    assert.Equal(t, "DiscountApplied", events[0].EventType())
}

func TestReservation_PropertyBasedTesting(t *testing.T) {
    // Property: A reservation should always maintain valid state after any operation
    property := func(guestID string, nights int, amount float64) bool {
        if nights <= 0 || nights > 365 || amount <= 0 || amount > 10000 {
            return true // Skip invalid inputs
        }

        checkIn := time.Now().AddDate(0, 0, 1)
        checkOut := checkIn.AddDate(0, 0, nights)

        dateRange, err := valueobject.NewDateRange(checkIn, checkOut)
        if err != nil {
            return false
        }

        roomBooking := valueobject.NewRoomBooking("room-type-1", 1)
        totalPrice, err := valueobject.NewMoney(int64(amount*100), valueobject.USD)
        if err != nil {
            return false
        }

        reservation := entity.NewReservation("res-123", guestID, dateRange, roomBooking, totalPrice)

        // Property: Reservation should always have valid state
        return reservation.ID() != "" &&
               reservation.GuestID() == guestID &&
               reservation.Status() == valueobject.BookingStatusPending &&
               reservation.TotalPrice().IsPositive()
    }

    // Run property-based test
    for i := 0; i < 100; i++ {
        guestID := fmt.Sprintf("guest-%d", i)
        nights := rand.Intn(30) + 1
        amount := rand.Float64()*1000 + 50

        if !property(guestID, nights, amount) {
            t.Errorf("Property violated for guestID=%s, nights=%d, amount=%.2f", guestID, nights, amount)
        }
    }
}

func BenchmarkReservation_Confirm(b *testing.B) {
    reservation := createTestReservation(b)

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        // Reset reservation state
        reservation = createTestReservation(b)

        err := reservation.Confirm()
        if err != nil {
            b.Fatalf("Unexpected error: %v", err)
        }
    }
}

func BenchmarkReservation_ApplyDiscount(b *testing.B) {
    reservation := createTestReservation(b)
    discount, _ := valueobject.NewPercentageDiscount(10.0, nil)

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        // Reset reservation state
        reservation = createTestReservation(b)

        err := reservation.ApplyDiscount(discount)
        if err != nil {
            b.Fatalf("Unexpected error: %v", err)
        }
    }
}

func createTestReservation(tb testing.TB) *entity.Reservation {
    checkIn := time.Now().AddDate(0, 0, 7)
    checkOut := time.Now().AddDate(0, 0, 10)

    dateRange, err := valueobject.NewDateRange(checkIn, checkOut)
    require.NoError(tb, err)

    roomBooking := valueobject.NewRoomBooking("room-type-1", 1)
    totalPrice, err := valueobject.NewMoney(30000, valueobject.USD)
    require.NoError(tb, err)

    reservation := entity.NewReservation("res-123", "guest-123", dateRange, roomBooking, totalPrice)

    // Clear creation events for clean test setup
    reservation.GetEvents()

    return reservation
}

```

### 4.3.3 Integration Testing

```go
// internal/reservation/infrastructure/persistence/postgres/reservation_repository_test.go
package postgres_test

import (
    "context"
    "context"
    "fmt"
    "sync"
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/stretchr/testify/suite"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"

    "hotel-booking/internal/reservation/domain/entity"
    "hotel-booking/internal/reservation/domain/valueobject"
    "hotel-booking/internal/reservation/infrastructure/persistence/postgres"
)

type ReservationRepositoryTestSuite struct {
    suite.Suite
    db   *gorm.DB
    repo *postgres.PostgresReservationRepository
}

func (suite *ReservationRepositoryTestSuite) SetupSuite() {
    // Setup test database connection
    dsn := "host=localhost port=5432 user=testuser password=testpass dbname=testdb sslmode=disable"
    db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
    require.NoError(suite.T(), err)

    // Auto-migrate tables
    err = db.AutoMigrate(&postgres.ReservationModel{})
    require.NoError(suite.T(), err)

    suite.db = db
    suite.repo = postgres.NewPostgresReservationRepository(db)
}

func (suite *ReservationRepositoryTestSuite) SetupTest() {
    // Clean up before each test
    suite.db.Exec("DELETE FROM reservation.reservations")
}

func (suite *ReservationRepositoryTestSuite) TearDownSuite() {
    sqlDB, _ := suite.db.DB()
    sqlDB.Close()
}

func (suite *ReservationRepositoryTestSuite) TestCreate_Success() {
    // Given
    ctx := context.Background()
    reservation := suite.createTestReservation()

    // When
    err := suite.repo.Create(ctx, reservation)

    // Then
    assert.NoError(suite.T(), err)

    // Verify in database
    var count int64
    suite.db.Model(&postgres.ReservationModel{}).Where("id = ?", reservation.ID()).Count(&count)
    assert.Equal(suite.T(), int64(1), count)
}

func (suite *ReservationRepositoryTestSuite) TestGetByID_Success() {
    // Given
    ctx := context.Background()
    originalReservation := suite.createTestReservation()

    err := suite.repo.Create(ctx, originalReservation)
    require.NoError(suite.T(), err)

    // When
    retrievedReservation, err := suite.repo.GetByID(ctx, originalReservation.ID())

    // Then
    assert.NoError(suite.T(), err)
    assert.NotNil(suite.T(), retrievedReservation)
    assert.Equal(suite.T(), originalReservation.ID(), retrievedReservation.ID())
    assert.Equal(suite.T(), originalReservation.GuestID(), retrievedReservation.GuestID())
    assert.Equal(suite.T(), originalReservation.Status(), retrievedReservation.Status())
}

func (suite *ReservationRepositoryTestSuite) TestGetByID_NotFound() {
    // Given
    ctx := context.Background()
    nonExistentID := "non-existent-id"

    // When
    reservation, err := suite.repo.GetByID(ctx, nonExistentID)

    // Then
    assert.NoError(suite.T(), err)
    assert.Nil(suite.T(), reservation)
}

func (suite *ReservationRepositoryTestSuite) TestUpdate_Success() {
    // Given
    ctx := context.Background()
    reservation := suite.createTestReservation()

    err := suite.repo.Create(ctx, reservation)
    require.NoError(suite.T(), err)

    // Modify reservation
    err = reservation.Confirm()
    require.NoError(suite.T(), err)

    // When
    err = suite.repo.Update(ctx, reservation)

    // Then
    assert.NoError(suite.T(), err)

    // Verify update in database
    retrievedReservation, err := suite.repo.GetByID(ctx, reservation.ID())
    require.NoError(suite.T(), err)
    assert.Equal(suite.T(), valueobject.BookingStatusConfirmed, retrievedReservation.Status())
}

func (suite *ReservationRepositoryTestSuite) TestFindByGuestID_Success() {
    // Given
    ctx := context.Background()
    guestID := "guest-123"

    // Create multiple reservations for the same guest
    reservation1 := suite.createTestReservationForGuest(guestID)
    reservation2 := suite.createTestReservationForGuest(guestID)
    reservation3 := suite.createTestReservationForGuest("other-guest")

    err := suite.repo.Create(ctx, reservation1)
    require.NoError(suite.T(), err)
    err = suite.repo.Create(ctx, reservation2)
    require.NoError(suite.T(), err)
    err = suite.repo.Create(ctx, reservation3)
    require.NoError(suite.T(), err)

    // When
    reservations, err := suite.repo.FindByGuestID(ctx, guestID)

    // Then
    assert.NoError(suite.T(), err)
    assert.Len(suite.T(), reservations, 2)

    for _, reservation := range reservations {
        assert.Equal(suite.T(), guestID, reservation.GuestID())
    }
}

func (suite *ReservationRepositoryTestSuite) TestTransactionalOperations() {
    ctx := context.Background()

    // Test rollback on error
    suite.T().Run("RollbackOnError", func(t *testing.T) {
        reservation := suite.createTestReservation()

        // Start transaction
        tx := suite.db.Begin()
        repo := postgres.NewPostgresReservationRepository(tx)

        // Create reservation in transaction
        err := repo.Create(ctx, reservation)
        assert.NoError(t, err)

        // Verify it exists in transaction
        retrieved, err := repo.GetByID(ctx, reservation.ID())
        assert.NoError(t, err)
        assert.NotNil(t, retrieved)

        // Rollback transaction
        tx.Rollback()

        // Verify it doesn't exist after rollback
        retrieved, err = suite.repo.GetByID(ctx, reservation.ID())
        assert.NoError(t, err)
        assert.Nil(t, retrieved)
    })

    // Test commit on success
    suite.T().Run("CommitOnSuccess", func(t *testing.T) {
        reservation := suite.createTestReservation()

        // Start transaction
        tx := suite.db.Begin()
        repo := postgres.NewPostgresReservationRepository(tx)

        // Create reservation in transaction
        err := repo.Create(ctx, reservation)
        assert.NoError(t, err)

        // Commit transaction
        tx.Commit()

        // Verify it exists after commit
        retrieved, err := suite.repo.GetByID(ctx, reservation.ID())
        assert.NoError(t, err)
        assert.NotNil(t, retrieved)
        assert.Equal(t, reservation.ID(), retrieved.ID())
    })
}

func (suite *ReservationRepositoryTestSuite) TestConcurrentAccess() {
    ctx := context.Background()
    reservation := suite.createTestReservation()

    err := suite.repo.Create(ctx, reservation)
    require.NoError(suite.T(), err)

    // Test concurrent updates
    const numGoroutines = 10
    var wg sync.WaitGroup
    errors := make(chan error, numGoroutines)

    for i := 0; i < numGoroutines; i++ {
        wg.Add(1)
        go func(goroutineID int) {
            defer wg.Done()

            // Create a new repo instance for each transaction to avoid race conditions
            tx := suite.db.Begin()
            repo := postgres.NewPostgresReservationRepository(tx)

            // Get a fresh instance of the reservation
            res, err := repo.GetByID(ctx, reservation.ID())
            if err != nil {
                errors <- err
                tx.Rollback()
                return
            }
            if res == nil {
                errors <- fmt.Errorf("reservation not found in goroutine %d", goroutineID)
                tx.Rollback()
                return
            }

            // Try to confirm
            if err := res.Confirm(); err != nil {
                errors <- err
                tx.Rollback()
                return
            }

            // Try to update
            if err := repo.Update(ctx, res); err != nil {
                errors <- err
                tx.Rollback()
                return
            }

            tx.Commit()
        }(i)
    }

    wg.Wait()
    close(errors)

    // Count errors (should have concurrency conflicts)
    errorCount := 0
    for err := range errors {
        if err != nil {
            errorCount++
        }
    }

    // At least some operations should fail due to concurrency
    assert.True(suite.T(), errorCount > 0, "Expected some concurrency conflicts")
}

func (suite *ReservationRepositoryTestSuite) createTestReservation() *entity.Reservation {
    return suite.createTestReservationForGuest("guest-123")
}

func (suite *ReservationRepositoryTestSuite) createTestReservationForGuest(guestID string) *entity.Reservation {
    checkIn := time.Now().AddDate(0, 0, 7)
    checkOut := time.Now().AddDate(0, 0, 10)

    dateRange, _ := valueobject.NewDateRange(checkIn, checkOut)
    roomBooking := valueobject.NewRoomBooking("room-type-1", 1)
    totalPrice, _ := valueobject.NewMoney(30000, valueobject.USD)

    reservation := entity.NewReservation(
        fmt.Sprintf("res-%d", time.Now().UnixNano()),
        guestID,
        dateRange,
        roomBooking,
        totalPrice,
    )

    // Clear events for clean test setup
    reservation.GetEvents()

    return reservation
}

func TestReservationRepositoryTestSuite(t *testing.T) {
    suite.Run(t, new(ReservationRepositoryTestSuite))
}
```

### 4.3.4 End-to-End Testing

```go
// test/e2e/reservation_test.go
package e2e_test

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
    "time"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    "github.com/stretchr/testify/suite"

    "hotel-booking/cmd/api"
    "hotel-booking/internal/reservation/presentation/dto/request"
    "hotel-booking/internal/reservation/presentation/dto/response"
)

type ReservationE2ETestSuite struct {
    suite.Suite
    server *httptest.Server
    client *http.Client
}

func (suite *ReservationE2ETestSuite) SetupSuite() {
    // Setup test server
    app := api.SetupTestApplication() // This would setup your application with test dependencies
    suite.server = httptest.NewServer(app.Handler)
    suite.client = &http.Client{Timeout: 30 * time.Second}
}

func (suite *ReservationE2ETestSuite) TearDownSuite() {
    suite.server.Close()
}

func (suite *ReservationE2ETestSuite) SetupTest() {
    // Clean up test data before each test
    // This would call your test database cleanup functions
}

func (suite *ReservationE2ETestSuite) TestCreateReservation_Success() {
    // Given
    createReq := request.CreateReservationRequest{
        GuestID:    "guest-123",
        RoomTypeID: "room-type-1",
        CheckIn:    time.Now().AddDate(0, 0, 7),
        CheckOut:   time.Now().AddDate(0, 0, 10),
    }

    reqBody, err := json.Marshal(createReq)
    require.NoError(suite.T(), err)

    // When
    resp, err := suite.client.Post(
        suite.server.URL+"/api/v1/reservations",
        "application/json",
        bytes.NewBuffer(reqBody),
    )

    // Then
    require.NoError(suite.T(), err)
    defer resp.Body.Close()

    assert.Equal(suite.T(), http.StatusCreated, resp.StatusCode)

    var reservationResp response.ReservationResponse
    err = json.NewDecoder(resp.Body).Decode(&reservationResp)
    require.NoError(suite.T(), err)

    assert.NotEmpty(suite.T(), reservationResp.ID)
    assert.Equal(suite.T(), createReq.GuestID, reservationResp.GuestID)
    assert.Equal(suite.T(), createReq.RoomTypeID, reservationResp.RoomTypeID)
    assert.Equal(suite.T(), "pending", reservationResp.Status)
}

func (suite *ReservationE2ETestSuite) TestCreateReservation_InvalidInput() {
    // Given - invalid date range (check-out before check-in)
    createReq := request.CreateReservationRequest{
        GuestID:    "guest-123",
        RoomTypeID: "room-type-1",
        CheckIn:    time.Now().AddDate(0, 0, 10),
        CheckOut:   time.Now().AddDate(0, 0, 7),
    }

    reqBody, err := json.Marshal(createReq)
    require.NoError(suite.T(), err)

    // When
    resp, err := suite.client.Post(
        suite.server.URL+"/api/v1/reservations",
        "application/json",
        bytes.NewBuffer(reqBody),
    )

    // Then
    require.NoError(suite.T(), err)
    defer resp.Body.Close()

    assert.Equal(suite.T(), http.StatusBadRequest, resp.StatusCode)

    var errorResp map[string]string
    err = json.NewDecoder(resp.Body).Decode(&errorResp)
    require.NoError(suite.T(), err)

    assert.Contains(suite.T(), errorResp["error"], "check-out date must be after check-in date")
}

func (suite *ReservationE2ETestSuite) TestGetReservation_Success() {
    // Given - create a reservation first
    createReq := request.CreateReservationRequest{
        GuestID:    "guest-123",
        RoomTypeID: "room-type-1",
        CheckIn:    time.Now().AddDate(0, 0, 7),
        CheckOut:   time.Now().AddDate(0, 0, 10),
    }

    reservationID := suite.createReservation(createReq)

    // When
    resp, err := suite.client.Get(suite.server.URL + "/api/v1/reservations/" + reservationID)

    // Then
    require.NoError(suite.T(), err)
    defer resp.Body.Close()

    assert.Equal(suite.T(), http.StatusOK, resp.StatusCode)

    var reservationResp response.ReservationResponse
    err = json.NewDecoder(resp.Body).Decode(&reservationResp)
    require.NoError(suite.T(), err)

    assert.Equal(suite.T(), reservationID, reservationResp.ID)
    assert.Equal(suite.T(), createReq.GuestID, reservationResp.GuestID)
}

func (suite *ReservationE2ETestSuite) TestConfirmReservation_Success() {
    // Given - create a reservation first
    createReq := request.CreateReservationRequest{
        GuestID:    "guest-123",
        RoomTypeID: "room-type-1",
        CheckIn:    time.Now().AddDate(0, 0, 7),
        CheckOut:   time.Now().AddDate(0, 0, 10),
    }

    reservationID := suite.createReservation(createReq)

    // When
    req, err := http.NewRequest(
        "PUT",
        suite.server.URL+"/api/v1/reservations/"+reservationID+"/confirm",
        nil,
    )
    require.NoError(suite.T(), err)

    resp, err := suite.client.Do(req)

    // Then
    require.NoError(suite.T(), err)
    defer resp.Body.Close()

    assert.Equal(suite.T(), http.StatusOK, resp.StatusCode)

    // Verify reservation is confirmed
    getResp, err := suite.client.Get(suite.server.URL + "/api/v1/reservations/" + reservationID)
    require.NoError(suite.T(), err)
    defer getResp.Body.Close()

    var reservationResp response.ReservationResponse
    err = json.NewDecoder(getResp.Body).Decode(&reservationResp)
    require.NoError(suite.T(), err)

    assert.Equal(suite.T(), "confirmed", reservationResp.Status)
}

// Helper method to create a reservation and return its ID
func (suite *ReservationE2ETestSuite) createReservation(createReq request.CreateReservationRequest) string {
    reqBody, err := json.Marshal(createReq)
    require.NoError(suite.T(), err)

    resp, err := suite.client.Post(
        suite.server.URL+"/api/v1/reservations",
        "application/json",
        bytes.NewBuffer(reqBody),
    )
    require.NoError(suite.T(), err)
    defer resp.Body.Close()

    require.Equal(suite.T(), http.StatusCreated, resp.StatusCode)

    var reservationResp response.ReservationResponse
    err = json.NewDecoder(resp.Body).Decode(&reservationResp)
    require.NoError(suite.T(), err)

    return reservationResp.ID
}

func TestReservationE2ETestSuite(t *testing.T) {
    suite.Run(t, new(ReservationE2ETestSuite))
}
```

## 4.4 Configuration and Environment Management

### 4.4.1 Configuration Structure

```go
// internal/shared/infrastructure/config/config.go
package config

import (
    "fmt"
    "strings"
    "time"

    "github.com/spf13/viper"
)

// Config holds all application configuration
type Config struct {
    Server        ServerConfig        `mapstructure:"server"`
    Database      DatabaseConfig      `mapstructure:"database"`
    Stripe        StripeConfig        `mapstructure:"stripe"`
    Email         EmailConfig         `mapstructure:"email"`
    Redis         RedisConfig         `mapstructure:"redis"`
    Logging       LoggingConfig       `mapstructure:"logging"`
    CircuitBreaker CircuitBreakerConfig `mapstructure:"circuit_breaker"` // ADD this
    RateLimit     RateLimitConfig     `mapstructure:"rate_limit"`      // ADD this
    Metrics       MetricsConfig       `mapstructure:"metrics"`         // ADD this
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
    Port            int           `mapstructure:"port"`
    Host            string        `mapstructure:"host"`
    ReadTimeout     time.Duration `mapstructure:"read_timeout"`
    WriteTimeout    time.Duration `mapstructure:"write_timeout"`
    ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
    CORS            CORSConfig    `mapstructure:"cors"`
}

// CORSConfig holds CORS configuration
type CORSConfig struct {
    AllowedOrigins []string `mapstructure:"allowed_origins"`
    AllowedMethods []string `mapstructure:"allowed_methods"`
    AllowedHeaders []string `mapstructure:"allowed_headers"`
}

// DatabaseConfig holds database configuration
type DatabaseConfig struct {
    Host         string `mapstructure:"host"`
    Port         int    `mapstructure:"port"`
    User         string `mapstructure:"user"`
    Password     string `mapstructure:"password"`
    DatabaseName string `mapstructure:"database_name"`
    SSLMode      string `mapstructure:"ssl_mode"`
    MaxOpenConns int    `mapstructure:"max_open_conns"`
    MaxIdleConns int    `mapstructure:"max_idle_conns"`
    MaxLifetime  int    `mapstructure:"max_lifetime"`
}

// StripeConfig holds Stripe configuration
type StripeConfig struct {
    APIKey          string `mapstructure:"api_key"`
    WebhookSecret   string `mapstructure:"webhook_secret"`
    WebhookEndpoint string `mapstructure:"webhook_endpoint"`
}

// EmailConfig holds email service configuration
type EmailConfig struct {
    Provider    string `mapstructure:"provider"`
    APIKey      string `mapstructure:"api_key"`
    FromAddress string `mapstructure:"from_address"`
    FromName    string `mapstructure:"from_name"`
}

// RedisConfig holds Redis configuration
type RedisConfig struct {
    Host     string `mapstructure:"host"`
    Port     int    `mapstructure:"port"`
    Password string `mapstructure:"password"`
    DB       int    `mapstructure:"db"`
}

// LoggingConfig holds logging configuration
type LoggingConfig struct {
    Level      string `mapstructure:"level"`
    Format     string `mapstructure:"format"`
    OutputPath string `mapstructure:"output_path"`
}

// ADD these new config structs
type CircuitBreakerConfig struct {
    MaxFailures int           `mapstructure:"max_failures"`
    Timeout     time.Duration `mapstructure:"timeout"`
    Interval    time.Duration `mapstructure:"interval"`
}

type RateLimitConfig struct {
    RequestsPerSecond int `mapstructure:"requests_per_second"`
    BurstSize         int `mapstructure:"burst_size"`
}

type MetricsConfig struct {
    Enabled bool   `mapstructure:"enabled"`
    Path    string `mapstructure:"path"`
    Port    int    `mapstructure:"port"`
}

// CacheConfig holds cache settings
type CacheConfig struct {
    Type    string        `mapstructure:"type"`
    TTL     time.Duration `mapstructure:"ttl"`
    MaxSize int           `mapstructure:"max_size"`
}

// TracingConfig holds tracing settings
type TracingConfig struct {
    Enabled        bool    `mapstructure:"enabled"`
    ServiceName    string  `mapstructure:"service_name"`
    JaegerEndpoint string  `mapstructure:"jaeger_endpoint"`
    SampleRate     float64 `mapstructure:"sample_rate"`
}

// Load loads configuration from files and environment variables
func Load() (*Config, error) {
    viper.SetConfigName("config")
    viper.SetConfigType("yaml")
    viper.AddConfigPath("./configs")
    viper.AddConfigPath(".")

    // Set default values
    setDefaults()

    // Enable environment variable reading
    viper.AutomaticEnv()
    viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

    // Read config file
    if err := viper.ReadInConfig(); err != nil {
        if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
            return nil, fmt.Errorf("failed to read config file: %w", err)
        }
    }

    var config Config
    if err := viper.Unmarshal(&config); err != nil {
        return nil, fmt.Errorf("failed to unmarshal config: %w", err)
    }

    return &config, nil
}

// setDefaults sets default configuration values
func setDefaults() {
    // Server defaults
    viper.SetDefault("server.port", 8080)
    viper.SetDefault("server.host", "0.0.0.0")
    viper.SetDefault("server.read_timeout", "30s")
    viper.SetDefault("server.write_timeout", "30s")
    viper.SetDefault("server.shutdown_timeout", "30s")

    // CORS defaults
    viper.SetDefault("server.cors.allowed_origins", []string{"*"})
    viper.SetDefault("server.cors.allowed_methods", []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"})
    viper.SetDefault("server.cors.allowed_headers", []string{"*"})

    // Database defaults
    viper.SetDefault("database.host", "localhost")
    viper.SetDefault("database.port", 5432)
    viper.SetDefault("database.user", "postgres")
    viper.SetDefault("database.database_name", "hotel_booking")
    viper.SetDefault("database.ssl_mode", "disable")
    viper.SetDefault("database.max_open_conns", 25)
    viper.SetDefault("database.max_idle_conns", 5)
    viper.SetDefault("database.max_lifetime", 5)

    // Email defaults
    viper.SetDefault("email.provider", "sendgrid")
    viper.SetDefault("email.from_address", "noreply@hotel-booking.com")
    viper.SetDefault("email.from_name", "Hotel Booking System")

    // Redis defaults
    viper.SetDefault("redis.host", "localhost")
    viper.SetDefault("redis.port", 6379)
    viper.SetDefault("redis.db", 0)

    // Logging defaults
    viper.SetDefault("logging.level", "info")
    viper.SetDefault("logging.format", "json")
    viper.SetDefault("logging.output_path", "stdout")
    // Logging defaults
    viper.SetDefault("logging.level", "info")
    viper.SetDefault("logging.format", "json")
    viper.SetDefault("logging.output_path", "stdout")

    // ADD Circuit breaker defaults
    viper.SetDefault("circuit_breaker.max_failures", 5)
    viper.SetDefault("circuit_breaker.timeout", "60s")
    viper.SetDefault("circuit_breaker.interval", "10s")

    // ADD Rate limit defaults
    viper.SetDefault("rate_limit.requests_per_second", 100)
    viper.SetDefault("rate_limit.burst_size", 200)

    // ADD Metrics defaults
    viper.SetDefault("metrics.enabled", true)
    viper.SetDefault("metrics.path", "/metrics")
    viper.SetDefault("metrics.port", 9090)

    // Cache defaults
    viper.SetDefault("cache.type", "redis")
    viper.SetDefault("cache.ttl", "5m")
    viper.SetDefault("cache.max_size", 1000)

    // Tracing defaults
    viper.SetDefault("tracing.enabled", true)
    viper.SetDefault("tracing.service_name", "hotel-booking-dev")
    viper.SetDefault("tracing.jaeger_endpoint", "http://localhost:14268/api/traces")
    viper.SetDefault("tracing.sample_rate", 1.0)
}

// GetDSN returns the PostgreSQL connection string
func (c *DatabaseConfig) GetDSN() string {
    return fmt.Sprintf(
        "host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
        c.Host,
        c.Port,
        c.User,
        c.Password,
        c.DatabaseName,
        c.SSLMode,
    )
}

// GetRedisAddr returns the Redis connection address
func (c *RedisConfig) GetRedisAddr() string {
    return fmt.Sprintf("%s:%d", c.Host, c.Port)
}
```

### 4.4.2 Environment-Specific Configuration Files

```yaml
# configs/config.yaml - Development configuration
server:
  port: 8080
  host: "0.0.0.0"
  read_timeout: "30s"
  write_timeout: "30s"
  shutdown_timeout: "30s"
  cors:
    allowed_origins: ["http://localhost:3000", "http://localhost:8080"]
    allowed_methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allowed_headers: ["*"]

database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: "password"
  database_name: "hotel_booking_dev"
  ssl_mode: "disable"
  max_open_conns: 25
  max_idle_conns: 5
  max_lifetime: 5

stripe:
  api_key: "sk_test_..."
  webhook_secret: "whsec_..."
  webhook_endpoint: "/api/webhooks/stripe"

email:
  provider: "sendgrid"
  api_key: "SG...."
  from_address: "noreply@hotel-booking.dev"
  from_name: "Hotel Booking System (Dev)"

redis:
  host: "localhost"
  port: 6379
  password: ""
  db: 0

logging:
  level: "debug"
  format: "text"
  output_path: "stdout"

circuit_breaker:
  max_failures: 3
  timeout: "30s"
  interval: "5s"

rate_limit:
  requests_per_second: 50
  burst_size: 100

metrics:
  enabled: true
  path: "/metrics"
  port: 9090

cache:
  type: "redis"
  ttl: "5m"
  max_size: 1000

tracing:
  enabled: true
  service_name: "hotel-booking-dev"
  jaeger_endpoint: "http://localhost:14268/api/traces"
  sample_rate: 1.0
```

```yaml
# configs/config.prod.yaml - Production configuration
server:
  port: 8080
  host: "0.0.0.0"
  read_timeout: "30s"
  write_timeout: "30s"
  shutdown_timeout: "30s"
  cors:
    allowed_origins: ["https://hotel-booking.com"]
    allowed_methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allowed_headers: ["Content-Type", "Authorization"]

database:
  host: "${DB_HOST}"
  port: 5432
  user: "${DB_USER}"
  password: "${DB_PASSWORD}"
  database_name: "${DB_NAME}"
  ssl_mode: "require"
  max_open_conns: 100
  max_idle_conns: 20
  max_lifetime: 10

stripe:
  api_key: "${STRIPE_API_KEY}"
  webhook_secret: "${STRIPE_WEBHOOK_SECRET}"
  webhook_endpoint: "/api/webhooks/stripe"

email:
  provider: "sendgrid"
  api_key: "${SENDGRID_API_KEY}"
  from_address: "noreply@hotel-booking.com"
  from_name: "Hotel Booking System"

redis:
  host: "${REDIS_HOST}"
  port: 6379
  password: "${REDIS_PASSWORD}"
  db: 0

logging:
  level: "info"
  format: "json"
  output_path: "/var/log/hotel-booking/app.log"

circuit_breaker:
  max_failures: 5
  timeout: "60s"
  interval: "10s"

rate_limit:
  requests_per_second: 1000
  burst_size: 2000

metrics:
  enabled: true
  path: "/metrics"
  port: 9090

cache:
  type: "redis"
  ttl: "10m"
  max_size: 10000

tracing:
  enabled: true
  service_name: "hotel-booking-prod"
  jaeger_endpoint: "${JAEGER_ENDPOINT}"
  sample_rate: 0.1
```

## 4.5 Summary and Best Practices

This comprehensive Go hotel booking system architecture demonstrates several key patterns and practices:

### Domain-Driven Design Implementation

- **Rich Domain Models**: Entities with behavior, not just data containers
- **Value Objects**: Immutable objects representing domain concepts
- **Domain Services**: Business logic that doesn't fit within entities
- **Domain Events**: Communication mechanism between aggregates
- **Bounded Contexts**: Clear separation of business concerns

### Clean Architecture Principles

- **Dependency Inversion**: Domain layer independent of infrastructure
- **Interface Segregation**: Small, focused interfaces
- **Single Responsibility**: Each layer has distinct responsibilities
- **Open/Closed Principle**: Extensible without modification

### Go-Specific Best Practices

- **Package Structure**: Following Go standard project layout
- **Error Handling**: Explicit error handling with custom domain errors
- **Interface Design**: Small, composable interfaces
- **Concurrency**: Goroutines for event publishing and processing
- **Testing**: Comprehensive unit, integration, and e2e tests

### Scalability Considerations

- **Modular Monolith**: Easy to extract to microservices
- **Event-Driven Architecture**: Loose coupling between contexts
- **Database Patterns**: Repository pattern with interface abstractions
- **Configuration Management**: Environment-specific configurations

### Operational Excellence

- **Observability**: Structured logging with contextual information
- **Graceful Shutdown**: Proper resource cleanup and connection handling
- **Health Checks**: Application and dependency health monitoring
- **Configuration**: Flexible, environment-aware configuration management

This architecture provides a solid foundation for building a scalable, maintainable hotel booking system in Go while following DDD principles and Go community best practices. The modular structure allows for independent development and testing of bounded contexts while maintaining clear integration patterns for system-wide consistency.
