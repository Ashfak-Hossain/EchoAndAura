-- Phase 7.5 (docs/LOAD-TEST.md): after register.js, the database must agree
-- with the k6 counts. Run against the load stack:
--   docker compose -f ops/load/docker-compose.yml exec -T postgres psql -U load -d echoandaura_load < ops/load/check.sql
select tt.quantity_total as seats,
       tt.quantity_sold as sold,
       tt.quantity_reserved as held,
       tt.quantity_total - tt.quantity_sold - tt.quantity_reserved as left_over,
       (select count(*) from orders o where o.ticket_type_id = tt.id) as orders,
       (select coalesce(sum(o.quantity), 0) from orders o
         where o.ticket_type_id = tt.id and o.status = 'pending_payment') as pending_qty,
       (select count(*) from order_events oe join orders o on o.id = oe.order_id
         where o.ticket_type_id = tt.id) as audit_rows
from ticket_types tt join events e on e.id = tt.event_id
where e.slug = 'load-test-night';
-- Expect: held = pending_qty = orders = audit_rows = seats, left_over = 0.
