# 2. Technical Foundation - Go Architecture and Technology Stack

## 2.1 Technology Stack Alignment with Strategic Design

The technical foundation supports the strategic design decisions, prioritizing Go best practices, type safety, and architectural flexibility:

### Core Technology Decisions

**Go Ecosystem Choices:**

- **HTTP Framework**: Gin or Echo for REST API development
- **Database**: PostgreSQL with GORM or SQLx for type-safe database operations
- **Authentication**: golang-jwt for JWT token handling
- **Configuration**: Viper for configuration management
- **Logging**: Zap or Logrus for structured logging
- **Testing**: Built-in `testing` package with Testify for assertions
- **Migration**: golang-migrate for database migrations

**External Service Integration:**

- **Payment Processing**: Stripe Go SDK
- **Email Service**: SendGrid or AWS SES Go SDK
- **Monitoring**: Prometheus metrics with Go client library
- **Documentation**: Swagger/OpenAPI with go-swagger

**Development Tools:**

- **Dependency Injection**: Wire for compile-time dependency injection
- **Code Generation**: go:generate for boilerplate reduction
- **Linting**: golangci-lint for comprehensive code analysis
- **Hot Reload**: Air for development server auto-reload

**Resilience and Observability:**

- **Circuit Breaker**: github.com/sony/gobreaker for external service resilience
- **Metrics**: Prometheus Go client for application metrics
- **Tracing**: OpenTelemetry for distributed tracing
- **Rate Limiting**: golang.org/x/time/rate for API rate limiting

## 2.2 Go Project Structure Following Standard Layout

The project follows Go's standard project layout adapted for DDD principles:

```text
hotel-booking-system/
├── cmd/
│   ├── api/                          # REST API server
│   │   └── main.go
│   ├── worker/                       # Background job processor
│   │   └── main.go
│   └── migrate/                      # Database migration tool
│       └── main.go
├── internal/                         # Private application code
│   ├── reservation/                  # Reservations & Booking bounded context
│   │   ├── domain/                   # Domain layer
│   │   │   ├── entity/               # Domain entities
│   │   │   ├── valueobject/          # Value objects
│   │   │   ├── service/              # Domain services
│   │   │   ├── event/                # Domain events
│   │   │   ├── specification/        # Domain specifications
│   │   │   ├── saga/                 # Business process orchestration
│   │   │   └── repository/           # Repository interfaces
│   │   ├── application/              # Application layer
│   │   │   ├── command/              # Command handlers
│   │   │   ├── query/                # Query handlers
│   │   │   ├── service/              # Application services
│   │   │   ├── projection/           # Read model projections
│   │   │   └── saga/                 # Saga orchestrators
│   │   ├── infrastructure/           # Infrastructure layer
│   │   │   ├── persistence/          # Database implementations
│   │   │   ├── external/             # External service adapters
│   │   │   ├── messaging/            # Event publishing
│   │   │   ├── resilience/           # Circuit breakers, retries
│   │   │   └── cache/                # Caching implementations
│   │   └── presentation/             # Presentation layer
│   │       ├── http/                 # HTTP handlers
│   │       └── dto/                  # Data transfer objects
│   ├── inventory/                    # Hotel & Room Management context
│   ├── guest/                        # Customer Identity & Access context
│   ├── billing/                      # Billing & Payments context
│   ├── notification/                 # Notification & Communication context
│   └── shared/                       # Shared domain concepts
│       ├── domain/                   # Common domain types
│       ├── infrastructure/           # Shared infrastructure
│       │   ├── cache/                # Caching abstractions
│       │   ├── messaging/            # Event bus and outbox
│       │   ├── metrics/              # Prometheus metrics
│       │   ├── tracing/              # OpenTelemetry tracing
│       │   ├── resilience/           # Circuit breakers
│       │   ├── middleware/           # HTTP middleware
│       │   └── database/             # Database utilities
│       └── util/                     # Utility functions
├── pkg/                              # Public library code (if needed)
├── api/                              # API definitions
│   ├── openapi/                      # OpenAPI specifications
│   └── proto/                        # Protocol buffer definitions (if using gRPC)
├── web/                              # Web frontend (if serving web UI)
│   ├── static/                       # Static assets
│   └── templates/                    # HTML templates
├── configs/                          # Configuration files
│   ├── config.yaml
│   ├── config.prod.yaml
│   └── config.test.yaml
├── deployments/                      # Deployment configurations
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   └── kubernetes/
│       ├── deployment.yaml
│       └── service.yaml
├── scripts/                          # Build and deployment scripts
│   ├── build.sh
│   ├── deploy.sh
│   ├── test.sh
│   └── migrate.sh
├── migrations/                       # Database migrations
│   ├── 001_create_schemas.up.sql
│   ├── 001_create_schemas.down.sql
│   ├── 002_create_reservations.up.sql
│   └── 002_create_reservations.down.sql
├── docs/                             # Documentation
│   ├── api/                          # API documentation
│   ├── architecture/                 # Architecture decisions
│   └── deployment/                   # Deployment guides
├── test/                             # Test utilities and fixtures
│   ├── fixtures/                     # Test data
│   ├── integration/                  # Integration tests
│   └── e2e/                          # End-to-end tests
├── .env.example                      # Environment variables template
├── .gitignore                        # Git ignore rules
├── .golangci.yml                     # Linter configuration
├── Dockerfile                        # Docker configuration
├── Makefile                          # Build automation
├── go.mod                            # Go module definition
└── go.sum                            # Go module checksums
```

