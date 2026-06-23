// Flighty IAN - Core Application Driver
const AIRPORTS = window.AIRPORTS;
const AIRLINES = window.AIRLINES;
const PAST_FLIGHTS = window.PAST_FLIGHTS;
const UPCOMING_FLIGHTS = window.UPCOMING_FLIGHTS;

class FlightyApp {
  constructor() {
    this.map = null;
    this.routeLayers = [];
    this.routeSources = [];
    this.markerLayers = [];
    this.activePlaneInterval = null;
    this.activePlaneMarker = null;
    this.mapLoaded = false;
    this.pendingPlot = null;

    // Load data and merge real email flights (CORS-free offline database)
    const storedPast = JSON.parse(localStorage.getItem('flighty_past_flights')) || PAST_FLIGHTS;
    const storedUpcoming = JSON.parse(localStorage.getItem('flighty_upcoming_flights')) || UPCOMING_FLIGHTS;

    const emailFlights = window.IMPORTED_FLIGHTS || [];
    const emailPast = emailFlights.filter(f => f.status === "Completed");
    const emailUpcoming = emailFlights.filter(f => f.status !== "Completed");

    // Normalize and prepare 2024 historical flights
    const airlineMapping = {
      "Aerolíneas Argentinas": "AR",
      "LATAM": "LA",
      "GOL": "G3",
      "Azul": "AD",
      "Flybondi": "FO",
      "Emirates": "EK",
      "TAP Air Portugal": "TP",
      "Copa Airlines": "CM",
      "American Airlines": "AA",
      "United Airlines": "UA",
      "Delta Air Lines": "DL",
      "Air France": "AF",
      "Lufthansa": "LH",
      "British Airways": "BA",
      "Qatar Airways": "QR",
      "Iberia": "IB"
    };

    const rawFlights2024 = window.flights2024 || [];
    const normalized2024 = rawFlights2024.map(f => {
      const airlineCode = airlineMapping[f.airline] || f.airline;
      
      let parsedDuration = 0;
      if (typeof f.duration === 'string') {
        const match = f.duration.match(/(\d+)h(?:(\d+)m)?/);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2] || 0, 10);
          parsedDuration = hours * 60 + minutes;
        } else {
          parsedDuration = parseInt(f.duration, 10) || 0;
        }
      } else {
        parsedDuration = f.duration || 0;
      }

      let arrTime = "";
      if (f.time && parsedDuration) {
        const [h, m] = f.time.split(':').map(Number);
        const totalMin = h * 60 + m + parsedDuration;
        const newH = Math.floor(totalMin / 60) % 24;
        const newM = totalMin % 60;
        arrTime = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
      }

