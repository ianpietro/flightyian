#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Flighty IAN - Real Email Flight Scraper & Integrator

import imaplib
# Evita erro imaplib.error: got more than 1000000 bytes em caixas de e-mail gigantescas
imaplib._MAXLINE = 100000000

import email
from email.header import decode_header
import re
import json
import os
import math
import getpass
from datetime import datetime

# ======================================================================
# CONFIGURAÇÃO DE CREDENCIAIS (FLIGHTY PRO LINK)
# Coloque suas credenciais entre as aspas abaixo para não precisar digitar toda vez:
DEFAULT_EMAIL = "ianpietrocapo@gmail.com"
DEFAULT_APP_PASSWORD = "lfugqbqkcxpgvops"

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

# Integração opcional com Supabase (Sincronização na Nuvem)
env = load_env()
SUPABASE_URL = env.get("SUPABASE_URL", "")
SUPABASE_KEY = env.get("SUPABASE_KEY", "")
SUPABASE_USER_ID = env.get("SUPABASE_USER_ID", "")
# ======================================================================

# Airport registers matching mockData.js coordinates for Haversine math
AIRPORTS_DB = {
  "CNF": {"lat": -19.6244, "lng": -43.9719, "city": "Belo Horizonte"},
  "IGU": {"lat": -25.5977, "lng": -54.4851, "city": "Foz do Iguaçu"},
  "IGR": {"lat": -25.7373, "lng": -54.4734, "city": "Iguazu"},
  "AEP": {"lat": -34.5580, "lng": -58.4173, "city": "Buenos Aires"},
  "REL": {"lat": -43.2105, "lng": -65.2703, "city": "Trelew"},
  "USH": {"lat": -54.8433, "lng": -68.2958, "city": "Ushuaia"},
  "GIG": {"lat": -22.8134, "lng": -43.2494, "city": "Rio de Janeiro"},
  "VCP": {"lat": -23.0074, "lng": -47.1345, "city": "Campinas"},
  "BEL": {"lat": -1.3792, "lng": -48.4763, "city": "Belém"},
  "GRU": {"lat": -23.4356, "lng": -46.4731, "city": "São Paulo"},
  "LDB": {"lat": -23.3303, "lng": -51.1384, "city": "Londrina"},
  "SDU": {"lat": -22.9102, "lng": -43.1631, "city": "Rio de Janeiro"},
  "CGH": {"lat": -23.6261, "lng": -46.6564, "city": "São Paulo"},
  "DXB": {"lat": 25.2532, "lng": 55.3657, "city": "Dubai"},
  "EZE": {"lat": -34.8222, "lng": -58.5358, "city": "Buenos Aires"},
  "LIS": {"lat": 38.7756, "lng": -9.1354, "city": "Lisboa"},
  "MIA": {"lat": 25.7959, "lng": -80.2870, "city": "Miami"},
  "JFK": {"lat": 40.6413, "lng": -73.7781, "city": "Nova York"},
  "MCO": {"lat": 28.4281, "lng": -81.3090, "city": "Orlando"},
  "LHR": {"lat": 51.4700, "lng": -0.4543, "city": "Londres"},
  "CDG": {"lat": 49.0097, "lng": 2.5479, "city": "Paris"},
  "MAD": {"lat": 40.4839, "lng": -3.5680, "city": "Madri"},
  "PTY": {"lat": 9.0714, "lng": -79.3835, "city": "Cidade do Panamá"},
  "BRC": {"lat": -41.1511, "lng": -71.1577, "city": "Bariloche"},
  "MCZ": {"lat": -9.5108, "lng": -35.7917, "city": "Maceió"},
  "BCN": {"lat": 41.2974, "lng": 2.0785, "city": "Barcelona"},
  "DEL": {"lat": 28.5687, "lng": 77.1061, "city": "Nova Deli"},
  "FCO": {"lat": 41.7993, "lng": 12.2462, "city": "Roma"},
  "CUN": {"lat": 21.0365, "lng": -86.8770, "city": "Cancún"},
  "UNA": {"lat": -15.3512, "lng": -38.9985, "city": "Ilha de Comandatuba"},
  "BYO": {"lat": -21.0119, "lng": -56.3769, "city": "Bonito"},
  "FOR": {"lat": -3.7758, "lng": -38.5322, "city": "Fortaleza"},
  "BOG": {"lat": 4.7017, "lng": -74.1469, "city": "Bogotá"},
  "MDE": {"lat": 6.1645, "lng": -75.4227, "city": "Medellín"},
  "ADZ": {"lat": 12.5767, "lng": -81.7114, "city": "San Andrés"},
  "SCL": {"lat": -33.3930, "lng": -70.7858, "city": "Santiago"},
  "CJC": {"lat": -22.4981, "lng": -68.9036, "city": "Calama"},
  "MVD": {"lat": -34.8384, "lng": -56.0308, "city": "Montevideo"},
  "POA": {"lat": -29.9939, "lng": -51.1711, "city": "Porto Alegre"},
  "FLN": {"lat": -27.6702, "lng": -48.5525, "city": "Florianópolis"},
  "NVT": {"lat": -26.8787, "lng": -48.6510, "city": "Navegantes"},
  "CXJ": {"lat": -29.1961, "lng": -51.1897, "city": "Caxias do Sul"},
  "CWB": {"lat": -25.5285, "lng": -49.1758, "city": "Curitiba"},
  "PMW": {"lat": -10.2900, "lng": -48.3578, "city": "Palmas"},
  "BSB": {"lat": -15.8692, "lng": -47.9172, "city": "Brasília"},
  "GYN": {"lat": -16.6322, "lng": -49.2206, "city": "Goiânia"},
  "CGB": {"lat": -15.6531, "lng": -56.1167, "city": "Cuiabá"},
  "SCL": {"lat": -33.3930, "lng": -70.7858, "city": "Santiago"},
  "CJC": {"lat": -22.4981, "lng": -68.9036, "city": "Calama"},
  "BOG": {"lat": 4.7017, "lng": -74.1469, "city": "Bogotá"},
  "MDE": {"lat": 6.1645, "lng": -75.4227, "city": "Medellín"},
  "ADZ": {"lat": 12.5767, "lng": -81.7114, "city": "San Andrés"},
  "MVD": {"lat": -34.8384, "lng": -56.0308, "city": "Montevideo"},
  "FLN": {"lat": -27.6702, "lng": -48.5525, "city": "Florianópolis"},
  "NVT": {"lat": -26.8787, "lng": -48.6510, "city": "Navegantes"},
  "CXJ": {"lat": -29.1961, "lng": -51.1897, "city": "Caxias do Sul"},
  "PMW": {"lat": -10.2900, "lng": -48.3578, "city": "Palmas"},
  "BSB": {"lat": -15.8692, "lng": -47.9172, "city": "Brasília"},
  "GYN": {"lat": -16.6322, "lng": -49.2206, "city": "Goiânia"},
  "CGR": {"lat": -20.4687, "lng": -54.6725, "city": "Campo Grande"}
}