## 2.3 Data Architecture and Consistency

### Database Design Strategy

**PostgreSQL Schema Organization:**

- **Schema-per-Context**: Logical separation of bounded contexts within PostgreSQL
- **Shared Tables**: Common entities (audit logs, events) in shared schema
- **Migration Strategy**: Context-specific migrations with dependency management

```sql
-- Example schema organization
CREATE SCHEMA reservation;
CREATE SCHEMA inventory;
CREATE SCHEMA guest;
CREATE SCHEMA billing;
CREATE SCHEMA notification;
CREATE SCHEMA shared;

-- Shared schema for cross-cutting concerns
CREATE TABLE shared.outbox_events (
    id UUID PRIMARY KEY,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    retry_count INTEGER DEFAULT 0
);

CREATE INDEX idx_outbox_events_processed ON shared.outbox_events(processed_at);
CREATE INDEX idx_outbox_events_created ON shared.outbox_events(created_at);
```

**Go Database Integration:**

```go
// Enhanced database connection configuration
type DatabaseConfig struct {
    Host         string `mapstructure:"host"`
    Port         int    `mapstructure:"port"`
    User         string `mapstructure:"user"`
    Password     string `mapstructure:"password"`
    DBName       string `mapstructure:"dbname"`
    SSLMode      string `mapstructure:"sslmode"`
    MaxOpenConns int    `mapstructure:"max_open_conns"`
    MaxIdleConns int    `mapstructure:"max_idle_conns"`
    MaxLifetime  int    `mapstructure:"max_lifetime"`

    // Connection pool settings
    ConnMaxIdleTime time.Duration `mapstructure:"conn_max_idle_time"`
    ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`

    // Performance settings
    SlowQueryThreshold time.Duration `mapstructure:"slow_query_threshold"`
    LogLevel          string        `mapstructure:"log_level"`
}

// Enhanced repository interface with specifications
type ReservationRepository interface {
    Create(ctx context.Context, reservation *domain.Reservation) error
    GetByID(ctx context.Context, id string) (*domain.Reservation, error)
    Update(ctx context.Context, reservation *domain.Reservation) error
    Delete(ctx context.Context, id string) error
    FindByGuestID(ctx context.Context, guestID string) ([]*domain.Reservation, error)

    // Advanced querying with specifications
    FindBySpecification(ctx context.Context, spec Specification, limit, offset int) ([]*domain.Reservation, error)
    CountBySpecification(ctx context.Context, spec Specification) (int64, error)

    // Batch operations for performance
    CreateBatch(ctx context.Context, reservations []*domain.Reservation) error
    UpdateBatch(ctx context.Context, reservations []*domain.Reservation) error
}

// Specification interface for complex queries
type Specification interface {
    ToSQL() (string, []interface{})
    IsSatisfiedBy(reservation *domain.Reservation) bool
}
```

### Enhanced Consistency Patterns

**Strong Consistency**: Within bounded context boundaries using database transactions

**Eventual Consistency**: Between contexts using domain events and outbox pattern

**Concurrency Control**:

- Optimistic locking with version fields for reservation conflicts
- Pessimistic locking for critical inventory operations
- Distributed locks using Redis for cross-service coordination

## 2.4 Development and Deployment Strategy

### MVP Development Approach

**Incremental Development:**

1. Start with core MVP contexts (Reservations, Rooms, Guests, Payments, Notifications)
2. Implement basic functionality before adding complexity
3. Use static pricing initially, defer dynamic pricing to post-MVP
4. Focus on direct bookings before external integrations

**Testing Strategy:**

```go
// Unit test example with table-driven tests
func TestReservation_Confirm(t *testing.T) {
    tests := []struct {
        name          string
        initialStatus domain.BookingStatus
        expectError   bool
        expectedStatus domain.BookingStatus
    }{
        {
            name:          "confirm pending reservation",
            initialStatus: domain.StatusPending,
            expectError:   false,
            expectedStatus: domain.StatusConfirmed,
        },
        {
            name:          "cannot confirm already confirmed",
            initialStatus: domain.StatusConfirmed,
            expectError:   true,
            expectedStatus: domain.StatusConfirmed,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // Given
            reservation := domain.NewReservation(...)
            reservation.SetStatus(tt.initialStatus)

            // When
            err := reservation.Confirm()

            // Then
            if tt.expectError {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
            }
            assert.Equal(t, tt.expectedStatus, reservation.Status())
        })
    }
}