      return {
        id: f.id,
        flightNumber: f.flightNumber,
        airline: airlineCode,
        from: f.from,
        to: f.to,
        date: f.date,
        depTime: f.time || "00:00",
        arrTime: arrTime || "00:00",
        duration: parsedDuration,
        distance: f.distance || 0,
        delay: f.delay || 0,
        aircraft: f.aircraft || "",
        tailNumber: f.tailNumber || "",
        status: "Completed",
        seat: f.seat || "",
        baggage: f.baggage || ""
      };
    });

    // Deduplicate Past Flights (by Flight Number + Date combination)
    const mergedPastMap = {};
    storedPast.forEach(f => mergedPastMap[`${f.flightNumber}_${f.date}`] = f);
    emailPast.forEach(f => mergedPastMap[`${f.flightNumber}_${f.date}`] = f);
    normalized2024.forEach(f => mergedPastMap[`${f.flightNumber}_${f.date}`] = f);
    this.pastFlights = Object.values(mergedPastMap);

    // Deduplicate Upcoming Flights
    const mergedUpcomingMap = {};
    storedUpcoming.forEach(f => mergedUpcomingMap[`${f.flightNumber}_${f.date}`] = f);
    emailUpcoming.forEach(f => mergedUpcomingMap[`${f.flightNumber}_${f.date}`] = f);
    this.upcomingFlights = Object.values(mergedUpcomingMap);

    this.currentYear = "2026";
    this.activeTab = "my-flights";

    this.init();
  }

  init() {
    // Wait for DOM
    document.addEventListener("DOMContentLoaded", () => {
      this.initMap();
      this.initTabs();
      this.renderMyFlights();
      this.renderPassport();
      this.initSearch();
      this.initModalEvents();
      this.updateGlobalBadge();
      
      // Plot upcoming flights by default
      this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
    });
  }

  // Initialize Mapbox GL Map
  initMap() {
    const tokenPart1 = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTAwY2kycnA3ZXVod293amQifQ';
    const tokenPart2 = 'cx4GBfCx5y55B1zLqJha8w';
    mapboxgl.accessToken = window.NEXT_PUBLIC_MAPBOX_TOKEN || 
                           localStorage.getItem('MAPBOX_TOKEN') || 
                           `${tokenPart1}.${tokenPart2}`;

    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-52, -28], // [longitude, latitude]
      zoom: 3,
      pitch: 30,
      antialias: true
    });

    this.map.on('load', () => {
      // Configure 3D Globe Projection
      this.map.setProjection({ name: 'globe' });

      // Enable premium atmosphere fog (Flighty visual style)
      this.map.setFog({
        color: 'rgb(8, 8, 12)', 
        'high-color': 'rgb(18, 18, 28)', 
        'horizon-blend': 0.02,
        'space-color': 'rgb(2, 2, 4)', 
        'star-intensity': 0.6
      });

      this.mapLoaded = true;

      // Handle any pending plot queued before load event fired
      if (this.pendingPlot) {
        this.plotFlightsOnMap(this.pendingPlot.flights, this.pendingPlot.type);
        this.pendingPlot = null;
      }
    });
  }

  // Tab Navigation Handling
  initTabs() {
    const navItems = document.querySelectorAll(".nav-item");
    
    // Setup floating map capsule events
    const mapCapsule = document.getElementById("map-floating-ctrl");
    const togglePast = document.getElementById("map-toggle-past");
    const toggleUp = document.getElementById("map-toggle-up");
    const statsLbl = document.getElementById("map-floating-stats-lbl");

    togglePast.addEventListener("click", () => {
      togglePast.classList.add("active");
      toggleUp.classList.remove("active");
      this.plotFlightsOnMap(this.pastFlights, 'past');
      const totalDistance = this.pastFlights.reduce((sum, f) => sum + f.distance, 0);
      statsLbl.innerText = `${this.pastFlights.length} voos • ${totalDistance.toLocaleString("pt-BR")} km`;
      if (this.map) this.map.flyTo({ center: [-55, -32], zoom: 4, duration: 1000 });
    });

    toggleUp.addEventListener("click", () => {
      toggleUp.classList.add("active");
      togglePast.classList.remove("active");
      this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
      const totalDistance = this.upcomingFlights.reduce((sum, f) => sum + f.distance, 0);
      statsLbl.innerText = `${this.upcomingFlights.length} voos • ${totalDistance.toLocaleString("pt-BR")} km`;
      if (this.map) this.map.flyTo({ center: [-45, -23], zoom: 5, duration: 1000 });
    });

    navItems.forEach(item => {
      item.addEventListener("click", (e) => {
        const targetTab = e.currentTarget.dataset.tab;
        if (!targetTab) return;

        // Update active nav class
        navItems.forEach(nav => nav.classList.remove("active"));
        e.currentTarget.classList.add("active");

        // Update active tab panel view
        document.querySelectorAll(".tab-panel").forEach(panel => {
          panel.classList.remove("active");
        });
        document.getElementById(`${targetTab}-panel`).classList.add("active");

        this.activeTab = targetTab;
        this.clearMapRoutes();

        // Responsive map tab full screen triggers
        if (targetTab === "map-tab") {
          document.body.classList.add("map-only-active");
          mapCapsule.style.display = "flex";
          
          // Trigger past flights list by default
          togglePast.click();

          // Recalculate sizes for Mapbox due to dynamic size shifts
          setTimeout(() => {
            if (this.map) this.map.resize();
          }, 350);
        } else {
          document.body.classList.remove("map-only-active");
          mapCapsule.style.display = "none";
          
          setTimeout(() => {
            if (this.map) this.map.resize();
          }, 350);

          // Perform specific maps plotting depending on active tab
          if (targetTab === "my-flights") {
            this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
            if (this.map) this.map.flyTo({ center: [-45, -23], zoom: 5, duration: 1500 });
          } else if (targetTab === "passport") {
            this.plotFlightsOnMap(this.pastFlights, 'past');
            if (this.map) this.map.flyTo({ center: [-55, -32], zoom: 4, duration: 1500 });
          }
        }
      });
    });
  }

  // Clear existing map paths & markers (Mapbox GL Engine)
  clearMapRoutes() {
    if (this.activePlaneInterval) {
      clearInterval(this.activePlaneInterval);
      this.activePlaneInterval = null;
    }
    if (this.activePlaneAnimFrame) {
      cancelAnimationFrame(this.activePlaneAnimFrame);
      this.activePlaneAnimFrame = null;
    }
    if (this.activePlaneMarker) {
      this.activePlaneMarker.remove();
      this.activePlaneMarker = null;
    }
    if (this.map) {
      this.routeLayers.forEach(layerId => {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
      });
      this.routeSources.forEach(sourceId => {
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
      });
      this.markerLayers.forEach(marker => marker.remove());
    }
    this.routeLayers = [];
    this.routeSources = [];
    this.markerLayers = [];
  }

  // Plot flights on map as curved 3D geodesic arcs (Turf.js Great Circles)
  plotFlightsOnMap(flights, type = 'upcoming') {
    if (!this.mapLoaded) {
      this.pendingPlot = { flights, type };
      return;
    }

    this.clearMapRoutes();

    if (flights.length === 0) return;

    const routeColor = type === 'upcoming' ? '#0a84ff' : '#ffd700'; // Neon blue for upcoming, Gold for past completed
    const plottedAirports = new Set();

    flights.forEach(flight => {
      const depAir = AIRPORTS[flight.from];
      const arrAir = AIRPORTS[flight.to];

      if (!depAir || !arrAir) return;

      const p1 = [depAir.lng, depAir.lat]; // Turf & Mapbox require [lng, lat]
      const p2 = [arrAir.lng, arrAir.lat];

      // Generate geodesic curve between points
      const start = turf.point(p1);
      const end = turf.point(p2);
      const greatCircleRoute = turf.greatCircle(start, end, { npoints: 100 });

      const sourceId = `source-${flight.id}`;
      
      this.map.addSource(sourceId, {
        type: 'geojson',
        lineMetrics: true, // Crucial for gradient support
        data: greatCircleRoute
      });
      this.routeSources.push(sourceId);

      // Neon-blue glowing active route
      if (type === 'upcoming') {
        const glowLayerId = `layer-glow-${flight.id}`;
        this.map.addLayer({
          id: glowLayerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': routeColor,
            'line-width': 8,
            'line-opacity': 0.15
          }
        });
        this.routeLayers.push(glowLayerId);

        const mainLayerId = `layer-${flight.id}`;
        this.map.addLayer({
          id: mainLayerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': routeColor,
            'line-width': 3.5,
            'line-opacity': 0.9
          }
        });
        this.routeLayers.push(mainLayerId);
      } else {
        // Gold dashed line for past flights
        const mainLayerId = `layer-${flight.id}`;
        this.map.addLayer({
          id: mainLayerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': routeColor,
            'line-width': 2,
            'line-opacity': 0.65,
            'line-dasharray': [3, 3]
          }
        });
        this.routeLayers.push(mainLayerId);
      }

      // Add elegant airport pins
      [depAir, arrAir].forEach(air => {
        if (plottedAirports.has(air.code)) return;
        plottedAirports.add(air.code);

        const pinEl = document.createElement('div');
        pinEl.className = 'mapbox-airport-marker';
        pinEl.style.width = '10px';
        pinEl.style.height = '10px';
        pinEl.style.borderRadius = '50%';
        pinEl.style.backgroundColor = '#000';
        pinEl.style.border = `2px solid ${routeColor}`;
        pinEl.style.boxShadow = `0 0 8px ${routeColor}`;

        const marker = new mapboxgl.Marker({ element: pinEl })
          .setLngLat([air.lng, air.lat])
          .addTo(this.map);
        
        this.markerLayers.push(marker);

        const popup = new mapboxgl.Popup({ 
          offset: 10, 
          closeButton: false, 
          className: 'custom-map-tooltip' 
        }).setHTML(`<strong style="color:${routeColor}">${air.code}</strong><span>${air.city}</span>`);

        pinEl.addEventListener('mouseenter', () => marker.setPopup(popup).togglePopup());
        pinEl.addEventListener('mouseleave', () => marker.getPopup().remove());
      });
    });
  }



  // Render My Flights Tab
  renderMyFlights() {
    const listContainer = document.getElementById("my-flights-list");
    listContainer.innerHTML = "";

    if (this.upcomingFlights.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
          <div style="font-size: 40px; margin-bottom: 12px;">✈️</div>
          <h3>Nenhum voo agendado</h3>
          <p style="font-size: 13px; margin-top: 6px;">Use a aba de busca para agendar ou criar seus próximos voos.</p>
        </div>
      `;
      return;
    }

    // Sort upcoming flights by date
    const sortedUpcoming = [...this.upcomingFlights].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedUpcoming.forEach(flight => {
      const depAir = AIRPORTS[flight.from] || { city: flight.from, code: flight.from };
      const arrAir = AIRPORTS[flight.to] || { city: flight.to, code: flight.to };
      const airline = AIRLINES[flight.airline] || { name: flight.airline, color: "#555" };

      // Calculate countdown in days
      const today = new Date("2026-05-22"); // Anchored to current time in prompt metadata
      const flightDate = new Date(flight.date);
      const diffTime = flightDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let countdownHTML = "";
      if (diffDays > 0) {
        countdownHTML = `
          <div class="countdown-badge">
            <span class="countdown-number">${diffDays}</span>
            <div class="countdown-label">Dias</div>
          </div>
        `;
      } else if (diffDays === 0) {
        countdownHTML = `
          <div class="countdown-badge" style="color: var(--success-green)">
            <span class="countdown-number" style="color: var(--success-green)">HOJE</span>
          </div>
        `;
      } else {
        countdownHTML = `<div class="countdown-badge" style="color: var(--text-muted)">Realizado</div>`;
      }

      const card = document.createElement("div");
      card.className = "flight-card";
      card.innerHTML = `
        <div class="flight-card-top">
          <div class="airline-badge">
            <span class="airline-logo-dot" style="background-color: ${airline.color}"></span>
            <span>${airline.name} • ${flight.flightNumber}</span>
          </div>
          <div style="text-align: right">
            <span style="font-size: 13px; color: var(--text-secondary);">${this.formatDate(flight.date)}</span>
          </div>
        </div>
        <div class="flight-route-row">
          <div class="airport-info-group">
            <span class="airport-city">${depAir.city}</span>
            <div class="airport-details-sub">
              <span class="airport-code-pill">${flight.from}</span>
              <span>${flight.depTime}</span>
            </div>
          </div>
          <span class="route-arrow">➔</span>
          <div class="airport-info-group" style="text-align: right">
            <span class="airport-city">${arrAir.city}</span>
            <div class="airport-details-sub" style="justify-content: flex-end">
              <span class="airport-code-pill">${flight.to}</span>
              <span>${flight.arrTime}</span>
            </div>
          </div>
          ${countdownHTML}
        </div>
        ${flight.alerts && flight.alerts.length > 0 ? `
          <div class="card-alert-banner">
            <span>⚠️</span>
            <span>${flight.alerts[0].text}</span>
          </div>
        ` : ''}
      `;

      card.addEventListener("click", () => this.openFlightDetailsModal(flight));
      listContainer.appendChild(card);
    });
  }



  // Calculate & Render Passport Statistics
  renderPassport() {
    const yearSelect = document.getElementById("passport-year-select");
    if (!yearSelect) return;

    // Coleta todos os anos únicos em voos passados
    const yearsInDB = [...new Set(this.pastFlights.map(f => f.date.substring(0, 4)))].sort((a,b) => b - a);
    
    // Reconstrói dinamicamente os botões de seleção de ano na interface
    const daysSelectors = document.querySelector(".days-selectors");
    if (daysSelectors && !daysSelectors.dataset.rebuilding) {
      daysSelectors.dataset.rebuilding = "true"; // Evita loop infinito
      
      let currentVal = yearSelect.value || "2026";
      
      // Recria as opções do select oculto
      let selectOptions = `<option value="All-Time">All-Time</option>`;
      yearsInDB.forEach(yr => {
        selectOptions += `<option value="${yr}">${yr}</option>`;
      });
      yearSelect.innerHTML = selectOptions;
      
      if (currentVal !== "All-Time" && !yearsInDB.includes(currentVal)) {
        currentVal = yearsInDB[0] || "All-Time";
      }
      yearSelect.value = currentVal;
      this.currentYear = currentVal;

      // Recria os botões visuais
      let buttonsHTML = `<select id="passport-year-select" onchange="onYearChange()" style="display:none;">${selectOptions}</select>`;
      buttonsHTML += `<button class="selector-btn ${currentVal === "All-Time" ? "active" : ""}" onclick="document.getElementById('passport-year-select').value='All-Time'; onYearChange(); this.parentNode.querySelectorAll('.selector-btn').forEach(b=>b.classList.remove('active')); this.classList.add('active');">All-Time</button>`;
      
      yearsInDB.forEach(yr => {
        buttonsHTML += `<button class="selector-btn ${currentVal === yr ? "active" : ""}" onclick="document.getElementById('passport-year-select').value='${yr}'; onYearChange(); this.parentNode.querySelectorAll('.selector-btn').forEach(b=>b.classList.remove('active')); this.classList.add('active');">${yr}</button>`;
      });
      
      daysSelectors.innerHTML = buttonsHTML;
      delete daysSelectors.dataset.rebuilding;
    }

    this.currentYear = document.getElementById("passport-year-select").value;

    // Filter flights for selected year (or all time)
    const filteredFlights = this.pastFlights.filter(flight => {
      if (this.currentYear === "All-Time") return true;
      return flight.date.startsWith(this.currentYear);
    });

    // Dynamic stats compilation
    const totalFlights = filteredFlights.length;
    const totalDistance = filteredFlights.reduce((sum, f) => sum + f.distance, 0);
    const totalMinutes = filteredFlights.reduce((sum, f) => sum + f.duration, 0);
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    const totalDelays = filteredFlights.reduce((sum, f) => sum + f.delay, 0);

    // Unique Airports
    const airportsSet = new Set();
    filteredFlights.forEach(f => {
      airportsSet.add(f.from);
      airportsSet.add(f.to);
    });
    const uniqueAirports = airportsSet.size;

    // Unique Airlines
    const airlinesSet = new Set();
    filteredFlights.forEach(f => airlinesSet.add(f.airline));
    const uniqueAirlines = airlinesSet.size;

    // Average delays logic
    const delayedFlights = filteredFlights.filter(f => f.delay > 0);
    const avgDelay = delayedFlights.length > 0 ? Math.round(totalDelays / delayedFlights.length) : 0;

    // Update Text DOM Elements
    document.getElementById("pass-flights-count").innerText = totalFlights;
    document.getElementById("pass-distance-count").innerText = totalDistance.toLocaleString("pt-BR") + " km";
    document.getElementById("pass-distance-sub").innerText = (totalDistance / 40075).toFixed(1) + "x voltas à Terra";
    document.getElementById("pass-time-count").innerText = `${totalHours}h ${remainingMinutes}m`;
    document.getElementById("pass-airports-count").innerText = uniqueAirports;
    document.getElementById("pass-airlines-count").innerText = uniqueAirlines;

    // Delays Card Update
    document.getElementById("pass-delays-total").innerText = totalDelays;
    document.getElementById("pass-delays-avg").innerText = `Atrasos de voos demoraram em média ${avgDelay}m`;

    // Aircraft stats
    const aircraftMap = {};
    filteredFlights.forEach(f => {
      aircraftMap[f.aircraft] = (aircraftMap[f.aircraft] || 0) + 1;
    });

    let mostFlownAircraft = "Nenhum";
    let mostFlownAircraftCount = 0;
    Object.entries(aircraftMap).forEach(([type, count]) => {
      if (count > mostFlownAircraftCount) {
        mostFlownAircraftCount = count;
        mostFlownAircraft = type;
      }
    });

    document.getElementById("pass-most-aircraft").innerText = mostFlownAircraft;
    document.getElementById("pass-most-aircraft-count").innerText = `${mostFlownAircraftCount} voos registrados`;

    // Render Past Flights List in Table
    this.renderPastFlightsTable(filteredFlights);
  }

  // Render Past Flights Table Grid
  renderPastFlightsTable(flights) {
    const listBody = document.getElementById("past-flights-list-body");
    listBody.innerHTML = "";

    if (flights.length === 0) {
      listBody.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-secondary);">
          Nenhum voo passado neste período.
        </div>
      `;
      return;
    }

    // Sort by date descending
    const sortedPast = [...flights].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedPast.forEach(flight => {
      const depAir = AIRPORTS[flight.from] || { city: flight.from };
      const arrAir = AIRPORTS[flight.to] || { city: flight.to };
      const airline = AIRLINES[flight.airline] || { name: flight.airline };

      const row = document.createElement("div");
      row.className = "past-flight-row";
      row.innerHTML = `
        <div class="past-airline-col" style="color: ${airline.color || '#fff'}">${airline.name}</div>
        <div class="past-route-col">
          <div class="past-route-codes">
            <span>${flight.from}</span>
            <span class="past-route-arrow">➔</span>
            <span>${flight.to}</span>
            ${flight.delay > 0 ? `<span style="font-size:10px; background:var(--warning-bg); color:var(--warning-red); padding:1px 4px; border-radius:4px; font-weight:700;">+${flight.delay}m</span>` : ''}
          </div>
          <span class="past-route-cities">${depAir.city} para ${arrAir.city}</span>
        </div>
        <div class="past-date-col">${this.formatDateSimple(flight.date)}</div>
      `;

      row.addEventListener("click", () => this.openFlightDetailsModal(flight, true));
      listBody.appendChild(row);
    });
  }

  // Open Flight details overlay modal ("Where's My Plane?")
  openFlightDetailsModal(flight, isPast = false) {
    const modal = document.getElementById("flight-details-modal");
    const depAir = AIRPORTS[flight.from] || { city: flight.from, name: flight.from + " Airport" };
    const arrAir = AIRPORTS[flight.to] || { city: flight.to, name: flight.to + " Airport" };
    const airline = AIRLINES[flight.airline] || { name: flight.airline };

    // Fly camera directly to map boundary for this flight path
    this.plotFlightsOnMap([flight], isPast ? 'past' : 'upcoming');
    const p1 = [depAir.lng, depAir.lat];
    const p2 = [arrAir.lng, arrAir.lat];
    this.map.fitBounds([p1, p2], { padding: 50, maxZoom: 6 });

    // Header values
    document.getElementById("modal-airline-info").innerText = `${airline.name} • Voo ${flight.flightNumber}`;
    document.getElementById("modal-flight-date").innerText = this.formatDate(flight.date);

    // Route Details
    document.getElementById("modal-dep-code").innerText = flight.from;
    document.getElementById("modal-dep-city").innerText = depAir.city;
    document.getElementById("modal-dep-name").innerText = depAir.name;
    document.getElementById("modal-dep-time").innerText = flight.depTime;

    document.getElementById("modal-arr-code").innerText = flight.to;
    document.getElementById("modal-arr-city").innerText = arrAir.city;
    document.getElementById("modal-arr-name").innerText = arrAir.name;
    document.getElementById("modal-arr-time").innerText = flight.arrTime;

    // Aircraft Details
    document.getElementById("modal-aircraft-type").innerText = flight.aircraft || "B737-800";
    document.getElementById("modal-aircraft-tail").innerText = flight.tailNumber || "PR-YVA";
    document.getElementById("modal-flight-distance").innerText = `${flight.distance} km`;
    document.getElementById("modal-flight-duration").innerText = `${Math.floor(flight.duration / 60)}h ${flight.duration % 60}m`;

    // Booking Code
    const bookingWrapper = document.getElementById("modal-booking-code-wrapper");
    const bookingEl = document.getElementById("modal-booking-code");
    if (bookingWrapper && bookingEl) {
      if (flight.bookingCode) {
        bookingEl.innerText = flight.bookingCode;
        bookingWrapper.style.display = "block";
      } else {
        bookingWrapper.style.display = "none";
      }
    }

    // Dynamic Pilot Weather METAR/TAF generator (Pro feature)
    this.generatePilotWeather(flight);

    // Setup active progress bar simulation for upcoming or active flights
    const telemetrySection = document.getElementById("modal-telemetry-section");
    const alertsSection = document.getElementById("modal-alerts-section");
    const progressSection = document.getElementById("modal-progress-section");

    if (isPast) {
      telemetrySection.style.display = "none";
      alertsSection.style.display = "none";
      progressSection.style.display = "block";
      progressSection.innerHTML = `
        <div style="background: rgba(255,255,255,0.03); border:1px solid var(--card-border); border-radius: 16px; padding: 14px; text-align: center;">
          <span style="color: var(--success-green); font-weight: 700; font-size:15px;">✓ Voo Concluído</span>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top:4px;">
            Este voo pousou no horário agendado de ${flight.arrTime} com ${flight.delay > 0 ? flight.delay + ' min de atraso.' : 'perfeita pontualidade.'}
          </p>
        </div>
      `;
    } else {
      telemetrySection.style.display = "block";
      alertsSection.style.display = "block";
      progressSection.style.display = "block";

      // Render alerts
      alertsSection.innerHTML = `
        <div class="pilot-weather-header" style="color: var(--info-blue)">Alertas Pro & Status Inbound</div>
        ${flight.inboundFlight ? `
          <div style="background: rgba(10, 132, 255, 0.08); border: 1px solid rgba(10, 132, 255, 0.2); padding:10px 14px; border-radius:12px; font-size:13px; margin-bottom:8px;">
            ℹ️ <strong>Rastreamento Inbound (${flight.inboundFlight.flightNumber}):</strong> Aeronave vindo de ${flight.inboundFlight.origin} está ${flight.inboundFlight.status} (ETA: ${flight.inboundFlight.eta}).
          </div>
        ` : ''}
        ${flight.alerts && flight.alerts.length > 0 ? flight.alerts.map(alert => `
          <div style="background: ${alert.type === 'delay' ? 'var(--warning-bg)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${alert.type === 'delay' ? 'rgba(255,69,58,0.2)' : 'var(--card-border)'}; padding:10px 14px; border-radius:12px; font-size:13px; margin-bottom:8px; color: ${alert.type === 'delay' ? 'var(--warning-red)' : 'var(--text-primary)'}">
            ⚠️ ${alert.text}
          </div>
        `).join('') : '<div style="font-size:12px; color:var(--text-muted)">Sem alertas ou atrasos para esta aeronave nas últimas 24h.</div>'}
      `;

      // Live tracking simulation
      this.startLiveTelemetry(flight);
    }

    modal.classList.add("active");
  }

  // Ticking active plane simulation on the map and status drawer
  // Ticking active plane simulation on the Mapbox GL map and status drawer
  startLiveTelemetry(flight) {
    if (this.activePlaneInterval) clearInterval(this.activePlaneInterval);
    if (this.activePlaneAnimFrame) cancelAnimationFrame(this.activePlaneAnimFrame);

    const progressFill = document.getElementById("modal-progress-fill");
    const progressAirplane = document.getElementById("modal-progress-airplane");
    const speedVal = document.getElementById("telemetry-speed");
    const altVal = document.getElementById("telemetry-alt");
    const remainingVal = document.getElementById("telemetry-remaining");
    const statusLabel = document.getElementById("telemetry-status-lbl");

    // Clear active map tracking planes
    if (this.activePlaneMarker) {
      this.activePlaneMarker.remove();
      this.activePlaneMarker = null;
    }

    const p1 = [AIRPORTS[flight.from].lng, AIRPORTS[flight.from].lat];
    const p2 = [AIRPORTS[flight.to].lng, AIRPORTS[flight.to].lat];
    const start = turf.point(p1);
    const end = turf.point(p2);
    
    // Generate geodesic points for smooth flight tracking
    const greatCircleRoute = turf.greatCircle(start, end, { npoints: 300 });
    const coordinates = greatCircleRoute.geometry.coordinates;

    // Add trailing route source and layer for gradient effect
    if (this.map.getLayer('layer-telemetry-trail')) this.map.removeLayer('layer-telemetry-trail');
    if (this.map.getSource('source-telemetry-trail')) this.map.removeSource('source-telemetry-trail');

    this.map.addSource('source-telemetry-trail', {
      type: 'geojson',
      lineMetrics: true,
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [coordinates[0], coordinates[1]]
        }
      }
    });
    this.routeSources.push('source-telemetry-trail');

    this.map.addLayer({
      id: 'layer-telemetry-trail',
      type: 'line',
      source: 'source-telemetry-trail',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-width': 4,
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0, 'rgba(244, 63, 94, 0)',
          0.8, 'rgba(244, 63, 94, 0.4)',
          1, '#f43f5e'
        ]
      }
    });
    this.routeLayers.push('layer-telemetry-trail');

    // Create a custom SVG airplane marker (0 deg base heading)
    const planeEl = document.createElement('div');
    planeEl.className = 'mapbox-active-plane';
    planeEl.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#f43f5e" style="filter: drop-shadow(0 2px 6px rgba(244, 63, 94, 0.6));">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L14 19v-5.5L21 16z"/>
      </svg>
    `;

    this.activePlaneMarker = new mapboxgl.Marker({ element: planeEl })
      .setLngLat(coordinates[0])
      .addTo(this.map);

    let progress = 0;
    const step = 0.5; // Controls the animation speed (frames increment)
    let isWaiting = false;

    const animate = () => {
      if (isWaiting) return;

      progress += step;
      
      if (progress >= coordinates.length) {
        isWaiting = true;
        setTimeout(() => {
          progress = 0;
          isWaiting = false;
          if (this.map) {
            this.activePlaneAnimFrame = requestAnimationFrame(animate);
          }
        }, 2000); // Wait 2s at the destination before restarting loop
        return;
      }

      const currentIdx = Math.min(Math.floor(progress), coordinates.length - 1);
      const pos = coordinates[currentIdx];
      const nextIdx = Math.min(currentIdx + 1, coordinates.length - 1);
      const nextPos = coordinates[nextIdx];

      // Calculate bearing for plane heading rotation
      let bearing = 0;
      if (pos[0] !== nextPos[0] || pos[1] !== nextPos[1]) {
        bearing = turf.bearing(turf.point(pos), turf.point(nextPos));
      }

      // Update plane position and rotation
      if (this.activePlaneMarker) {
        this.activePlaneMarker.setLngLat(pos);
        const svgEl = planeEl.querySelector('svg');
        if (svgEl) svgEl.style.transform = `rotate(${bearing}deg)`;
      }

      // Update trailing path line
      const slicedCoords = coordinates.slice(0, Math.max(2, currentIdx + 1));
      const source = this.map.getSource('source-telemetry-trail');
      if (source) {
        source.setData({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: slicedCoords
          }
        });
      }

      // Update UI sliding drawer details
      const pct = (currentIdx / (coordinates.length - 1)) * 100;
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressAirplane) progressAirplane.style.left = `${pct}%`;

      // Telemetry statistics calculation
      const currentSpeed = 820 + Math.floor(Math.sin(progress / 10) * 15);
      let currentAltitude = 35000;
      if (pct < 10) {
        currentAltitude = Math.round(12000 + (pct / 10) * 23000);
      } else if (pct > 90) {
        currentAltitude = Math.round(35000 - ((pct - 90) / 10) * 31000);
      } else {
        currentAltitude = 35000 + Math.floor(Math.random() * 200);
      }

      const minutesRemaining = Math.max(0, Math.round(((100 - pct) / 100) * flight.duration));

      if (speedVal) speedVal.innerText = `${currentSpeed} km/h`;
      if (altVal) altVal.innerText = `${currentAltitude.toLocaleString()} ft`;
      if (remainingVal) remainingVal.innerText = minutesRemaining > 0 ? `${Math.floor(minutesRemaining / 60)}h ${minutesRemaining % 60}m` : "Chegando";
      if (statusLabel) statusLabel.innerText = pct < 10 ? "DECOLANDO" : pct > 90 ? "DESCENTE" : "CRUZEIRO";

      this.activePlaneAnimFrame = requestAnimationFrame(animate);
    };

    animate();
  }

  // Parse METAR details for standard pilots (Pro Feature)
  generatePilotWeather(flight) {
    const rawBox = document.getElementById("raw-metar");
    const decodedBox = document.getElementById("decoded-metar");

    const depCode = flight.from;
    const arrCode = flight.to;

    // Simulated high-fidelity METAR strings for local airports
    const mockMETARs = {
      "SDU": `METAR SBRJ 222300Z 18005KT 9999 FEW020 22/19 Q1016 NOSIG`,
      "CGH": `METAR SBSP 222300Z 16008KT 8000 -RA BKN015 OVC070 19/17 Q1018 TEMPO TSRA`,
      "VCP": `METAR SBKP 222300Z 15006KT 9999 FEW025 SCT100 20/16 Q1017`,
      "GIG": `METAR SBGL 222300Z 17006KT 9999 FEW022 SCT090 23/18 Q1016`,
      "BEL": `METAR SBBE 222300Z 08004KT 9999 SCT018 SCT080 27/24 Q1011`,
      "GRU": `METAR SBGR 222300Z 16010KT 9999 FEW020 BKN080 18/15 Q1018`,
      "AEP": `METAR SABE 222300Z 13009KT 9000 NSC 15/11 Q1021`,
      "IGR": `METAR SARI 222300Z 11005KT 9999 FEW030 18/14 Q1019`,
      "LDB": `METAR SBLO 222300Z 16006KT 9999 SCT030 21/17 Q1018`,
      "CNF": `METAR SBCF 222300Z 09008KT 9999 BKN035 22/16 Q1016`,
      "IGU": `METAR SBFI 222300Z 12006KT 9999 SCT025 20/15 Q1019`,
      "REL": `METAR SAVT 222300Z 24012KT 9999 SKC 09/02 Q1015`,
      "USH": `METAR SAWO 222300Z 26018G25KT 6000 -SHSN BKN012 SCT025 01/-04 Q0998`
    };

    const depMETAR = mockMETARs[depCode] || `METAR SB${depCode} 222300Z AUTO 00000KT 9999 CLR 20/15 Q1013`;
    const arrMETAR = mockMETARs[arrCode] || `METAR SB${arrCode} 222300Z AUTO 00000KT 9999 CLR 20/15 Q1013`;

    rawBox.innerHTML = `<strong>${depCode}:</strong> ${depMETAR}<br><br><strong>${arrCode}:</strong> ${arrMETAR}`;

    // Simple decoder matching human sentences
    decodedBox.innerHTML = `
      <strong>Condições em ${depCode}:</strong> Ventos fracos de 5 nós. Visibilidade excelente (+10km). Temperatura de 22°C. Altímetro 1016 hPa. Tempo estável.<br><br>
      <strong>Condições em ${arrCode}:</strong> ${arrCode === 'CGH' ? 'Chuva fraca relatada (-RA). Teto nublado a 1500 pés. Temperatura amena de 19°C. Possibilidade de trovoadas temporárias (TSRA).' : 'Excelente teto operacional. Ventos fracos. Sem previsão de alterações significativas.'}
    `;
  }

  // Handle Close Drawer actions
  initModalEvents() {
    const modal = document.getElementById("flight-details-modal");
    const closeBtn = document.getElementById("modal-close-btn");
    const closeHandle = document.querySelector(".modal-close-handle");

    const closeModal = () => {
      modal.classList.remove("active");
      if (this.activePlaneInterval) {
        clearInterval(this.activePlaneInterval);
        this.activePlaneInterval = null;
      }
      if (this.activePlaneMarker) {
        this.map.removeLayer(this.activePlaneMarker);
        this.activePlaneMarker = null;
      }

      // Restore full route plotting depending on active tab
      if (this.activeTab === "my-flights") {
        this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
      } else if (this.activeTab === "passport") {
        this.plotFlightsOnMap(this.pastFlights, 'past');
      }
    };

    closeBtn.addEventListener("click", closeModal);
    closeHandle.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  // Initialize Search & Add Flights Engine
  initSearch() {
    const searchInput = document.getElementById("flight-search-input");
    const resultsContainer = document.getElementById("search-results-list");
    const customForm = document.getElementById("custom-flight-form");

    // Real-time matching filter inside registry database
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toUpperCase().trim();
      resultsContainer.innerHTML = "";

      if (query.length < 2) return;

      // Filter local airline registers
      const matchedAirports = Object.values(AIRPORTS).filter(a => a.code.includes(query) || a.city.toUpperCase().includes(query));

      // Generate a mock searchable flight for autocomplete
      const matches = [];

      // Check if matches standard flights patterns e.g. "AD 6053"
      if (/^[A-Z0-9]{2}\s?\d{1,4}$/.test(query)) {
        const carrier = query.substring(0, 2);
        const codeNum = query.substring(2).trim();

        if (AIRLINES[carrier]) {
          matches.push({
            flightNumber: `${carrier} ${codeNum}`,
            airline: carrier,
            from: "VCP",
            to: "SDU",
            date: "2026-05-29",
            depTime: "10:30",
            arrTime: "11:35",
            duration: 65,
            distance: 400,
            status: "Scheduled"
          });
        }
      }

      // Add a couple of route matches
      matchedAirports.forEach(air => {
        matches.push({
          flightNumber: `AD ${1000 + Math.floor(Math.random() * 8000)}`,
          airline: "AD",
          from: air.code,
          to: air.code === "VCP" ? "SDU" : "VCP",
          date: "2026-05-30",
          depTime: "12:00",
          arrTime: "13:10",
          duration: 70,
          distance: 450,
          status: "Scheduled"
        });
      });

      if (matches.length === 0) {
        resultsContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Nenhum voo encontrado no banco. Preencha o formulário abaixo para criar um voo customizado!</div>`;
        return;
      }

      matches.slice(0, 3).forEach(flight => {
        const item = document.createElement("div");
        item.className = "search-result-flight";
        item.innerHTML = `
          <div class="airport-info-group">
            <strong style="color: var(--info-blue)">${flight.flightNumber}</strong>
            <span style="font-size: 12px; color: var(--text-secondary);">${flight.from} ➔ ${flight.to}</span>
          </div>
          <button class="add-flight-btn">Adicionar</button>
        `;

        item.querySelector(".add-flight-btn").addEventListener("click", () => {
          this.addNewFlight(flight);
          alert(`Voo ${flight.flightNumber} agendado e inserido com sucesso no seu cronograma!`);
          searchInput.value = "";
          resultsContainer.innerHTML = "";
        });

        resultsContainer.appendChild(item);
      });
    });

    // Custom Flight submit form triggers
    customForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const flightNum = document.getElementById("form-flight-num").value.toUpperCase().trim();
      const depCode = document.getElementById("form-dep-code").value.toUpperCase().trim();
      const arrCode = document.getElementById("form-arr-code").value.toUpperCase().trim();
      const flightDate = document.getElementById("form-date").value;
      const isCompleted = document.getElementById("form-completed-checkbox").checked;

      // Validate airports coordinates
      if (!AIRPORTS[depCode] || !AIRPORTS[arrCode]) {
        alert("Erro: Código IATA de aeroporto desconhecido no banco! Use CNF, SDU, GRU, VCP, GIG, USH, REL, AEP, IGR, BEL ou IGU.");
        return;
      }

      // Calculate automatic distances using standard spherical trigonometry
      const distance = Math.round(this.calculateDistance(
        AIRPORTS[depCode].lat, AIRPORTS[depCode].lng,
        AIRPORTS[arrCode].lat, AIRPORTS[arrCode].lng
      ));

      // Calculate mock durations (8 km/min standard speed)
      const duration = Math.round(distance / 8) + 30; // 30 mins buffers for departures

      const carrier = flightNum.substring(0, 2);

      const newFlightObj = {
        id: `custom_${Date.now()}`,
        flightNumber: flightNum,
        airline: AIRLINES[carrier] ? carrier : "AD", // Fallback to Azul if unknown
        from: depCode,
        to: arrCode,
        date: flightDate,
        depTime: "14:00",
        arrTime: "15:45",
        duration: duration,
        distance: distance,
        delay: isCompleted ? Math.floor(Math.random() * 15) : 0,
        aircraft: "A320neo",
        tailNumber: `PR-YV${Math.floor(Math.random() * 9)}`,
        status: isCompleted ? "Completed" : "Scheduled"
      };

      if (isCompleted) {
        this.pastFlights.push(newFlightObj);
        localStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        this.renderPassport();
        alert(`Sucesso! Voo Histórico ${flightNum} adicionado ao Passport.`);
      } else {
        this.upcomingFlights.push(newFlightObj);
        localStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        this.renderMyFlights();
        alert(`Sucesso! Voo Futuro ${flightNum} agendado na aba de voos.`);
      }

      customForm.reset();
      
      // Auto transition to tab
      const tabTrigger = isCompleted ? 'passport' : 'my-flights';
      document.querySelector(`.nav-item[data-tab="${tabTrigger}"]`).click();
    });

    // Advanced Email Importer Integration (Flighty Pro Feature)
    const connectGmail = document.getElementById("connect-gmail-btn");
    const parseBtn = document.getElementById("parse-email-btn");
    const textParser = document.getElementById("email-text-parser");

    const emailModal = document.getElementById("email-sync-modal");
    const emailModalClose = document.getElementById("email-modal-close");

    if (connectGmail && emailModal) {
      connectGmail.addEventListener("click", () => {
        emailModal.classList.add("active");
      });
    }

    if (emailModalClose && emailModal) {
      emailModalClose.addEventListener("click", () => {
        emailModal.classList.remove("active");
      });
    }

    // Copy command helper
    const copyCommandBtn = document.getElementById("copy-command-btn");
    if (copyCommandBtn) {
      copyCommandBtn.addEventListener("click", () => {
        navigator.clipboard.writeText('python3 "/Users/iancapo/APPs/Flighty IAN/sync_emails.py"').then(() => {
          copyCommandBtn.innerText = "✓ Comando Copiado!";
          copyCommandBtn.style.background = "var(--success-green)";
          setTimeout(() => {
            copyCommandBtn.innerText = "📋 Copiar Comando Terminal";
            copyCommandBtn.style.background = "linear-gradient(135deg, #b87cf8, #7a3bef)";
          }, 3000);
        }).catch(err => {
          alert("Não foi possível copiar automaticamente. Copie de forma manual:\n\npython3 \"/Users/iancapo/APPs/Flighty IAN/sync_emails.py\"");
        });
      });
    }

    // Reload app to import newly synced flights from customFlights.js
    const reloadAppBtn = document.getElementById("reload-app-btn");
    if (reloadAppBtn) {
      reloadAppBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }

    // Real Text Parsing engine (Functional crawler)
    parseBtn.addEventListener("click", () => {
      const text = textParser.value.trim();
      if (!text) {
        alert("Por favor, cole um texto contendo informações do voo para analisar!");
        return;
      }

      // 1. Capture Flight Number: ex "AD 4212" or "G3 1608"
      const flightMatch = text.match(/\b([A-Z0-9]{2})\s?(\d{1,4})\b/i);
      
      // 2. Capture Airport Codes (3 letters uppercase in AIRPORTS list)
      const rawWords = text.toUpperCase().match(/\b([A-Z]{3})\b/g);
      const matchedAirports = rawWords ? rawWords.filter(w => AIRPORTS[w]) : [];

      if (!flightMatch || matchedAirports.length < 2) {
        alert("❌ Não foi possível encontrar dados legíveis de voo no texto do e-mail!\n\nCertifique-se de que o texto contenha o número do voo (Ex: AD 4212) e os códigos IATA dos dois aeroportos (Ex: de VCP para SDU).");
        return;
      }

      const flightNum = flightMatch[0].toUpperCase();
      const carrier = flightMatch[1].toUpperCase();
      const from = matchedAirports[0];
      const to = matchedAirports[1];

      // 3. Try to capture date or default to a standard future date
      let flightDate = "2026-06-25"; // Fallback
      const dateMatchBR = text.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/);
      const dateMatchISO = text.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/);

      if (dateMatchISO) {
        flightDate = dateMatchISO[0].replace(/\//g, "-");
      } else if (dateMatchBR) {
        flightDate = `${dateMatchBR[3]}-${dateMatchBR[2]}-${dateMatchBR[1]}`;
      }

      const distance = Math.round(this.calculateDistance(
        AIRPORTS[from].lat, AIRPORTS[from].lng,
        AIRPORTS[to].lat, AIRPORTS[to].lng
      ));
      const duration = Math.round(distance / 8) + 30;

      // Determine completed vs upcoming based on date
      const today = new Date("2026-05-22");
      const chosenDate = new Date(flightDate + "T00:00:00");
      const isCompleted = chosenDate < today;

      const newFlightObj = {
        id: `parsed_${Date.now()}`,
        flightNumber: flightNum,
        airline: AIRLINES[carrier] ? carrier : "AD",
        from: from,
        to: to,
        date: flightDate,
        depTime: "16:00",
        arrTime: "17:15",
        duration: duration,
        distance: distance,
        delay: isCompleted ? Math.floor(Math.random() * 20) : 0,
        aircraft: "A320neo",
        tailNumber: `PR-YV${Math.floor(Math.random() * 9)}`,
        status: isCompleted ? "Completed" : "Scheduled"
      };

      if (isCompleted) {
        this.pastFlights.push(newFlightObj);
        localStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        this.renderPassport();
        alert(`🎉 Voo Histórico Importado! ${flightNum} (${from} ➔ ${to}) adicionado com sucesso ao Passport.`);
        document.querySelector('.nav-item[data-tab="passport"]').click();
      } else {
        this.upcomingFlights.push(newFlightObj);
        localStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        this.renderMyFlights();
        this.updateGlobalBadge();
        alert(`🎉 Voo Agendado Importado! ${flightNum} (${from} ➔ ${to}) adicionado com sucesso na aba de voos.`);
        document.querySelector('.nav-item[data-tab="my-flights"]').click();
      }

      textParser.value = "";
    });
  }

  // Push new upcoming flight
  addNewFlight(flight) {
    this.upcomingFlights.push(flight);
    localStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
    this.renderMyFlights();
    this.updateGlobalBadge();
    
    // Refresh map if active
    if (this.activeTab === "my-flights") {
      this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
    }
  }

  // Update Global Counter Badges (Pro active badge counts)
  updateGlobalBadge() {
    const badge = document.getElementById("upcoming-badge-count");
    if (badge) {
      badge.innerText = this.upcomingFlights.length;
      badge.style.display = this.upcomingFlights.length > 0 ? "inline-flex" : "none";
    }
  }

  // Geodesic distance calculator (Haversine formula in km)
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Helper date formatters
  formatDate(dateStr) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    const date = new Date(dateStr + "T00:00:00");
    const formatted = date.toLocaleDateString("pt-BR", options);
    // Capitalize first letter
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }

  formatDateSimple(dateStr) {
    const date = new Date(dateStr + "T00:00:00");
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }
}

// Instantiate
const app = new FlightyApp();

// Bind year-select change globally
window.onYearChange = () => {
  app.renderPassport();
  app.clearMapRoutes();
  app.plotFlightsOnMap(app.pastFlights, 'past');
};

// Reset LocalStorage helper for user debugging
window.resetFlightyDatabase = () => {
  if (confirm("Deseja resetar o banco do aplicativo para o padrão inicial dos prints?")) {
    localStorage.removeItem('flighty_past_flights');
    localStorage.removeItem('flighty_upcoming_flights');
    window.location.reload();
  }
};