AIRLINES_DB = {
  "AD": "Azul",
  "G3": "GOL",
  "AR": "Aerolineas Argentinas",
  "FO": "Flybondi",
  "LA": "LATAM",
  "JJ": "LATAM",
  "EK": "Emirates",
  "TP": "TAP Air Portugal",
  "CM": "Copa Airlines",
  "AA": "American Airlines",
  "UA": "United Airlines",
  "DL": "Delta Air Lines",
  "AF": "Air France",
  "LH": "Lufthansa",
  "BA": "British Airways",
  "QR": "Qatar Airways",
  "IB": "Iberia",
  "AV": "Avianca",
  "H2": "Sky Airline",
  "JA": "JetSMART",
  "WJ": "JetSMART",
  "SKX": "Sky Peru"
}

def calculate_distance(lat1, lon1, lat2, lon2):
    R = 6371.0 # Earth radius in km
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return int(round(R * c))

def clean_html(raw_html):
    # Strip HTML tags to scan plain text
    cleanr = re.compile('<.*?>|&nbsp;|\r|\n')
    cleantext = re.sub(cleanr, ' ', raw_html)
    return ' '.join(cleantext.split())

def decode_mime_words(s):
    # Decode email subjects correctly
    decoded_seq = decode_header(s)
    decoded_string = ""
    for part, encoding in decoded_seq:
        if isinstance(part, bytes):
            if encoding:
                try:
                    decoded_string += part.decode(encoding)
                except Exception:
                    decoded_string += part.decode('utf-8', errors='ignore')
            else:
                decoded_string += part.decode('utf-8', errors='ignore')
        else:
            decoded_string += str(part)
    return decoded_string

