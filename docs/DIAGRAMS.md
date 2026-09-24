# Diagrams

Status: ACTIVE · Owner: unassigned · Last updated: 2026-09-15

Visual models of the data, domain, architecture, and core flows. These render
natively on GitHub. See [ARCHITECTURE.md](ARCHITECTURE.md) for the narrative and
[../CLAUDE.md](../CLAUDE.md) for the invariants they encode.

---

## 1. Entity–relationship (database)

```mermaid
erDiagram
    events ||--o{ ticket_types : has
    events ||--o{ orders : receives
    events ||--o{ tickets : for
    ticket_types ||--o{ orders : "sold as"
    ticket_types ||--o{ tickets : "typed as"
    ticket_types ||--o{ promo_code_ticket_types : "restricted by"
    promo_codes ||--o{ promo_code_ticket_types : restricts
    promo_codes |o--o{ orders : "applied to"
    orders ||--o{ order_events : "audited by"
    orders ||--o{ tickets : issues
    events ||--o{ door_passes : "gates of"
    door_passes ||--o{ door_scans : logs
    tickets |o--o{ door_scans : "scanned as"

    events {
        uuid id PK
        text slug UK
        text title
        timestamptz starts_at
        timestamptz registration_opens_at
        timestamptz registration_closes_at
        event_status status
    }
    ticket_types {
        uuid id PK
        uuid event_id FK
        text name
        bigint price_paisa
        int quantity_total
        int quantity_sold
        int quantity_reserved
        timestamptz sales_starts_at
        timestamptz sales_ends_at
    }
    orders {
        uuid id PK
        text reference UK
        uuid event_id FK
        uuid ticket_type_id FK
        uuid promo_code_id FK
        int quantity
        bigint unit_price_paisa
        bigint subtotal_paisa
        bigint discount_paisa
        bigint total_paisa
        order_status status
        text bkash_trx_id UK
        text bkash_sender_msisdn
        timestamptz hold_expires_at
    }
    order_events {
        uuid id PK
        uuid order_id FK
        text actor
        text action
        order_status from_status
        order_status to_status
    }
    promo_codes {
        uuid id PK
        text code UK
        promo_type type
        bigint value
        boolean active
    }
    promo_code_ticket_types {
        uuid promo_code_id FK
        uuid ticket_type_id FK
    }
    tickets {
        uuid id PK
        uuid order_id FK
        uuid ticket_type_id FK
        uuid event_id FK
        text code UK
        text attendee_name
        ticket_status status
        timestamptz checked_in_at
        text checked_in_by
        uuid checked_in_scan_id
    }
    door_passes {
        uuid id PK
        uuid event_id FK
        text label
        text code UK
        timestamptz revoked_at
    }
    door_scans {
        uuid id PK
        uuid scan_id UK
        uuid pass_id FK
        uuid ticket_id FK
        door_scan_result result
        door_scan_method method
        timestamptz received_at
    }
```

Money is `bigint` paisa (Invariant 1); `orders.bkash_trx_id` is UNIQUE
(Invariant 3); `ticket_types` carries a CHECK that
`quantity_total − quantity_sold − quantity_reserved >= 0` (Invariant 2 backstop).

---

## 2. Domain model (class diagram)

