// Flighty IAN - Mock Data Registry

// Precise coordinates for the 13 Brazilian & Argentine airports from the flight history
window.AIRPORTS = {
  "CNF": { code: "CNF", city: "Belo Horizonte", name: "Confins International", lat: -19.6244, lng: -43.9719 },
  "IGU": { code: "IGU", city: "Foz do Iguaçu", name: "Foz do Iguaçu International", lat: -25.5977, lng: -54.4851 },
  "IGR": { code: "IGR", city: "Iguazu", name: "Cataratas del Iguazú", lat: -25.7373, lng: -54.4734 },
  "AEP": { code: "AEP", city: "Buenos Aires", name: "Aeroparque Jorge Newbery", lat: -34.5580, lng: -58.4173 },
  "REL": { code: "REL", city: "Trelew", name: "Almirante Marcos A. Zar", lat: -43.2105, lng: -65.2703 },
  "USH": { code: "USH", city: "Ushuaia", name: "Ushuaia Malvinas Argentinas", lat: -54.8433, lng: -68.2958 },
  "GIG": { code: "GIG", city: "Rio de Janeiro", name: "Galeão International", lat: -22.8134, lng: -43.2494 },
  "VCP": { code: "VCP", city: "Campinas", name: "Viracopos International", lat: -23.0074, lng: -47.1345 },
  "BEL": { code: "BEL", city: "Belém", name: "Val-de-Cans International", lat: -1.3792, lng: -48.4763 },
  "GRU": { code: "GRU", city: "São Paulo", name: "Guarulhos International", lat: -23.4356, lng: -46.4731 },
  "LDB": { code: "LDB", city: "Londrina", name: "Londrina Airport", lat: -23.3303, lng: -51.1384 },
  "SDU": { code: "SDU", city: "Rio de Janeiro", name: "Santos Dumont Airport", lat: -22.9102, lng: -43.1631 },
  "CGH": { code: "CGH", city: "São Paulo", name: "Congonhas Airport", lat: -23.6261, lng: -46.6564 },
  "DXB": { code: "DXB", city: "Dubai", name: "Dubai International", lat: 25.2532, lng: 55.3657 },
  "EZE": { code: "EZE", city: "Buenos Aires", name: "Ezeiza International", lat: -34.8222, lng: -58.5358 },
  "LIS": { code: "LIS", city: "Lisboa", name: "Humberto Delgado Airport", lat: 38.7756, lng: -9.1354 },
  "MIA": { code: "MIA", city: "Miami", name: "Miami International", lat: 25.7959, lng: -80.2870 },
  "JFK": { code: "JFK", city: "Nova York", name: "John F. Kennedy International", lat: 40.6413, lng: -73.7781 },
  "MCO": { code: "MCO", city: "Orlando", name: "Orlando International", lat: 28.4281, lng: -81.3090 },
  "LHR": { code: "LHR", city: "Londres", name: "London Heathrow Airport", lat: 51.4700, lng: -0.4543 },
  "CDG": { code: "CDG", city: "Paris", name: "Charles de Gaulle Airport", lat: 49.0097, lng: 2.5479 },
  "MAD": { code: "MAD", city: "Madri", name: "Adolfo Suárez Barajas Airport", lat: 40.4839, lng: -3.5680 },
  "PTY": { code: "PTY", city: "Cidade do Panamá", name: "Tocumen International", lat: 9.0714, lng: -79.3835 },
  "BRC": { code: "BRC", city: "Bariloche", name: "San Carlos de Bariloche Airport", lat: -41.1511, lng: -71.1577 },
  "MCZ": { code: "MCZ", city: "Maceió", name: "Zumbi dos Palmares Airport", lat: -9.5108, lng: -35.7917 },
  "BCN": { code: "BCN", city: "Barcelona", name: "Barcelona-El Prat Airport", lat: 41.2974, lng: 2.0785 },
  "DEL": { code: "DEL", city: "Nova Deli", name: "Indira Gandhi International", lat: 28.5687, lng: 77.1061 },
  "FCO": { code: "FCO", city: "Roma", name: "Leonardo da Vinci-Fiumicino", lat: 41.7993, lng: 12.2462 },
  "CUN": { code: "CUN", city: "Cancún", name: "Cancún International", lat: 21.0365, lng: -86.8770 },
  "UNA": { code: "UNA", city: "Ilha de Comandatuba", name: "Hotel Transamérica Airport", lat: -15.3512, lng: -38.9985 },
  "BYO": { code: "BYO", city: "Bonito", name: "Bonito Regional Airport", lat: -21.0119, lng: -56.3769 },
  "FOR": { code: "FOR", city: "Fortaleza", name: "Pinto Martins International", lat: -3.7758, lng: -38.5322 }
};

