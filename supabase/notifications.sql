-- Milky Marble: stored customer notifications (the bell + "Sweet Updates" page).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Notifications are written by DATABASE TRIGGERS, so every path that changes an
-- order's status (payment verify/reject, staff status update, POS, production,
-- customer cancel, checkout) and every promo approval is covered automatically.
-- No route has to remember to insert a row.

create table if not exists notifications (
  id          bigserial primary key,
  customer_id bigint,                      -- null = broadcast to every customer (promos)
  type        text not null,               -- 'order' | 'promo'
  status      text,                        -- order: COMPLETED, READY, PREPARING, ...
  title       text not null,
  message     text not null,
  order_id    bigint,
  promo_id    bigint,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_customer_idx on notifications (customer_id, created_at desc);
create index if not exists notifications_created_idx  on notifications (created_at desc);

-- Per-customer read state (needed because promo rows are shared by everyone).
create table if not exists notification_reads (
  customer_id     bigint not null,
  notification_id bigint not null references notifications(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (customer_id, notification_id)
);

-- Same wording as mmOrderNotifContent() in public/customer/js/navbar.js.
create or replace function mm_order_notif_content(p_status text, p_reason text)
returns table (code text, title text, message text)
language plpgsql immutable as $$
declare s text := upper(coalesce(p_status, 'CONFIRMED'));
begin
  if s like '%COMPLET%' then
    return query select 'COMPLETED', 'Order Complete!', 'Thanks for sipping with us! Tell us how your drink was.';
  elsif s like '%READY%' then
    return query select 'READY', 'Ready for Pick-up!', 'Your sweet cups are chilled and waiting for you at the counter!';
  elsif s like '%PREP%' then
    return query select 'PREPARING', 'Prepping Your Sips!', 'The Marble Bar is layering your sweet treats now. We''ll let you know once ready!';
  elsif s like '%CANCEL%' then
    if coalesce(btrim(p_reason), '') <> '' then
      return query select 'CANCELLED', 'Payment Not Verified', 'We couldn''t confirm your payment: ' || btrim(p_reason);
    else
      return query select 'CANCELLED', 'Order Cancelled', 'This order was cancelled.';
    end if;
  elsif s like '%PENDING%' then
    return query select 'PENDING_PAYMENT', 'Awaiting Payment', 'We''re waiting to verify your payment. Hang tight, or open the order to finish paying.';
  elsif s like '%PAID%' then
    return query select 'PAID_VERIFIED', 'Payment Verified!', 'Your payment went through. Your jelly cups will be prepared soon.';
  else
    return query select 'CONFIRMED', 'Order Confirmed!', 'We''ve received your order! Hang tight, your jelly cups will be prepared soon.';
  end if;
end $$;

-- Order trigger: one notification per status change (history is kept).
create or replace function mm_notify_order_status() returns trigger
language plpgsql as $$
declare c record;
begin
  if NEW.customer_id is null then return NEW; end if;   -- guest checkout: nobody to notify
  if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status then return NEW; end if;

  select * into c from mm_order_notif_content(NEW.status, NEW.payment_reject_reason);
  insert into notifications (customer_id, type, status, title, message, order_id, data)
  values (NEW.customer_id, 'order', c.code, c.title, c.message, NEW.id,
          jsonb_build_object('order_number', NEW.order_number));
  return NEW;
end $$;

drop trigger if exists trg_notify_order_status on orders;
create trigger trg_notify_order_status
  after insert or update of status on orders
  for each row execute function mm_notify_order_status();

-- Promo trigger: broadcast when a promo becomes ACTIVE/APPROVED (CEO approval).
create or replace function mm_notify_promo_live() returns trigger
language plpgsql as $$
declare off text; bits text := '';
begin
  if upper(coalesce(NEW.status, '')) not in ('ACTIVE', 'APPROVED') then return NEW; end if;
  if TG_OP = 'UPDATE' and upper(coalesce(OLD.status, '')) in ('ACTIVE', 'APPROVED') then return NEW; end if;

  off := case when lower(coalesce(NEW.discount_type, '')) like 'percent%'
              then trim(trailing '.' from trim(trailing '0' from NEW.discount_value::numeric(12,2)::text)) || '% off'
              else '₱' || trim(trailing '.' from trim(trailing '0' from NEW.discount_value::numeric(12,2)::text)) || ' off' end;
  if NEW.min_spend is not null then bits := bits || ' · min. spend ₱' || NEW.min_spend::numeric(12,0)::text; end if;
  if NEW.valid_until is not null then
    bits := bits || ' · until ' || to_char(NEW.valid_until::timestamptz at time zone 'Asia/Manila', 'Mon FMDD');
  end if;

  insert into notifications (customer_id, type, status, title, message, promo_id, data)
  values (null, 'promo', 'PROMO', 'New Promo: ' || off || '!',
          'Use code ' || NEW.code || ' at checkout' || bits || '.', NEW.id,
          jsonb_build_object('code', NEW.code));
  return NEW;
end $$;

drop trigger if exists trg_notify_promo_live on promotions;
create trigger trg_notify_promo_live
  after insert or update of status on promotions
  for each row execute function mm_notify_promo_live();

-- Backfill: one row for each existing order's current status and each live promo.
insert into notifications (customer_id, type, status, title, message, order_id, data, created_at)
select o.customer_id, 'order', c.code, c.title, c.message, o.id,
       jsonb_build_object('order_number', o.order_number),
       coalesce(o.updated_at, o.placed_at, now())
from orders o
cross join lateral mm_order_notif_content(o.status, o.payment_reject_reason) c
where o.customer_id is not null
  and not exists (select 1 from notifications n where n.order_id = o.id);

insert into notifications (customer_id, type, status, title, message, promo_id, data, created_at)
select null, 'promo', 'PROMO',
       'New Promo: ' || case when lower(coalesce(p.discount_type, '')) like 'percent%'
            then trim(trailing '.' from trim(trailing '0' from p.discount_value::numeric(12,2)::text)) || '% off'
            else '₱' || trim(trailing '.' from trim(trailing '0' from p.discount_value::numeric(12,2)::text)) || ' off' end || '!',
       'Use code ' || p.code || ' at checkout.', p.id, jsonb_build_object('code', p.code),
       coalesce(p.created_at, now())
from promotions p
where upper(coalesce(p.status, '')) in ('ACTIVE', 'APPROVED')
  and not exists (select 1 from notifications n where n.promo_id = p.id);
