---
name: clean-ddd-hexagonal
description: Proactively apply when designing APIs, microservices, or scalable backend structure. Triggers on DDD, Clean Architecture, Hexagonal, ports and adapters, entities, value objects, domain events, CQRS, event sourcing, repository pattern, use cases, onion architecture, outbox pattern, aggregate root, anti-corruption layer. Use when working with domain models, aggregates, repositories, or bounded contexts. Clean Architecture + DDD + Hexagonal patterns for backend services, language-agnostic (Go, Rust, Python, TypeScript, Java, C#).
---

# Clean Architecture + DDD + Hexagonal

Backend architecture combining DDD tactical patterns, Clean Architecture dependency rules, and Hexagonal ports/adapters for maintainable, testable systems.

This skill is an **opinionated synthesis** of several related architecture traditions. It is not a single canonical architecture model. Use the original source that matches the design question you are answering: DDD for domain modeling, Hexagonal Architecture for ports/adapters, Clean Architecture for dependency direction, Onion Architecture for domain-centered layering, and CQRS/Event Sourcing only for specific read/write or temporal requirements.

## When to Use (and When NOT to)

| Use When | Skip When |
|----------|-----------|
| Complex business domain with many rules | Simple CRUD, few business rules |
| Long-lived system (years of maintenance) | Prototype, MVP, throwaway code |
| Team of 5+ developers | Solo developer or small team (1-2) |
| Multiple entry points (API, CLI, events) | Single entry point, simple API |
| Need to swap infrastructure (DB, broker) | Fixed infrastructure, unlikely to change |
| High test coverage required | Quick scripts, internal tools |

**Start simple. Evolve complexity only when needed.** Most systems don't need full CQRS or Event Sourcing.

## Pattern Boundaries

| Pattern | Primary Question | Use It For | Do Not Treat As |
|---------|------------------|------------|-----------------|
| **DDD** | How do we model a complex business domain? | Ubiquitous language, bounded contexts, aggregates, value objects | A folder structure by itself |
| **Hexagonal Architecture** | How does the application interact with the outside world? | Ports, driver adapters, driven adapters, testable application core | A mandate for six sides or one exact package layout |
| **Clean Architecture** | Which direction should dependencies point? | Inward dependency rule, use case boundaries, framework independence | A universal four-folder template |
| **Onion Architecture** | How do we keep the domain model central? | Domain-centered layers and dependency inversion | A separate requirement when Clean/Hexagonal already solve the local problem |
| **CQRS** | Do reads and writes need different models? | Bounded contexts with divergent read/write workloads | A default application architecture |
| **Event Sourcing** | Do we need state from a complete event history? | Audit, temporal queries, replayable workflows | A persistence default for CRUD systems |

## CRITICAL: The Dependency Rule

Dependencies point **inward only**. Outer layers depend on inner layers, never the reverse.

```
Infrastructure → Application → Domain
   (adapters)     (use cases)    (core)
```

**Violations to catch:**
- Domain importing database/HTTP libraries
- In this architecture style, controllers calling repositories directly instead of application use cases
- Entities depending on application services

**Design validation:** "Create your application to work without either a UI or a database" — Alistair Cockburn. If you can run your domain logic from tests with no infrastructure, your boundaries are correct.

## Quick Decision Trees

### "Where does this code go?"

```
Where does it go?
├─ Pure business logic, no I/O           → domain/
├─ Orchestrates domain + has side effects → application/
├─ Talks to external systems              → infrastructure/
├─ Defines HOW to interact (interface)    → port (domain or application)
└─ Implements a port                      → adapter (infrastructure)
```

### "Is this an Entity or Value Object?"

```
Entity or Value Object?
├─ Has unique identity that persists → Entity
├─ Defined only by its attributes    → Value Object
├─ "Is this THE same thing?"         → Entity (identity comparison)
└─ "Does this have the same value?"  → Value Object (structural equality)
```

### "Should this be its own Aggregate?"

```
Aggregate boundaries?
├─ Must be consistent together in a transaction → Same aggregate
├─ Can be eventually consistent                 → Separate aggregates
├─ Referenced by ID only                        → Separate aggregates
└─ >10 entities in aggregate                    → Split it
```

**Rule:** One aggregate per transaction. Cross-aggregate consistency via domain events (eventual consistency).

## Directory Structure

```
src/
├── domain/                    # Core business logic (NO external dependencies)
│   ├── {aggregate}/
│   │   ├── entity              # Aggregate root + child entities
│   │   ├── value_objects       # Immutable value types
│   │   ├── events              # Domain events
│   │   ├── repository          # DDD repository interface (driven port)
│   │   └── services            # Domain services (stateless logic)
│   └── shared/
│       └── errors              # Domain errors
├── application/               # Use cases / Application services
│   ├── {use-case}/
│   │   ├── command             # Command/Query DTOs
│   │   ├── handler             # Use case implementation
│   │   └── port                # Driver port interface
│   └── shared/
│       └── unit_of_work        # Transaction abstraction
├── infrastructure/            # Adapters (external concerns)
│   ├── persistence/           # Database adapters
│   ├── messaging/             # Message broker adapters
│   ├── http/                  # REST/GraphQL adapters (DRIVER)
│   └── config/
│       └── di                  # Dependency injection / composition root
└── main                        # Bootstrap / entry point
```

**Port placement:** This skill defaults to a DDD-centered layout where aggregate repository interfaces live beside the aggregate in `domain/`. A stricter Hexagonal layout may instead put driven ports under `application/ports/driven/`. Pick one convention per codebase and keep the dependency rule intact.

## DDD Building Blocks

| Pattern | Purpose | Layer | Key Rule |
|---------|---------|-------|----------|
| **Entity** | Identity + behavior | Domain | Equality by ID |
| **Value Object** | Immutable data | Domain | Equality by value, no setters |
| **Aggregate** | Consistency boundary | Domain | Only root is referenced externally |
| **Domain Event** | Record of change | Domain | Past tense naming (`OrderPlaced`) |
| **Repository** | Persistence abstraction | Domain (port) | Per aggregate, not per table |
| **Domain Service** | Stateless logic | Domain | When logic doesn't fit an entity |
| **Application Service** | Orchestration | Application | Coordinates domain + infra |

## Anti-Patterns (CRITICAL)

| Anti-Pattern | Problem | Fix |
|--------------|---------|-----|
| **Anemic Domain Model** | Entities are data bags, logic in services | Move behavior INTO entities |
| **Repository per Entity** | Breaks aggregate boundaries | One repository per AGGREGATE |
| **Leaking Infrastructure** | Domain imports DB/HTTP libs | Domain has ZERO external deps |
| **God Aggregate** | Too many entities, slow transactions | Split into smaller aggregates |
| **Skipping Use Cases** | Controllers call repositories directly in a use-case architecture | Route through application use cases |
| **CRUD Thinking** | Modeling data, not behavior | Model business operations |
| **Premature CQRS** | Adding complexity before needed | Start with simple read/write, evolve |
| **Cross-Aggregate TX** | Multiple aggregates in one transaction | Use domain events for consistency |

## Implementation Order

1. **Discover the Domain** — Event Storming, conversations with domain experts
2. **Model the Domain** — Entities, value objects, aggregates (no infra)
3. **Define Ports** — Repository interfaces, external service interfaces
4. **Implement Use Cases** — Application services coordinating domain
5. **Add Adapters last** — HTTP, database, messaging implementations

**DDD is collaborative.** Modeling sessions with domain experts are as important as the code patterns.

## Reference Documentation

| File | Purpose |
|------|---------|
| [references/LAYERS.md](references/LAYERS.md) | Complete layer specifications |
| [references/DDD-STRATEGIC.md](references/DDD-STRATEGIC.md) | Bounded contexts, context mapping |
| [references/DDD-TACTICAL.md](references/DDD-TACTICAL.md) | Entities, value objects, aggregates (pseudocode) |
| [references/HEXAGONAL.md](references/HEXAGONAL.md) | Ports, adapters, naming |
| [references/CQRS-EVENTS.md](references/CQRS-EVENTS.md) | Command/query separation, events |
| [references/TESTING.md](references/TESTING.md) | Unit, integration, architecture tests |
| [references/CHEATSHEET.md](references/CHEATSHEET.md) | Quick decision guide |

## Sources

### Primary Sources
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn (2005)
- [Domain-Driven Design: The Blue Book](https://www.domainlanguage.com/ddd/blue-book/) — Eric Evans (2003)
- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — Robert C. Martin (2012)
- [Onion Architecture](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) — Jeffrey Palermo (2008)
- [Implementing Domain-Driven Design](https://openlibrary.org/works/OL17392277W) — Vaughn Vernon (2013)

### Primary Pattern References
- [CQRS](https://martinfowler.com/bliki/CQRS.html) — Martin Fowler
- [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) — Martin Fowler
- [Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html) — Martin Fowler (PoEAA)
- [Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html) — Martin Fowler (PoEAA)
- [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) — Martin Fowler
- [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) — microservices.io
- [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) — Vaughn Vernon

### Implementation Guides
- [Microsoft: DDD + CQRS Microservices](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/)
- [Domain Events](https://udidahan.com/2009/06/14/domain-events-salvation/) — Udi Dahan

### Supplemental Syntheses
- [Clean Architecture: Standing on the Shoulders of Giants](https://herbertograca.com/2017/09/28/clean-architecture-standing-on-the-shoulders-of-giants/) — Herberto Graça
- [Explicit Architecture](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — Herberto Graça (opinionated synthesis, not canonical source)
- [Get Your Hands Dirty on Clean Architecture](https://reflectoring.io/book/) — Tom Hombergs
