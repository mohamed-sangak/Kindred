# Kindred — Social Platform Backend

> A social-networking backend that serves three coordinated API surfaces — REST, GraphQL, and WebSocket — over a single shared domain core (MongoDB + Redis + S3).

Kindred is the product name; the codebase identifier is `social-app` (it appears in `package.json`, the OpenAPI title, and the S3 key prefix). The two refer to the same system.

---

## Table of Contents

1. [Overview & Problem Statement](#1-overview--problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [Design Principles & Patterns](#3-design-principles--patterns)
4. [Layer-by-Layer Breakdown](#4-layer-by-layer-breakdown)
5. [Tech Stack & Rationale](#5-tech-stack--rationale)
6. [Project Structure](#6-project-structure)
7. [Key Engineering Decisions & Trade-offs](#7-key-engineering-decisions--trade-offs)
8. [Testing & Verification Strategy](#8-testing--verification-strategy)
9. [Setup, Configuration & Local Development](#9-setup-configuration--local-development)
10. [API Reference](#10-api-reference)
11. [Observability, Error Handling & Resilience](#11-observability-error-handling--resilience)
12. [Roadmap](#12-roadmap)

---

## 1. Overview & Problem Statement

Kindred is the backend for a social network: people register and verify by email, build a friend graph, publish posts (with image attachments and friend tagging), comment in arbitrarily deep threads, react with typed emoji, and chat in real time over 1:1 and group conversations.

The interesting problem is not any single feature — it's that a social product needs **three different interaction models at once**, and naïvely each wants its own stack:

| Need | Natural fit | Why |
| --- | --- | --- |
| Mutations, file uploads, auth | **REST** | Predictable verbs, multipart support, cacheable, easy to document. |
| Aggregated read views (feed, dashboards) | **GraphQL** | One round trip composes posts + owners + tags + reaction summaries + "did I react?" without over/under-fetching. |
| Live chat & presence | **WebSocket (Socket.IO)** | Server push; request/response is the wrong shape for messaging. |

Kindred runs all three **against one domain model and one set of cross-cutting concerns** (auth, validation, rate limiting, storage). The engineering goal — and the thing this README documents — is keeping those three surfaces consistent: the same JWT identity, the same token-revocation rules, the same data-integrity guarantees, no matter which door a client comes through.

**Implemented today:** local email/password auth with email-OTP verification, access/refresh tokens with revocation, profiles, the friend graph, posts/comments/reacts, real-time direct & group chat, S3-backed media, and a generated OpenAPI spec.

---

## 2. Architecture Overview

Kindred is a **layered (n-tier) architecture** with a clean dependency direction: HTTP/transport at the edges, business logic in services, persistence behind repositories, and a shared core of utilities, types, and cross-cutting middleware.

```
                            ┌──────────────────────────────────────────────┐
   Clients                  │                  src/index.ts                  │
 (web / mobile)             │  helmet · CORS allow-list · json(1mb) · morgan │
       │                    │  global rate limiter · error-handling sink     │
       │                    └───────────────┬────────────────┬───────────────┘
       │                                    │                │
       ▼                                    ▼                ▼
┌──────────────┐   ┌────────────────────────────┐   ┌───────────────────────┐
│   REST        │   │        GraphQL              │   │      Socket.IO        │
│ /api/*        │   │  POST/GET /graphql          │   │  ws  (io.use auth)    │
│               │   │  (read-only)                │   │                       │
│ Router →      │   │  context.ts builds identity │   │ Gateways/socketIo →   │
│ middleware →  │   │  from JWT (own auth path)   │   │ Chat events → service │
│ Service       │   │  resolvers → mappers        │   │                       │
└──────┬───────┘   └──────────────┬─────────────┘   └───────────┬───────────┘
       │                          │                             │
       │   ┌──────────────────────┴─────────────────────────────┘
       ▼   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          DOMAIN / SERVICE LAYER                            │
│  Modules/**/services/*  — business rules, orchestration, authorization    │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     PERSISTENCE LAYER (Repositories)                       │
│      BaseRepository<T>  ←  PostRepository, UserRepository, …               │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mongoose Models  (Db/Models)                       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
        ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
        │   MongoDB     │     │     Redis     │     │   AWS S3      │
        │  (domain data)│     │ (rate limits) │     │   (media)     │
        └───────────────┘     └───────────────┘     └───────────────┘
```

**Request flow (REST):** `index.ts` → controller (`express.Router`) → middleware chain (auth → rate limit → upload → validation) → service handler → repository → Mongoose model → MongoDB.

The three surfaces are **siblings, not layers** — each owns its transport and authentication entry point but converges on the same services/repositories/models and the same response envelope.

---

## 3. Design Principles & Patterns

Each pattern below is named with the file it lives in and the trade-off that motivated it.

### Repository pattern over a generic base — `Db/Repositories/base.repository.ts`
`BaseRepository<T>` wraps the generic Mongoose CRUD surface (`createNewDocument`, `findOneDocument`, `updateDocumentById`, …). Concrete repositories extend it and add only what's special — e.g. `PostRepository.postsPagination()` delegates to `mongoose-paginate-v2` (`post.repository.ts`).

- **Why:** services depend on a narrow, typed persistence interface instead of scattering Mongoose calls through business logic. Swapping query mechanics (e.g. adding pagination) is localized.
- **Trade-off considered:** the base class is a thin pass-through, so it doesn't fully hide Mongoose — `FilterQuery<T>`/`QueryOptions<T>` leak into signatures. We accepted a *leaky* abstraction over a heavy ORM-agnostic one: the cost of a fully framework-independent data layer (mapping every query type) wasn't justified for a single-database system.

### Polymorphic associations — `Db/Models/comment.model.ts`, `react.model.ts`
Comments and reacts both use `refId` + `refPath: 'onModel'` with `onModel ∈ {Post, Comment}`.

- **Why:** one comment model serves both top-level comments (on a `Post`) and replies (on a `Comment`), giving **arbitrarily deep threads** for free; one react model serves posts and comments alike.
- **Trade-off:** polymorphic refs can't be enforced by a single foreign-key-style index, so target existence is validated in the service layer (`ensureTargetExists`, `react.service.ts` / `comment.service.ts`). We traded a DB-level guarantee for schema simplicity and recover it with an application-level check.

### Factory functions for configured middleware — `Middlewares/rate-limit.middleware.ts`, `multer.middleware.ts`
`createRateLimitMiddleware({ keyPrefix, points, duration, … })` produces a fully-configured limiter; `createSocketRateLimiter(...)` does the same for sockets; `Multer()` returns a configured uploader.

- **Why:** every limiter (global, auth, signup, signin, graphql, upload, three socket limiters) is one declarative call. Policy lives in data, not duplicated logic.
- **Trade-off:** a registry/config object would centralize the numbers further, but the factory keeps each policy co-located with its export and readable at a glance.

### Singleton services with constructor-injected repositories — `Modules/**/services/*.service.ts`
Services are exported as instances (`export default new PostService()`) that hold their repositories as private fields.

- **Why:** stateless services + connection-pooled Mongoose mean a single instance is safe and avoids per-request allocation. Repositories are injected in the constructor (manual DI), so a service's dependencies are explicit and swappable in principle.
- **Trade-off:** no DI container means wiring is manual and there's no built-in seam for substituting mocks. For a codebase this size, a container's indirection would cost more clarity than it buys (see [§8](#8-testing--verification-strategy)).

### Event-driven side effects — `Utils/Services/email.utils.ts`
OTP email is emitted on a Node `EventEmitter` (`localEventEmitter.emit('sendEmail', …)`) rather than awaited inline in `signUp`.

- **Why:** the signup response shouldn't block on (or fail because of) the mail server. The emitter decouples the request path from email delivery.
- **Trade-off:** an in-process emitter is **fire-and-forget** — a failed send is logged, not retried, and is lost on crash. This is the honest limit of an in-memory bus; a durable queue is the upgrade path ([§12](#12-roadmap)).

### Centralized error handling via a typed exception hierarchy — `Utils/Errors/`
`HttpException` (carrying `statusCode` + optional `error` context) is subclassed by `BadRequestException`, `UnauthorizedException`, `NotFoundException`, `ConflictException`. Handlers `throw`; a single terminal middleware in `index.ts` maps them to the response envelope.

- **Why:** business code reads top-to-bottom with no per-route `try/catch` for HTTP mapping. One place decides status codes and shapes.
- **Trade-off:** relies on Express 5 forwarding rejected async handlers to the error middleware. We lean on that contract deliberately rather than wrapping every handler.

---

## 4. Layer-by-Layer Breakdown

| Layer | Location | Responsibility | May depend on | Must **not** depend on |
| --- | --- | --- | --- | --- |
| **Transport / Controllers** | `Modules/**/*.controller.ts` | Declare routes; compose the middleware chain; delegate to a service handler | Middlewares, Validators, Services | Models directly |
| **Middleware (cross-cutting)** | `Middlewares/` | Auth, validation, rate limiting, upload, file cleanup | Utils, Repositories (auth needs the user), Config | Services |
| **Service / Domain** | `Modules/**/services/*.service.ts` | Business rules, orchestration, authorization, multi-step workflows | Repositories, Utils, Models (for cross-cutting ops) | Controllers |
| **Persistence / Repositories** | `Db/Repositories/` | Typed CRUD + specialized queries | Models | Services, transport |
| **Data / Models** | `Db/Models/` | Mongoose schemas, indexes, validation hooks | Common (types/enums) | everything above |
| **Shared core** | `Common/`, `Utils/`, `Config/` | Types/enums/interfaces, crypto, tokens, S3, responses, env/redis/swagger config | — | transport, services |

### Controllers
Thin `express.Router()` instances. Example wiring (`post.controller.ts`):
```ts
postController.post(
  '/add-post',
  authentication,                       // identity
  uploadRateLimitMiddleware,            // throttle (keyed per user)
  Multer().array('files', 3),           // ≤3 images to disk
  validationMiddleware(CreatePostValidator), // Zod-validate + coerce
  postService.addPost,                  // business logic
)
```
All routers are re-exported through `Modules/controllers.index.ts` and mounted under `/api/*` in `index.ts`.

### Services
Hold the business logic. A deliberate, documented characteristic: **service methods are the Express `(req, res, next)` handlers** — they read `req.body` and call `res.json(...)`. This keeps the layer count low and the call path short, at the cost of coupling business logic to the HTTP framework. This is layered architecture, *not* hexagonal/clean: the services are not framework-independent. (Chat is the exception — `ChatService` takes a `Socket` and domain args, no `req`/`res`.)

### Repositories
`BaseRepository<T>` provides the generic surface; specialized repos add methods (`PostRepository.postsPagination`, `countDocuments`). Re-exported via `Repositories/index.ts`.

### Models
Mongoose schemas with deliberate indexing and `pre('validate')` hooks for derived keys (see [§7](#7-key-engineering-decisions--trade-offs)). Re-exported via `Models/index.ts`.

### The GraphQL & Socket surfaces have their *own* auth entry points
Because neither rides the Express routing middleware, each re-implements the same identity check against the same primitives:
- **GraphQL** — `GraphQl/context.ts` reads the `Authorization` header, verifies the JWT, checks the blacklist, loads the user id, and exposes `context.userId`; resolvers call `requireGraphQLUser(context)`.
- **Socket.IO** — `Gateways/socketIo.gateways.ts` registers `socketAuthentication` as an `io.use` middleware that verifies the handshake token (rate-limited by IP) before any chat event is wired.

This duplication is intentional and bounded: all three paths share `verifyToken`, the `BlackListedToken` lookup, and the `User` model — so the *rules* are single-sourced even though the *plumbing* is per-transport.

---

## 5. Tech Stack & Rationale

| Concern | Choice | Why this, and the trade-off |
| --- | --- | --- |
| Language | **TypeScript 5.6**, `strict` | Compile-time guarantees on a dynamically-typed runtime. `strict` + `noImplicitAny` are on; `noUnusedLocals/Parameters` are off (pragmatic, given no linter is wired up). |
| HTTP | **Express 5** | Mature, minimal. v5 forwards rejected async handlers to the error middleware — the foundation of the centralized error sink. (v5 also makes `req.query` getter-only, which the validation middleware works around — see [§7](#7-key-engineering-decisions--trade-offs).) |
| Database | **MongoDB + Mongoose 7** | Document model fits nested/polymorphic social data (comment trees, polymorphic reacts). Trade-off: no native cross-document FKs, so referential integrity is enforced in services and via unique indexes. |
| Read API | **graphql + graphql-http** | Lets clients fetch a composed feed/dashboard in one request. Schema is built programmatically (`GraphQLObjectType`s) rather than SDL-first — more verbose, but no codegen step and types live next to resolvers. |
| Realtime | **Socket.IO 4** | Rooms map cleanly to conversations; built-in reconnection and handshake auth hook (`io.use`). |
| Cache / limiter store | **Redis (ioredis) + rate-limiter-flexible** | Rate-limit counters must be shared across instances; an in-memory limiter breaks the moment you scale past one process. `maxRetriesPerRequest: null` keeps commands queued through reconnects. |
| Object storage | **AWS S3 (v3 SDK + lib-storage)** | Offloads binary blobs from the DB; presigned URLs keep the bucket private; `lib-storage` `Upload` gives multipart for large files. |
| Auth | **jsonwebtoken + bcrypt** | Stateless access tokens (low-latency authz) with a blacklist for revocation (see [§7](#7-key-engineering-decisions--trade-offs)); bcrypt for password and OTP hashing. |
| Validation | **Zod 4** | One schema library for request validation **and** OpenAPI generation (`z.toJSONSchema`) **and** env validation — one source of truth for "what is a valid X." |
| Crypto (PII) | **node:crypto AES-256-CBC** | Phone numbers are encrypted at rest with a per-record random IV. |
| Security headers | **helmet** | Sensible default headers; CSP is selectively relaxed only for the Swagger UI route. |
| Docs | **swagger-ui-express** | Serves the generated spec at `/api-docs`. |

---

## 6. Project Structure

```
BE/
├── src/
│   ├── index.ts                     # Composition root: app wiring, middleware order, error sink, server + io bootstrap
│   │
│   ├── Config/                      # Boot-time configuration (all fail-fast)
│   │   ├── env.config.ts            #   Zod-validated process.env → process.exit(1) on any invalid var
│   │   ├── redis.config.ts          #   ioredis client + connection lifecycle logging
│   │   └── swagger.config.ts        #   Assembles OpenAPI 3.0 spec from Zod validators + hand-written responses
│   │
│   ├── Common/                      # Shared, dependency-free core
│   │   ├── Enums/                   #   Role, Gender, Provider, OtpType, FriendShipStatus, ChatType, ReactType
│   │   ├── Interfaces/              #   IUser, IPost, IRequest (req + loggedInUser), response envelopes …
│   │   └── Types/
│   │
│   ├── Db/
│   │   ├── db.connection.ts         # mongoose.connect → process.exit(1) on failure
│   │   ├── Models/                  # Mongoose schemas + indexes + validate hooks
│   │   │   ├── user.model.ts        #   unique email index, embedded hashed OTPs
│   │   │   ├── post.model.ts        #   mongoose-paginate-v2 plugin, (ownerId, createdAt) index
│   │   │   ├── comment.model.ts     #   polymorphic refPath, compound indexes
│   │   │   ├── react.model.ts       #   UNIQUE (ownerId, refId, onModel) — one react per target
│   │   │   ├── conversation.model.ts#   derived directKey + PARTIAL UNIQUE index for DMs
│   │   │   ├── friendShip.model.ts  #   derived friendshipKey + UNIQUE index
│   │   │   ├── message.model.ts
│   │   │   └── black-listed-tokens.model.ts  # TTL index (expireAfterSeconds: 0) → self-purging
│   │   └── Repositories/            # BaseRepository<T> + concrete repos
│   │
│   ├── Modules/                     # Feature modules (controller + service[s])
│   │   ├── controllers.index.ts     #   barrel mounted in index.ts
│   │   ├── Users/                   #   auth.* + profile.* (friendships, groups, account deletion)
│   │   ├── Posts/                   #   posts + attachments + tagging
│   │   ├── Comments/                #   threaded comments
│   │   ├── Reacts/                  #   typed reactions (upsert)
│   │   └── Chat/                    #   ChatEvents (listeners) + ChatService (Socket-based logic)
│   │
│   ├── Middlewares/                 # authentication · validation · rate-limit · multer
│   │
│   ├── GraphQl/                     # Read-only surface
│   │   ├── index.graphql.ts         #   assembles MainSchema, exposes the express handler
│   │   ├── context.ts               #   JWT identity (own auth path) + requireGraphQLUser
│   │   ├── Schema/Query/            #   feed/postDetails, profileDashboard, conversations
│   │   ├── Resolvers/               #   batched aggregation (feed N+1 avoidance)
│   │   ├── Types/                   #   hand-built GraphQLObjectTypes
│   │   └── Utils/graphql-mappers.utils.ts  # Mongoose docs → GraphQL shapes
│   │
│   ├── Gateways/socketIo.gateways.ts# io init, handshake auth, multi-tab presence map
│   │
│   ├── Validators/                  # Zod schemas — single source for requests + OpenAPI + socket payloads
│   │
│   ├── Docs/                        # OpenAPI registry, paths, response schemas
│   │
│   └── Utils/                       # crypto, token, hash, S3, email, pagination, response helpers, errors,
│                                    # CORS allow-list, recursive comment-tree cleanup
│
├── API_DOCUMENTATION.md             # Full client contract (REST + GraphQL + Socket)
├── WEBSOCKET.md                     # Socket.IO event/payload reference
├── openapi.json                     # Exported spec (npm run export-spec)
├── Dockerfile
└── tsconfig.json
```

---

## 7. Key Engineering Decisions & Trade-offs

### 7.1 Revocable stateless JWTs via a self-expiring blacklist
**Problem:** stateless JWTs are fast (no session lookup) but can't be revoked before they expire — a real issue for sign-out and "log me out everywhere."

**Decision:** each token is signed with a `uuid` `jti` (`auth.service.ts`). Sign-out writes that `jti` to a `BlackListedToken` document **with the token's own expiry as `expiresAt`**, and the collection carries a TTL index:
```ts
// black-listed-tokens.model.ts
blackListedTokensModel.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
```
MongoDB then deletes each blacklist entry exactly when the token would have expired anyway, so the blacklist never grows unbounded. Every authenticated request (REST middleware **and** GraphQL context) checks it.

**Trade-off:** we reintroduce one DB read per authenticated request — the very cost stateless JWTs exist to avoid. We chose **correctness (instant revocation) over the last increment of latency**, and bounded the cost to a single indexed `findOne` on a self-pruning collection. Refresh tokens are currently **not rotated** on use; rotation + reuse-detection is on the roadmap.

### 7.2 Single-sourced contracts: Zod → validation → OpenAPI → env
The Zod validators in `src/Validators` are the one definition of a valid request. The same definitions:
- validate and **coerce** incoming requests (`validation.middleware.ts`),
- are converted to OpenAPI component schemas at runtime via `z.toJSONSchema(...)` (`swagger.config.ts`), and
- the same library validates `process.env` at boot (`env.config.ts`).

**Trade-off:** response/domain schemas are **hand-written** (responses aren't Zod), so a handler that changes its return shape needs a manual docs update. We single-sourced the half that drifts most often (requests) and accepted manual maintenance on responses rather than building response-side schema inference.

A concrete Express-5 wrinkle handled here: v5 exposes `req.query` (and friends) through getters with no setter, so the usual `req.query = parsed` throws. The middleware shadows the getter instead:
```ts
// validation.middleware.ts — write coerced data back without tripping the getter
Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true })
```

### 7.3 Structural uniqueness via derived keys + partial indexes
Duplicate DMs between the same two people, or duplicate friend requests in opposite directions, are classic race conditions. Rather than guard them only in code, Kindred makes them **representable-once at the schema level**:
```ts
// conversation.model.ts (abridged) — sort the member ids, join them, key unique for DMs only
ConversationSchema.pre('validate', function (next) {
  if (this.type === ChatTypeEnum.DIRECT && this.members?.length === 2) {
    const ids = this.members.map((m) => m.toString()).sort()
    this.directKey = ids.join(':')
  }
  next()
})
ConversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { type: ChatTypeEnum.DIRECT } },
)
```
`friendShip.model.ts` uses the same sorted-key trick (`friendshipKey`). The **partial** filter is the subtle part: uniqueness is enforced for direct conversations only, leaving group conversations unconstrained.

**Trade-off:** order-independent identity now lives in a hook + index pair that must stay in sync with the members. We accepted that small coupling to get a guarantee the database enforces even under concurrent writes.

### 7.4 GraphQL feed: deliberate N+1 elimination on the hot path
A feed of `N` posts that fetched each post's comment count, reaction breakdown, and "did I react?" separately would issue `~3N` queries. The `feed` resolver instead collects all post ids and issues **three aggregations**, then assembles per-post metrics in a `Map`:
```ts
// post.resolvers.ts (abridged)
const [commentCounts, reactCounts, myReacts] = await Promise.all([
  CommentModel.aggregate([{ $match: { refId: { $in: postIds }, onModel: 'Post' } },
                          { $group: { _id: '$refId', count: { $sum: 1 } } }]),
  ReactModel.aggregate([{ $match: { refId: { $in: postIds }, onModel: 'Post' } },
                        { $group: { _id: { refId: '$refId', type: '$type' }, count: { $sum: 1 } } }]),
  ReactModel.find({ ownerId, refId: { $in: postIds }, onModel: 'Post' }).lean(),
])
```
Feed pagination is also clamped server-side (`limit` capped at 50) so a client can't request an unbounded page.

**Trade-off:** `postDetails` does **not** apply this batching to its comment thread — `getPostComments` resolves each comment's reaction summary individually. That's an intentional scope decision: the feed is the high-fan-out hot path worth optimizing; a single post's thread is a lower-cardinality, lower-frequency view. Batching the thread (or introducing DataLoader across the schema) is a tracked improvement.

### 7.5 Media writes are reversible (compensating cleanup)
Uploads and DB writes can't be one atomic transaction across S3 + MongoDB, so Kindred treats them as a **saga with compensation**. If the post insert fails *after* files reached S3, the orphaned objects are deleted; if a multi-file upload fails partway, the already-uploaded keys are rolled back; local temp files from Multer are always unlinked. The same discipline runs in reverse for deletes.
```ts
// post.service.ts — roll back uploaded objects if the DB write fails
try {
  newPost = await this.postRepo.createNewDocument({ ... , attachments })
} catch (error) {
  try { await this.s3ClientService.deleteBulkFromS3(attachments) }
  catch (cleanupError) { console.warn('Failed to delete attachments after create failure', cleanupError) }
  throw error
}
```
The terminal error middleware also calls `cleanupUploadedFiles(req)` so a request that dies *before* the service still doesn't leak temp files.

**Trade-off:** compensation is best-effort — a failed cleanup is logged, not guaranteed — so a rare orphan is possible. We chose pragmatic eventual cleanliness over a heavier two-phase protocol.

### 7.6 Account deletion as a full cascade
`profile.service.ts#deletAccount` performs a GDPR-style teardown: the user's posts, their entire comment subtree (a breadth-first walk — the same algorithm as `comment-cleanup.utils.ts`, currently inlined here; see the roadmap), reactions, friendships, direct conversations and messages, group membership (with cleanup of now-empty groups), post tags pointing at the user, and every associated S3 object — then the user.

**Trade-off:** this runs as a **sequence of `deleteMany` calls, not a single transaction**. On standalone MongoDB, multi-document transactions require a replica set; a mid-sequence failure can leave partial orphans. The order is chosen to minimize that window, and wrapping it in a session is a roadmap item.

### 7.7 Layered, not hexagonal — on purpose
As noted in [§4](#4-layer-by-layer-breakdown), services double as Express handlers. The benefit is a short, legible call path and no DTO-mapping ceremony; the cost is that business logic isn't portable off Express and isn't unit-testable without an HTTP-ish `req`/`res`. For a project of this size and a single transport-per-feature, that was the right altitude. The cleanest seam already exists in the chat layer (Socket-based, `req`-free), which is the template if/when the HTTP services need the same decoupling.

---

## 8. Testing & Verification Strategy

Kindred's current safety net is **static and contract-level**, and the build is honest about that — `npm test` is an alias for `tsc --noEmit`, not a runtime suite.

What guards correctness today:

| Mechanism | What it catches | Where |
| --- | --- | --- |
| `tsc --strict` (`noImplicitAny`) | Type errors, null-safety gaps, contract mismatches between layers | whole codebase |
| Zod request validation | Malformed/over-posted input at the edge (`.strictObject`), with coercion | `src/Validators` + `validation.middleware.ts` |
| Zod env validation | Misconfiguration — the process refuses to boot on a bad/missing var | `env.config.ts` |
| Schema-level constraints | Duplicate DMs/friendships/reacts, oversized fields, enum violations | `Db/Models/*` indexes & validators |
| Generated OpenAPI | Request-contract drift between code and docs | `swagger.config.ts` |

**The next layer of investment** is a behavioral test suite. The architecture is set up for it: repositories are an injectable seam for mocking the DB, services encapsulate the rules worth asserting, and the highest-value targets are clear — token revocation (blacklist), the derived-key uniqueness guarantees, the comment-tree BFS, the deletion cascade, and the feed aggregation math. That suite, run in CI, is the headline item on the roadmap below.

> Verification convention for contributors: after any change, run `npm run typecheck`. Where a true behavioral assertion isn't yet possible, state the tightest check the change allows.

---

## 9. Setup, Configuration & Local Development

### Prerequisites
- Node.js (Dockerfile pins **Node 24**), npm
- A MongoDB instance (Atlas or local)
- A Redis instance
- An AWS S3 bucket + IAM credentials
- SMTP credentials (for OTP email)

### Install & run
```bash
cd BE
npm install
cp .env.example .env        # then fill in every key — see the note below
npm run dev                 # nodemon: tsc compile + run, restart on src changes
```

| Script | Action |
| --- | --- |
| `npm run dev` | Compile + run with nodemon (watch mode) |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` (expects a prior build) |
| `npm run typecheck` / `npm test` | `tsc --noEmit` |
| `npm run export-spec` | Write the OpenAPI spec to `openapi.json` |

### Configuration
`env.config.ts` validates the entire environment against a Zod schema at startup and **exits with code 1** on any missing/invalid variable — the app will not boot half-configured.

> **Heads-up:** the Zod schema additionally requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`, which are not present in `.env.example`. Add them when filling your `.env`, or boot will fail validation. (Aligning `.env.example` with the schema is a roadmap item.)

Notable constraints enforced by the schema:

| Variable | Constraint |
| --- | --- |
| `ENCRYPTION_SECRET_KEY` | exactly **32** characters (AES-256) |
| `IV_LENGTH` | positive int (16 for AES-CBC) |
| `JWT_PREFIX` | the literal string `Bearer` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥ 16 chars |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | e.g. `1d`, `7d` |
| `CLIENT_ORIGINS` | non-empty (CORS allow-list source) |
| `SALT_ROUNDS` | bcrypt cost (e.g. `10`) |

### Docker
```bash
docker build -t kindred-backend .
docker run --env-file .env -p 5000:5000 kindred-backend
```

---

## 10. API Reference

Authoritative, interactive docs are generated and served by the app:

| Resource | Path |
| --- | --- |
| Swagger UI | `GET /api-docs` |
| Raw OpenAPI 3.0 spec | `GET /api-docs.json` |
| Health probe | `GET /health` → `{ server, mongo, redis, uptime }` |

Full client contract (including request/response examples and Socket payloads) lives in [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) and [`WEBSOCKET.md`](./WEBSOCKET.md).

**Auth:** protected REST and GraphQL requests send `Authorization: Bearer <accessToken>`. Every response uses one envelope:
```jsonc
// success
{ "meta": { "status": 200, "success": true, "message": "..." }, "data": { /* ... */ } }
// failure
{ "meta": { "status": 400, "success": false, "message": "..." }, "error": { "context": { /* ... */ } } }
```

### REST surface (`/api`)

| Group | Method & Path | Purpose |
| --- | --- | --- |
| **Auth** | `POST /api/auth/signup` | Register; emails an OTP |
| | `POST /api/auth/confirmEmail` | Verify email with OTP |
| | `POST /api/auth/signin` | Issue access + refresh tokens |
| | `POST /api/auth/refresh-token` | New access token from a refresh token |
| | `POST /api/auth/signout` | Blacklist access + refresh tokens |
| **Users** | `PUT /api/users/update-profile` | Update profile (email change resets verification) |
| | `DELETE /api/users/delete-account` | Cascade-delete the account & all its data |
| | `POST /api/users/profile-picture` | Upload avatar to S3 |
| | `POST /api/users/renew-signed-url` | Refresh a presigned media URL |
| | `POST /api/users/send-friendship-request` | Send a friend request |
| | `GET /api/users/list-friendship-requests` | List requests / friends (+ groups) |
| | `PATCH /api/users/respond-to-friendship-request` | Accept/reject a request |
| | `POST /api/users/create-group` | Create a group (friends only) |
| **Posts** | `POST /api/posts/add-post` | Create a post (≤3 images, tag friends) |
| | `PATCH /api/posts/:postId` | Update; add/remove attachments |
| | `DELETE /api/posts/:postId` | Delete post + its comment tree + reacts + media |
| | `GET /api/posts/home` | Paginated global feed (REST) |
| | `GET /api/posts/user/me` · `GET /api/posts/user/:userId` | Paginated user posts |
| **Comments** | `POST /api/comments` | Comment on a Post or a Comment |
| | `GET /api/comments/:onModel/:refId` | List comments for a target |
| | `PATCH /api/comments/:commentId` · `DELETE /api/comments/:commentId` | Edit / delete (deletes subtree) |
| **Reacts** | `POST /api/reacts` | Upsert a typed reaction |
| | `GET /api/reacts/:onModel/:refId` · `DELETE /api/reacts/:onModel/:refId` | List / remove |

### GraphQL surface (`/graphql`, read-only)

| Query | Args | Returns |
| --- | --- | --- |
| `feed` | `page`, `limit` (≤50) | Paginated feed with owner, tags, reaction summary, viewer's reaction |
| `postDetails` | `postId` | A post with its full comment thread |
| `profileDashboard` | — | The authenticated user's profile aggregate |
| `conversations` | — | The user's conversations with last-message previews |

### Socket.IO surface

Connect with `auth: { authorization: "Bearer <accessToken>" }`. Client emits: `send-private-message`, `get-chat-history`, `send-group-message`, `get-group-chat`. Server emits: `connected`, `message-sent`, `chat-history`, `group-chat-history`, `error`. Presence is multi-tab aware. See [`WEBSOCKET.md`](./WEBSOCKET.md).

---

## 11. Observability, Error Handling & Resilience

**Error handling.** Handlers `throw` typed `HttpException`s; one terminal middleware in `index.ts` maps them to the response envelope, special-casing `MulterError` (e.g. `413` for oversized files) and falling back to a generic `500` for anything unexpected — internal error details are never leaked to clients.

**Resilience.**
- **Fail-fast boot** — invalid env (`env.config.ts`) or an unreachable DB (`db.connection.ts`) exits the process rather than running degraded.
- **Redis reconnection** — `ioredis` is configured with `maxRetriesPerRequest: null` and logs every lifecycle transition (`connect`/`ready`/`error`/`close`/`reconnecting`), so commands survive transient blips.
- **Distributed rate limiting** — Redis-backed limiters guard the global surface plus auth/signup/signin/upload/GraphQL and three socket dimensions, each returning `429` with a `Retry-After` header. Uploads are keyed per authenticated user, not per IP, so shared-NAT clients aren't collectively throttled.

| Scope | Budget |
| --- | --- |
| Global (per IP) | 300 / 5 min |
| Auth (confirm/email) | 10 / 15 min |
| Signup | 5 / 15 min |
| Signin | 20 / 15 min |
| GraphQL | 120 / 5 min |
| Upload (per user) | 20 / 10 min |
| Socket handshake (per IP) | 20 / 5 min |
| Socket messages / history reads | 60 / min · 30 / min |

**Security posture.** `helmet` headers; explicit CORS allow-list (`cors.utils.ts`); bcrypt-hashed passwords; **hashed** OTPs (a leaked DB doesn't reveal codes); AES-256-CBC-encrypted phone numbers with per-record IVs; presigned, expiring S3 URLs over a private bucket; strict request validation with `.strictObject` to reject unknown fields; multipart payloads capped (1 MB JSON, 5 MB/file, ≤3 files).

**Logging.** `morgan` (`combined` in production, `dev` otherwise). Structured logging/metrics/tracing are roadmap items (below).

---

## 12. Roadmap

Concrete next steps, roughly in priority order:

- **Behavioral test suite + CI** — unit-test the high-value invariants (token revocation, derived-key uniqueness, comment-tree BFS, deletion cascade, feed aggregation) and a GitHub Actions pipeline running typecheck + tests on every PR. *(See [§8](#8-testing--verification-strategy).)*
- **Transactional cascade deletes** — wrap account deletion in a MongoDB session (replica set) to remove the partial-orphan window. *(See [§7.6](#7-key-engineering-decisions--trade-offs).)*
- **Refresh-token rotation + reuse detection** — rotate refresh tokens on use and revoke a token family on replay.
- **GraphQL DataLoader** — extend the feed's batching to `postDetails` comment threads and any per-entity resolver to fully close N+1 gaps. *(See [§7.4](#7-key-engineering-decisions--trade-offs).)*
- **Durable email/jobs** — replace the in-process `EventEmitter` with a queue (retries, dead-letter) for OTP and future notifications. *(See [§3](#3-design-principles--patterns).)*
- **Observability** — structured JSON logs with request ids, plus metrics/tracing around DB and S3 calls.
- **Config & dependency hygiene** — align `.env.example` with the env schema (SMTP keys), drop accidental dependencies (`fs`, `uninstall`), and harden the Dockerfile (multi-stage build, `npm ci`, non-root user).
- **Optional decoupling** — if HTTP services need to become transport-independent/unit-testable, split the request parsing from the domain method (the chat layer already models this).

---

<sub>Architecture and decisions documented here were verified directly against the source in `BE/src`. Where the code and an earlier description disagreed, the code is treated as the source of truth.</sub>
