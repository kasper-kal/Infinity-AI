import { Pool } from 'pg';
import 'dotenv/config';

async function createTables() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
CREATE TABLE IF NOT EXISTS preview_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  component_id UUID REFERENCES build_apps(id) ON DELETE SET NULL,
  preview_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  share_token TEXT NOT NULL UNIQUE,
  access_level TEXT NOT NULL DEFAULT 'public' CHECK (access_level IN ('public', 'private', 'password')),
  password_hash TEXT,
  expires_at TIMESTAMPTZ,
  allowed_emails JSONB DEFAULT '[]',
  allowed_domains JSONB DEFAULT '[]',
  enable_comments BOOLEAN NOT NULL DEFAULT true,
  enable_reactions BOOLEAN NOT NULL DEFAULT true,
  notify_on_comment BOOLEAN NOT NULL DEFAULT true,
  view_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS preview_shares_project_idx ON preview_shares(project_id);
CREATE INDEX IF NOT EXISTS preview_shares_expires_idx ON preview_shares(expires_at);

CREATE TABLE IF NOT EXISTS preview_share_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES preview_shares(id) ON DELETE CASCADE,
  email TEXT,
  ip TEXT,
  user_agent TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS preview_share_access_share_idx ON preview_share_access(share_id);
CREATE INDEX IF NOT EXISTS preview_share_access_accessed_idx ON preview_share_access(accessed_at);

CREATE TABLE IF NOT EXISTS preview_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES preview_shares(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES preview_comments(id) ON DELETE CASCADE,
  element_selector TEXT,
  element_data JSONB,
  author_name TEXT NOT NULL,
  author_email TEXT,
  author_avatar TEXT,
  content TEXT NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES accounts(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS preview_comments_share_idx ON preview_comments(share_id);
CREATE INDEX IF NOT EXISTS preview_comments_parent_idx ON preview_comments(parent_id);
CREATE INDEX IF NOT EXISTS preview_comments_element_idx ON preview_comments(element_selector);
CREATE INDEX IF NOT EXISTS preview_comments_created_idx ON preview_comments(created_at);

CREATE TABLE IF NOT EXISTS preview_comment_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES preview_comments(id) ON DELETE CASCADE,
  mentioned_email TEXT NOT NULL,
  notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS preview_comment_mentions_comment_idx ON preview_comment_mentions(comment_id);
CREATE INDEX IF NOT EXISTS preview_comment_mentions_email_idx ON preview_comment_mentions(mentioned_email);
  `);

  console.log('Preview shares tables created successfully');
  await pool.end();
}

createTables().catch(console.error);