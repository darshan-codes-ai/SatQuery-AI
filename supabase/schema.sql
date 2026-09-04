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

-- This table is written by the server using the Supabase secret key.
-- Keep it private and do not expose the secret key to browser/client code.
alter table public.analysis_history enable row level security;