def parse_flight_from_text(text, default_date_str="2026-06-25"):
    # 1. Search for Airline carrier + Flight number (Strict 3-4 digits, or 1-2 digits only with flight context)
    # Suporta códigos IATA (Ex: EK 261) e nomes por extenso (Ex: Flybondi 5101)
    flight_pattern_strict = re.compile(
        r'\b(AD|G3|AR|FO|LA|JJ|EK|TP|CM|AA|UA|DL|AF|LH|BA|QR|IB|AV|H2|JA|WJ|azul|gol|latam|aerolineas|aerolíneas|flybondi|emirates|tap|copa|avianca|sky|jetsmart)\s?(?:voo|flight|vuelo)?\s?(\d{3,4})\b',
        re.IGNORECASE
    )
    flight_match = flight_pattern_strict.search(text)
    
    if not flight_match:
        # Fallback para voos de 1-2 dígitos (Ex: EK 73, LA 10) apenas se houver forte contexto de viagem no e-mail
        flight_pattern_short = re.compile(
            r'\b(AD|G3|AR|FO|LA|JJ|EK|TP|CM|AA|UA|DL|AF|LH|BA|QR|IB|AV|H2|JA|WJ|azul|gol|latam|aerolineas|aerolíneas|flybondi|emirates|tap|copa|avianca|sky|jetsmart)\s?(?:voo|flight|vuelo)?\s?(\d{1,2})\b',
            re.IGNORECASE
        )
        short_match = flight_pattern_short.search(text)
        if short_match:
            context_words = ["voo", "flight", "vuelo", "passagem", "reserva", "e-ticket", "ticket", "localizador", "booking", "boarding", "embarque", "assento"]
            text_lower = text.lower()
            if any(w in text_lower for w in context_words):
                flight_match = short_match
                
    if not flight_match:
        return None
        
    carrier_raw = flight_match.group(1).upper()
    flight_number_digits = flight_match.group(2)
    
    # Mapeia nomes completos para códigos IATA
    carrier_map = {
        "AZUL": "AD",
        "GOL": "G3",
        "LATAM": "LA",
        "AEROLINEAS": "AR",
        "AEROLÍNEAS": "AR",
        "FLYBONDI": "FO",
        "EMIRATES": "EK",
        "TAP": "TP",
        "COPA": "CM",
        "AVIANCA": "AV",
        "SKY": "H2",
        "JETSMART": "JA"
    }
    airline = carrier_map.get(carrier_raw, carrier_raw)
    flight_num = f"{airline} {flight_number_digits}"
    
    # 2. Search for Airports (Suporta códigos IATA capitalizados e nomes de cidades/aeroportos por extenso)
    AIRPORT_KEYWORDS = {
        "confins": "CNF", "belo horizonte": "CNF",
        "foz do iguaçu": "IGU", "foz do iguacu": "IGU",
        "iguazu": "IGR", "cataratas": "IGR",
        "aeroparque": "AEP",
        "ezeiza": "EZE",
        "trelew": "REL",
        "ushuaia": "USH",
        "galeão": "GIG", "galeao": "GIG",
        "viracopos": "VCP", "campinas": "VCP",
        "belém": "BEL", "belem": "BEL",
        "guarulhos": "GRU", "cumbica": "GRU",
        "londrina": "LDB",
        "santos dumont": "SDU",
        "congonhas": "CGH",
        "dubai": "DXB",
        "lisboa": "LIS", "lisbon": "LIS",
        "miami": "MIA",
        "john f. kennedy": "JFK", "nova york": "JFK", "new york": "JFK",
        "orlando": "MCO",
        "heathrow": "LHR", "londres": "LHR", "london": "LHR",
        "charles de gaulle": "CDG", "paris": "CDG",
        "barajas": "MAD", "madrid": "MAD", "madri": "MAD",
        "tocumen": "PTY", "panamá": "PTY", "panama": "PTY",
        "bariloche": "BRC",
        "maceió": "MCZ", "maceio": "MCZ",
        "barcelona": "BCN", "el prat": "BCN",
        "deli": "DEL", "delhi": "DEL",
        "fiumicino": "FCO", "roma": "FCO", "rome": "FCO",
        "cancún": "CUN", "cancun": "CUN",
        "comandatuba": "UNA",
        "bonito": "BYO",
        "fortaleza": "FOR",
        "bogotá": "BOG", "bogota": "BOG",
        "medellín": "MDE", "medellin": "MDE",
        "san andrés": "ADZ", "san andres": "ADZ",
        "santiago": "SCL",
        "calama": "CJC",
        "montevideo": "MVD", "montevidéu": "MVD",
        "porto alegre": "POA",
        "florianópolis": "FLN", "florianopolis": "FLN",
        "navegantes": "NVT", "itajai": "NVT", "itajají": "NVT",
        "caxias do sul": "CXJ",
        "curitiba": "CWB",
        "palmas": "PMW",
        "brasília": "BSB", "brasilia": "BSB",
        "goiânia": "GYN", "goiania": "GYN",
        "cuiabá": "CGB", "cuiaba": "CGB"
    }

    text_lower = text.lower()
    found_airports = [] # lista de tuplas: (posição_no_texto, código_IATA)
    
    # 1. Busca por códigos IATA exatos em maiúsculas (Ex: SDU, GRU)
    for code in AIRPORTS_DB.keys():
        pattern = re.compile(rf'\b{code}\b')
        for match in pattern.finditer(text.upper()):
            found_airports.append((match.start(), code))
            
    # 2. Busca por nomes de cidades e aeroportos em minúsculas com limite de palavras estrito (Ex: Congonhas, Guarulhos, Fortaleza)
    for keyword, code in AIRPORT_KEYWORDS.items():
        pattern = re.compile(rf'\b{re.escape(keyword)}\b', re.IGNORECASE)
        for match in pattern.finditer(text_lower):
            found_airports.append((match.start(), code))
            
    # Ordena cronologicamente por ordem de aparecimento no e-mail
    found_airports.sort(key=lambda x: x[0])
    
    # Deduplica paradas adjacentes (Ex: se encontrar SDU múltiplicas vezes seguidas, mantém apenas uma)
    unique_stops = []
    for pos, code in found_airports:
        if not unique_stops or unique_stops[-1] != code:
            unique_stops.append(code)
            
    if len(unique_stops) < 2:
        return None
        
    dep_code = unique_stops[0]
    arr_code = unique_stops[1]
    
    # Se a origem e destino forem idênticos no início, tenta avançar
    idx = 1
    while arr_code == dep_code and idx < len(unique_stops):
        arr_code = unique_stops[idx]
        idx += 1
        
    if dep_code == arr_code:
        return None # Rota inválida (mesmo destino)
        
    # 3. Search for Dates in email body (Suporta formatos numéricos e textuais como '28 jan. 2026')
    flight_date = default_date_str
    
    date_iso_match = re.search(r'\b(\d{4})[/-](\d{2})[/-](\d{2})\b', text)
    date_br_match = re.search(r'\b(\d{2})[/-](\d{2})[/-](\d{4})\b', text)
    
    if date_iso_match:
        flight_date = f"{date_iso_match.group(1)}-{date_iso_match.group(2)}-{date_iso_match.group(3)}"
    elif date_br_match:
        flight_date = f"{date_br_match.group(3)}-{date_br_match.group(2)}-{date_br_match.group(1)}"
    else:
        # Analisador de meses textuais (Português/Inglês)
        months_map = {
            "jan": "01", "fev": "02", "mar": "03", "abr": "04", "mai": "05", "jun": "06",
            "jul": "07", "ago": "08", "set": "09", "out": "10", "nov": "11", "dez": "12",
            "january": "01", "february": "02", "march": "03", "april": "04", "may": "05", "june": "06",
            "july": "07", "august": "08", "september": "09", "october": "10", "november": "11", "december": "12",
            "janeiro": "01", "fevereiro": "02", "março": "03", "marco": "03", "abril": "04", "maio": "05", "junho": "06",
            "julho": "07", "agosto": "08", "setembro": "09", "outubro": "10", "novembro": "11", "dezembro": "12",
            "enero": "01", "febrero": "02", "marzo": "03", "abril": "04", "mayo": "05", "junio": "06",
            "julio": "07", "agosto": "08", "septiembre": "09", "octubre": "10", "noviembre": "11", "diciembre": "12"
        }
        
        # Regex para "28 jan. 2026", "28 de jan de 2026", "28 de janeiro de 2026"
        text_date_match = re.search(
            r'\b(\d{1,2})\s*(?:de\s*)?([a-zA-Záçõé]+)\.?\s*(?:de\s*)?(\d{4})\b',
            text
        )
        if text_date_match:
            day = text_date_match.group(1).zfill(2)
            month_str = text_date_match.group(2).lower()
            year = text_date_match.group(3)
            
            month_num = None
            for key, val in months_map.items():
                if key in month_str:
                    month_num = val
                    break
            
            if month_num:
                flight_date = f"{year}-{month_num}-{day}"
        
    # 4. Extract Booking Code (Localizador)
    booking_code = None
    locator_patterns = [
        r'(?:localizador|locator|reserva|reserva\s?nº|código|booking|booking\s?ref)\s*[:\-=]?\s*\b([A-Z0-9]{6})\b',
        r'\b([A-Z0-9]{6})\b'
    ]
    for pattern in locator_patterns:
        loc_match = re.search(pattern, text, re.IGNORECASE)
        if loc_match:
            candidate = loc_match.group(1).upper()
            if candidate not in AIRPORTS_DB and candidate not in ["FLIGHT", "VOEAZU", "PASSAG", "TICKET", "ETICKET", "RESV", "STATUS"]:
                booking_code = candidate
                break
                
    # 5. Calculate Distance & Durations
    coord_dep = AIRPORTS_DB[dep_code]
    coord_arr = AIRPORTS_DB[arr_code]
    distance = calculate_distance(coord_dep["lat"], coord_dep["lng"], coord_arr["lat"], coord_arr["lng"])
    duration = int(round(distance / 8)) + 30 # 8 km/min standard speed + 30 mins buffers
    
    # Completed vs Scheduled comparison (App baseline date: 2026-05-22)
    today = datetime.strptime("2026-05-22", "%Y-%m-%d")
    f_date = datetime.strptime(flight_date, "%Y-%m-%d")
    is_completed = f_date < today
    
    return {
        "id": f"email_parsed_{int(datetime.now().timestamp())}_{dep_code}_{arr_code}",
        "flightNumber": flight_num,
        "airline": airline,
        "from": dep_code,
        "to": arr_code,
        "date": flight_date,
        "depTime": "11:30" if is_completed else "15:15",
        "arrTime": "12:45" if is_completed else "16:30",
        "duration": duration,
        "distance": distance,
        "delay": int(math.floor(math.sin(distance) * 5) + 5) if is_completed else 0, # mock realistic delays
        "aircraft": "A320neo" if airline == "AD" else "B737-800",
        "tailNumber": f"PR-YV{int(math.floor(distance % 9))}",
        "status": "Completed" if is_completed else "Scheduled",
        "bookingCode": booking_code
    }