window.AIRLINES = {
  "AD": { code: "AD", name: "Azul", color: "#002060" },
  "G3": { code: "G3", name: "GOL", color: "#FF5A00" },
  "AR": { code: "AR", name: "Aerolíneas Argentinas", color: "#009CDE" },
  "FO": { code: "FO", name: "Flybondi", color: "#F7A800" },
  "LA": { code: "LA", name: "LATAM", color: "#E8117F" },
  "JJ": { code: "JJ", name: "LATAM", color: "#E8117F" },
  "EK": { code: "EK", name: "Emirates", color: "#C41230" },
  "TP": { code: "TP", name: "TAP Air Portugal", color: "#C60C30" },
  "CM": { code: "CM", name: "Copa Airlines", color: "#0D2C6C" },
  "AA": { code: "AA", name: "American Airlines", color: "#0078D7" },
  "UA": { code: "UA", name: "United Airlines", color: "#1D5F8A" },
  "DL": { code: "DL", name: "Delta Air Lines", color: "#E01933" },
  "AF": { code: "AF", name: "Air France", color: "#002244" },
  "LH": { code: "LH", name: "Lufthansa", color: "#FFCC00" },
  "BA": { code: "BA", name: "British Airways", color: "#071D49" },
  "QR": { code: "QR", name: "Qatar Airways", color: "#5C0632" },
  "IB": { code: "IB", name: "Iberia", color: "#C20E1A" }
};

// Past flights pre-loaded from screenshots
// Math verification to match screenshots exactly:
// Total flights: 9
// Distance sum: 1140+1070+1120+1371+360+2460+2480+445+400 = 10,846 km (Matches 10.846 km exactly!)
// Flight time sum: 120+110+130+155+65+210+215+67+65 = 1137 min = 18h 57m (Matches 18h 57m exactly!)
// Total delay sum: 12+18+6+10+8 = 54 mins (Matches 54 minutes lost exactly!)
// Delayed flights count: 5. Average delay = 54/5 = 10.8m (rounds/floors to "Delayed flights averaged 10m late")
// Airlines count: 4 (Azul, GOL, Aerolíneas Argentinas, Flybondi)
// Unique airports count: 12 (CNF, IGU, IGR, AEP, REL, USH, GIG, VCP, BEL, GRU, LDB, SDU)
// Most flown aircraft: B737-800 (3 flights: AR 1892, AR 1892, and FO 5101)
window.PAST_FLIGHTS = [
  {
    id: "past_1",
    flightNumber: "AD 2599",
    airline: "AD",
    from: "CNF",
    to: "IGU",
    date: "2026-01-27",
    depTime: "10:00",
    arrTime: "12:00",
    duration: 120, // 2h 00m
    distance: 1140,
    delay: 0,
    aircraft: "E195-E2",
    tailNumber: "PR-YVB",
    status: "Completed"
  },
  {
    id: "past_2",
    flightNumber: "FO 5101",
    airline: "FO",
    from: "IGR",
    to: "AEP",
    date: "2026-01-28",
    depTime: "14:30",
    arrTime: "16:20",
    duration: 110, // 1h 50m
    distance: 1070,
    delay: 12,
    aircraft: "B737-800",
    tailNumber: "LV-HKN",
    status: "Completed"
  },
  {
    id: "past_3",
    flightNumber: "AR 1892",
    airline: "AR",
    from: "AEP",
    to: "REL",
    date: "2026-01-29",
    depTime: "08:15",
    arrTime: "10:25",
    duration: 130, // 2h 10m
    distance: 1120,
    delay: 18,
    aircraft: "B737-800",
    tailNumber: "LV-FVO",
    status: "Completed"
  },
  {
    id: "past_4",
    flightNumber: "AR 1892",
    airline: "AR",
    from: "REL",
    to: "USH",
    date: "2026-01-29",
    depTime: "11:10",
    arrTime: "13:45",
    duration: 155, // 2h 35m
    distance: 1371,
    delay: 6,
    aircraft: "B737-800",
    tailNumber: "LV-FVO",
    status: "Completed"
  },
  {
    id: "past_5",
    flightNumber: "AD 4450",
    airline: "AD",
    from: "GIG",
    to: "VCP",
    date: "2026-03-26",
    depTime: "07:15",
    arrTime: "08:20",
    duration: 65, // 1h 05m
    distance: 360,
    delay: 0,
    aircraft: "ATR 72-600",
    tailNumber: "PR-AKC",
    status: "Completed"
  },
  {
    id: "past_6",
    flightNumber: "AD 4070",
    airline: "AD",
    from: "VCP",
    to: "BEL",
    date: "2026-03-26",
    depTime: "09:30",
    arrTime: "13:00",
    duration: 210, // 3h 30m
    distance: 2460,
    delay: 0,
    aircraft: "A320neo",
    tailNumber: "PR-YRI",
    status: "Completed"
  },
  {
    id: "past_7",
    flightNumber: "G3 1517",
    airline: "G3",
    from: "BEL",
    to: "GRU",
    date: "2026-04-13",
    depTime: "14:10",
    arrTime: "17:45",
    duration: 215, // 3h 35m
    distance: 2480,
    delay: 10,
    aircraft: "B737-MAX8",
    tailNumber: "PR-XMR",
    status: "Completed"
  },
  {
    id: "past_8",
    flightNumber: "AD 4584",
    airline: "AD",
    from: "LDB",
    to: "VCP",
    date: "2026-04-26",
    depTime: "11:35",
    arrTime: "12:42",
    duration: 67, // 1h 07m
    distance: 445,
    delay: 8,
    aircraft: "ATR 72-600",
    tailNumber: "PR-AKG",
    status: "Completed"
  },
  {
    id: "past_9",
    flightNumber: "AD 5086",
    airline: "AD",
    from: "VCP",
    to: "SDU",
    date: "2026-04-27",
    depTime: "15:40",
    arrTime: "16:45",
    duration: 65, // 1h 05m
    distance: 400,
    delay: 0,
    aircraft: "E195-E2",
    tailNumber: "PR-YVD",
    status: "Completed"
  }
];

