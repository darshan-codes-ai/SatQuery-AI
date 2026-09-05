-- SatQuery AI: persistent analysis history
-- Run this script once in Supabase SQL Editor.

create table if not exists public.analysis_history (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  latitude double precision not null,
  longitude double precision not null,
  geometry jsonb,
  analysis_type text,
  ndvi double precision,
  ndwi double precision,
  ndbi double precision,
  valid_pixel_coverage double precision,
  confidence double precision,
  confidence_label text,
  cloud_coverage double precision,
  acquisition_date timestamptz,
  sensor text default 'Sentinel-2 L2A',
  processing_resolution text,
  ai_interpretation jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analysis_history_created_at_idx
  on public.analysis_history (created_at desc);

create index if not exists analysis_history_location_idx
  on public.analysis_history (latitude, longitude);

-- Persistent Before/After comparisons from Change Detection.
create table if not exists public.change_detection_history (
  id uuid primary key default gen_random_uuid(),
  latitude double precision not null,
  longitude double precision not null,
  geometry jsonb not null,
  before_target_date date not null,
  after_target_date date not null,
  before_acquisition_date timestamptz,
  after_acquisition_date timestamptz,
  before_scene_id text,
  after_scene_id text,
  before_ndvi double precision,
  after_ndvi double precision,
  before_ndwi double precision,
  after_ndwi double precision,
  before_ndbi double precision,
  after_ndbi double precision,
  ndvi_delta double precision,
  ndwi_delta double precision,
  ndbi_delta double precision,
  ndvi_change_percent double precision,
  ndwi_change_percent double precision,
  ndbi_change_percent double precision,
  before_cloud_coverage double precision,
  after_cloud_coverage double precision,
  summary text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists change_detection_history_created_at_idx
  on public.change_detection_history (created_at desc);

create index if not exists change_detection_history_location_idx
  on public.change_detection_history (latitude, longitude);

-- These tables are written by the server using the Supabase secret key.
-- Keep the secret key private and never expose it to browser/client code.
alter table public.analysis_history enable row level security;
alter table public.change_detection_history enable row level security;