```mermaid
classDiagram
    class Event {
        +UUID id
        +string slug
        +string title
        +datetime startsAt
        +EventStatus status
    }
    class TicketType {
        +UUID id
        +int pricePaisa
        +int quantityTotal
        +int quantitySold
        +int quantityReserved
        +available() int
    }
    class Order {
        +UUID id
        +string reference
        +int quantity
        +int unitPricePaisa
        +int totalPaisa
        +OrderStatus status
        +string bkashTrxId
        +datetime holdExpiresAt
    }
    class OrderEvent {
        +UUID id
        +string actor
        +string action
        +OrderStatus fromStatus
        +OrderStatus toStatus
    }
    class PromoCode {
        +UUID id
        +string code
        +PromoType type
        +int value
        +boolean active
    }
    class Ticket {
        +UUID id
        +string code
        +string attendeeName
        +TicketStatus status
    }
    class EventStatus {
        <<enumeration>>
        draft
        published
        archived
    }
    class OrderStatus {
        <<enumeration>>
        pending_payment
        pending_verification
        paid
        issued
        rejected
        expired
        cancelled
    }
    class PromoType {
        <<enumeration>>
        percentage
        fixed
    }
    class TicketStatus {
        <<enumeration>>
        issued
        cancelled
    }

    Event "1" --> "*" TicketType
    Event "1" --> "*" Order
    TicketType "1" --> "*" Order
    Order "1" --> "*" OrderEvent
    Order "1" --> "*" Ticket
    Order "*" --> "0..1" PromoCode : uses
    PromoCode "*" --> "*" TicketType : restricted to
    Event ..> EventStatus
    Order ..> OrderStatus
    PromoCode ..> PromoType
    Ticket ..> TicketStatus
```

---

## 3. Architecture (component layers)

```mermaid
flowchart TD
    B["Buyer / Admin<br/>(browser)"]

    subgraph App["Next.js 16 App Router"]
      R["Route handlers + Server Actions<br/>thin: Zod parse → service → map"]
    end

    subgraph Srv["src/server (no next/* imports)"]
      S["Services<br/>order · inventory · fulfilment"]
      Rep["Repositories<br/>(own Drizzle queries)"]
      Lib["lib/money.ts"]
    end

    DB[("Postgres 17")]
    Q[("Redis 7 · BullMQ")]
    W["worker.ts"]
    Ext["Resend · Cloudflare R2"]

    B --> R --> S
    S --> Rep --> DB
    S --> Lib
    S -- "enqueue I/O" --> Q
    Q --> W
    W --> S
    W --> Ext
```

The worker is a separate Node process that imports the same services directly —
which is why nothing in `src/server/**` may import `next/*`. All network I/O
(email, R2) is queued, never done inside a DB transaction (Invariant 7).

---

## 4. Order lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> pending_payment
    pending_payment --> pending_verification : trxID submitted
    pending_verification --> paid : admin approves
    pending_verification --> rejected : admin rejects
    pending_verification --> expired : 24h hold TTL
    paid --> issued : tickets generated
    issued --> cancelled : admin cancels
    rejected --> [*]
    expired --> [*]
    cancelled --> [*]
    issued --> [*]
```

Inventory is held on order creation and released on `rejected` or `expired`.
Every transition writes an append-only `order_events` row (Invariant 6), and only
`fulfilment.service.ts` performs the `paid → issued` step (Invariant 4).

---

## 5. Registration → payment → fulfilment (sequence)

```mermaid
sequenceDiagram
    actor Buyer
    participant Web as Next.js app
    participant Svc as Services (src/server)
    participant DB as Postgres
    participant Q as Redis / BullMQ
    participant W as Worker
    actor Admin
    participant Email as Resend

    Buyer->>Web: submit registration (ticketTypeId, qty)
    Web->>Svc: createOrder()
    Svc->>DB: atomic reserve — UPDATE ... WHERE available >= qty
    DB-->>Svc: reserved (or sold out)
    Svc->>DB: insert order (pending_payment, 24h hold) + order_event
    Svc-->>Buyer: payment instructions (bKash number)
    Buyer->>Web: submit trxID + sender number
    Web->>Svc: submitTransaction()
    Svc->>DB: → pending_verification (UNIQUE trxID) + order_event
    Admin->>Web: open verification queue → Approve
    Web->>Svc: fulfilment.service.approve()
    Svc->>DB: order → paid, reserved → sold, issue tickets + order_event
    Svc->>Q: enqueue ticket email (after commit)
    Q->>W: deliver job
    W->>Email: send ticket email
    Note over Svc,DB: No HTTP inside the DB transaction (Invariant 7)
```