// Integration test with testcontainers
func TestReservationService_CreateReservation(t *testing.T) {
    // Setup test database with testcontainers
    ctx := context.Background()
    container, db := setupTestDatabase(ctx, t)
    defer container.Terminate(ctx)
    defer db.Close()

    // Setup service with real dependencies
    service := NewReservationService(db)

    // Test integration between service and repository
    reservation, err := service.CreateReservation(ctx, "guest-123", "room-type-1", time.Now(), time.Now().AddDate(0, 0, 1))

    assert.NoError(t, err)
    assert.NotNil(t, reservation)
    assert.Equal(t, domain.StatusPending, reservation.Status())
}

// Benchmark tests for performance
func BenchmarkReservationService_CreateReservation(b *testing.B) {
    service := setupBenchmarkService(b)

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, err := service.CreateReservation(context.Background(),
            fmt.Sprintf("guest-%d", i),
            "room-type-1",
            time.Now(),
            time.Now().AddDate(0, 0, 1))
        if err != nil {
            b.Fatal(err)
        }
    }
}
```

**Performance and Monitoring Strategy:**

```go
// Comprehensive metrics collection
type MetricsCollector struct {
    requestDuration   *prometheus.HistogramVec
    requestCount      *prometheus.CounterVec
    errorCount        *prometheus.CounterVec
    activeConnections prometheus.Gauge
    cacheHitRate      *prometheus.CounterVec
    eventProcessingTime *prometheus.HistogramVec
}

func NewMetricsCollector() *MetricsCollector {
    return &MetricsCollector{
        requestDuration: prometheus.NewHistogramVec(
            prometheus.HistogramOpts{
                Name: "http_request_duration_seconds",
                Help: "HTTP request duration in seconds",
                Buckets: prometheus.DefBuckets,
            },
            []string{"method", "endpoint", "status"},
        ),
        requestCount: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "http_requests_total",
                Help: "Total number of HTTP requests",
            },
            []string{"method", "endpoint", "status"},
        ),
        errorCount: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "application_errors_total",
                Help: "Total number of application errors",
            },
            []string{"type", "context"},
        ),
        activeConnections: prometheus.NewGauge(
            prometheus.GaugeOpts{
                Name: "database_connections_active",
                Help: "Number of active database connections",
            },
        ),
        cacheHitRate: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "cache_operations_total",
                Help: "Total number of cache operations",
            },
            []string{"operation", "result"},
        ),
        eventProcessingTime: prometheus.NewHistogramVec(
            prometheus.HistogramOpts{
                Name: "event_processing_duration_seconds",
                Help: "Event processing duration in seconds",
            },
            []string{"event_type", "handler"},
        ),
    }
}

// Circuit breaker configuration for external services
type CircuitBreakerConfig struct {
    MaxFailures     int           `mapstructure:"max_failures"`
    Timeout         time.Duration `mapstructure:"timeout"`
    Interval        time.Duration `mapstructure:"interval"`
    HalfOpenMaxCalls int          `mapstructure:"half_open_max_calls"`
}

// Rate limiting configuration
type RateLimitConfig struct {
    RequestsPerSecond int           `mapstructure:"requests_per_second"`
    BurstSize         int           `mapstructure:"burst_size"`
    CleanupInterval   time.Duration `mapstructure:"cleanup_interval"`
}

// Caching configuration
type CacheConfig struct {
    Type        string        `mapstructure:"type"` // redis, memory
    TTL         time.Duration `mapstructure:"ttl"`
    MaxSize     int           `mapstructure:"max_size"`
    RedisAddr   string        `mapstructure:"redis_addr"`
    RedisDB     int           `mapstructure:"redis_db"`
    RedisPassword string      `mapstructure:"redis_password"`
}

// Tracing configuration
type TracingConfig struct {
    Enabled      bool    `mapstructure:"enabled"`
    ServiceName  string  `mapstructure:"service_name"`
    JaegerURL    string  `mapstructure:"jaeger_url"`
    SampleRate   float64 `mapstructure:"sample_rate"`
}
```

### Deployment and Operations

**Docker Configuration:**

```dockerfile
# Multi-stage build for optimized production image
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main cmd/api/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/

COPY --from=builder /app/main .
COPY --from=builder /app/configs ./configs
COPY --from=builder /app/migrations ./migrations

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["./main"]
```

**Kubernetes Deployment:**

```yaml
# deployments/kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: hotel-booking-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: hotel-booking-api
  template:
    metadata:
      labels:
        app: hotel-booking-api
    spec:
      containers:
      - name: api
        image: hotel-booking-api:latest
        ports:
        - containerPort: 8080
        env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: host
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```