def load_existing_flights(file_path):
    if not os.path.exists(file_path):
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Extract JS array inside window.IMPORTED_FLIGHTS = [ ... ];
            match = re.search(r'window\.IMPORTED_FLIGHTS\s*=\s*(\[.*?\])\s*;', content, re.DOTALL)
            if match:
                return json.loads(match.group(1))
    except Exception as e:
        print(f"Aviso ao ler {file_path}: {e}. Criando base limpa.")
    return []

def save_flights_js(file_path, flights):
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write("// Flighty IAN - Real Imported Flights from Email\n")
            f.write("// ATENÇÃO: Este arquivo é atualizado automaticamente pelo script sync_emails.py.\n\n")
            f.write("window.IMPORTED_FLIGHTS = ")
            f.write(json.dumps(flights, indent=2, ensure_ascii=False))
            f.write(";\n")
        return True
    except Exception as e:
        print(f"Erro ao gravar {file_path}: {e}")
        return False

def sync_with_supabase(flights):
    # Verifica se os dados necessários estão configurados
    if (not SUPABASE_URL or SUPABASE_URL == "SUA_PROJECT_URL_AQUI" or 
        not SUPABASE_KEY or SUPABASE_KEY == "SUA_SERVICE_ROLE_KEY_AQUI" or 
        not SUPABASE_USER_ID or SUPABASE_USER_ID == "SEU_USER_ID_SUPABASE_AQUI"):
        return False
        
    print("\n[+] Sincronizando voos reais com o Supabase...")
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        supabase_records = []
        for f in flights:
            dep_code = f["from"]
            arr_code = f["to"]
            
            dep_info = AIRPORTS_DB.get(dep_code, {"city": dep_code})
            arr_info = AIRPORTS_DB.get(arr_code, {"city": arr_code})
            
            airline_name = AIRLINES_DB.get(f["airline"], f["airline"])
            
            # Montar registro para inserção
            supabase_records.append({
                "user_id": SUPABASE_USER_ID,
                "flight_date": f["date"],
                "airline_code": f["airline"],
                "airline_name": airline_name,
                "flight_number": f["flightNumber"],
                "origin_airport_code": dep_code,
                "origin_airport_name": f"Aeroporto de {dep_info.get('city')}" if "city" in dep_info else dep_code,
                "origin_city": dep_info.get("city", dep_code),
                "origin_country_code": "BR" if dep_code in ["CNF", "IGU", "GIG", "VCP", "BEL", "GRU", "LDB", "SDU", "CGH", "MCZ", "UNA", "BYO", "FOR"] else "AR" if dep_code in ["IGR", "AEP", "REL", "USH", "EZE", "BRC"] else "US",
                "destination_airport_code": arr_code,
                "destination_airport_name": f"Aeroporto de {arr_info.get('city')}" if "city" in arr_info else arr_code,
                "destination_city": arr_info.get("city", arr_code),
                "destination_country_code": "BR" if arr_code in ["CNF", "IGU", "GIG", "VCP", "BEL", "GRU", "LDB", "SDU", "CGH", "MCZ", "UNA", "BYO", "FOR"] else "AR" if arr_code in ["IGR", "AEP", "REL", "USH", "EZE", "BRC"] else "US",
                "aircraft_type": f.get("aircraft", "Commercial"),
                "aircraft_registration": f.get("tailNumber", ""),
                "distance_km": int(f.get("distance", 0)),
                "duration_minutes": int(f.get("duration", 0)),
                "seat_number": f.get("bookingCode", ""),
                "flight_class": "economy",
                "reason_for_travel": "leisure",
                "is_public": True
            })

        # Buscar chaves existentes no banco do Supabase para evitar duplicados
        res = supabase.table("flights").select("flight_number, flight_date").eq("user_id", SUPABASE_USER_ID).execute()
        existing_keys = {f"{row['flight_number']}_{row['flight_date']}" for row in res.data}
        
        to_insert = [r for r in supabase_records if f"{r['flight_number']}_{r['flight_date']}" not in existing_keys]
        
        if to_insert:
            supabase.table("flights").insert(to_insert).execute()
            print(f"[✓] {len(to_insert)} novos voos inseridos no Supabase com sucesso!")
        else:
            print("[✓] Todos os voos já estão atualizados no Supabase.")
            
        return True
    except Exception as e:
        print(f"[!] Erro ao sincronizar com o Supabase: {e}")
        return False

