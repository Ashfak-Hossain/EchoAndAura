/**
 * Composition root: the one place services are wired to real repositories
 * and adapters.
 *
 * Service modules depend only on interfaces, so importing a service never
 * opens a database connection or reads storage credentials — unit tests
 * build services with in-memory fakes. The app (server actions, route
 * handlers) and the worker import the ready-made instances from here.
 */
import { db } from '@/db/client';
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ordersRepository } from '@/server/repositories/orders.repository';
import { promoCodesRepository } from '@/server/repositories/promo-codes.repository';
import { reportsRepository } from '@/server/repositories/reports.repository';
import { settingsRepository } from '@/server/repositories/settings.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createEventsService } from '@/server/services/events.service';
import { enqueueEmail } from '@/server/queue/producer';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
import { createPromoCodesService } from '@/server/services/promo-codes.service';
import { createReportsService } from '@/server/services/reports.service';
import { createDashboardService } from '@/server/services/dashboard.service';
import { createDoorService } from '@/server/services/door.service';
import { doorRepository } from '@/server/repositories/door.repository';
import { createSettingsService } from '@/server/services/settings.service';
import { createTicketsService } from '@/server/services/tickets.service';
import { createTicketTypesService } from '@/server/services/ticket-types.service';
import {
  type ObjectStorage,
  createS3ObjectStorage,
  readStorageEnv,
} from '@/server/storage/object-storage';

// Storage env is read on first use, not at import: `next build` and any code
// path that never touches images must work without R2_* being set.
let storageInstance: ObjectStorage | undefined;
function lazyStorage(): ObjectStorage {
  return (storageInstance ??= createS3ObjectStorage(readStorageEnv()));
}

export const storage: ObjectStorage = {
  createUploadUrl: (input) => lazyStorage().createUploadUrl(input),
  head: (key) => lazyStorage().head(key),
  delete: (key) => lazyStorage().delete(key),
  publicUrl: (key) => lazyStorage().publicUrl(key),
};

export const eventsService = createEventsService(eventsRepository, ticketTypesRepository, storage);
export const ticketTypesService = createTicketTypesService(ticketTypesRepository);
export const settingsService = createSettingsService(settingsRepository);
export const inventoryService = createInventoryService(inventoryRepository);
export const ordersService = createOrdersService({
  orders: ordersRepository,
  tickets: ticketsRepository,
  events: eventsRepository,
  ticketTypes: ticketTypesRepository,
  inventory: inventoryService,
  promoCodes: promoCodesRepository,
  runInTransaction: (fn) => db.transaction(fn),
  // Emails are queued after commit and sent by the worker (Invariant 7).
  onOrderCreated: (orderId) => enqueueEmail('payment-instructions', orderId),
  onOrderExpired: (orderId) => enqueueEmail('expired', orderId),
});

// The only place fulfilment is constructed (Invariant 4).
export const fulfilmentService = createFulfilmentService({
  orders: ordersRepository,
  tickets: ticketsRepository,
  ticketTypes: ticketTypesRepository,
  inventory: inventoryService,
  runInTransaction: (fn) => db.transaction(fn),
  onTicketsIssued: (orderId) => enqueueEmail('tickets-issued', orderId),
  onOrderRejected: (orderId) => enqueueEmail('rejected', orderId),
  onTicketsResendRequested: (orderId) => enqueueEmail('tickets-issued', orderId, { resend: true }),
});

export const ticketsService = createTicketsService({
  tickets: ticketsRepository,
  orders: ordersRepository,
  events: eventsRepository,
  ticketTypes: ticketTypesRepository,
  runInTransaction: (fn) => db.transaction(fn),
});

// B12: read-only aggregates over the same repositories.
export const reportsService = createReportsService({
  events: eventsRepository,
  ticketTypes: ticketTypesRepository,
  orders: ordersRepository,
  reports: reportsRepository,
});

// B3: the admin dashboard's live numbers (read-only).
export const dashboardService = createDashboardService({
  orders: ordersRepository,
  reports: reportsRepository,
});

// B10: promo codes, the admin side. Pricing reads codes via ordersService.
export const promoCodesService = createPromoCodesService({
  promoCodes: promoCodesRepository,
  events: eventsRepository,
  ticketTypes: ticketTypesRepository,
  runInTransaction: (fn) => db.transaction(fn),
});

// ADR-030: gate passes and check-in at the door.
export const doorService = createDoorService({
  door: doorRepository,
  tickets: ticketsRepository,
  orders: ordersRepository,
  events: eventsRepository,
  runInTransaction: (fn) => db.transaction(fn),
});

export type { PromoCheck } from '@/server/services/orders.service';
