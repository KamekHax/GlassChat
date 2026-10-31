CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_-]{2,48}$'),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE community_memberships (
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_memberships_user_idx ON community_memberships(user_id, community_id);

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  topic TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, name),
  UNIQUE (id, community_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_channel_time_idx ON messages(channel_id, created_at DESC, id DESC);

INSERT INTO communities (slug, name) VALUES ('commons', 'Commons');
INSERT INTO community_memberships (community_id,user_id,role)
SELECT c.id,u.id,'member' FROM communities c CROSS JOIN users u WHERE c.slug='commons'
ON CONFLICT (community_id,user_id) DO NOTHING;
INSERT INTO channels (community_id, name, topic)
SELECT id, 'general', 'Welcome to Commons' FROM communities WHERE slug = 'commons';