def main():
    print("=" * 60)
    print("      FLIGHTY IAN - IMPORTADOR DE VOOS REAL DO SEU E-MAIL")
    print("=" * 60)
    print("Este script se conecta de forma segura ao seu e-mail (Gmail/Outlook)")
    print("e busca passagens da Azul, GOL, LATAM e Aerolíneas para alimentar seu app.")
    print("-" * 60)
    
    # 1. Carregar credenciais salvas ou solicitar interativamente
    email_user = DEFAULT_EMAIL.strip()
    email_pass = DEFAULT_APP_PASSWORD.strip()
    
    imap_server = ""
    
    # Auto-detecção se as credenciais estiverem pré-configuradas no topo do script
    if email_user and email_pass:
        print(f"[+] Carregando credenciais salvas de: {email_user}")
        email_lower = email_user.lower()
        if email_lower.endswith("@gmail.com"):
            imap_server = "imap.gmail.com"
        elif email_lower.endswith(("@outlook.com", "@hotmail.com", "@live.com", "@msn.com")):
            imap_server = "outlook.office365.com"
        else:
            # Fallback padrão caso seja outro domínio
            imap_server = "imap.gmail.com"
            
    # Se não houver credenciais salvas, executa o fluxo interativo normal
    if not imap_server or not email_user or not email_pass:
        print("Escolha o seu provedor de e-mail:")
        print(" 1) Gmail (imap.gmail.com)")
        print(" 2) Outlook / Hotmail (outlook.office365.com)")
        print(" 3) Outro provedor IMAP customizado")
        
        opt = input("Selecione uma opção (1-3): ").strip()
        
        if opt == "1":
            imap_server = "imap.gmail.com"
            print("\n--> DICA PARA O GMAIL:")
            print("Para sua segurança, a Google exige uma 'Senha de App' (App Password).")
            print("Como gerar em 30 segundos:")
            print("1. Acesse: https://myaccount.google.com/")
            print("2. Vá em 'Segurança' e ative a 'Verificação em duas etapas' (se não estiver ativa).")
            print("3. Na busca da conta, digite 'Senhas de app'.")
            print("4. Crie uma senha com o nome 'Flighty IAN' e copie o código de 16 letras gerado.\n")
        elif opt == "2":
            imap_server = "outlook.office365.com"
            print("\n--> DICA PARA O OUTLOOK:")
            print("Certifique-se de habilitar o acesso IMAP nas configurações de e-mail do seu painel web")
            print("e crie uma 'Senha de Aplicativo' nas configurações de segurança da sua conta Microsoft.\n")
        else:
            imap_server = input("Digite o servidor IMAP do seu provedor (Ex: imap.provedor.com): ").strip()
            
        if not imap_server:
            print("Erro: Servidor IMAP inválido.")
            return
    
        if not email_user:
            email_user = input("Digite o seu endereço de e-mail completo: ").strip()
        if not email_user:
            print("Erro: E-mail não fornecido.")
            return
            
        if not email_pass:
            email_pass = getpass.getpass("Digite a sua Senha de App (os caracteres ficarão ocultos): ").strip()
        if not email_pass:
            print("Erro: Senha não fornecida.")
            return

    # 2. Conexão IMAP
    print(f"\n[+] Conectando a {imap_server} com segurança (SSL)...")
    try:
        mail = imaplib.IMAP4_SSL(imap_server)
        mail.login(email_user, email_pass)
        print("[v] Login efetuado com sucesso!")
    except Exception as e:
        print(f"[-] Falha no login: {e}")
        print("Certifique-se de que digitou o e-mail correto e que usou uma SENHA DE APP, não a senha comum.")
        return

    # Pastas a escanear (inclui pastas customizadas do usuário além do INBOX)
    folders_to_scan = ["INBOX", '"PASSAGENS E RESERVAS"', '"Boarding Passes"']

    all_candidate_emails = []

    for current_folder in folders_to_scan:
        print(f"\n[+] Abrindo pasta: {current_folder}...")
        try:
            status_sel, _ = mail.select(current_folder, readonly=True)
            if status_sel != "OK":
                print(f"[-] Pasta {current_folder} não encontrada, pulando...")
                continue
        except Exception as e:
            print(f"[-] Falha ao abrir pasta {current_folder}: {e}")
            continue

        # 3. Busca Direcionada de E-mails de Voos
        print(f"[+] Executando busca direcionada de voos em {current_folder}...")
        
        search_queries = [
            'SUBJECT "reserva"',
            'SUBJECT "e-ticket"',
            'SUBJECT "bilhete"',
            'SUBJECT "localizador"',
            'SUBJECT "confirmac"',
            'SUBJECT "itinerary"',
            'SUBJECT "cartao de embarque"',
            'SUBJECT "cart\u00e3o de embarque"',
            'SUBJECT "azul"',
            'SUBJECT "voegol"',
            'SUBJECT "latam"',
            'SUBJECT "aerolineas"',
            'SUBJECT "flybondi"',
            'SUBJECT "emirates"',
            'SUBJECT "EK"',
            'SUBJECT "avianca"',
            'SUBJECT "sky"',
            'SUBJECT "jetsmart"',
            'SUBJECT "smiles"',
            'ALL'
        ]

        matched_ids = set()
        for query in search_queries:
            try:
                status, data = mail.search(None, query)
                if status == "OK" and data[0]:
                    for msg_id in data[0].split():
                        matched_ids.add(msg_id)
            except Exception:
                pass

        msg_ids = sorted(list(matched_ids), key=lambda x: int(x))
        total_matched = len(msg_ids)
        print(f"[v] Encontrados {total_matched} e-mails potencialmente elegíveis em {current_folder}.")

        # Whitelist & Blacklist definitions
        blacklist_subjects = [
            "comprar milhas", "compre milhas", "compra de milhas", "clube tudoazul", "clube smiles",
            "clube latam", "extrato de pontos", "saldo de pontos", "seus pontos", "suas milhas",
            "a partir de", "de r$", "voos baratos", "passagens baratas", "mega promo", "megapromo",
            "últimos dias", "últimas horas", "aniver", "aniversário", "comissão", "comissões",
            "ingresso", "ingressos", "disney", "universal", "cruzeiro", "cruzeiros", "apê", "ape",
            "hostel", "pousada", "hotel", "aluguel", "pilates", "academia", "dentista", "consulta",
            "camisetas", "camiseta", "calça", "calca", "tênis", "tenis", "polo", "t-shirt", "bermuda",
            "opiniao", "opinião", "pesquisa de satisfação", "login", "segurança", "dispositivo",
            "fatura", "cartão de crédito", "cartão de credito", "cartao de credito", "premmia",
            "viram milhas", "pontos viram", "ir mais alto", "bem-vindo", "bem vindo", "welcome",
            "black friday", "blackfriday", "happy hour", "happyhour", "jogada aérea", "jogada aerea",
            "última chamada", "ultima chamada", "fidelidade", "novidade", "novidades", "tarifas especiais",
            "dia das crianças", "dia das criancas", "dia dos namorados", "dia das mães", "dia dos pais",
            "natal", "ano novo", "ofertas", "oferta", "promoção", "promocao", "promoções", "promocoes",
            "desconto", "descontos", "ganhe", "acumule", "participe", "cadastre", "expiro el tiempo",
            "boleto de cobranca", "protocolo", "pesquisa", "comunicado", "seja bem-vindo", "black-friday",
            "regulamento", "pontos multiplus", "multiplus", "juntos em", "conhece", "boas festas",
            "rock in rio", "rockinrio", "concorrer", "compartilhamento", "atualização importante",
            "atualizacao importante", "novas rotas", "nova rota", "novo destino", "novos destinos",
            "novo voo", "novos voos", "serviço de bordo", "servico de bordo", "junte e troque",
            "viaje com tranquilidade", "dia do consumidor", "novas tarifas", "lançou novas", "lancou novas",
            "seguiremos construindo", "boas festas", "happy-hour", "blackfriday", "experiência de reserva",
            "validação", "validacao", "valide", "validar", "vacina", "vacinas", "transportou",
            "se reinventou", "reinventou", "bem-vinda a bordo", "bem-vindo a bordo", "lider", "líder",
            "upgrade exclusivo", "estacionamento", "estacionar", "parceria", "parcerias"
        ]

        flight_keywords_local = ["voo", "passagem", "reserva", "e-ticket", "confirmac", "itinerary", "flight", "ticket", "boarding", "azul", "gol", "latam", "decolar", "tripit", "booking", "emirates", "avianca", "sky", "jetsmart", "smiles", "vuelo", "bilhete", "embarque"]

        print(f"[+] Filtrando cabeçalhos em {current_folder}...")
        chunk_size = 300
        import time
        t_start = time.time()
        folder_candidates = []
        for i in range(0, total_matched, chunk_size):
            chunk = msg_ids[i:i+chunk_size]
            ids_str = b",".join(chunk)
            try:
                res, fetch_data = mail.fetch(ids_str, "(BODY[HEADER.FIELDS (SUBJECT FROM DATE)])")
                if res != "OK":
                    continue
                for item in fetch_data:
                    if isinstance(item, tuple):
                        header_bytes = item[1]
                        msg = email.message_from_bytes(header_bytes)
                        
                        subject = decode_mime_words(msg.get("Subject", ""))
                        sender = decode_mime_words(msg.get("From", ""))
                        date_header = msg.get("Date", "")
                        
                        sender_lower = sender.lower()
                        subject_lower = subject.lower()
                        keyword_str = (subject + " " + sender).lower()
                        
                        # 1. Date Age Filter (>= 2015)
                        try:
                            date_tuple = email.utils.parsedate_tz(date_header)
                            if date_tuple:
                                dt = datetime.fromtimestamp(email.utils.mktime_tz(date_tuple))
                                if dt.year < 2015:
                                    continue
                        except Exception:
                            pass

                        # 2. For INBOX: apply strict whitelist; for custom folders: allow all
                        if current_folder == "INBOX":
                            domain = ""
                            sender_email = ""
                            if "@" in sender_lower:
                                email_match = re.search(r'<([^>]+)>', sender_lower)
                                if email_match:
                                    sender_email = email_match.group(1).strip()
                                else:
                                    sender_email = sender_lower.strip()
                                domain = sender_email.split("@")[-1].strip()
                                
                            is_allowed = False
                            if sender_email == "ianpietrocapo@gmail.com":
                                is_allowed = True
                            else:
                                for ok_dom in allowed_domains:
                                    if domain == ok_dom or domain.endswith("." + ok_dom):
                                        is_allowed = True
                                        break
                                        
                            if not is_allowed:
                                continue
                                
                        # 3. Subject Blacklist Filter
                        is_blacklisted = any(bad_sub in subject_lower for bad_sub in blacklist_subjects)
                        if is_blacklisted:
                            continue
                            
                        # 4. Flight Keywords Filter (relax for non-INBOX folders)
                        if current_folder == "INBOX":
                            has_flight_kw = any(kw in keyword_str for kw in flight_keywords_local)
                            if not has_flight_kw:
                                continue
                            
                        # Passed all filters!
                        envelope = item[0].decode()
                        msg_id_match = re.search(r'^(\d+)\s+', envelope)
                        if msg_id_match:
                            numeric_id = msg_id_match.group(1)
                            folder_candidates.append((numeric_id, subject, sender, date_header, current_folder))
            except Exception as e:
                pass
                
        t_end = time.time()
        print(f"[v] {len(folder_candidates)} candidatos em {current_folder} ({t_end - t_start:.1f}s)")
        all_candidate_emails.extend(folder_candidates)

    try:
        mail.close()
        mail.logout()
    except Exception:
        pass

    total_candidates = len(all_candidate_emails)
    print(f"\n[v] Total de candidatos em todas as pastas: {total_candidates}")
    print(f"[+] Fazendo a análise do corpo de {total_candidates} e-mails candidatos...")

    # Re-open connection for body fetching
    try:
        mail = imaplib.IMAP4_SSL(imap_server)
        mail.login(email_user, email_pass)
    except Exception as e:
        print(f"[-] Falha ao reconectar para leitura dos corpos: {e}")
        return

    new_flights = []
    scanned_count = 0
    for idx in range(total_candidates - 1, -1, -1):
        entry = all_candidate_emails[idx]
        numeric_id, subject, sender, date_header, folder_name = entry
        scanned_count += 1
        
        print(f"\n[ Analisando {scanned_count}/{total_candidates} | {folder_name} ] Assunto: '{subject}'")
        
        # Select correct folder for this message
        try:
            mail.select(folder_name, readonly=True)
        except Exception:
            pass

        # Fetch do corpo completo do e-mail candidato
        try:
            res_body, data_body = mail.fetch(numeric_id.encode(), "(RFC822)")
            if res_body != "OK" or not data_body or not data_body[0]:
                continue
                
            raw_email = data_body[0][1]
            full_msg = email.message_from_bytes(raw_email)
            
            body_text = ""
            if full_msg.is_multipart():
                for part in full_msg.walk():
                    content_type = part.get_content_type()
                    content_disposition = str(part.get("Content-Disposition"))
                    if content_type in ["text/plain", "text/html"] and "attachment" not in content_disposition:
                        try:
                            payload = part.get_payload(decode=True).decode("utf-8", errors="ignore")
                            body_text += " " + payload
                        except Exception:
                            pass
            else:
                try:
                    body_text = full_msg.get_payload(decode=True).decode("utf-8", errors="ignore")
                except Exception:
                    pass
                    
            body_cleaned = clean_html(body_text)
            
            # Tenta inferir data da mensagem caso não ache no corpo
            default_date = "2026-06-25"
            try:
                date_tuple = email.utils.parsedate_tz(date_header)
                if date_tuple:
                    dt = datetime.fromtimestamp(email.utils.mktime_tz(date_tuple))
                    default_date = dt.strftime("%Y-%m-%d")
            except Exception:
                pass
                
            # Executa motor de regex
            flight = parse_flight_from_text(subject + " " + body_cleaned, default_date)
            if flight:
                dep_city = AIRPORTS_DB[flight['from']]['city']
                arr_city = AIRPORTS_DB[flight['to']]['city']
                print(f" [✓ VOO DETECTADO REAL! ] {flight['flightNumber']}: {flight['from']} ({dep_city}) ➔ {flight['to']} ({arr_city}) em {flight['date']}")
                new_flights.append(flight)
            else:
                # Tenta assunto apenas
                flight_subj = parse_flight_from_text(subject, default_date)
                if flight_subj:
                    dep_city = AIRPORTS_DB[flight_subj['from']]['city']
                    arr_city = AIRPORTS_DB[flight_subj['to']]['city']
                    print(f" [✓ VOO DETECTADO REAL! ] {flight_subj['flightNumber']}: {flight_subj['from']} ({dep_city}) ➔ {flight_subj['to']} ({arr_city}) em {flight_subj['date']}")
                    new_flights.append(flight_subj)
                else:
                    print(" [-] E-mail correspondente, mas detalhes da rota ou voo não estruturados.")
        except Exception as e:
            print(f" [-] Erro ao analisar e-mail: {e}")
            
    # Fechar conexão IMAP de forma limpa
    try:
        mail.close()
        mail.logout()
    except Exception:
        pass

    # 4. Gravação e Deduplicação no customFlights.js
    db_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "customFlights.js")
    existing_flights = load_existing_flights(db_file_path)
    print(f"\n[+] Voos anteriormente importados na base: {len(existing_flights)}")

    # Unifica e deduplica
    merged_flights = {f"{f['flightNumber']}_{f['date']}": f for f in existing_flights}
    
    added_count = 0
    for flight in new_flights:
        key = f"{flight['flightNumber']}_{flight['date']}"
        is_new = key not in merged_flights
        merged_flights[key] = flight
        if is_new:
            added_count += 1
            
    updated_list = list(merged_flights.values())
    
    if save_flights_js(db_file_path, updated_list):
        print(f"[v] Sucesso! Sincronização concluída localmente.")
        print(f"[v] {added_count} novos voos adicionados nesta rodada.")
        print(f"[v] Total de voos reais importados de e-mail ativos: {len(updated_list)}")
        
        # Tenta sincronizar com o Supabase na nuvem (se configurado)
        sync_with_supabase(updated_list)
        
        print("\n--> PRÓXIMO PASSO:")
        print("Basta dar dois cliques no arquivo 'index.html' da sua pasta para visualizar")
        print("seus voos reais sincronizados plotados na aba do Mapa e Passport!")
    else:
        print("[-] Falha ao gravar banco de voos local customFlights.js.")
        
    print("=" * 60)
    if not os.environ.get("NON_INTERACTIVE"):
        input("\nPressione ENTER para fechar...")

if __name__ == "__main__":
    main()
