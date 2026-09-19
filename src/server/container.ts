/**
 * Composition root: the one place services are wired to real repositories
 * and adapters.
 *
 * Service modules depend only on interfaces, so importing a service never
 * opens a database connection or reads storage credentials — unit tests
 * build services with in-memory fakes. The app (server actions, route
 * handlers) and the worker import the ready-made instances from here.
 */
import { eventsRepository } from '@/server/repositories/events.repository';
import { inventoryRepository } from '@/server/repositories/inventory.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { createEventsService } from '@/server/services/events.service';
import { createInventoryService } from '@/server/services/inventory.service';
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
