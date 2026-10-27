// Idempotent schema; runs on first DB use. Safe to re-run.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'agent',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One channel = one WhatsApp number (e.g. Shine Jewel, Mooneye, Star Joya)
CREATE TABLE IF NOT EXISTS channels (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone_number_id text UNIQUE,
  waba_id text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  default_country text NOT NULL DEFAULT '91',
  template_language text NOT NULL DEFAULT 'en',
  shopify_secret text NOT NULL DEFAULT '',
  tpl_order text NOT NULL DEFAULT '',
  tpl_cod text NOT NULL DEFAULT '',
  tpl_cart text NOT NULL DEFAULT '',
  tpl_shipped text NOT NULL DEFAULT '',
  cart_delay_min int NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id serial PRIMARY KEY,
  channel_id int NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  opted_in boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  assigned_to int REFERENCES users(id) ON DELETE SET NULL,
  bot_paused boolean NOT NULL DEFAULT false,
  unread int NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_preview text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_contacts_chan_last ON contacts(channel_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  contact_id int NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  direction text NOT NULL,            -- in | out | note | sys
  type text NOT NULL DEFAULT 'text',
  body text NOT NULL DEFAULT '',
  wa_message_id text,
  status text NOT NULL DEFAULT 'sent',
  sender text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_contact ON messages(contact_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_wa ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS templates (
  id serial PRIMARY KEY,
  channel_id int NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL DEFAULT 'UTILITY',
  status text NOT NULL DEFAULT 'PENDING',
  body text NOT NULL DEFAULT '',
  UNIQUE (channel_id, name, language)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id serial PRIMARY KEY,
  channel_id int NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_name text NOT NULL,
  language text NOT NULL,
  params jsonb NOT NULL DEFAULT '[]',
  tag text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sending',   -- sending | paused | done
  total int NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id bigserial PRIMARY KEY,
  campaign_id int NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id int NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',   -- pending | sending | sent | delivered | read | failed
  wa_message_id text,
  error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rec_campaign ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_rec_wa ON campaign_recipients(wa_message_id);

CREATE TABLE IF NOT EXISTS flows (
  id serial PRIMARY KEY,
  channel_id int NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'keyword',  -- keyword | welcome | fallback
  trigger_value text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id bigserial PRIMARY KEY,
  channel_id int NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL DEFAULT '',
  phone text NOT NULL,
  name text NOT NULL DEFAULT '',
  template text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  params jsonb NOT NULL DEFAULT '[]',
  send_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',   -- pending | sending | sent | skipped | cancelled | failed
  error text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, send_at);
CREATE INDEX IF NOT EXISTS idx_sched_ref ON scheduled_messages(channel_id, ref);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---- v2: media, rich templates, flow state ----
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_id text;          -- Meta media id (inbound; fetched on demand)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_ref bigint;       -- row in media table (outbound / template headers)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime text NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS filename text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS media (
  id bigserial PRIMARY KEY,
  channel_id int REFERENCES channels(id) ON DELETE CASCADE,
  mime text NOT NULL,
  filename text NOT NULL DEFAULT '',
  size int NOT NULL DEFAULT 0,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_format text NOT NULL DEFAULT 'NONE';  -- NONE|TEXT|IMAGE|VIDEO|DOCUMENT|LOCATION
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_text text NOT NULL DEFAULT '';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS footer text NOT NULL DEFAULT '';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS buttons jsonb NOT NULL DEFAULT '[]';
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_media_ref bigint;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_meta_id text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_meta_at timestamptz;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS flow_state jsonb;

CREATE OR REPLACE FUNCTION wa_rank(s text) RETURNS int AS $$
  SELECT CASE s WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END
$$ LANGUAGE sql IMMUTABLE;
`;

export const DEFAULT_FLOWS = [
  {
    name: 'Welcome message',
    trigger_type: 'welcome',
    trigger_value: '',
    steps: [{ type: 'text', text: 'Hi {{name}}! Thanks for messaging us. 👋\nReply ORDER to track your order, or HUMAN to talk to our team.' }],
  },
  {
    name: 'Order status',
    trigger_type: 'keyword',
    trigger_value: 'order, track',
    steps: [
      { type: 'text', text: 'Please share your order number (e.g. #1001) and our team will check the status for you.' },
      { type: 'tag', tag: 'order-query' },
      { type: 'handoff' },
    ],
  },
  {
    name: 'Talk to human',
    trigger_type: 'keyword',
    trigger_value: 'human, agent, support',
    steps: [{ type: 'text', text: 'Sure {{name}}, connecting you to our team. We will reply shortly.' }, { type: 'handoff' }],
  },
];
