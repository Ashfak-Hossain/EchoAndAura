/**
 * Composition root: the one place services are wired to real repositories.
 *
 * Service modules depend only on repository *interfaces*, so importing a
 * service never opens a database connection — unit tests build services with
 * in-memory fakes. The app (server actions, route handlers) and the worker
 * import the ready-made instances from here.
 */
import { eventsRepository } from '@/server/repositories/events.repository';
import { ticketTypesRepository } from '@/server/repositories/ticket-types.repository';
import { createEventsService } from '@/server/services/events.service';
import { createTicketTypesService } from '@/server/services/ticket-types.service';

export const eventsService = createEventsService(eventsRepository);
export const ticketTypesService = createTicketTypesService(ticketTypesRepository);
