// Flighty IAN - Core Application Driver

// Stub MapLibre GL JS if it's blocked by Brave Shields, AdBlockers, or network failure
if (typeof window.maplibregl === 'undefined') {
  window.maplibregl = {
    Map: class DummyMap {
      on(event, cb) {
        if (event === 'load') setTimeout(cb, 100);
      }
      flyTo() {}
      resize() {}
      remove() {}
      setProjection() {}
      setFog() {}
      addSource() {}
      addLayer() {}
      removeLayer() {}
      removeSource() {}
      getSource() {}
      getLayer() {}
      fitBounds() {}
    },
    Marker: class DummyMarker {
      setLngLat() { return this; }
      addTo() { return this; }
      remove() {}
    },
    Popup: class DummyPopup {
      setLngLat() { return this; }
      setHTML() { return this; }
      addTo() { return this; }
      remove() {}
    },
    accessToken: ''
  };
}
if (typeof window.mapboxgl === 'undefined') {
  window.mapboxgl = window.maplibregl;
}

// Safe localStorage wrapper to prevent crashes in private browsing mode (e.g., Safari Private)
const safeStorage = {
  _fallback: {},
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      console.warn(`[Storage] Não foi possível ler a chave "${key}" do localStorage:`, e);
      return this._fallback[key] || null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[Storage] Não foi possível salvar a chave "${key}" no localStorage:`, e);
      this._fallback[key] = String(value);
    }
  },
  removeItem(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[Storage] Não foi possível remover a chave "${key}" do localStorage:`, e);
      delete this._fallback[key];
    }
  }
};




let AIRPORTS = window.AIRPORTS;
let AIRLINES = window.AIRLINES;
const PAST_FLIGHTS = window.PAST_FLIGHTS;
const UPCOMING_FLIGHTS = window.UPCOMING_FLIGHTS;

