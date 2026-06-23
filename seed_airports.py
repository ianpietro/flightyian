#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Flighty IAN - Supabase Airports Seeding Script

import os
import pandas as pd
from supabase import create_client

# Função leve para carregar variáveis do arquivo .env
def load_env():
    env = {}
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    key, val = line.strip().split("=", 1)
                    env[key.strip()] = val.strip().strip('"').strip("'")
    return env

# ======================================================================
# CONFIGURAÇÃO DO SUPABASE
env = load_env()
SUPABASE_URL = env.get("SUPABASE_URL", "")
SUPABASE_KEY = env.get("SUPABASE_KEY", "")
# ======================================================================

def main():
    if not SUPABASE_URL or not SUPABASE_KEY or SUPABASE_KEY == "SUA_SERVICE_ROLE_KEY_AQUI":
        print("[-] ERRO: Chaves do Supabase não encontradas. Certifique-se de configurar o arquivo .env!")
        return

    print("[+] Conectando ao Supabase...")
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[-] Erro ao conectar ao Supabase: {e}")
        return

    print("[+] Baixando dados públicos atualizados do OurAirports...")
    url = "https://davidmegginson.github.io/ourairports-data/airports.csv"
    try:
        df = pd.read_csv(url)
    except Exception as e:
        print(f"[-] Erro ao baixar dados do OurAirports: {e}")
        return

    # Filtrar aeroportos comerciais (médios e grandes)
    print("[+] Filtrando apenas aeroportos comerciais...")
    df = df[df['type'].isin(['medium_airport', 'large_airport'])]

    # Regras de Negócio Geográficas:
    # Europa (EU), América do Norte (NA), América do Sul (SA) -> Entram todos os comerciais
    # Ásia (AS), África (AF), Oceania (OC) -> Entram apenas os hubs principais (large_airport)
    def filtrar_escopo(row):
        continente = row['continent']
        tipo = row['type']
        
        if continente in ['EU', 'NA', 'SA']:
            return True
        elif continente in ['AS', 'AF', 'OC'] and tipo == 'large_airport':
            return True
        return False

    df_filtrado = df[df.apply(filtrar_escopo, axis=1)].copy()
    print(f"[+] Total de aeroportos que passaram no filtro: {len(df_filtrado)}")

    # Mapear as colunas do CSV para a estrutura da tabela public.airports
    print("[+] Formatando dados para o banco...")
    df_filtrado['iata_code'] = df_filtrado['iata_code'].fillna('')
    df_filtrado['municipality'] = df_filtrado['municipality'].fillna('Unknown City')
    df_filtrado['iso_country'] = df_filtrado['iso_country'].fillna('')
    df_filtrado['continent'] = df_filtrado['continent'].fillna('')

    dados_formatados = []
    for _, row in df_filtrado.iterrows():
        dados_formatados.append({
            "icao": row["ident"],
            "iata": row["iata_code"] if row["iata_code"] != "" else None,
            "name": row["name"],
            "city": row["municipality"],
            "country": row["iso_country"],
            "country_code": row["iso_country"],
            "continent": row["continent"],
            "latitude": float(row["latitude_deg"]),
            "longitude": float(row["longitude_deg"]),
            "timezone": None,  # Pode ser populado futuramente se necessário
            "is_major_hub": row["type"] == "large_airport"
        })

    # Fazer upload em blocos (batching) de 500 registros para evitar sobrecarga ou timeouts da API
    batch_size = 500
    total_records = len(dados_formatados)
    print(f"[+] Iniciando envio de {total_records} aeroportos para o Supabase em blocos de {batch_size}...")

    for i in range(0, total_records, batch_size):
        batch = dados_formatados[i:i+batch_size]
        try:
            supabase.table("airports").insert(batch).execute()
            print(f"[✓] Progresso: {min(i + batch_size, total_records)}/{total_records} enviados.")
        except Exception as e:
            print(f"[-] Erro ao enviar bloco {i} a {i+batch_size}: {e}")
            print("Tentando continuar com o próximo bloco...")

    print("[✓] Carga de aeroportos concluída com sucesso!")

if __name__ == "__main__":
    main()
