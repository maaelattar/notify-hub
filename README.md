# NotifyHub API

<p align="center">
  <strong>🚀 Enterprise-grade notification delivery platform built with NestJS</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
</p>

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [Monitoring](#monitoring)
- [Contributing](#contributing)

## 🌟 Overview

NotifyHub is a scalable, multi-channel notification delivery platform designed for enterprise applications. It provides reliable message delivery across email, SMS, push notifications, and webhooks with advanced features like queue management, retry logic, rate limiting, and comprehensive monitoring.

### Key Benefits

- **🔧 Multi-Channel Support**: Email, SMS, Push, Webhook delivery
- **⚡ High Performance**: Redis-backed queue processing with Bull
- **🔒 Enterprise Security**: API key authentication, rate limiting, CORS
- **📊 Advanced Monitoring**: Health checks, metrics, error tracking
- **🔄 Reliability**: Automatic retries, dead letter queues, circuit breakers
- **🎨 Template System**: Handlebars-based email templates
- **📈 Scalability**: Horizontal scaling support with Redis clustering

## ✨ Features

### Core Functionality
- ✅ Multi-channel notification delivery (Email, SMS, Push, Webhook)
- ✅ Template-based content management with Handlebars
- ✅ Queue-based processing with Bull and Redis
- ✅ Automatic retry logic with exponential backoff
- ✅ Dead letter queue handling
- ✅ Batch notification processing

### Security & Authentication
- ✅ API key-based authentication
- ✅ Rate limiting with Redis storage
- ✅ CORS protection
- ✅ Input validation and sanitization
- ✅ Webhook signature verification

### Monitoring & Observability
- ✅ Comprehensive health checks
- ✅ Prometheus-compatible metrics
- ✅ Structured logging with correlation IDs
- ✅ Performance monitoring
- ✅ Error tracking and alerting

### DevOps & Operations
- ✅ Docker containerization
- ✅ Docker Compose for local development
- ✅ SonarQube integration for code quality
- ✅ Environment-based configuration
- ✅ Database migrations with TypeORM

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Gateway   │    │  Notification   │    │    Channel      │
│   (NestJS)      │────│    Service      │────│    Router       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   PostgreSQL    │    │      Redis      │    │   Channel       │
│   (Database)    │    │   (Queue/Cache) │    │ Implementations │
│                 │    │                 │    │ (Email/SMS/etc) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Technology Stack

- **Framework**: NestJS with TypeScript
- **Database**: PostgreSQL with TypeORM
- **Queue**: Redis with Bull
- **Cache**: Redis
- **Email**: Nodemailer with Handlebars templates
- **Monitoring**: Custom health checks + Prometheus metrics
- **Testing**: Jest with comprehensive test coverage
- **Code Quality**: ESLint, Prettier, SonarQube

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Docker and Docker Compose
- PostgreSQL 14+
- Redis 6+

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd notifyhub-api
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Start infrastructure services**
   ```bash
   docker-compose up -d postgres redis
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

5. **Run database migrations**
   ```bash
   pnpm run migration:run
   ```

6. **Start the application**
   ```bash
   pnpm run start:dev
   ```

The API will be available at `http://localhost:3000` with Swagger documentation at `http://localhost:3000/api`.

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `development` | No |
| `PORT` | Application port | `3000` | No |
| `DATABASE_URL` | PostgreSQL connection string | - | Yes |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | No |
| `SMTP_HOST` | SMTP server hostname | - | Production only |
| `SMTP_PORT` | SMTP server port | `587` | No |
| `SMTP_USER` | SMTP username | - | Production only |
| `SMTP_PASS` | SMTP password | - | Production only |
| `API_KEY_SECRET` | Secret for API key generation | - | Yes |
| `CORS_ORIGIN` | Allowed CORS origins | `*` | No |

### Email Configuration

For development, the system uses Ethereal Email for testing. For production:

```env
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-username
SMTP_PASS=your-password
SMTP_FROM="Your App <noreply@yourapp.com>"
```

## 📚 API Documentation

### Authentication

All API endpoints require authentication via API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/notifications
```

### Core Endpoints

#### Send Notification
```http
POST /api/notifications
Content-Type: application/json
X-API-Key: your-api-key

{
  "channel": "email",
  "recipient": "user@example.com",
  "subject": "Welcome!",
  "content": "Welcome to our platform",
  "priority": "high",
  "metadata": {
    "template": "welcome",
    "userId": "123"
  }
}
```

#### Get Notification Status
```http
GET /api/notifications/{id}
X-API-Key: your-api-key
```

#### Health Check
```http
GET /api/health
```

### Swagger Documentation

Interactive API documentation is available at `/api` when running the application.

## 🛠️ Development

### Project Structure

```
src/
├── common/                 # Shared utilities and decorators
│   ├── decorators/        # Custom decorators
│   ├── filters/           # Exception filters
│   ├── guards/            # Authentication guards
│   ├── interceptors/      # Request/response interceptors
│   └── services/          # Shared services
├── modules/
│   ├── channels/          # Notification channels
│   │   ├── email/         # Email channel implementation
│   │   └── interfaces/    # Channel interfaces
│   ├── notifications/     # Core notification module
│   │   ├── entities/      # Database entities
│   │   ├── processors/    # Queue processors
│   │   └── services/      # Business logic
│   ├── monitoring/        # Health checks and metrics
│   └── security/          # Authentication and security
├── config/                # Configuration files
└── main.ts               # Application bootstrap
```

### Development Commands

```bash
# Start development server
pnpm run start:dev

# Run tests
pnpm run test
pnpm run test:e2e
pnpm run test:cov

# Code quality
pnpm run lint
pnpm run lint:fix
pnpm run format

# Database operations
pnpm run migration:generate
pnpm run migration:run
pnpm run migration:revert

# Build for production
pnpm run build
pnpm run start:prod
```

### Code Quality Standards

- **ESLint**: Enforces coding standards
- **Prettier**: Code formatting
- **SonarQube**: Code quality analysis
- **Jest**: Unit and integration testing
- **TypeScript**: Strict type checking

## 🧪 Testing

### Running Tests

```bash
# Unit tests
pnpm run test

# Integration tests
pnpm run test:e2e

# Test coverage
pnpm run test:cov

# Watch mode
pnpm run test:watch
```

### Test Structure

- **Unit Tests**: Located alongside source files (`*.spec.ts`)
- **Integration Tests**: Located in `test/` directory
- **Coverage**: Minimum 80% coverage required

## 🚢 Deployment

### Docker Deployment

1. **Build the image**
   ```bash
   docker build -t notifyhub-api .
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up -d
   ```

### Production Considerations

- **Environment Variables**: Ensure all required variables are set
- **Database**: Run migrations before deployment
- **SSL/TLS**: Configure HTTPS termination
- **Load Balancing**: Use multiple instances behind a load balancer
- **Monitoring**: Set up external monitoring and alerting

### Health Checks

The application provides comprehensive health checks:

- `/health` - Basic health status
- `/health/detailed` - Detailed component health
- Database connectivity
- Redis connectivity
- Queue status
- External service availability

## 📊 Monitoring

### Metrics

The application exposes metrics compatible with Prometheus:

- Request duration and counts
- Queue processing metrics
- Channel delivery success rates
- Error rates by type
- Database connection pool status

### Logging

Structured logging with correlation IDs for request tracing:

```json
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "level": "info",
  "correlationId": "abc123",
  "message": "Notification sent",
  "notificationId": "uuid",
  "channel": "email"
}
```

### Error Tracking

- Comprehensive error handling with structured responses
- Automatic error categorization
- Stack trace capture in development
- Rate limiting to prevent abuse

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write comprehensive tests
- Update documentation
- Ensure code quality passes SonarQube checks
- Use conventional commits

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Built with ❤️ using NestJS and TypeScript</strong>
</p>