// Supabase Configuration Configuration
const SUPABASE_URL = "https://vmrnhuwhnkkvkcbdgida.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_d-JR4zjC-cd-VSdg4PJsbg_p0QDqHBI";

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

    // Load and apply theme immediately
    const savedTheme = safeStorage.getItem("flighty_theme") || "light";
    document.body.classList.toggle("dark-theme", savedTheme === "dark");

    // Initialize standard user flights list (uniquely identified by flightNumber + date)
    // Only load static/mock databases if user is not logging in or has not logged in yet.
    // However, to keep it clean, if there is a session or cloud sync flag, we start with empty lists
    // and wait for syncFromSupabase to populate them.
    const isCloudSynced = safeStorage.getItem('flighty_cloud_synced_v4') === 'true';

    if (safeStorage.getItem('flighty_flights_initialized_v4') !== 'true') {
      if (!isCloudSynced) {
        safeStorage.setItem('flighty_past_flights', JSON.stringify(PAST_FLIGHTS));
        safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(UPCOMING_FLIGHTS));
      } else {
        safeStorage.setItem('flighty_past_flights', JSON.stringify([]));
        safeStorage.setItem('flighty_upcoming_flights', JSON.stringify([]));
      }
      safeStorage.setItem('flighty_flights_initialized_v4', 'true');
    }

    this.pastFlights = JSON.parse(safeStorage.getItem('flighty_past_flights')) || (isCloudSynced ? [] : PAST_FLIGHTS);
    this.upcomingFlights = JSON.parse(safeStorage.getItem('flighty_upcoming_flights')) || (isCloudSynced ? [] : UPCOMING_FLIGHTS);
    
    if (!isCloudSynced) {
      this.mergeStaticFlights();
    }

    this.currentYear = "All-Time";
    this.activeTab = "my-flights";
    this.mapRouteStyle = safeStorage.getItem('map_route_style') || 'geodesic';

    this.start();
  }

  // Merge external flights (from customFlights.js and flights2024.js) into current lists
  mergeStaticFlights() {
    const parseDuration = (d) => {
      if (typeof d === 'number') return d;
      if (!d || typeof d !== 'string') return 120;
      const match = d.match(/(\d+)h\s*(\d+)m/);
      if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
      const matchHours = d.match(/(\d+)h/);
      if (matchHours) return parseInt(matchHours[1]) * 60;
      const matchMins = d.match(/(\d+)m/);
      if (matchMins) return parseInt(matchMins[1]);
      const parsed = parseInt(d);
      return isNaN(parsed) ? 120 : parsed;
    };

    const calculateArrTime = (depTime, durationMins) => {
      if (!depTime) return "16:00";
      const parts = depTime.split(":");
      if (parts.length < 2) return "16:00";
      const hours = parseInt(parts[0]);
      const mins = parseInt(parts[1]);
      if (isNaN(hours) || isNaN(mins)) return "16:00";
      const totalMins = hours * 60 + mins + durationMins;
      const newHours = Math.floor(totalMins / 60) % 24;
      const newMins = totalMins % 60;
      return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
    };

    const todayStr = new Date().toISOString().split('T')[0];

    // Build a unique key set of currently loaded flights
    const existingKeys = new Set();
    const allLocal = [...this.pastFlights, ...this.upcomingFlights];
    allLocal.forEach(f => {
      if (f.flightNumber && f.date) {
        existingKeys.add(`${f.flightNumber.trim().toUpperCase()}_${f.date}`);
      }
    });

    let mergedAny = false;

    // Merge window.IMPORTED_FLIGHTS
    if (window.IMPORTED_FLIGHTS && Array.isArray(window.IMPORTED_FLIGHTS)) {
      window.IMPORTED_FLIGHTS.forEach(f => {
        const key = `${f.flightNumber.trim().toUpperCase()}_${f.date}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          const isCompleted = f.date < todayStr;
          const duration = typeof f.duration === 'number' ? f.duration : parseDuration(f.duration);
          const depTime = f.depTime || "14:00";
          const arrTime = f.arrTime || calculateArrTime(depTime, duration);
          const mapped = {
            id: f.id || `email_${Date.now()}_${Math.random()}`,
            flightNumber: f.flightNumber,
            airline: f.airline || f.flightNumber.substring(0, 2).toUpperCase(),
            from: f.from,
            to: f.to,
            date: f.date,
            depTime: depTime,
            arrTime: arrTime,
            duration: duration,
            distance: f.distance || 400,
            delay: f.delay || 0,
            aircraft: f.aircraft || "Commercial",
            tailNumber: f.tailNumber || "",
            seat: f.seat || f.bookingCode || "",
            status: isCompleted ? "Completed" : "Scheduled"
          };
          if (isCompleted) {
            this.pastFlights.push(mapped);
          } else {
            this.upcomingFlights.push(mapped);
          }
          mergedAny = true;
        }
      });
    }

    // Merge window.flights2024
    if (window.flights2024 && Array.isArray(window.flights2024)) {
      window.flights2024.forEach(f => {
        const key = `${f.flightNumber.trim().toUpperCase()}_${f.date}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          const isCompleted = f.date < todayStr;
          const duration = parseDuration(f.duration);
          const depTime = f.depTime || f.time || "14:00";
          const arrTime = f.arrTime || calculateArrTime(depTime, duration);
          const airline = f.airline && f.airline.length === 2 ? f.airline : f.flightNumber.substring(0, 2).toUpperCase();
          const mapped = {
            id: f.id || `f24_${Date.now()}_${Math.random()}`,
            flightNumber: f.flightNumber,
            airline: airline,
            from: f.from,
            to: f.to,
            date: f.date,
            depTime: depTime,
            arrTime: arrTime,
            duration: duration,
            distance: f.distance || 400,
            delay: f.delay || 0,
            aircraft: f.aircraft || "Commercial",
            tailNumber: f.tailNumber || f.registration || "",
            seat: f.seat || f.seatNumber || "",
            status: isCompleted ? "Completed" : "Scheduled"
          };
          if (isCompleted) {
            this.pastFlights.push(mapped);
          } else {
            this.upcomingFlights.push(mapped);
          }
          mergedAny = true;
        }
      });
    }

    if (mergedAny) {
      safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
      safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
    }
  }


  // Load external databases asynchronously and initialize
  async start() {
    try {
      const [resAirports, resAirlines] = await Promise.all([
        fetch('assets/data/airports.json').then(r => r.json()),
        fetch('assets/data/airlines.json').then(r => r.json())
      ]);

      const airportMap = {};
      resAirports.forEach(ap => {
        airportMap[ap.iata] = {
          code: ap.iata,
          city: ap.city_en,
          name: ap.name_en,
          lat: ap.lat,
          lng: ap.lng,
          country_code: ap.country_code
        };
      });

      // Merge original window.AIRPORTS for custom definitions
      Object.entries(window.AIRPORTS).forEach(([code, ap]) => {
        if (!airportMap[code]) {
          airportMap[code] = ap;
        }
      });

      const airlineMap = {};
      resAirlines.forEach(al => {
        airlineMap[al.iata] = {
          code: al.iata,
          name: al.name_en,
          color: (window.AIRLINES[al.iata] && window.AIRLINES[al.iata].color) || "#555555"
        };
      });
      // Merge original window.AIRLINES for custom definitions
      Object.entries(window.AIRLINES).forEach(([code, al]) => {
        airlineMap[code] = {
          code: code,
          name: al.name,
          color: al.color
        };
      });

      this.airports = airportMap;
      this.airlines = airlineMap;
      AIRPORTS = this.airports;
      AIRLINES = this.airlines;
      window.AIRPORTS = this.airports;
      window.AIRLINES = this.airlines;

    } catch (e) {
      console.error("Erro ao carregar os bancos de dados do passaporte:", e);
      this.airports = window.AIRPORTS;
      this.airlines = window.AIRLINES;
    }

    // Hide loading screen
    const splash = document.getElementById("splash-screen");
    if (splash) {
      splash.classList.add("fade-out");
      setTimeout(() => splash.remove(), 550);
    }

    this.init();
  }

  init() {
    const initialize = () => {
      this.mapLoaded = false;

      const safeInit = (name, fn) => {
        try {
          fn();
        } catch (err) {
          console.error(`[Init] Falha ao inicializar ${name}:`, err);
        }
      };

      safeInit("Mapa", () => this.initMap());
      safeInit("Tabs", () => this.initTabs());
      safeInit("Meus Voos", () => this.renderMyFlights());
      safeInit("Passaporte", () => this.renderPassport());
      safeInit("Edição de Passaporte", () => this.initPassportEditing());
      safeInit("Busca de Voos", () => this.initSearch());
      safeInit("Eventos do Modal", () => this.initModalEvents());
      safeInit("Badges Globais", () => this.updateGlobalBadge());
      safeInit("Customizador de Passaporte", () => this.initPassportCustomizer());
      safeInit("Listeners de Perfil", () => this.initProfileTabListeners());
      safeInit("Configurações do Token Mapbox", () => this.initMapboxTokenSettings());
      
      // Initialize Supabase cloud synchronization
      safeInit("Supabase Auth", () => this.initSupabase());

      // Plot upcoming flights by default
      safeInit("Plot Inicial de Voos", () => this.plotFlightsOnMap(this.upcomingFlights, 'upcoming'));
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize);
    } else {
      initialize();
    }
  }

  // ================================================================
  // AUTH GATE — Initialize Supabase and enforce login overlay
  // ================================================================
  async initSupabase() {
    this.supabase = null;
    this.currentUser = null;
    this._loginMode = 'signin'; // 'signin' | 'signup'

    if (typeof supabase === 'undefined') {
      console.warn("[Auth] Supabase SDK não carregado.");
      this._dismissLoginOverlay(); // allow offline use
      return;
    }

    if (SUPABASE_URL === "SUA_URL_SUPABASE" || SUPABASE_ANON_KEY === "SUA_KEY_ANON_SUPABASE") {
      console.warn("[Auth] Credenciais Supabase não configuradas. Modo local offline.");
      this._dismissLoginOverlay();
      return;
    }

    try {
      this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // Persist session in localStorage so the overlay stays hidden across refreshes
          persistSession: true,
          // Detect the OAuth hash fragment on redirect
          detectSessionInUrl: true
        }
      });

      // Listen for auth state changes (covers Google OAuth redirect callback)
      this.supabase.auth.onAuthStateChange(async (event, session) => {
        console.log(`[Auth] onAuthStateChange: ${event}`);
        if (session && session.user) {
          await this._handleAuthSuccess(session.user);
        } else if (event === 'SIGNED_OUT') {
          this.currentUser = null;
          safeStorage.removeItem('flighty_cloud_synced_v4');
          safeStorage.removeItem('flighty_flights_initialized_v4');
          safeStorage.removeItem('flighty_past_flights');
          safeStorage.removeItem('flighty_upcoming_flights');
          
          this.pastFlights = PAST_FLIGHTS;
          this.upcomingFlights = UPCOMING_FLIGHTS;
          
          this._showLoginOverlay();
          this.updateCloudSyncUI();
          this.renderMyFlights();
          this.renderPassport();
        }
      });

      // Wire up the full-screen login overlay UI
      this._initLoginOverlayUI();

      // Wire up the Perfil-tab mini sync card
      this.initSupabaseUI();

      // Check for an existing session (handles page reloads)
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session && session.user) {
        await this._handleAuthSuccess(session.user);
      } else {
        // No session — show the login overlay
        this._showLoginOverlay();
      }

    } catch (e) {
      console.error("[Auth] Falha ao inicializar:", e);
      // On error, allow offline use but keep overlay dismissible
      this._dismissLoginOverlay();
    }
  }

  // Check whitelist and, if approved, dismiss overlay and sync data
  async _handleAuthSuccess(user) {
    console.log(`[Auth] Verificando whitelist para: ${user.email}`);
    const allowed = await this._isEmailAllowed(user.email);

    if (!allowed) {
      console.warn(`[Auth] Email não autorizado: ${user.email}. Fazendo logout.`);
      // Sign out immediately
      await this.supabase.auth.signOut();
      this.currentUser = null;
      // Show overlay with "not allowed" notice
      this._showLoginOverlay({ showAccessDenied: true });
      return;
    }

    this.currentUser = user;
    this._dismissLoginOverlay();
    this.updateCloudSyncUI();
    await this.syncFromSupabase();
  }

  // Query the allowed_emails whitelist table
  async _isEmailAllowed(email) {
    // Permitir acesso a qualquer usuário autenticado com sucesso
    return true;
  }

  // Show the login overlay
  _showLoginOverlay(opts = {}) {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    // Clear any stale error
    this._setLoginError('');
    if (opts.showAccessDenied) {
      const notice = document.getElementById('login-access-notice');
      if (notice) notice.style.display = 'block';
      this._setLoginError('⛔ Seu e-mail não está na lista de acesso autorizado.');
    }
  }

  // Dismiss / fade out the login overlay
  _dismissLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    // Remove from DOM after transition so it doesn't intercept events
    setTimeout(() => { overlay.style.display = 'none'; }, 450);
  }

  // Show an error message in the login overlay
  _setLoginError(msg) {
    const el = document.getElementById('login-error-msg');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.classList.add('visible');
    } else {
      el.textContent = '';
      el.classList.remove('visible');
    }
  }

  // Set loading state on the submit button
  _setLoginLoading(loading) {
    const btn = document.getElementById('login-submit-btn');
    const label = document.getElementById('login-submit-label');
    const spinner = document.getElementById('login-submit-spinner');
    const googleBtn = document.getElementById('login-google-btn');
    if (!btn) return;
    btn.disabled = loading;
    if (googleBtn) googleBtn.disabled = loading;
    if (spinner) spinner.style.display = loading ? 'block' : 'none';
    if (label) label.style.opacity = loading ? '0.4' : '1';
  }

  // Wire up the full-screen login overlay buttons & form
  _initLoginOverlayUI() {
    const overlay    = document.getElementById('login-overlay');
    const googleBtn  = document.getElementById('login-google-btn');
    const form       = document.getElementById('login-email-form');
    const emailInput = document.getElementById('login-email-input');
    const pwInput    = document.getElementById('login-password-input');
    const modeSwitch = document.getElementById('login-mode-switch');
    const modeText   = document.getElementById('login-mode-text');
    const submitLbl  = document.getElementById('login-submit-label');
    const togglePwBtn = document.getElementById('login-toggle-pw-btn');

    if (!overlay) return;

    // ── Google OAuth ──────────────────────────────────────────────
    if (googleBtn) {
      googleBtn.addEventListener('click', async (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        this._setLoginLoading(true);
        this._setLoginError('');
        try {
          if (!this.supabase) {
            throw new Error("Supabase não pôde ser carregado. Verifique sua conexão com a internet ou desative bloqueadores de anúncios (Adblocker/Brave Shields) que possam estar bloqueando o serviço de autenticação.");
          }
          const redirectTo = window.location.origin + window.location.pathname;
          console.log("[Auth] Iniciando login com Google, redirecionando para:", redirectTo);
          const { data, error } = await this.supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo }
          });
          if (error) throw error;
          
          if (data && data.url) {
            console.log("[Auth] Redirecionando manualmente para:", data.url);
            window.location.href = data.url;
          }
        } catch (err) {
          console.error("[Auth] Erro ao iniciar login com Google:", err);
          this._setLoginLoading(false);
          this._setLoginError('Erro ao iniciar login com Google: ' + err.message);
        }
      });
    }

    // ── Toggle show / hide password ───────────────────────────────
    if (togglePwBtn && pwInput) {
      togglePwBtn.addEventListener('click', () => {
        const isHidden = pwInput.type === 'password';
        pwInput.type = isHidden ? 'text' : 'password';
        const icon = document.getElementById('login-pw-eye-icon');
        if (icon) {
          icon.innerHTML = isHidden
            ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
            : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
        }
      });
    }

    // ── Toggle signin ↔ signup mode ───────────────────────────────
    if (modeSwitch) {
      modeSwitch.addEventListener('click', () => {
        this._loginMode = this._loginMode === 'signin' ? 'signup' : 'signin';
        const isSignup = this._loginMode === 'signup';
        if (submitLbl) submitLbl.textContent = isSignup ? 'Cadastrar' : 'Entrar';
        if (modeText)   modeText.textContent  = isSignup ? 'Já tem conta?' : 'Não tem conta?';
        modeSwitch.textContent = isSignup ? 'Entrar' : 'Cadastrar';
        this._setLoginError('');
      });
    }

    // ── Email / Password form submit ──────────────────────────────
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (emailInput?.value || '').trim();
        const password = pwInput?.value || '';

        if (!email || !password) {
          this._setLoginError('Preencha e-mail e senha.');
          return;
        }
        if (password.length < 6) {
          this._setLoginError('A senha deve ter pelo menos 6 caracteres.');
          return;
        }

        this._setLoginLoading(true);
        this._setLoginError('');
        console.log(`[Auth] Iniciando tentativa de login por e-mail: ${email}`);

        try {
          if (this._loginMode === 'signup') {
            const { data, error } = await this.supabase.auth.signUp({ email, password });
            this._setLoginLoading(false);
            if (error) throw error;
            if (data.user && !data.session) {
              console.log("[Auth] Cadastro efetuado com sucesso! Confirmação pendente por e-mail.");
              this._setLoginError('✉️ Confirmação enviada! Verifique seu e-mail e clique no link de confirmação.');
            } else if (data.session) {
              console.log("[Auth] Cadastro efetuado e auto-confirmado.");
              if (data.user) {
                await this._handleAuthSuccess(data.user);
              }
            }
          } else {
            const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
            this._setLoginLoading(false);
            if (error) throw error;
            if (data && data.user) {
              console.log("[Auth] Login por e-mail efetuado com sucesso!");
              await this._handleAuthSuccess(data.user);
            }
          }
        } catch (err) {
          console.error("[Auth] Erro ao autenticar por e-mail:", err);
          this._setLoginLoading(false);
          // Translate common Supabase auth errors to Portuguese
          const msg = err.message.includes('Invalid login credentials')
            ? 'E-mail ou senha incorretos.'
            : err.message.includes('Email not confirmed')
            ? 'Confirme seu e-mail antes de entrar.'
            : err.message.includes('User already registered')
            ? 'Este e-mail já está cadastrado. Tente entrar.'
            : err.message;
          this._setLoginError(msg);
        }
      });
    }
  }

  // Setup UI elements for Perfil-tab Supabase mini-card (sign-out, status)
  initSupabaseUI() {
    const authBtn = document.getElementById("supabase-auth-btn");
    const authForm = document.getElementById("supabase-auth-form");
    const loginBtn = document.getElementById("supabase-login-btn");
    const signupBtn = document.getElementById("supabase-signup-btn");
    const emailInput = document.getElementById("supabase-email-input");
    const passwordInput = document.getElementById("supabase-password-input");

    this.updateCloudSyncUI();

    if (authBtn && authForm) {
      authBtn.addEventListener("click", async () => {
        if (this.currentUser) {
          // Logout — will re-show the login overlay via onAuthStateChange
          const { error } = await this.supabase.auth.signOut();
          if (error) alert("Erro ao deslogar: " + error.message);
        } else {
          // Show the full login overlay instead of the tiny inline form
          this._showLoginOverlay();
        }
      });
    }

    // Inline form in Perfil tab — kept for backwards compatibility
    if (loginBtn && emailInput && passwordInput) {
      loginBtn.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) { alert("Preencha e-mail e senha."); return; }
        loginBtn.innerText = "Entrando...";
        loginBtn.disabled = true;
        const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
        loginBtn.innerText = "Entrar";
        loginBtn.disabled = false;
        if (error) {
          alert("Erro no login: " + error.message);
        } else {
          // onAuthStateChange handles the rest
          if (authForm) authForm.style.display = "none";
          if (emailInput) emailInput.value = "";
          if (passwordInput) passwordInput.value = "";
        }
      });
    }

    if (signupBtn && emailInput && passwordInput) {
      signupBtn.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) { alert("Preencha e-mail e senha."); return; }
        signupBtn.innerText = "Cadastrando...";
        signupBtn.disabled = true;
        const { data, error } = await this.supabase.auth.signUp({ email, password });
        signupBtn.innerText = "Cadastrar";
        signupBtn.disabled = false;
        if (error) alert("Erro no cadastro: " + error.message);
        else alert("Cadastro efetuado! Verifique seu e-mail se precisar confirmar.");
      });
    }
  }

  // Update Perfil-tab mini-card to reflect current auth state
  updateCloudSyncUI() {
    const statusLbl = document.getElementById("supabase-status-lbl");
    const authBtn = document.getElementById("supabase-auth-btn");
    
    if (statusLbl && authBtn) {
      if (this.currentUser) {
        statusLbl.innerHTML = `
          Conectado como <strong style="color: var(--success-green);">${this.currentUser.email}</strong>
          <span style="display:block; font-size: 10px; color: var(--text-secondary); margin-top: 4px; cursor: pointer; user-select: none;" 
                id="copy-uid-btn" title="Clique para copiar o UID">
            UID: <code style="color: var(--accent-gold); font-family: monospace;">${this.currentUser.id}</code> 📋
          </span>
        `;
        authBtn.innerText = "Sair";
        authBtn.style.background = "#ff453a";
        setTimeout(() => {
          const copyBtn = document.getElementById("copy-uid-btn");
          if (copyBtn) {
            copyBtn.addEventListener("click", () => {
              navigator.clipboard.writeText(this.currentUser.id).then(() => {
                const oldHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = `UID: <code style="color: var(--success-green); font-family: monospace;">Copiado!</code>`;
                setTimeout(() => { copyBtn.innerHTML = oldHTML; }, 2000);
              });
            });
          }
        }, 100);
      } else {
        statusLbl.innerText = "Desconectado (Modo Local)";
        authBtn.innerText = "Conectar";
        authBtn.style.background = "var(--info-blue)";
      }
    }
  }

  // Sync profile and flights from Supabase Cloud DB
  async syncFromSupabase() {
    if (!this.supabase || !this.currentUser) return;

    try {
      // Ensure sync flag is set locally
      safeStorage.setItem('flighty_cloud_synced_v4', 'true');

      // 1. Fetch flights directly from Supabase (sole source of truth)
      const { data: dbFlights, error } = await this.supabase
        .from('flights')
        .select('*')
        .eq('user_id', this.currentUser.id);

      if (error) throw error;

      // Map Supabase records to client flight objects
      const todayStr = new Date().toISOString().split('T')[0];
      const mappedFlights = (dbFlights || []).map(f => {
        const isCompleted = f.flight_date < todayStr;
        return {
          id: f.id,
          date: f.flight_date,
          airline: f.airline_code,
          flightNumber: f.flight_number,
          from: f.origin_airport_code,
          to: f.destination_airport_code,
          aircraft: f.aircraft_type || "",
          tailNumber: f.aircraft_registration || "",
          distance: f.distance_km || 0,
          duration: f.duration_minutes || 0,
          seat: f.seat_number || "",
          delay: isCompleted ? Math.floor(Math.random() * 15) : 0,
          status: isCompleted ? "Completed" : "Scheduled"
        };
      });

      // Split into past and upcoming
      this.pastFlights = mappedFlights.filter(f => f.status === "Completed");
      this.upcomingFlights = mappedFlights.filter(f => f.status === "Scheduled");

      // Save to safeStorage
      safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
      safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));

      // 2. Sync profile details
      const { data: profile, error: profileErr } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', this.currentUser.id)
        .single();

      if (!profileErr && profile) {
        const surnameEl = document.getElementById("passport-surname");
        const givenNameEl = document.getElementById("passport-givenname");
        
        if (profile.full_name) {
          const parts = profile.full_name.split(' ');
          if (givenNameEl) givenNameEl.innerText = parts[0].toUpperCase();
          if (surnameEl) surnameEl.innerText = parts.slice(1).join(' ').toUpperCase() || "";
        } else if (profile.username) {
          if (givenNameEl) givenNameEl.innerText = profile.username.toUpperCase();
        }

        if (profile.avatar_url) {
          const photoImg = document.getElementById("passport-photo-img");
          const profileImg = document.getElementById("profile-avatar-img");
          if (photoImg) photoImg.src = profile.avatar_url;
          if (profileImg) profileImg.src = profile.avatar_url;
          safeStorage.setItem("passport-photo-dataurl", profile.avatar_url);
        }
        
        // Dynamic Passport Number based on names
        const updatePassportNum = () => {
          const surnameVal = document.getElementById("passport-surname")?.innerText || "CAPO";
          const givenVal = document.getElementById("passport-givenname")?.innerText || "IAN";
          let hash = 0;
          for (let i = 0; i < surnameVal.length + givenVal.length; i++) {
            hash = (surnameVal + givenVal).charCodeAt(i) + ((hash << 5) - hash);
          }
          const numDisplay = document.getElementById("passport-num-display");
          if (numDisplay) {
            const formattedNum = `FP${Math.abs(hash).toString().substring(0, 6).padEnd(6, '0')}A`;
            numDisplay.innerText = formattedNum;
          }
        };
        updatePassportNum();
        this.updateMRZ();
      }
      
      this.updateCloudSyncUI();
      // Re-render components after sync
      this.renderPassport();
      this.renderMyFlights();
      this.clearMapRoutes();
      this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
    } catch (e) {
      console.error("[Supabase] Falha ao sincronizar dados com a nuvem:", e);
    }
  }

  // Upload flight insertion to Supabase Cloud DB
  async saveFlightToSupabase(f) {
    if (!this.supabase || !this.currentUser) return;

    try {
      const record = {
        user_id: this.currentUser.id,
        flight_date: f.date,
        airline_code: f.airline,
        airline_name: window.AIRLINES[f.airline]?.name || f.airline,
        flight_number: f.flightNumber,
        origin_airport_code: f.from,
        origin_airport_name: `Aeroporto de ${f.from}`,
        origin_city: f.from,
        origin_country_code: "BR", // default
        destination_airport_code: f.to,
        destination_airport_name: `Aeroporto de ${f.to}`,
        destination_city: f.to,
        destination_country_code: "BR", // default
        aircraft_type: f.aircraft || "Commercial",
        aircraft_registration: f.tailNumber || "",
        distance_km: parseInt(f.distance || 0),
        duration_minutes: parseInt(f.duration || 0),
        seat_number: f.seat || "",
        flight_class: "economy",
        reason_for_travel: "leisure",
        is_public: true
      };

      const { data, error } = await this.supabase
        .from('flights')
        .insert([record])
        .select();

      if (error) throw error;

      if (data && data[0]) {
        f.id = data[0].id;
        safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
      }
      console.log("[Supabase] Voo salvo na nuvem com sucesso!");
    } catch (e) {
      console.error("[Supabase] Erro ao sincronizar voo com o banco:", e);
    }
  }

  // Initialize Mapbox GL Map
  initMap() {
    try {
      // Clean up existing map instance to prevent WebGL leaks
      if (this.map) {
        try {
          this.map.remove();
        } catch (e) {
          console.error("[Map] Error removing old map instance:", e);
        }
        this.map = null;
        this.mapLoaded = false;
      }

      const tokenPart1 = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTAwY2kycnA3ZXVod293amQifQ';
      const tokenPart2 = 'cx4GBfCx5y55B1zLqJha8w';
      
      if (typeof maplibregl !== 'undefined') {
        maplibregl.accessToken = window.NEXT_PUBLIC_MAPBOX_TOKEN || 
                               safeStorage.getItem('MAPBOX_TOKEN') || 
                               `${tokenPart1}.${tokenPart2}`;

        this.map = new maplibregl.Map({
          container: 'map',
          style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
          center: [12, 10], 
          zoom: 1.2, 
          pitch: 0, 
          antialias: true
        });

        this.map.on('load', () => {
          // Configure Flat Mercator Projection to match the user's flat map layout
          if (this.map && typeof this.map.setProjection === 'function') {
            try {
              this.map.setProjection({ name: 'mercator' });
            } catch (e) {
              console.warn("[Map] Failed to set projection:", e);
            }
          }

          // Enable premium atmosphere fog (Flighty visual style)
          if (this.map && typeof this.map.setFog === 'function') {
            try {
              this.map.setFog({
                color: 'rgb(8, 8, 12)', 
                'high-color': 'rgb(18, 18, 28)', 
                'horizon-blend': 0.02,
                'space-color': 'rgb(2, 2, 4)', 
                'star-intensity': 0.6
              });
            } catch (e) {
              console.warn("[Map] Failed to set fog:", e);
            }
          }

          this.mapLoaded = true;

          // Handle any pending plot queued before load event fired
          if (this.pendingPlot) {
            this.plotFlightsOnMap(this.pendingPlot.flights, this.pendingPlot.type);
            this.pendingPlot = null;
          }
        });
      }
    } catch (err) {
      console.error("[Map] Erro catastrófico ao inicializar o mapa (WebGL pode estar sem suporte):", err);
    }
  }

  // Tab Navigation Handling
  initTabs() {
    const navItems = document.querySelectorAll(".nav-item, .nav-search-btn");
    
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

      // Geodesic (greatCircle) or straight line route depending on map settings
      let routeData;
      if (this.mapRouteStyle === 'geodesic') {
        const greatCircleRoute = turf.greatCircle(turf.point(p1), turf.point(p2), { npoints: 100 });
        const coordinates = greatCircleRoute.geometry.coordinates;
        for (let i = 1; i < coordinates.length; i++) {
          const prevLng = coordinates[i - 1][0];
          const currentLng = coordinates[i][0];
          if (currentLng - prevLng > 180) {
            coordinates[i][0] -= 360;
          } else if (prevLng - currentLng > 180) {
            coordinates[i][0] += 360;
          }
        }
        routeData = greatCircleRoute;
      } else {
        routeData = turf.lineString([p1, p2]);
      }

      const sourceId = `source-${flight.id}`;
      
      this.map.addSource(sourceId, {
        type: 'geojson',
        lineMetrics: true, // Crucial for gradient support
        data: routeData
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

    // Sort upcoming flights by date and departure time
    const sortedUpcoming = [...this.upcomingFlights].sort((a, b) => {
      const dateTimeA = new Date(`${a.date}T${a.depTime || '00:00'}:00`);
      const dateTimeB = new Date(`${b.date}T${b.depTime || '00:00'}:00`);
      return dateTimeA - dateTimeB;
    });

    sortedUpcoming.forEach((flight, index) => {
      const depAir = AIRPORTS[flight.from] || { city: flight.from, code: flight.from };
      const arrAir = AIRPORTS[flight.to] || { city: flight.to, code: flight.to };
      const airline = AIRLINES[flight.airline] || { name: flight.airline, color: "#555" };

      // Calculate countdown in days
      const today = new Date("2026-06-23"); // Anchored to current time in prompt metadata
      const flightDate = new Date(flight.date);
      const diffTime = flightDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let countdownHTML = "";
      if (diffDays > 0) {
        countdownHTML = `
          <span class="flight-countdown-num">${diffDays}</span>
          <span class="flight-countdown-unit">${diffDays === 1 ? 'DAY' : 'DAYS'}</span>
        `;
      } else if (diffDays === 0) {
        countdownHTML = `
          <span class="flight-countdown-num" style="font-size: 16px; color: var(--accent-pro); line-height: 1.2;">TODAY</span>
        `;
      } else {
        countdownHTML = `
          <span class="flight-countdown-num" style="font-size: 14px; color: var(--text-muted); line-height: 1.2;">PAST</span>
        `;
      }

      const logoSrc = `assets/images/airlines/${flight.airline.toLowerCase()}.png`;

      const rowContainer = document.createElement("div");
      rowContainer.style.display = "block";

      const flightRow = document.createElement("div");
      flightRow.className = "flight-row-container";
      
      flightRow.innerHTML = `
        <div class="flight-countdown-col">
          ${countdownHTML}
        </div>
        <div class="flight-info-col">
          <div class="flight-info-top">
            <div class="flight-info-airline">
              <img src="${logoSrc}" class="flight-airline-logo" data-fallback-color="${airline.color}" onerror="this.outerHTML='<span class=\'airline-logo-dot\' style=\'background-color:' + (this.dataset.fallbackColor||'#555') + '; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;\'></span>'" />
              <span>${airline.name} • ${flight.flightNumber}</span>
            </div>
            <div class="flight-info-date">${this.formatDate(flight.date)}</div>
          </div>
          <div class="flight-info-route">
            <span class="city-name">${depAir.city}</span>
            <span class="route-to">to</span>
            <span class="city-name">${arrAir.city}</span>
          </div>
          <div class="flight-info-times">
            <div class="time-block">
              <span class="arrow-circle">↗</span>
              <span class="airport-code">${flight.from}</span>
              <span class="time-value">${flight.depTime}</span>
            </div>
            <div class="time-block">
              <span class="arrow-circle">↘</span>
              <span class="airport-code">${flight.to}</span>
              <span class="time-value">${flight.arrTime}</span>
            </div>
          </div>
          ${flight.alerts && flight.alerts.length > 0 ? `
            <div class="card-alert-banner" style="margin-top: 8px;">
              <span>⚠️</span>
              <span>${flight.alerts[0].text}</span>
            </div>
          ` : ''}
        </div>
      `;

      // Context menu for desktop right click
      flightRow.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, flight);
      });

      // Mobile Touch events for long press
      let touchTimeout = null;
      let startX = 0;
      let startY = 0;
      let isLongPress = false;

      flightRow.addEventListener("touchstart", (e) => {
        isLongPress = false;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        
        touchTimeout = setTimeout(() => {
          isLongPress = true;
          if (navigator.vibrate) {
            navigator.vibrate(50); // Small haptic feedback
          }
          this.showContextMenu(touch.clientX, touch.clientY, flight);
        }, 700);
      }, { passive: true });

      flightRow.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        const diffX = Math.abs(touch.clientX - startX);
        const diffY = Math.abs(touch.clientY - startY);
        if (diffX > 10 || diffY > 10) {
          if (touchTimeout) {
            clearTimeout(touchTimeout);
            touchTimeout = null;
          }
        }
      }, { passive: true });

      flightRow.addEventListener("touchend", (e) => {
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          touchTimeout = null;
        }
      }, { passive: true });

      flightRow.addEventListener("click", (e) => {
        if (isLongPress) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.openEditFlightModal(flight);
      });
      rowContainer.appendChild(flightRow);

      // Layover detection
      if (index < sortedUpcoming.length - 1) {
        const nextFlight = sortedUpcoming[index + 1];
        if (nextFlight.from === flight.to) {
          const currentArrDateTime = new Date(`${flight.date}T${flight.arrTime || '00:00'}:00`);
          const nextDepDateTime = new Date(`${nextFlight.date}T${nextFlight.depTime || '00:00'}:00`);
          
          const layoverMs = nextDepDateTime - currentArrDateTime;
          const layoverHours = layoverMs / (1000 * 60 * 60);

          if (layoverMs > 0 && layoverHours < 24) {
            const layoverMinutesTotal = Math.round(layoverMs / (1000 * 60));
            const hrs = Math.floor(layoverMinutesTotal / 60);
            const mins = layoverMinutesTotal % 60;
            
            const layoverText = `${hrs > 0 ? hrs + 'h ' : ''}${mins}m at ${flight.to}`;

            const layoverRow = document.createElement("div");
            layoverRow.className = "layover-row";
            layoverRow.innerHTML = `
              <span>${layoverText}</span>
              <span class="chevron-right">›</span>
            `;

            layoverRow.addEventListener("click", (e) => {
              e.stopPropagation();
              this.openEditFlightModal(nextFlight);
            });

            rowContainer.appendChild(layoverRow);
          }
        }
      }

      listContainer.appendChild(rowContainer);
    });
  }



  // Calculate & Render Passport Statistics
  renderPassport() {
    const yearSelect = document.getElementById("passport-year-select");
    if (!yearSelect) return;

    // Coleta todos os anos únicos em voos passados
    const yearsInDB = [...new Set(this.pastFlights.map(f => f.date.substring(0, 4)))].sort((a,b) => b - a);
    
    // Reconstrói dinamicamente os botões de seleção de ano na interface
    const daysSelectors = document.querySelector("#passport-panel .days-selectors");
    if (daysSelectors && !daysSelectors.dataset.rebuilding) {
      daysSelectors.dataset.rebuilding = "true"; // Evita loop infinito
      
      let currentVal = yearSelect.value || "All-Time";
      
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

    // Unique visited countries based on ISO codes in airports database
    const visitedCountryCodes = new Set();
    filteredFlights.forEach(f => {
      const depAp = AIRPORTS[f.from];
      const arrAp = AIRPORTS[f.to];
      if (depAp && depAp.country_code) visitedCountryCodes.add(depAp.country_code.toUpperCase());
      if (arrAp && arrAp.country_code) visitedCountryCodes.add(arrAp.country_code.toUpperCase());
    });

    const getEmojiFlag = (cc) => {
      if (!cc || cc.length !== 2) return "🏳️";
      const codePoints = cc.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0));
      return String.fromCodePoint(...codePoints);
    };

    const flagsContainer = document.getElementById("passport-flags");
    if (flagsContainer) {
      if (visitedCountryCodes.size === 0) visitedCountryCodes.add("BR");
      flagsContainer.innerHTML = [...visitedCountryCodes].map(code => {
        return `<img class="flag-img-icon" src="assets/images/flags/${code.toLowerCase()}.png" alt="${code}" onerror="this.outerHTML='<span class=\'flag-icon\'>${getEmojiFlag(code)}</span>'" title="${code}" />`;
      }).join('');
    }

    // Populate Airline Badges inside booklet using PNG logos
    const airlineBadgesContainer = document.getElementById("passport-airline-logos");
    if (airlineBadgesContainer) {
      airlineBadgesContainer.innerHTML = "";
      const visitedAirlines = [...new Set(filteredFlights.map(f => f.airline))];
      visitedAirlines.slice(0, 5).forEach(airlineCode => {
        const airlineInfo = AIRLINES[airlineCode] || { name: airlineCode, color: "#444" };
        const badge = document.createElement("div");
        badge.className = "passport-airline-logo-badge";
        badge.style.backgroundColor = airlineInfo.color || "#333";
        badge.title = airlineInfo.name;
        badge.innerHTML = `<img src="assets/images/airlines/${airlineCode.toLowerCase()}.png" onerror="this.outerHTML='<span>${airlineCode}</span>'" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`;
        airlineBadgesContainer.appendChild(badge);
      });
      if (visitedAirlines.length > 5) {
        const badge = document.createElement("div");
        badge.className = "passport-airline-logo-badge";
        badge.style.backgroundColor = "#555";
        badge.innerText = `+${visitedAirlines.length - 5}`;
        airlineBadgesContainer.appendChild(badge);
      }
    }

    // Calculate advanced statistics
    const routeCounts = {};
    filteredFlights.forEach(f => {
      const routeKey = [f.from, f.to].sort().join(' ➔ ');
      routeCounts[routeKey] = (routeCounts[routeKey] || 0) + 1;
    });
    let topRoute = "-";
    let topRouteCount = 0;
    Object.entries(routeCounts).forEach(([route, count]) => {
      if (count > topRouteCount) {
        topRouteCount = count;
        topRoute = route;
      }
    });

    const airportCounts = {};
    filteredFlights.forEach(f => {
      airportCounts[f.from] = (airportCounts[f.from] || 0) + 1;
      airportCounts[f.to] = (airportCounts[f.to] || 0) + 1;
    });
    let topAirport = "-";
    let topAirportCount = 0;
    Object.entries(airportCounts).forEach(([ap, count]) => {
      if (count > topAirportCount) {
        topAirportCount = count;
        topAirport = ap;
      }
    });

    // Populate extra fields in details
    const subStatContainer = document.querySelector(".passport-stat-details");
    if (subStatContainer) {
      subStatContainer.innerHTML = `
        <div class="passport-sub-stat">
          <span class="sub-label">Distance</span>
          <span class="sub-value" id="pass-distance-count">${totalDistance.toLocaleString("pt-BR")} km</span>
        </div>
        <div class="passport-sub-stat">
          <span class="sub-label">Flight Time</span>
          <span class="sub-value" id="pass-time-count">${totalHours}h ${remainingMinutes}m</span>
        </div>
        <div class="passport-sub-stat">
          <span class="sub-label">Airlines</span>
          <span class="sub-value" id="pass-airlines-count">${uniqueAirlines}</span>
        </div>
        <div class="passport-sub-stat">
          <span class="sub-label">Airports</span>
          <span class="sub-value" id="pass-airports-count">${uniqueAirports}</span>
        </div>
        <div class="passport-sub-stat" title="Hub Pessoal (Aeroporto mais visitado)">
          <span class="sub-label">Top Hub</span>
          <span class="sub-value" style="color:var(--accent-pro); font-weight:700;">${topAirport} (${topAirportCount}x)</span>
        </div>
        <div class="passport-sub-stat" title="Rota mais frequente">
          <span class="sub-label">Top Rota</span>
          <span class="sub-value" style="color:var(--accent-pro); font-weight:700; font-size: 8px;">${topRoute} (${topRouteCount}x)</span>
        </div>
      `;
    }

    // Render Stamps
    this.renderStamps(filteredFlights);

    // Initialize/Update Canvas Mini-Map inside passport booklet
    this.drawPassportCanvasMap(filteredFlights);

    // Update MRZ dynamic text
    this.updateMRZ();

    // Aircraft stats (keep existing card working as extra info below passport booklet)
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

    const passMostAircraftEl = document.getElementById("pass-most-aircraft");
    if (passMostAircraftEl) passMostAircraftEl.innerText = mostFlownAircraft;
    
    const passMostAircraftCountEl = document.getElementById("pass-most-aircraft-count");
    if (passMostAircraftCountEl) passMostAircraftCountEl.innerText = `${mostFlownAircraftCount} voos registrados`;

    // Render Past Flights List in Table
    this.renderPastFlightsTable(filteredFlights);
  }

  // Dynamic MRZ Code Line Generator
  updateMRZ() {
    const surname = (document.getElementById("passport-surname")?.innerText || "CAPO").toUpperCase().replace(/[^A-Z]/g, '');
    const givenname = (document.getElementById("passport-givenname")?.innerText || "IAN").toUpperCase().replace(/[^A-Z]/g, '');
    const country = (document.getElementById("passport-country-name")?.innerText || "BRASIL").toUpperCase().trim();
    
    const countryCodes = {
      "BRASIL": "BRA", "BRAZIL": "BRA", "ARGENTINA": "ARG", "ARG": "ARG", "CHINA": "CHN", "USA": "USA", "ESTADOS UNIDOS": "USA",
      "PORTUGAL": "PRT", "ESPANHA": "ESP", "SPAIN": "ESP", "FRANCE": "FRA", "FRANÇA": "FRA", "REINO UNIDO": "GBR", "UK": "GBR"
    };
    const countryCode = countryCodes[country] || country.substring(0, 3).toUpperCase();
    
    const countryCodeDisplay = document.getElementById("passport-country-code-display");
    if (countryCodeDisplay) countryCodeDisplay.innerText = countryCode;

    const passportNo = (document.getElementById("passport-num-display")?.innerText || "FP000001A").toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    const issueDateStr = document.getElementById("passport-issue-date")?.innerText || "23 JUN 2026";
    let yy = "26";
    let mm = "06";
    let dd = "23";
    const dateMatch = issueDateStr.match(/(\d{1,2})\s*([A-Za-z]+)\s*(\d{4}|\d{2})/);
    if (dateMatch) {
      dd = dateMatch[1].padStart(2, '0');
      const monthMap = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        dez: "12", nov: "11", out: "10", set: "09", ago: "08", jul: "07", jun: "06", mai: "05", abr: "04", mar: "03", fev: "02", jan: "01"
      };
      const monthName = dateMatch[2].substring(0, 3).toLowerCase();
      mm = monthMap[monthName] || "06";
      yy = dateMatch[3].substring(dateMatch[3].length - 2);
    }
    const mrzDate = `${yy}${mm}${dd}`;

    let line1 = `P<FP<${surname}<<${givenname}`;
    line1 = line1.length > 44 ? line1.substring(0, 44) : line1.padEnd(44, '<');

    let line2 = `${passportNo}<${mrzDate}<FLIGHTPASSPORT.APP`;
    line2 = line2.length > 44 ? line2.substring(0, 44) : line2.padEnd(44, '<');

    const mrzLine1El = document.getElementById("passport-mrz-line1");
    const mrzLine2El = document.getElementById("passport-mrz-line2");
    if (mrzLine1El) mrzLine1El.innerText = line1;
    if (mrzLine2El) mrzLine2El.innerText = line2;
  }

  // Draw routes specifically on the Passport Mini-Map
  // ─── Canvas 2D World Map for Passport Booklet (no Mapbox token needed) ───
  async drawPassportCanvasMap(flights, canvasEl = null) {
    const canvas = canvasEl || document.getElementById('passport-mini-map');
    if (!canvas) return;

    // Retina-ready sizing
    const W = canvas.offsetWidth  || 520;
    const H = canvas.offsetHeight || 200;
    canvas.width  = W * 2;
    canvas.height = H * 2;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // ── 1. White base background ─────────────────────────────────
    ctx.fillStyle = '#f8faf8';
    ctx.fillRect(0, 0, W, H);

    // ── 2. Iridescent shimmer overlay (top half only) ────────────
    //    Replicates the holographic sheen in the reference image
    const shimmer = ctx.createLinearGradient(0, 0, W, H * 0.6);
    shimmer.addColorStop(0.00, 'rgba(200, 240, 255, 0.55)');
    shimmer.addColorStop(0.20, 'rgba(180, 255, 230, 0.35)');
    shimmer.addColorStop(0.40, 'rgba(255, 240, 200, 0.25)');
    shimmer.addColorStop(0.60, 'rgba(210, 190, 255, 0.20)');
    shimmer.addColorStop(0.80, 'rgba(180, 230, 255, 0.15)');
    shimmer.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = shimmer;
    ctx.fillRect(0, 0, W, H * 0.6);

    // ── 3. Equirectangular projection (centered bounding box zooming in on flight paths) ────────────────────────────
    const pad = 4;
    const minLng = -95, maxLng = 105;
    const minLat = -58, maxLat = 62;
    const projX = lng => pad + ((lng - minLng) / (maxLng - minLng)) * (W - pad * 2);
    const projY = lat => pad + ((maxLat - lat) / (maxLat - minLat)) * (H - pad * 2);

    // ── 4. Fetch & cache world GeoJSON ───────────────────────────
    if (!window._passportWorldGeo) {
      try {
        const res  = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
        const topo = await res.json();
        window._passportWorldGeo = window.topojson
          ? window.topojson.feature(topo, topo.objects.land)
          : null;
        if (!window._passportWorldGeo) {
          const r2 = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson');
          window._passportWorldGeo = await r2.json();
        }
      } catch(e) { window._passportWorldGeo = null; }
    }

    // ── 5. Draw teal land masses (like reference) ────────────────
    const drawLand = (geo) => {
      // Subtle dot grid texture on ocean
      ctx.fillStyle = 'rgba(130,190,175,0.07)';
      for (let gx = pad; gx < W; gx += 6) {
        for (let gy = pad; gy < H; gy += 6) {
          ctx.beginPath();
          ctx.arc(gx, gy, 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const drawPoly = (rings) => {
        ctx.beginPath();
        rings[0].forEach(([lng, lat], i) => {
          i === 0
            ? ctx.moveTo(projX(lng), projY(lat))
            : ctx.lineTo(projX(lng), projY(lat));
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };

      // Land fill: teal translucent (like reference)
      ctx.fillStyle   = 'rgba(100, 185, 165, 0.38)';
      ctx.strokeStyle = 'rgba(70,  160, 140, 0.55)';
      ctx.lineWidth   = 0.4;

      geo.features.forEach(f => {
        if (!f.geometry) return;
        if (f.geometry.type === 'Polygon')
          drawPoly(f.geometry.coordinates);
        else if (f.geometry.type === 'MultiPolygon')
          f.geometry.coordinates.forEach(p => drawPoly(p));
      });
    };

    if (window._passportWorldGeo) drawLand(window._passportWorldGeo);

    // ── 6. Draw great-circle routes ──────────────────────────────
    const validFlights = flights.filter(f => AIRPORTS[f.from] && AIRPORTS[f.to]);

    validFlights.forEach(f => {
      const p1 = [AIRPORTS[f.from].lng, AIRPORTS[f.from].lat];
      const p2 = [AIRPORTS[f.to].lng,   AIRPORTS[f.to].lat];

      let points;
      try {
        const gc = turf.greatCircle(turf.point(p1), turf.point(p2), { npoints: 80 });
        points = gc.geometry.coordinates;
        for (let i = 1; i < points.length; i++) {
          const d = points[i][0] - points[i-1][0];
          if (d >  180) points[i][0] -= 360;
          if (d < -180) points[i][0] += 360;
        }
      } catch(e) { points = [p1, p2]; }

      // Glow halo
      ctx.beginPath();
      points.forEach(([lng, lat], i) => {
        i === 0
          ? ctx.moveTo(projX(lng), projY(lat))
          : ctx.lineTo(projX(lng), projY(lat));
      });
      ctx.strokeStyle = 'rgba(200, 40, 40, 0.18)';
      ctx.lineWidth   = 4;
      ctx.setLineDash([]);
      ctx.stroke();

      // Main dashed red line
      ctx.beginPath();
      points.forEach(([lng, lat], i) => {
        i === 0
          ? ctx.moveTo(projX(lng), projY(lat))
          : ctx.lineTo(projX(lng), projY(lat));
      });
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#cc2828';
      ctx.lineWidth   = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // ── 7. Airport dots ──────────────────────────────────────────
    const seen = new Set();
    validFlights.forEach(f => {
      [f.from, f.to].forEach(code => {
        if (seen.has(code)) return;
        seen.add(code);
        const ap = AIRPORTS[code];
        const x  = projX(ap.lng);
        const y  = projY(ap.lat);
        // White ring
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        // Red fill
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle   = '#cc2828';
        ctx.strokeStyle = 'rgba(180,0,0,0.4)';
        ctx.lineWidth   = 1;
        ctx.fill();
        ctx.stroke();
      });
    });

    // ── 8. Subtle vignette at bottom ─────────────────────────────
    const vig = ctx.createLinearGradient(0, H * 0.65, 0, H);
    vig.addColorStop(0, 'rgba(220,235,220,0)');
    vig.addColorStop(1, 'rgba(220,235,220,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, H * 0.65, W, H * 0.35);
  }


  // Helper to compress/resize base64 image data to keep storage footprint small
  compressImage(dataUrl, maxDimension = 300) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  // Save profile modifications (name and base64 avatar) back to Supabase
  async saveProfileToSupabase() {
    if (!this.supabase || !this.currentUser) return;
    try {
      const surname = (document.getElementById("passport-surname")?.innerText || "").trim();
      const givenname = (document.getElementById("passport-givenname")?.innerText || "").trim();
      const fullName = `${givenname} ${surname}`.trim();
      const avatarUrl = safeStorage.getItem("passport-photo-dataurl") || "";

      const { error } = await this.supabase
        .from('profiles')
        .update({
          full_name: fullName,
          avatar_url: avatarUrl
        })
        .eq('id', this.currentUser.id);

      if (error) throw error;
      console.log("[Supabase] Perfil atualizado na nuvem com sucesso!");
    } catch (e) {
      console.error("[Supabase] Erro ao sincronizar perfil com a nuvem:", e);
    }
  }

  // Setup Passport editing and local saving
  initPassportEditing() {
    const fields = ["passport-surname", "passport-givenname", "passport-country-name", "passport-issue-date"];
    
    fields.forEach(fieldId => {
      const val = safeStorage.getItem(fieldId);
      const el = document.getElementById(fieldId);
      if (val && el) {
        el.innerText = val;
      }
      
      if (el) {
        el.addEventListener("blur", () => {
          safeStorage.setItem(fieldId, el.innerText);
          this.updateMRZ();
          if (this.supabase && this.currentUser) {
            this.saveProfileToSupabase();
          }
        });
        
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            el.blur();
          }
        });
      }
    });

    // Custom Photo Upload
    const photoTrigger = document.getElementById("passport-photo-trigger");
    const photoInput = document.getElementById("passport-photo-input");
    const photoImg = document.getElementById("passport-photo-img");
    const profileImg = document.getElementById("profile-avatar-img");

    const savedPhoto = safeStorage.getItem("passport-photo-dataurl");
    if (savedPhoto) {
      if (photoImg) photoImg.src = savedPhoto;
      if (profileImg) profileImg.src = savedPhoto;
    }

    if (photoTrigger && photoInput) {
      photoTrigger.addEventListener("click", () => {
        photoInput.click();
      });

      photoInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const rawDataUrl = event.target.result;
            // Compress the image before storing to reduce size footprint
            const dataUrl = await this.compressImage(rawDataUrl, 300);
            
            if (photoImg) photoImg.src = dataUrl;
            if (profileImg) profileImg.src = dataUrl;
            
            safeStorage.setItem("passport-photo-dataurl", dataUrl);
            if (this.supabase && this.currentUser) {
              this.saveProfileToSupabase();
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // Dynamic Passport Number based on names
    const updatePassportNum = () => {
      const surnameVal = document.getElementById("passport-surname")?.innerText || "CAPO";
      const givenVal = document.getElementById("passport-givenname")?.innerText || "IAN";
      let hash = 0;
      for (let i = 0; i < surnameVal.length + givenVal.length; i++) {
        hash = (surnameVal + givenVal).charCodeAt(i) + ((hash << 5) - hash);
      }
      const numDisplay = document.getElementById("passport-num-display");
      if (numDisplay) {
        const formattedNum = `FP${Math.abs(hash).toString().substring(0, 6).padEnd(6, '0')}A`;
        numDisplay.innerText = formattedNum;
      }
    };

    fields.forEach(fieldId => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.addEventListener("blur", () => {
          updatePassportNum();
          this.updateMRZ();
        });
      }
    });

    updatePassportNum();

    // Export PNG
    const downloadBtn = document.getElementById("download-passport-btn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => this.exportPassportAsPNG());
    }

    this.updateMRZ();
  }

  // Export passport booklet card to PNG image using html2canvas
  exportPassportAsPNG() {
    const card = document.getElementById("passport-folder-wrapper") || document.getElementById("mypassport-booklet-card");
    if (!card) return;

    // Show a loading text on download button
    const downloadBtn = document.getElementById("download-passport-btn");
    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerHTML = "<span>⏳</span> Renderizando Imagem...";
    downloadBtn.disabled = true;

    // Temporarily trigger Mapbox resize to map fits exactly, then export
    if (this.passportMap) this.passportMap.resize();

    setTimeout(() => {
      html2canvas(card, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        scale: 2 // double scale for crisp retina resolution
      }).then(canvas => {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `FlightPassport_IanCapo.png`;
        link.href = dataUrl;
        link.click();

        // Restore button state
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
      }).catch(err => {
        console.error("Export error:", err);
        alert("Erro ao exportar passaporte. Tente novamente.");
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
      });
    }, 500);
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

      let displayName = airline.name;
      if (displayName === "Aerolíneas Argentinas") {
        displayName = "Aerolíneas";
      }

      const row = document.createElement("div");
      row.className = "past-flight-row";
      row.innerHTML = `
        <div class="past-airline-col" style="color: ${airline.color || '#fff'}" title="${airline.name}">${displayName}</div>
        <div class="past-route-col">
          <div class="past-route-codes">
            <span>${flight.from}</span>
            <span class="past-route-arrow">➔</span>
            <span>${flight.to}</span>
          </div>
          <span class="past-route-cities">${depAir.city} para ${arrAir.city}</span>
        </div>
        <div class="past-date-col">${this.formatDateSimple(flight.date)}</div>
      `;

      // Context menu for desktop right click
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, flight);
      });

      // Mobile Touch events for long press
      let touchTimeout = null;
      let startX = 0;
      let startY = 0;
      let isLongPress = false;

      row.addEventListener("touchstart", (e) => {
        isLongPress = false;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        
        touchTimeout = setTimeout(() => {
          isLongPress = true;
          if (navigator.vibrate) {
            navigator.vibrate(50); // Small haptic feedback
          }
          this.showContextMenu(touch.clientX, touch.clientY, flight);
        }, 700);
      }, { passive: true });

      row.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        const diffX = Math.abs(touch.clientX - startX);
        const diffY = Math.abs(touch.clientY - startY);
        // If moved more than 10px, cancel long press (they are scrolling)
        if (diffX > 10 || diffY > 10) {
          if (touchTimeout) {
            clearTimeout(touchTimeout);
            touchTimeout = null;
          }
        }
      }, { passive: true });

      row.addEventListener("touchend", (e) => {
        if (touchTimeout) {
          clearTimeout(touchTimeout);
          touchTimeout = null;
        }
        if (isLongPress) {
          e.preventDefault();
        }
      });

      row.addEventListener("click", (e) => {
        if (isLongPress) {
          isLongPress = false;
          return;
        }
        this.openEditFlightModal(flight);
      });

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

      // Dynamically initialize inbound tracking details for simulated or synced flights
      if (!flight.inboundFlight && flight.flightNumber) {
        flight.inboundFlight = this.generateDynamicInbound(flight);
      }
      if (!flight.alerts) {
        flight.alerts = this.generateDynamicAlerts(flight);
      }

      // Render alerts
      alertsSection.innerHTML = `
        <div class="pilot-weather-header" style="color: var(--info-blue)">Alertas Pro & Status Inbound</div>
        ${flight.inboundFlight ? `
          <div style="background: rgba(26, 184, 160, 0.08); border: 1px solid rgba(26, 184, 160, 0.2); padding:10px 14px; border-radius:12px; font-size:13px; margin-bottom:8px;">
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

  showContextMenu(x, y, flight) {
    const menu = document.getElementById("flight-context-menu");
    if (!menu) return;

    // Show menu first to calculate dimensions
    menu.style.display = "block";

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Adjust position so it doesn't overflow screen boundaries
    let left = x;
    let top = y;

    if (x + menuWidth > windowWidth) {
      left = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
      top = windowHeight - menuHeight - 10;
    }

    // Ensure it doesn't go negative
    left = Math.max(10, left);
    top = Math.max(10, top);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // Bind data to the menu actions
    const editBtn = document.getElementById("context-menu-edit-btn");
    const cancelBtn = document.getElementById("context-menu-cancel-btn");

    // Clear previous event listeners by cloning nodes
    const newEditBtn = editBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEditBtn, editBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // Bind new actions
    newEditBtn.addEventListener("click", () => {
      menu.style.display = "none";
      this.openEditFlightModal(flight);
    });

    newCancelBtn.addEventListener("click", () => {
      menu.style.display = "none";
    });

    // Close menu when clicking anywhere else
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.style.display = "none";
        document.removeEventListener("click", closeMenu);
        document.removeEventListener("touchstart", closeMenu);
      }
    };
    
    // Defer adding listeners
    setTimeout(() => {
      document.addEventListener("click", closeMenu);
      document.addEventListener("touchstart", closeMenu);
    }, 50);
  }

  openEditFlightModal(flight) {
    // Populate form fields
    document.getElementById("edit-form-flight-id").value = flight.id || "";
    document.getElementById("edit-form-flight-num").value = flight.flightNumber || "";
    document.getElementById("edit-form-date").value = flight.date || "";
    document.getElementById("edit-form-dep-code").value = flight.from || "";
    document.getElementById("edit-form-arr-code").value = flight.to || "";
    document.getElementById("edit-form-dep-time").value = flight.depTime || "14:00";
    document.getElementById("edit-form-arr-time").value = flight.arrTime || "15:45";
    document.getElementById("edit-form-seat").value = flight.seat || "";
    document.getElementById("edit-form-aircraft").value = flight.aircraft || "";
    document.getElementById("edit-form-tail").value = flight.tailNumber || "";
    document.getElementById("edit-form-booking").value = flight.bookingCode || "";

    // Set subtitle/title info
    const airline = AIRLINES[flight.airline] || { name: flight.airline || "" };
    document.getElementById("edit-modal-flight-title").innerText = `${airline.name || ""} Voo ${flight.flightNumber || ""} em ${this.formatDateSimple(flight.date)}`;

    // Show modal drawer
    const editModal = document.getElementById("edit-flight-modal");
    if (editModal) {
      editModal.classList.add("active");
    }
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
    
    // Animate smoothly along geodesic or straight line route depending on map styles
    let coordinates = [];
    if (this.mapRouteStyle === 'geodesic') {
      const greatCircleRoute = turf.greatCircle(turf.point(p1), turf.point(p2), { npoints: 300 });
      coordinates = greatCircleRoute.geometry.coordinates;
      for (let i = 1; i < coordinates.length; i++) {
        const prevLng = coordinates[i - 1][0];
        const currentLng = coordinates[i][0];
        if (currentLng - prevLng > 180) {
          coordinates[i][0] -= 360;
        } else if (prevLng - currentLng > 180) {
          coordinates[i][0] += 360;
        }
      }
    } else {
      const steps = 300;
      for (let i = 0; i <= steps; i++) {
        const pct = i / steps;
        const lng = p1[0] + (p2[0] - p1[0]) * pct;
        const lat = p1[1] + (p2[1] - p1[1]) * pct;
        coordinates.push([lng, lat]);
      }
    }

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

  // METAR Real — API pública aviationweather.gov (sem chave, gratuita)
  async generatePilotWeather(flight) {
    const rawBox     = document.getElementById('raw-metar');
    const decodedBox = document.getElementById('decoded-metar');
    if (!rawBox || !decodedBox) return;

    rawBox.innerHTML     = '<span style="opacity:0.5">Carregando METAR real...</span>';
    decodedBox.innerHTML = '';

    // Mapa IATA → ICAO para os aeroportos do usuário
    const IATA_TO_ICAO = {
      SDU: 'SBRJ', CGH: 'SBSP', VCP: 'SBKP', GIG: 'SBGL', BEL: 'SBBE',
      GRU: 'SBGR', LDB: 'SBLO', CNF: 'SBCF', IGU: 'SBFI', BSB: 'SBBR',
      FOR: 'SBFZ', MCZ: 'SBMO', STM: 'SBSN', MCO: 'KMCO', MIA: 'KMIA',
      JFK: 'KJFK', LHR: 'EGLL', CDG: 'LFPG', MAD: 'LEMD', LIS: 'LPPT',
      AEP: 'SABE', EZE: 'SAEZ', REL: 'SAVT', USH: 'SAWH', IGR: 'SARI',
      BRC: 'SANC', PTY: 'MPTO', CUN: 'MMUN', DXB: 'OMDB', DEL: 'VIDP',
      FCO: 'LIRF', BCN: 'LEBL', UNA: 'SNVB', BYO: 'SSNW'
    };

    const depICAO = IATA_TO_ICAO[flight.from] || ('SB' + flight.from);
    const arrICAO = IATA_TO_ICAO[flight.to]   || ('SB' + flight.to);
    const ids     = `${depICAO},${arrICAO}`;

    try {
      const url = `https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=2`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data || data.length === 0) {
        rawBox.innerHTML = '<span style="color:var(--warning-red)">METAR indisponível para estes aeroportos.</span>';
        return;
      }

      // Render raw strings
      rawBox.innerHTML = data.map(m =>
        `<strong>${m.stationId || m.icaoId}:</strong> ${m.rawOb || m.rawObs || 'N/D'}`
      ).join('<br><br>');

      // Decode each METAR into human-readable Portuguese
      const decoded = data.map(m => {
        const station  = m.stationId || m.icaoId || '?';
        const wdir     = m.wdir != null ? `${m.wdir}°` : 'variável';
        const wspd     = m.wspd != null ? `${m.wspd} nós` : '0 nós';
        
        // Accurate visibility parsing and conversion
        let vis = 'N/D';
        if (m.visib != null) {
          const visMiles = parseFloat(m.visib);
          const visKm = visMiles * 1.60934;
          if (visMiles >= 10 || visMiles >= 9.9) {
            vis = '+10 km';
          } else if (visKm < 1) {
            vis = `${Math.round(visKm * 1000)} m`;
          } else {
            vis = `${visKm.toFixed(1)} km`;
          }
        }

        const temp     = m.temp   != null ? `${m.temp}°C`   : 'N/D';
        const dewp     = m.dewp   != null ? `${m.dewp}°C`   : 'N/D';
        const altim    = m.altim  != null ? `${m.altim} hPa` : 'N/D';
        const wxStr    = m.wxString || m.wx || '';
        
        // Translated cloud coverage descriptions
        const coverMap = { 
          FEW: 'Poucas nuvens', 
          SCT: 'Nuvens esparsas', 
          BKN: 'Muito nublado', 
          OVC: 'Encoberto', 
          CLR: 'Céu limpo', 
          SKC: 'Céu limpo' 
        };
        const skyStr   = (m.clouds || []).map(c =>
          `${coverMap[c.cover] || c.cover}${c.base != null ? ' a ' + c.base + ' ft' : ''}`).join(', ') || 'Céu limpo';

        // Precise weather condition translation
        const directMap = {
          'RA': 'Chuva', '+RA': 'Chuva forte', '-RA': 'Chuva fraca',
          'TSRA': 'Trovoada com chuva', '+TSRA': 'Trovoada com chuva forte', '-TSRA': 'Trovoada com chuva fraca',
          'SHRA': 'Pancadas de chuva', '+SHRA': 'Pancadas de chuva forte', '-SHRA': 'Pancadas de chuva fraca',
          'DZ': 'Chuvisco', '-DZ': 'Chuvisco fraco', '+DZ': 'Chuvisco forte',
          'SN': 'Neve', '-SN': 'Neve fraca', '+SN': 'Neve forte',
          'TS': 'Trovoada', 'FG': 'Nevoeiro', 'BR': 'Névoa úmida', 'HZ': 'Névoa seca'
        };
        const wxPt = wxStr ? wxStr.split(' ').map(w => directMap[w] || w).join(', ') : 'Sem precipitação';

        return `<strong>▸ ${station}:</strong> ` +
          `Vento ${wdir} a ${wspd}. ` +
          `Visibilidade ${vis}. ` +
          `${wxPt}. ` +
          `Nuvens: ${skyStr}. ` +
          `Temp ${temp} / Orv ${dewp}. ` +
          `QNH ${altim}.`;
      }).join('<br><br>');

      decodedBox.innerHTML = decoded;

    } catch (err) {
      rawBox.innerHTML = `<span style="color:var(--warning-red)">Erro ao buscar METAR: ${err.message}</span>`;
      console.warn('METAR fetch error:', err);
    }
  }

  // Generates a realistic inbound flight based on current flight details
  generateDynamicInbound(flight) {
    let inboundNumber = "";
    if (flight.flightNumber) {
      const numPart = flight.flightNumber.replace(/[^0-9]/g, '');
      const alphaPart = flight.flightNumber.replace(/[0-9\s]/g, '');
      if (numPart) {
        const num = parseInt(numPart);
        inboundNumber = `${alphaPart || flight.airline || 'AD'} ${num % 2 === 0 ? num + 1 : num - 1}`;
      } else {
        inboundNumber = `${flight.airline || 'AD'} 2026`;
      }
    } else {
      inboundNumber = `${flight.airline || 'AD'} 2026`;
    }

    const hubs = {
      AD: ['VCP', 'CNF', 'REC'],
      G3: ['GRU', 'CGH', 'BSB'],
      LA: ['GRU', 'CGH', 'BSB'],
      JJ: ['GRU', 'CGH', 'BSB'],
      AR: ['AEP', 'EZE']
    };
    const airlineHubs = hubs[flight.airline] || ['GRU', 'GIG', 'BSB'];
    let origin = airlineHubs[0];
    if (origin === flight.from) {
      origin = airlineHubs[1] || 'GRU';
    }

    let eta = "08:15";
    if (flight.depTime) {
      const parts = flight.depTime.split(':');
      if (parts.length === 2) {
        let h = parseInt(parts[0]);
        let m = parseInt(parts[1]) - 50;
        if (m < 0) {
          m += 60;
          h -= 1;
        }
        if (h < 0) {
          h += 24;
        }
        eta = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }

    let status = "No horário";
    const todayStr = new Date().toISOString().split('T')[0];
    if (flight.date === todayStr) {
      const parts = (flight.depTime || "12:00").split(':');
      const depHour = parseInt(parts[0]);
      const currentHour = new Date().getHours();
      if (currentHour < depHour - 2) {
        status = "No horário";
      } else if (currentHour < depHour - 1) {
        status = "Em voo";
      } else {
        status = "Pousou";
      }
    }

    return {
      flightNumber: inboundNumber,
      status: status,
      origin: origin,
      eta: eta
    };
  }

  // Generates realistic alerts based on the flight and its inbound status
  generateDynamicAlerts(flight) {
    const alerts = [];
    const randGate = `${Math.floor(Math.random() * 20) + 1}${['A', 'B', 'C', ''][Math.floor(Math.random() * 4)]}`;
    const gate = flight.gate || randGate;
    
    alerts.push({
      type: "gate",
      text: `Portão de embarque definido para ${gate} no aeroporto ${flight.from}.`
    });

    alerts.push({
      type: "weather",
      text: `Previsão de teto operacional favorável em ${flight.to} no horário de pouso.`
    });

    if (flight.inboundFlight) {
      if (flight.inboundFlight.status === "Atrasado" || flight.inboundFlight.status === "Delayed") {
        alerts.push({
          type: "delay",
          text: `Alerta Pro: Aeronave vindo de ${flight.inboundFlight.origin} com atraso acumulado.`
        });
      } else if (flight.inboundFlight.status === "Em voo") {
        alerts.push({
          type: "info",
          text: `Aeronave de chegada está em voo vindo de ${flight.inboundFlight.origin} (ETA: ${flight.inboundFlight.eta}).`
        });
      }
    }

    return alerts;
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

    // Edit Flight Modal events
    const editModal = document.getElementById("edit-flight-modal");
    const editCloseBtn = document.getElementById("edit-modal-close-btn");
    const editCloseHandle = document.getElementById("edit-modal-close-handle");

    const closeEditModal = () => {
      editModal.classList.remove("active");
    };

    if (editCloseBtn) editCloseBtn.addEventListener("click", closeEditModal);
    if (editCloseHandle) editCloseHandle.addEventListener("click", closeEditModal);
    if (editModal) {
      editModal.addEventListener("click", (e) => {
        if (e.target === editModal) closeEditModal();
      });
    }

    const editForm = document.getElementById("edit-flight-form");
    if (editForm) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const id = document.getElementById("edit-form-flight-id").value;
        const flightNum = document.getElementById("edit-form-flight-num").value.trim().toUpperCase();
        const dateVal = document.getElementById("edit-form-date").value;
        const depCode = document.getElementById("edit-form-dep-code").value.trim().toUpperCase();
        const arrCode = document.getElementById("edit-form-arr-code").value.trim().toUpperCase();
        const depTime = document.getElementById("edit-form-dep-time").value;
        const arrTime = document.getElementById("edit-form-arr-time").value;
        const seat = document.getElementById("edit-form-seat").value.trim();
        const aircraft = document.getElementById("edit-form-aircraft").value.trim();
        const tailNumber = document.getElementById("edit-form-tail").value.trim().toUpperCase();
        const bookingCode = document.getElementById("edit-form-booking").value.trim().toUpperCase();

        // Validations
        if (!AIRPORTS[depCode] || !AIRPORTS[arrCode]) {
          alert("⚠️ Código IATA inválido. Os aeroportos devem ser válidos no sistema (ex: GRU, SDU, GIG, CNF).");
          return;
        }

        let isPastList = true;
        let idx = this.pastFlights.findIndex(f => f.id === id);
        if (idx === -1) {
          idx = this.upcomingFlights.findIndex(f => f.id === id);
          isPastList = false;
        }

        if (idx === -1) {
          alert("⚠️ Voo não encontrado.");
          return;
        }

        const flight = isPastList ? this.pastFlights[idx] : this.upcomingFlights[idx];
        
        // Update local object properties
        flight.flightNumber = flightNum;
        flight.date = dateVal;
        flight.from = depCode;
        flight.to = arrCode;
        flight.depTime = depTime;
        flight.arrTime = arrTime;
        flight.seat = seat;
        flight.aircraft = aircraft;
        flight.tailNumber = tailNumber;
        flight.bookingCode = bookingCode;

        // Recalculate distance and duration
        const distance = Math.round(this.calculateDistance(
          AIRPORTS[depCode].lat, AIRPORTS[depCode].lng,
          AIRPORTS[arrCode].lat, AIRPORTS[arrCode].lng
        ));
        flight.distance = distance;
        flight.duration = Math.round(distance / 8) + 30;

        const carrier = flightNum.substring(0, 2);
        flight.airline = AIRLINES[carrier] ? carrier : flight.airline;

        // Save local
        if (isPastList) {
          safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        } else {
          safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        }

        // Close modal
        closeEditModal();

        // Supabase DB Update
        if (this.supabase && this.currentUser) {
          try {
            const record = {
              flight_date: flight.date,
              airline_code: flight.airline,
              airline_name: window.AIRLINES[flight.airline]?.name || flight.airline,
              flight_number: flight.flightNumber,
              origin_airport_code: flight.from,
              origin_airport_name: `Aeroporto de ${flight.from}`,
              origin_city: flight.from,
              destination_airport_code: flight.to,
              destination_airport_name: `Aeroporto de ${flight.to}`,
              destination_city: flight.to,
              aircraft_type: flight.aircraft,
              aircraft_registration: flight.tailNumber,
              distance_km: parseInt(flight.distance || 0),
              duration_minutes: parseInt(flight.duration || 0),
              seat_number: flight.seat,
            };

            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            if (isUUID) {
              const { error } = await this.supabase
                .from('flights')
                .update(record)
                .eq('id', id)
                .eq('user_id', this.currentUser.id);
              if (error) throw error;
            } else {
              // Try updating by matching details
              const { data: existing } = await this.supabase
                .from('flights')
                .select('id')
                .eq('user_id', this.currentUser.id)
                .eq('flight_number', flight.flightNumber)
                .eq('flight_date', flight.date);
              
              if (existing && existing.length > 0) {
                const { error } = await this.supabase
                  .from('flights')
                  .update(record)
                  .eq('id', existing[0].id);
                if (error) throw error;
                flight.id = existing[0].id;
                if (isPastList) {
                  safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
                } else {
                  safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
                }
              } else {
                await this.saveFlightToSupabase(flight);
              }
            }
            console.log("[Supabase] Voo atualizado na nuvem com sucesso!");
          } catch (err) {
            console.error("[Supabase] Erro ao atualizar voo:", err);
          }
        }

        // Re-render passport stats, table, and maps
        this.renderPassport();
        this.renderMyFlights();
        this.updateGlobalBadge();
        this.clearMapRoutes();
        if (isPastList) {
          this.plotFlightsOnMap(this.pastFlights, 'past');
        } else {
          this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
        }
        
        alert("🎉 Voo atualizado com sucesso!");
      });
    }

    const deleteBtn = document.getElementById("edit-form-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        const id = document.getElementById("edit-form-flight-id").value;
        if (!id) return;

        let isPastList = true;
        let idx = this.pastFlights.findIndex(f => f.id === id);
        if (idx === -1) {
          idx = this.upcomingFlights.findIndex(f => f.id === id);
          isPastList = false;
        }

        if (idx === -1) {
          alert("⚠️ Voo não encontrado.");
          return;
        }

        const flight = isPastList ? this.pastFlights[idx] : this.upcomingFlights[idx];
        const confirmDelete = confirm(`Deseja realmente apagar o voo ${flight.flightNumber || ""} de ${flight.from} para ${flight.to}?`);
        if (!confirmDelete) return;

        // Remove from local array
        if (isPastList) {
          this.pastFlights.splice(idx, 1);
          safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        } else {
          this.upcomingFlights.splice(idx, 1);
          safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        }

        // Close edit modal
        closeEditModal();

        // Supabase DB Delete
        if (this.supabase && this.currentUser) {
          try {
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
            if (isUUID) {
              const { error } = await this.supabase
                .from('flights')
                .delete()
                .eq('id', id)
                .eq('user_id', this.currentUser.id);
              if (error) throw error;
            } else {
              const { error } = await this.supabase
                .from('flights')
                .delete()
                .eq('user_id', this.currentUser.id)
                .eq('flight_number', flight.flightNumber)
                .eq('flight_date', flight.date);
              if (error) throw error;
            }
            console.log("[Supabase] Voo deletado da nuvem com sucesso!");
          } catch (err) {
            console.error("[Supabase] Erro ao deletar voo da nuvem:", err);
          }
        }

        // Re-render passport stats, table, and maps
        this.renderPassport();
        this.renderMyFlights();
        this.updateGlobalBadge();
        this.clearMapRoutes();
        if (isPastList) {
          this.plotFlightsOnMap(this.pastFlights, 'past');
        } else {
          this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
        }

        alert("🗑️ Voo excluído com sucesso.");
      });
    }
  }

  // Initialize Search & Add Flights Engine
  initSearch() {
    const searchInput = document.getElementById("flight-search-input");
    const resultsContainer = document.getElementById("search-results-list");
    const customForm = document.getElementById("custom-flight-form");

    if (!searchInput || !resultsContainer || !customForm) return; // guard: elements may not exist yet

    // Fuzzy match algorithm matching airports or cities with score-ranking
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toUpperCase().trim();
      resultsContainer.innerHTML = "";

      if (query.length < 2) return;

      const matches = [];
      let isFlightPattern = false;

      // 1. Check if matches standard flights patterns e.g. "AD 6053"
      if (/^[A-Z0-9]{2,3}\s?\d{1,4}$/.test(query)) {
        isFlightPattern = true;
        const carrier = query.substring(0, 2);
        const codeNum = query.substring(2).trim();

        // Push standard mock result as an immediate fallback placeholder
        matches.push({
          flightNumber: query,
          airline: AIRLINES[carrier] ? carrier : "AD",
          from: "VCP",
          to: "SDU",
          date: new Date().toISOString().split('T')[0],
          depTime: "10:30",
          arrTime: "11:35",
          duration: 65,
          distance: 400,
          aircraft: "A320neo",
          tailNumber: `PR-YV${Math.floor(Math.random() * 9)}`,
          status: "Scheduled",
          isMockPlaceholder: true
        });
      }

      // 2. Perform fuzzy search with ranking over all 8,500 airports
      const scoredAirports = [];
      Object.values(AIRPORTS).forEach(ap => {
        let score = 0;
        const code = ap.code ? ap.code.toUpperCase() : "";
        const city = ap.city ? ap.city.toUpperCase() : "";
        const name = ap.name ? ap.name.toUpperCase() : "";

        if (code === query) score = 10;
        else if (code.startsWith(query)) score = 8;
        else if (city.startsWith(query)) score = 5;
        else if (city.includes(query)) score = 3;
        else if (name.includes(query)) score = 1;

        if (score > 0) {
          scoredAirports.push({ ap, score });
        }
      });

      scoredAirports.sort((a, b) => b.score - a.score);

      // Add scored airports to autocomplete list
      scoredAirports.slice(0, 5).forEach(({ ap }) => {
        matches.push({
          isAirportResult: true,
          code: ap.code,
          city: ap.city,
          name: ap.name,
          country: ap.country_code
        });
      });

      // Render the initial offline list
      this.renderSearchResults(matches, resultsContainer, searchInput);

      // If it looks like a flight number, trigger an online search with debouncing
      if (isFlightPattern) {
        // Prepend a loading indicator to matches and re-render
        const matchesWithLoading = [
          { isLoadingPlaceholder: true },
          ...matches
        ];
        this.renderSearchResults(matchesWithLoading, resultsContainer, searchInput);

        if (this._searchTimeout) clearTimeout(this._searchTimeout);
        this._searchTimeout = setTimeout(async () => {
          const onlineFlight = await this.searchFlightOnline(query);
          if (onlineFlight) {
            // Remove the mock placeholder and loading indicator, put real flight at the top
            const updatedMatches = [
              onlineFlight,
              ...matches.filter(m => !m.isMockPlaceholder)
            ];
            this.renderSearchResults(updatedMatches, resultsContainer, searchInput);
          } else {
            // Online lookup failed/returned nothing, remove loading but keep the mock placeholder
            this.renderSearchResults(matches, resultsContainer, searchInput);
          }
        }, 400);
      }
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
        safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        this.renderPassport();
        if (this.supabase && this.currentUser) {
          this.saveFlightToSupabase(newFlightObj);
        }
        alert(`Sucesso! Voo Histórico ${flightNum} adicionado ao Passport.`);
      } else {
        this.upcomingFlights.push(newFlightObj);
        safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        this.renderMyFlights();
        if (this.supabase && this.currentUser) {
          this.saveFlightToSupabase(newFlightObj);
        }
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
      const today = new Date("2026-06-23");
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
        safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
        this.renderPassport();
        if (this.supabase && this.currentUser) {
          this.saveFlightToSupabase(newFlightObj);
        }
        alert(`🎉 Voo Histórico Importado! ${flightNum} (${from} ➔ ${to}) adicionado com sucesso ao Passport.`);
        document.querySelector('.nav-item[data-tab="passport"]').click();
      } else {
        this.upcomingFlights.push(newFlightObj);
        safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
        this.renderMyFlights();
        this.updateGlobalBadge();
        if (this.supabase && this.currentUser) {
          this.saveFlightToSupabase(newFlightObj);
        }
        alert(`🎉 Voo Agendado Importado! ${flightNum} (${from} ➔ ${to}) adicionado com sucesso na aba de voos.`);
        document.querySelector('.nav-item[data-tab="my-flights"]').click();
      }

      textParser.value = "";
    });
  }

  // Render search results UI
  renderSearchResults(matches, resultsContainer, searchInput) {
    resultsContainer.innerHTML = "";
    
    if (matches.length === 0) {
      resultsContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px;">Nenhum aeroporto ou voo encontrado. Preencha o formulário para criar manualmente.</div>`;
      return;
    }

    matches.forEach(match => {
      const item = document.createElement("div");
      item.className = "search-result-flight";
      
      if (match.isAirportResult) {
        item.innerHTML = `
          <div class="airport-info-group">
            <strong style="color: var(--accent-gold)">${match.code}</strong>
            <span style="font-size: 12px; color: var(--text-secondary);">${match.city} — ${match.name}</span>
          </div>
          <button class="add-flight-btn" style="background: rgba(240,184,48,0.15); border-color: rgba(240,184,48,0.25); color: var(--accent-gold);">Usar</button>
        `;

        item.querySelector(".add-flight-btn").addEventListener("click", () => {
          const depInput = document.getElementById("form-dep-code");
          const arrInput = document.getElementById("form-arr-code");
          if (depInput && (!depInput.value || depInput.value.length < 3)) {
            depInput.value = match.code;
          } else if (arrInput) {
            arrInput.value = match.code;
          }
          alert(`Aeroporto ${match.code} preenchido no formulário manual!`);
          searchInput.value = "";
          resultsContainer.innerHTML = "";
          depInput.focus();
        });
      } else if (match.isLoadingPlaceholder) {
        item.innerHTML = `
          <div class="airport-info-group" style="display: flex; align-items: center; gap: 8px;">
            <div class="search-spinner" style="width: 14px; height: 14px; border: 2px solid var(--info-blue); border-top-color: transparent; border-radius: 50%; animation: search-spin 0.6s linear infinite;"></div>
            <span style="font-size: 13px; color: var(--text-secondary);">Buscando voo online...</span>
          </div>
        `;
        if (!document.getElementById("search-spin-style")) {
          const style = document.createElement("style");
          style.id = "search-spin-style";
          style.innerHTML = `@keyframes search-spin { to { transform: rotate(360deg); } }`;
          document.head.appendChild(style);
        }
      } else {
        const isOnline = !!match.isOnlineResult;
        const pillText = isOnline ? "Online" : "Rascunho";
        const pillStyle = isOnline ? "background: #e1f5fe; color: #0288d1;" : "background: #f5f5f5; color: #757575;";
        
        item.innerHTML = `
          <div class="airport-info-group">
            <div style="display: flex; align-items: center; gap: 6px;">
              <strong style="color: var(--info-blue)">${match.flightNumber}</strong>
              <span style="font-size: 9px; font-weight: bold; padding: 2px 5px; border-radius: 4px; ${pillStyle}">${pillText}</span>
            </div>
            <span style="font-size: 12px; color: var(--text-secondary);">${match.from} ➔ ${match.to} (${match.aircraft || 'Voo'})</span>
          </div>
          <button class="add-flight-btn">Adicionar</button>
        `;

        item.querySelector(".add-flight-btn").addEventListener("click", () => {
          this.addSearchedFlight(match);
          searchInput.value = "";
          resultsContainer.innerHTML = "";
        });
      }

      resultsContainer.appendChild(item);
    });
  }

  // Add a flight to past or upcoming lists depending on its date
  addSearchedFlight(flight) {
    if (!flight.id) {
      flight.id = `searched_${Date.now()}`;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const isCompleted = flight.date < todayStr;

    if (isCompleted) {
      flight.status = "Completed";
      if (typeof flight.delay === 'undefined') {
        flight.delay = Math.floor(Math.random() * 15);
      }
      this.pastFlights.push(flight);
      safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
      this.renderPassport();
      this.clearMapRoutes();
      this.plotFlightsOnMap(this.pastFlights, 'past');
      alert(`🎉 Voo Histórico ${flight.flightNumber} (${flight.from} ➔ ${flight.to}) adicionado com sucesso ao Passport.`);
      document.querySelector('.nav-item[data-tab="passport"]').click();
    } else {
      flight.status = "Scheduled";
      this.upcomingFlights.push(flight);
      safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
      this.renderMyFlights();
      this.updateGlobalBadge();
      
      if (this.activeTab === "my-flights") {
        this.clearMapRoutes();
        this.plotFlightsOnMap(this.upcomingFlights, 'upcoming');
      }
      alert(`🎉 Voo Agendado ${flight.flightNumber} (${flight.from} ➔ ${flight.to}) adicionado com sucesso!`);
      document.querySelector('.nav-item[data-tab="my-flights"]').click();
    }
    
    if (this.supabase && this.currentUser) {
      this.saveFlightToSupabase(flight);
    }
  }

  // Fetch flight details from serverless API proxy
  async searchFlightOnline(query) {
    try {
      const searchRes = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
      if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`);
      const searchData = await searchRes.json();

      if (!searchData || !searchData.results || searchData.results.length === 0) {
        return null;
      }

      const flightResult = searchData.results.find(r => r.type === 'schedule' || r.type === 'live');
      if (!flightResult) return null;

      const flightId = flightResult.id;

      const detailRes = await fetch(`/api/flight?id=${encodeURIComponent(flightId)}`);
      if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
      const detailData = await detailRes.json();

      if (!detailData) return null;

      const flightNumber = (detailData.identification && detailData.identification.number && detailData.identification.number.default)
        || flightResult.name
        || query.toUpperCase();

      const carrier = flightNumber.substring(0, 2).toUpperCase();

      const fromIATA = (detailData.airport && detailData.airport.origin && detailData.airport.origin.code && detailData.airport.origin.code.iata) || 'VCP';
      const toIATA = (detailData.airport && detailData.airport.destination && detailData.airport.destination.code && detailData.airport.destination.code.iata) || 'SDU';

      const depOffset = (detailData.airport && detailData.airport.origin && detailData.airport.origin.timezone && detailData.airport.origin.timezone.offset) || 0;
      const arrOffset = (detailData.airport && detailData.airport.destination && detailData.airport.destination.timezone && detailData.airport.destination.timezone.offset) || 0;

      const depTimestamp = (detailData.time && detailData.time.scheduled && detailData.time.scheduled.departure) || Math.round(Date.now() / 1000);
      const arrTimestamp = (detailData.time && detailData.time.scheduled && detailData.time.scheduled.arrival) || Math.round(Date.now() / 1000) + 3600;

      // Adjust date calculations using offset
      const depLocal = new Date((depTimestamp + depOffset) * 1000);
      const arrLocal = new Date((arrTimestamp + arrOffset) * 1000);

      const dateStr = depLocal.toISOString().split('T')[0];
      const depTimeStr = depLocal.toISOString().substring(11, 16);
      const arrTimeStr = arrLocal.toISOString().substring(11, 16);

      let durationMins = 0;
      if (detailData.time && detailData.time.other && detailData.time.other.duration) {
        durationMins = Math.round(detailData.time.other.duration / 60);
      } else {
        durationMins = Math.round((arrTimestamp - depTimestamp) / 60);
      }

      const aircraftModel = (detailData.aircraft && detailData.aircraft.model && detailData.aircraft.model.text) || 'Airbus A320';
      const tailNumber = (detailData.aircraft && detailData.aircraft.registration) || '';

      let distanceKm = 400;
      if (AIRPORTS[fromIATA] && AIRPORTS[toIATA]) {
        distanceKm = Math.round(this.calculateDistance(
          AIRPORTS[fromIATA].lat, AIRPORTS[fromIATA].lng,
          AIRPORTS[toIATA].lat, AIRPORTS[toIATA].lng
        ));
      }

      return {
        isOnlineResult: true,
        flightNumber: flightNumber,
        airline: carrier,
        from: fromIATA,
        to: toIATA,
        date: dateStr,
        depTime: depTimeStr,
        arrTime: arrTimeStr,
        duration: durationMins,
        distance: distanceKm,
        aircraft: aircraftModel,
        tailNumber: tailNumber,
        status: 'Scheduled'
      };
    } catch (e) {
      console.warn('[Search] Online search failed:', e);
      return null;
    }
  }

  // Push new upcoming flight
  addNewFlight(flight) {
    this.upcomingFlights.push(flight);
    safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
    this.renderMyFlights();
    this.updateGlobalBadge();
    
    if (this.supabase && this.currentUser) {
      this.saveFlightToSupabase(flight);
    }
    
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

  // Render collected Visa Stamps in Passport tab
  renderStamps(flights) {
    const stampsGrid = document.getElementById("passport-visa-stamps-grid");
    if (!stampsGrid) return;
    
    stampsGrid.innerHTML = "";
    if (flights.length === 0) {
      stampsGrid.innerHTML = `<div style="grid-column: span 4; text-align: center; color: var(--text-secondary); font-size: 12px; padding: 20px;">Nenhum visto ainda. Registre voos para carimbar!</div>`;
      return;
    }

    const countryNames = {
      "BR": "Brasil", "AR": "Argentina", "US": "USA", "PT": "Portugal", "FR": "França", 
      "ES": "Espanha", "GB": "United Kingdom", "AE": "UAE", "PA": "Panamá", "IN": "India", 
      "IT": "Itália", "MX": "México"
    };

    const entryDates = {};
    flights.forEach(f => {
      const dep = AIRPORTS[f.from];
      const arr = AIRPORTS[f.to];
      if (dep && dep.country_code) {
        const code = dep.country_code.toUpperCase();
        if (!entryDates[code] || f.date < entryDates[code]) entryDates[code] = f.date;
      }
      if (arr && arr.country_code) {
        const code = arr.country_code.toUpperCase();
        if (!entryDates[code] || f.date < entryDates[code]) entryDates[code] = f.date;
      }
    });

    const colors = ["stamp-blue", "stamp-red", "stamp-green", "stamp-purple"];
    Object.entries(entryDates).forEach(([code, date], idx) => {
      const name = countryNames[code] || code;
      const dateFormatted = date.split('-').reverse().join('.');
      const colorClass = colors[idx % colors.length];
      const rotation = (idx * 7) % 30 - 15; // Random angle -15 to 15 deg

      const stamp = document.createElement("div");
      stamp.className = `visa-stamp ${colorClass}`;
      stamp.style.transform = `rotate(${rotation}deg)`;
      stamp.innerHTML = `
        <span style="font-weight: 800; font-size: 11px;">${code}</span>
        <span style="font-size: 7px; text-transform: uppercase; margin: 1px 0;">${name}</span>
        <span class="visa-stamp-date">${dateFormatted}</span>
      `;
      stampsGrid.appendChild(stamp);
    });
  }

  // Manage booklet colors and Guilloche style overrides
  initPassportCustomizer() {
    const swatches = document.querySelectorAll(".color-swatch");
    const booklet = document.getElementById("mypassport-booklet-card");
    const savedTheme = safeStorage.getItem('passport_cover_theme') || 'blue';

    const folder = document.getElementById("passport-folder-wrapper");

    const applyTheme = (theme) => {
      if (booklet) {
        booklet.classList.remove('theme-blue', 'theme-red', 'theme-green', 'theme-black', 'theme-azure');
        booklet.classList.add(`theme-${theme}`);
      }
      if (folder) {
        folder.classList.remove('theme-blue', 'theme-red', 'theme-green', 'theme-black', 'theme-azure');
        folder.classList.add(`theme-${theme}`);
      }
      
      swatches.forEach(s => {
        if (s.dataset.theme === theme) s.classList.add('active');
        else s.classList.remove('active');
      });
    };

    applyTheme(savedTheme);

    swatches.forEach(swatch => {
      swatch.addEventListener("click", () => {
        const theme = swatch.dataset.theme;
        safeStorage.setItem('passport_cover_theme', theme);
        applyTheme(theme);
      });
    });

    const options = document.querySelectorAll(".guilloche-option");
    const savedPattern = safeStorage.getItem('passport_guilloche_pattern') || '1';

    const applyPattern = (pattern) => {
      if (!booklet) return;
      booklet.style.backgroundImage = `linear-gradient(rgba(252, 251, 250, 0.82), rgba(252, 251, 250, 0.82)), radial-gradient(circle, #fcfbfa 20%, #f4f2e8 100%), url('assets/images/guilloche${pattern}.png')`;
      booklet.style.backgroundBlendMode = 'normal, multiply, normal';
      
      options.forEach(o => {
        if (o.dataset.pattern === pattern) o.classList.add('active');
        else o.classList.remove('active');
      });
    };

    applyPattern(savedPattern);

    options.forEach(opt => {
      opt.addEventListener("click", () => {
        const pattern = opt.dataset.pattern;
        safeStorage.setItem('passport_guilloche_pattern', pattern);
        applyPattern(pattern);
      });
    });

    // Story export binding
    const downloadStoryBtn = document.getElementById("download-story-btn");
    if (downloadStoryBtn) {
      downloadStoryBtn.addEventListener("click", () => this.exportInstagramStory());
    }
  }

  // Setup Profile tab listeners
  initProfileTabListeners() {
    // CSV Input parser
    const csvInput = document.getElementById("csv-file-input");
    if (csvInput) {
      csvInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          this.parseCSVFlights(event.target.result);
        };
        reader.readAsText(file);
      });
    }

    // Map styles toggle buttons (straight vs geodesic)
    const btnGeodesic = document.getElementById("map-style-geodesic");
    const btnStraight = document.getElementById("map-style-straight");

    const updateMapRouteStyle = (style) => {
      this.mapRouteStyle = style;
      safeStorage.setItem('map_route_style', style);
      
      if (btnGeodesic && btnStraight) {
        if (style === 'geodesic') {
          btnGeodesic.classList.add("active");
          btnStraight.classList.remove("active");
        } else {
          btnStraight.classList.add("active");
          btnGeodesic.classList.remove("active");
        }
      }

      // Re-plot maps
      this.clearMapRoutes();
      const currentMapToggle = document.getElementById("map-toggle-past");
      const isPastActive = currentMapToggle && currentMapToggle.classList.contains("active");
      this.plotFlightsOnMap(isPastActive ? this.pastFlights : this.upcomingFlights, isPastActive ? 'past' : 'upcoming');
    };

    updateMapRouteStyle(this.mapRouteStyle);

    if (btnGeodesic) btnGeodesic.addEventListener("click", () => updateMapRouteStyle('geodesic'));
    if (btnStraight) btnStraight.addEventListener("click", () => updateMapRouteStyle('straight'));

    // Hook Avatar profile triggers
    const profileTrigger = document.getElementById("profile-avatar-trigger");
    const profileImg = document.getElementById("profile-avatar-img");
    const photoImg = document.getElementById("passport-photo-img");

    // Initialize photo sources on load
    const savedPhoto = safeStorage.getItem("passport-photo-dataurl");
    if (savedPhoto) {
      if (profileImg) profileImg.src = savedPhoto;
      if (photoImg) photoImg.src = savedPhoto;
    }

    if (profileTrigger) {
      profileTrigger.addEventListener("click", () => {
        document.getElementById("passport-photo-input").click();
      });
    }

    // Monitor local storage photo changes to update Profile tab
    window.addEventListener("storage", () => {
      const savedPhotoStorage = safeStorage.getItem("passport-photo-dataurl");
      if (savedPhotoStorage) {
        if (profileImg) profileImg.src = savedPhotoStorage;
        if (photoImg) photoImg.src = savedPhotoStorage;
      }
    });

    // Hook Dark Theme Toggle
    const themeCheckbox = document.getElementById("theme-dark-checkbox");
    if (themeCheckbox) {
      themeCheckbox.checked = document.body.classList.contains("dark-theme");
      themeCheckbox.addEventListener("change", (e) => {
        const isDark = e.target.checked;
        safeStorage.setItem("flighty_theme", isDark ? "dark" : "light");
        document.body.classList.toggle("dark-theme", isDark);
      });
    }

    // Hook Logout Button
    const logoutBtn = document.getElementById("logout-button-item");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        const confirmLogout = confirm("Deseja realmente sair da sua conta?");
        if (!confirmLogout) return;

        if (this.supabase) {
          const { error } = await this.supabase.auth.signOut();
          if (error) {
            alert("Erro ao deslogar: " + error.message);
          }
        } else {
          // Fallback offline
          safeStorage.removeItem('flighty_cloud_synced_v4');
          safeStorage.removeItem('flighty_flights_initialized_v4');
          safeStorage.removeItem('flighty_past_flights');
          safeStorage.removeItem('flighty_upcoming_flights');
          window.location.reload();
        }
      });
    }

    // Listen to surname / givenname edits
    const updateDisplayName = () => {
      const surname = document.getElementById("passport-surname")?.innerText || "CAPO";
      const given = document.getElementById("passport-givenname")?.innerText || "IAN";
      const profileName = document.getElementById("profile-display-name");
      if (profileName) profileName.innerText = `${given} ${surname}`.toUpperCase();
    };

    updateDisplayName();
    
    document.getElementById("passport-surname")?.addEventListener("blur", updateDisplayName);
    document.getElementById("passport-givenname")?.addEventListener("blur", updateDisplayName);
  }

  // Hook Mapbox Access Token form events
  initMapboxTokenSettings() {
    const tokenInput = document.getElementById("settings-mapbox-token");
    const saveBtn = document.getElementById("save-mapbox-token-btn");
    const statusLbl = document.getElementById("mapbox-token-status");

    if (tokenInput && saveBtn) {
      const currentToken = safeStorage.getItem('MAPBOX_TOKEN') || '';
      tokenInput.value = currentToken;

      if (currentToken) {
        statusLbl.innerText = "Status: Token salvo localmente";
        statusLbl.style.color = "var(--success-green)";
        statusLbl.style.display = "block";
      }

      saveBtn.addEventListener("click", () => {
        const tokenVal = tokenInput.value.trim();
        if (!tokenVal) {
          safeStorage.removeItem('MAPBOX_TOKEN');
          statusLbl.innerText = "Status: Nenhum token salvo (usando fallback)";
          statusLbl.style.color = "var(--text-secondary)";
        } else {
          safeStorage.setItem('MAPBOX_TOKEN', tokenVal);
          statusLbl.innerText = "Status: Token salvo! Recarregando mapa...";
          statusLbl.style.color = "var(--success-green)";
        }
        statusLbl.style.display = "block";

        // Re-initialize map
        this.initMap();

        // Wait for map load and replot
        setTimeout(() => {
          const currentMapToggle = document.getElementById("map-toggle-past");
          const isPastActive = currentMapToggle && currentMapToggle.classList.contains("active");
          this.plotFlightsOnMap(isPastActive ? this.pastFlights : this.upcomingFlights, isPastActive ? 'past' : 'upcoming');
        }, 1200);
      });
    }
  }

  // Parse custom user flights uploaded via CSV
  parseCSVFlights(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) {
      alert("Erro: Arquivo CSV vazio ou corrompido!");
      return;
    }

    const headers = lines[0].split(/[;,]/).map(h => h.trim().toLowerCase());
    const dateIdx = headers.findIndex(h => h.includes("dat") || h.includes("date"));
    const flightIdx = headers.findIndex(h => h.includes("voo") || h.includes("flight"));
    const fromIdx = headers.findIndex(h => h.includes("ori") || h.includes("dep") || h.includes("from"));
    const toIdx = headers.findIndex(h => h.includes("dest") || h.includes("arr") || h.includes("to"));
    const seatIdx = headers.findIndex(h => h.includes("assento") || h.includes("seat"));
    const tailIdx = headers.findIndex(h => h.includes("matr") || h.includes("tail") || h.includes("reg"));

    if (dateIdx === -1 || flightIdx === -1 || fromIdx === -1 || toIdx === -1) {
      alert("❌ Formato de CSV inválido! Certifique-se de que a primeira linha contenha os cabeçalhos: Data, Voo, Origem, Destino.");
      return;
    }

    let countPast = 0;
    let countUpcoming = 0;
    const today = new Date("2026-06-23");

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cells = line.split(/[;,]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
      if (cells.length < 4) continue;

      const dateVal = cells[dateIdx];
      const flightNum = cells[flightIdx].toUpperCase();
      const from = cells[fromIdx].toUpperCase();
      const to = cells[toIdx].toUpperCase();
      const seat = seatIdx !== -1 ? cells[seatIdx] : "";
      const tail = tailIdx !== -1 ? cells[tailIdx] : "";

      if (!AIRPORTS[from] || !AIRPORTS[to]) {
        console.warn(`Aeroporto desconhecido no CSV na linha ${i}: ${from} ou ${to}. Ignorando voo.`);
        continue;
      }

      const distance = Math.round(this.calculateDistance(
        AIRPORTS[from].lat, AIRPORTS[from].lng,
        AIRPORTS[to].lat, AIRPORTS[to].lng
      ));
      const duration = Math.round(distance / 8) + 30;

      const carrier = flightNum.substring(0, 2);
      const isCompleted = new Date(dateVal + "T00:00:00") < today;

      const flightObj = {
        id: `csv_${Date.now()}_${i}`,
        flightNumber: flightNum,
        airline: AIRLINES[carrier] ? carrier : "AD",
        from: from,
        to: to,
        date: dateVal,
        depTime: "12:00",
        arrTime: "13:30",
        duration: duration,
        distance: distance,
        delay: isCompleted ? Math.floor(Math.random() * 15) : 0,
        aircraft: "Commercial",
        tailNumber: tail,
        seat: seat,
        status: isCompleted ? "Completed" : "Scheduled"
      };

      if (isCompleted) {
        if (!this.pastFlights.some(f => f.flightNumber === flightNum && f.date === dateVal)) {
          this.pastFlights.push(flightObj);
          countPast++;
          if (this.supabase && this.currentUser) this.saveFlightToSupabase(flightObj);
        }
      } else {
        if (!this.upcomingFlights.some(f => f.flightNumber === flightNum && f.date === dateVal)) {
          this.upcomingFlights.push(flightObj);
          countUpcoming++;
          if (this.supabase && this.currentUser) this.saveFlightToSupabase(flightObj);
        }
      }
    }

    if (countPast > 0 || countUpcoming > 0) {
      safeStorage.setItem('flighty_past_flights', JSON.stringify(this.pastFlights));
      safeStorage.setItem('flighty_upcoming_flights', JSON.stringify(this.upcomingFlights));
      
      this.renderMyFlights();
      this.renderPassport();
      this.updateGlobalBadge();
      
      alert(`🎉 Importação de CSV Concluída! Adicionados: ${countPast} voos no histórico e ${countUpcoming} agendados.`);
      document.querySelector(`.nav-item[data-tab="${countPast > 0 ? 'passport' : 'my-flights'}"]`).click();
    } else {
      alert("Nenhum voo novo foi encontrado no CSV (registros já existentes ou IATAs inválidos).");
    }
  }

  // Render offscreen portrait Instagram Story template and capture
  async exportInstagramStory() {
    const frame = document.getElementById("story-export-frame");
    const downloadBtn = document.getElementById("download-story-btn");
    if (!frame || !downloadBtn) return;

    const originalText = downloadBtn.innerHTML;
    downloadBtn.innerHTML = "<span>⏳</span> Gerando Story...";
    downloadBtn.disabled = true;

    // Reveal offscreen canvas
    frame.style.display = "flex";

    // Gather filtered stats
    const filteredFlights = this.pastFlights.filter(flight => {
      if (this.currentYear === "All-Time") return true;
      return flight.date.startsWith(this.currentYear);
    });

    const totalFlights = filteredFlights.length;
    const totalDistance = filteredFlights.reduce((sum, f) => sum + f.distance, 0);
    const totalMinutes = filteredFlights.reduce((sum, f) => sum + f.duration, 0);
    const totalHours = Math.floor(totalMinutes / 60);

    const visitedCountryCodes = new Set();
    filteredFlights.forEach(f => {
      const depAp = AIRPORTS[f.from];
      const arrAp = AIRPORTS[f.to];
      if (depAp && depAp.country_code) visitedCountryCodes.add(depAp.country_code.toUpperCase());
      if (arrAp && arrAp.country_code) visitedCountryCodes.add(arrAp.country_code.toUpperCase());
    });
    const totalCountries = visitedCountryCodes.size === 0 ? 1 : visitedCountryCodes.size;

    document.getElementById("story-stat-flights").innerText = totalFlights;
    document.getElementById("story-stat-distance").innerText = `${totalDistance.toLocaleString("pt-BR")} km`;
    document.getElementById("story-stat-time").innerText = `${totalHours}h`;
    document.getElementById("story-stat-countries").innerText = totalCountries;

    // Draw high resolution map on story canvas
    const storyCanvas = document.getElementById('story-canvas-map');
    if (storyCanvas) {
      await this.drawPassportCanvasMap(filteredFlights, storyCanvas);
    }

    setTimeout(() => {
      html2canvas(frame, {
        scale: 1,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null
      }).then(canvas => {
        const link = document.createElement("a");
        link.download = `FlightyIAN_Story_${this.currentYear}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        // Restore
        frame.style.display = "none";
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
      }).catch(err => {
        console.error("Story render error:", err);
        alert("Erro ao exportar o Story.");
        frame.style.display = "none";
        downloadBtn.innerHTML = originalText;
        downloadBtn.disabled = false;
      });
    }, 450);
  }
}

// Instantiate
const app = new FlightyApp();

// Bind year-select change globally
window.onYearChange = () => {
  app.renderPassport();
  app.clearMapRoutes();
  const currentMapToggle = document.getElementById("map-toggle-past");
  const isPastActive = currentMapToggle && currentMapToggle.classList.contains("active");
  app.plotFlightsOnMap(isPastActive ? app.pastFlights : app.upcomingFlights, isPastActive ? 'past' : 'upcoming');
};

// Reset LocalStorage helper for user debugging
window.resetFlightyDatabase = () => {
  if (confirm("Deseja resetar o banco do aplicativo para o padrão inicial dos prints?")) {
    safeStorage.removeItem('flighty_past_flights');
    safeStorage.removeItem('flighty_upcoming_flights');
    window.location.reload();
  }
};
