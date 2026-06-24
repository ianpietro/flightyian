-- Schema SQL para o Supabase - Flighty IAN
-- Copie e cole este script completo no SQL Editor do seu projeto Supabase (https://supabase.com) e clique em RUN.

-- 1. Tabela de Perfis de Usuário (vinculada com auth.users)
create table if not exists public.profiles (
    id uuid references auth.users on delete cascade primary key,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    username text unique not null,
    full_name text,
    avatar_url text,
    home_airport_icao varchar(4), -- Aeroporto base do usuário (ex: SBGL)
    tier_level varchar(20) default 'bronze', -- Sistema de fidelidade do próprio app
    total_distance_km integer default 0,
    total_flight_hours integer default 0,
    
    constraint username_length check (char_length(username) >= 3)
);

-- 2. Tabela de Voos do Usuário
create table if not exists public.flights (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.profiles(id) on delete cascade not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    flight_date date not null,
    
    -- Dados do Voo
    airline_code varchar(3) not null, -- IATA ou ICAO (ex: TAM/JJ, AZU/AD)
    airline_name text not null,
    flight_number varchar(10) not null,
    
    -- Origem
    origin_airport_code varchar(4) not null, -- Usar ICAO ou IATA (ex: SDU ou SBRJ)
    origin_airport_name text not null,
    origin_city text not null,
    origin_country_code varchar(2) not null, -- ISO de 2 letras (ex: BR, US)
    
    -- Destino
    destination_airport_code varchar(4) not null,
    destination_airport_name text not null,
    destination_city text not null,
    destination_country_code varchar(2) not null,
    
    -- Detalhes da Aeronave
    aircraft_type varchar(10), -- Ex: B738, A320
    aircraft_registration varchar(15), -- Matrícula/Prefixo (ex: PR-XRA)
    
    -- Métricas
    distance_km integer default 0,
    duration_minutes integer default 0,
    seat_number varchar(10),
    flight_class varchar(20) default 'economy', -- economy, premium, business, first
    reason_for_travel varchar(20) default 'leisure', -- leisure, business, crew
    
    -- Customização do Usuário
    user_notes text,
    rating_stars integer check (rating_stars between 1 and 5),
    is_public boolean default true
);

-- Índices cruciais para que a busca por voos e estatísticas seja instantânea
create index if not exists flights_user_id_idx on public.flights(user_id);
create index if not exists flights_date_idx on public.flights(flight_date);

-- 3. Tabela de Badges/Conquistas
create table if not exists public.badges (
    id uuid default gen_random_uuid() primary key,
    title text unique not null,
    description text not null,
    icon_url text not null,
    category varchar(30) not null, -- 'distance', 'regions', 'special', 'airlines'
    requirement_type varchar(50) not null -- ex: 'count_countries', 'hours_accumulated'
);

-- 4. Tabela de Relação Usuário <-> Conquistas
create table if not exists public.user_badges (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.profiles(id) on delete cascade not null,
    badge_id uuid references public.badges(id) on delete cascade not null,
    unlocked_at timestamp with time zone default timezone('utc'::text, now()) not null,
    
    unique(user_id, badge_id)
);

-- 5. Tabela de Aeroportos de Referência
create table if not exists public.airports (
    icao varchar(4) primary key,         -- Código ICAO (ex: SBGL, EGLL)
    iata varchar(3) unique,             -- Código IATA (ex: GIG, LHR)
    name text not null,                 -- Nome do Aeroporto
    city text not null,                 -- Cidade
    country text not null,              -- Nome do País
    country_code varchar(2) not null,   -- Código ISO (ex: BR, GB, US)
    continent varchar(2) not null,      -- EU, NA, SA, AS, AF, OC
    
    -- Coordenadas tradicionais (Ideais para mandar pro Front-end de forma simples)
    latitude float8 not null,
    longitude float8 not null,
    
    timezone text,                      -- Ex: "America/Sao_Paulo"
    is_major_hub boolean default false, -- Flag para destacar aeroportos principais
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Índices para buscas instantâneas na tabela de aeroportos
create index if not exists airports_iata_idx on public.airports(iata);
create index if not exists airports_country_code_idx on public.airports(country_code);
create index if not exists airports_continent_idx on public.airports(continent);

-- 6. Trigger para auto-criação de perfil do usuário após o cadastro (signUp)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger para auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 7. Trigger para recalcular distância total e horas de voo automaticamente
create or replace function public.handle_flight_stats_update()
returns trigger as $$
declare
    target_user_id uuid;
begin
    -- Descobrir qual usuário recebeu a alteração (funciona para INSERT, UPDATE e DELETE)
    if (TG_OP = 'DELETE') then
        target_user_id := old.user_id;
    else
        target_user_id := new.user_id;
    end if;

    -- Atualizar o perfil do usuário com o somatório atualizado
    update public.profiles
    set 
        total_distance_km = coalesce((
            select sum(distance_km) 
            from public.flights 
            where user_id = target_user_id
        ), 0),
        total_flight_hours = coalesce((
            select sum(duration_minutes) / 60 
            from public.flights 
            where user_id = target_user_id
        ), 0),
        updated_at = timezone('utc'::text, now())
    where id = target_user_id;

    return null;
end;
$$ language plpgsql security definer;

-- Trigger para flights
drop trigger if exists on_flight_change on public.flights;
create trigger on_flight_change
after insert or update or delete on public.flights
for each row execute function public.handle_flight_stats_update();

-- 8. Configuração de RLS (Row Level Security) para proteger as tabelas
alter table public.profiles enable row level security;
alter table public.flights enable row level security;
alter table public.airports enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;

-- Políticas de acesso para Profiles
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
create policy "Public profiles are viewable by everyone." on public.profiles for select using (true);

drop policy if exists "Users can update their own profile." on public.profiles;
create policy "Users can update their own profile." on public.profiles for update using (auth.uid() = id);

-- Políticas de acesso para Flights
drop policy if exists "Users can view their own flights." on public.flights;
create policy "Users can view their own flights." on public.flights for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own flights." on public.flights;
create policy "Users can insert their own flights." on public.flights for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own flights." on public.flights;
create policy "Users can update their own flights." on public.flights for update using (auth.uid() = user_id);

drop policy if exists "Users can delete their own flights." on public.flights;
create policy "Users can delete their own flights." on public.flights for delete using (auth.uid() = user_id);

-- Políticas de acesso para Airports
drop policy if exists "Airports are viewable by everyone." on public.airports;
create policy "Airports are viewable by everyone." on public.airports for select using (true);

-- Políticas de acesso para Badges
drop policy if exists "Badges are viewable by everyone." on public.badges;
create policy "Badges are viewable by everyone." on public.badges for select using (true);

-- Políticas de acesso para User Badges
drop policy if exists "Users can view their own badges." on public.user_badges;
create policy "Users can view their own badges." on public.user_badges for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own badges." on public.user_badges;
create policy "Users can insert their own badges." on public.user_badges for insert with check (auth.uid() = user_id);

-- ===================================================================
-- 9. Tabela de E-mails Permitidos (Whitelist de Acesso)
-- ===================================================================
-- Criada para controlar quais e-mails podem acessar o aplicativo.
-- Novos e-mails são adicionados automaticamente via trigger ao cadastro
-- ou manualmente via script sync_emails.py.

create table if not exists public.allowed_emails (
    email text primary key,
    added_at timestamp with time zone default timezone('utc'::text, now()) not null,
    added_by text default 'system'  -- 'system', 'trigger', 'sync_script', 'admin'
);

-- Habilitar RLS
alter table public.allowed_emails enable row level security;

-- Qualquer usuário autenticado pode verificar se o seu próprio e-mail está na lista
drop policy if exists "Users can check their own email in whitelist." on public.allowed_emails;
create policy "Users can check their own email in whitelist." on public.allowed_emails
    for select using (email = auth.jwt() ->> 'email');

-- Seed inicial: e-mail do administrador sempre permitido
insert into public.allowed_emails (email, added_by) values
    ('ianpietrocapo@gmail.com', 'admin')
on conflict (email) do nothing;

-- ===================================================================
-- 10. Trigger: ao criar novo usuário, inserir seu e-mail na whitelist
-- (garantindo inclusão automática quando novos usuários são adicionados)
-- ===================================================================
create or replace function public.handle_new_user_whitelist()
returns trigger as $$
begin
    -- Adiciona o e-mail do novo usuário na lista de permitidos automaticamente
    insert into public.allowed_emails (email, added_by)
    values (new.email, 'trigger')
    on conflict (email) do nothing;
    return new;
end;
$$ language plpgsql security definer;

-- Trigger para auth.users - executa após cada novo cadastro
drop trigger if exists on_auth_user_whitelist on auth.users;
create trigger on_auth_user_whitelist
    after insert on auth.users
    for each row execute procedure public.handle_new_user_whitelist();