// Upcoming flights pre-loaded from screenshots
// Departs relative to May 22, 2026 local time
window.UPCOMING_FLIGHTS = [
  {
    id: "up_1",
    flightNumber: "AD 6053",
    airline: "AD",
    from: "SDU",
    to: "CGH",
    date: "2026-05-28", // +6 days from May 22
    depTime: "09:05",
    arrTime: "10:15",
    duration: 70, // 1h 10m
    distance: 366,
    status: "Scheduled",
    gate: "4A",
    terminal: "1",
    aircraft: "A320neo",
    tailNumber: "PR-YRQ",
    inboundFlight: {
      flightNumber: "AD 6052",
      status: "On Time",
      origin: "VCP",
      eta: "08:15"
    },
    alerts: [
      { type: "gate", text: "Portão definido para 4A no Aeroporto Santos Dumont." },
      { type: "weather", text: "Previsão de chuva fraca em São Paulo no horário de pouso." }
    ]
  },
  {
    id: "up_2",
    flightNumber: "AD 6068",
    airline: "AD",
    from: "CGH",
    to: "SDU",
    date: "2026-06-02", // +11 days from May 22
    depTime: "13:55",
    arrTime: "14:55",
    duration: 60, // 1h 00m
    distance: 366,
    status: "Scheduled",
    gate: "12",
    terminal: "M",
    aircraft: "E195-E2",
    tailNumber: "PR-YVA",
    inboundFlight: {
      flightNumber: "AD 6067",
      status: "Delayed",
      origin: "CNF",
      eta: "13:10"
    },
    alerts: [
      { type: "delay", text: "Alerta Pro: Aeronave chegando de CNF com 15 min de atraso acumulado." }
    ]
  },
  {
    id: "up_3",
    flightNumber: "G3 2006",
    airline: "G3",
    from: "GIG",
    to: "BEL",
    date: "2026-06-11", // +20 days from May 22
    depTime: "08:30",
    arrTime: "12:00",
    duration: 210, // 3h 30m
    distance: 2450,
    status: "Scheduled",
    gate: "B22",
    terminal: "2",
    aircraft: "B737-MAX8",
    tailNumber: "PR-XMZ",
    inboundFlight: null,
    alerts: []
  }
];

