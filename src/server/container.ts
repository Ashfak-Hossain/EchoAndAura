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
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { ticketsRepository } from '@/server/repositories/tickets.repository';
import { createEventsService } from '@/server/services/events.service';
import { logger } from '@/server/lib/logger';
import { createFulfilmentService } from '@/server/services/fulfilment.service';
import { createInventoryService } from '@/server/services/inventory.service';
import { createOrdersService } from '@/server/services/orders.service';
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
export const inventoryService = createInventoryService(inventoryRepository);
export const ordersService = createOrdersService({
  orders: ordersRepository,
  tickets: ticketsRepository,
  events: eventsRepository,
  ticketTypes: ticketTypesRepository,
  inventory: inventoryService,
  runInTransaction: (fn) => db.transaction(fn),
});

// The only place fulfilment is constructed (Invariant 4). The after-commit
// hook becomes the ticket-email producer in the email slice; until then it
// only records that tickets went out.
export const fulfilmentService = createFulfilmentService({
  orders: ordersRepository,
  tickets: ticketsRepository,
  inventory: inventoryService,
  runInTransaction: (fn) => db.transaction(fn),
  onTicketsIssued: async (orderId) => {
    logger.info({ orderId }, 'tickets issued (email delivery not wired yet)');
  },
});
