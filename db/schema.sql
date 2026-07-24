-- UIC Group Agent System — schema additions
-- Run once against your existing Postgres DB (does not touch existing Instagram-agent tables)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- One row per content idea moving through the Intelligence -> Creation -> Distribution pipeline
CREATE TABLE IF NOT EXISTS content_pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,                 -- pixel_diagnostics, airmed, urja, usmanpura
  stage TEXT NOT NULL DEFAULT 'queued',-- queued / intelligence / creation / distribution / done / failed
  status TEXT NOT NULL DEFAULT 'pending',
  trend_source JSONB,
  script JSONB,
  assets JSONB,                        -- image/video/voice/subtitle URLs once generated
  platforms_targeted TEXT[] DEFAULT '{}',
  flow_job_id TEXT,                    -- BullMQ flow root job id, for lookup/debugging
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per individual agent call — audit trail + per-agent cost tracking
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES content_pipeline_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  input JSONB,
  output JSONB,
  status TEXT NOT NULL,                -- success / failed / needs_review
  confidence NUMERIC,
  cost_usd NUMERIC DEFAULT 0,
  duration_ms INT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Published post tracking, per platform
CREATE TABLE IF NOT EXISTS published_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id UUID REFERENCES content_pipeline_runs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,              -- instagram / facebook / youtube_shorts / linkedin
  external_post_id TEXT,
  published_at TIMESTAMPTZ,
  metrics JSONB DEFAULT '{}',          -- filled in later by Analytics Agent
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Leads captured via engagement (comments/DMs) -> qualified -> handed to CRM
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_platform TEXT,
  source_post_id UUID REFERENCES published_posts(id),
  contact_name TEXT,
  contact_phone TEXT,
  contact_handle TEXT,
  intent_signal TEXT,                  -- raw comment/DM text that triggered qualification
  qualification_score NUMERIC,         -- 0-1 from Lead Qualification Agent
  status TEXT DEFAULT 'new',           -- new / qualified / contacted / converted / dropped
  crm_ref_id TEXT,                     -- id in external/internal CRM once synced
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_brand_stage ON content_pipeline_runs(brand, stage);
CREATE INDEX IF NOT EXISTS idx_agent_runs_pipeline ON agent_runs(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- v13: post format per run ('reel' = avatar/slideshow video, 'image' = static post)
ALTER TABLE content_pipeline_runs ADD COLUMN IF NOT EXISTS format TEXT DEFAULT 'reel';
