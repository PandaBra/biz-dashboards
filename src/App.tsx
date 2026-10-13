import { useEffect, useMemo, useState } from "react";
import {
  company,
  money,
  type PageId,
} from "./data";

type AuthMode = "login" | "register";

type ApiUser = {
  name: string;
  email: string;
};

type BeautyService = {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
};

type OpeningHours = {
  open: string;
  close: string;
};

type Appointment = {
  id: string;
  name: string;
  phone: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  price: number;
  date: string;
  time: string;
  status: string;
};

type Vacation = {
  id: string;
  startDate: string;
  endDate: string;
};

type CalendarData = {
  appointments: Appointment[];
  vacations: Vacation[];
};

type Availability = {
  slots: string[];
  closedReason: string | null;
};

async function apiRequest<T>(
  path: string,
  method = "GET",
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  let result: T & { error?: string };
  try {
    result = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error("Der Server hat eine ungültige Antwort gesendet.");
  }

  if (!response.ok) {
    throw new Error(result.error || "Die Anfrage ist fehlgeschlagen.");
  }
  return result;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function formatDate(date: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("de-DE", options).format(new Date(`${date}T12:00:00`));
}

function dateRangeLabel(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

function useMonthlyCalendar(month: string, refreshKey = 0) {
  const [calendar, setCalendar] = useState<CalendarData>({ appointments: [], vacations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiRequest<CalendarData>(`/api/admin/calendar?month=${encodeURIComponent(month)}`)
      .then((result) => {
        if (!cancelled) setCalendar(result);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Daten konnten nicht geladen werden.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);

  return { calendar, loading, error, setError };
}

const pages: { id: PageId; label: string; hint: string }[] = [
  {
    id: "home",
    label: "Übersicht",
    hint: "Tagesübersicht mit aktuellen Buchungen und Terminen.",
  },
  {
    id: "sales",
    label: "Termine",
    hint: "Gebuchte Kundentermine des aktuellen Monats.",
  },
  {
    id: "calendar",
    label: "Kalender",
    hint: "Kundenbuchungen im Monatskalender ansehen und Urlaubszeiten planen. Während einer Abwesenheit sind keine Buchungen möglich.",
  },
  {
    id: "clients",
    label: "Kunden",
    hint: "Kundinnen und Kunden mit einem Termin im aktuellen Monat.",
  },
  {
    id: "stock",
    label: "Materialien",
    hint: "Bestandsverwaltung ist noch nicht eingerichtet.",
  },
  {
    id: "team",
    label: "Team",
    hint: "Teamverwaltung ist noch nicht eingerichtet.",
  },
];

function Icon({ name }: { name: PageId }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
      </svg>
    );
  }
  if (name === "sales") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
      </svg>
    );
  }
  if (name === "clients") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <circle cx="9" cy={8} r={3} />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <circle cx="17" cy={9} r={2.4} />
        <path d="M16 19a4.5 4.5 0 0 1 5-4.4" />
      </svg>
    );
  }
  if (name === "stock") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M4 8h16l-1.5 12h-13L4 8z" />
        <path d="M8 8V6a4 4 0 0 1 8 0v2" />
      </svg>
    );
  }
  if (name === "calendar") {
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <circle cx="12" cy={8} r={3} />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [showBooking, setShowBooking] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", setupToken: "" });
  const [error, setError] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ user: ApiUser | null }>("/api/auth/session")
      .then((result) => {
        if (!cancelled) setCurrentUser(result.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Das Backend ist nicht erreichbar. Bitte starten Sie npm run dev neu.");
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await apiRequest<{ user: ApiUser }>("/api/auth/login", "POST", {
        email: form.email,
        password: form.password,
      });
      if (!result.user) throw new Error("Der Server hat kein Benutzerkonto zurückgegeben.");
      setCurrentUser(result.user);
      setForm({ name: "", email: "", password: "", confirmPassword: "", setupToken: "" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Anmeldung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    const password = form.password;

    if (!name || !form.email.trim() || !password) {
      setError("Bitte füllen Sie alle Felder aus.");
      return;
    }

    if (password.length < 12) {
      setError("Das Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }

    if (password !== form.confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const result = await apiRequest<{ user: ApiUser }>("/api/auth/register", "POST", {
        name,
        email: form.email,
        password,
        setupToken: form.setupToken,
      });
      if (!result.user) throw new Error("Der Server hat kein Benutzerkonto zurückgegeben.");
      setCurrentUser(result.user);
      setForm({ name: "", email: "", password: "", confirmPassword: "", setupToken: "" });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Registrierung fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setError("");
    try {
      await apiRequest<{ user: null }>("/api/auth/logout", "POST", {});
      setCurrentUser(null);
      setAuthMode("login");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Abmeldung fehlgeschlagen.");
    }
  };

  if (checkingSession) {
    return <div className="auth-shell"><div className="auth-card">Verbindung wird hergestellt …</div></div>;
  }

  if (showBooking) {
    return <PublicBooking onBack={() => setShowBooking(false)} />;
  }

  if (!currentUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="brand-mark">{company.shortName[0]}</div>
            <div>
              <strong>{company.name}</strong>
              <span>Business Dashboard</span>
            </div>
          </div>

          <div className="auth-tabs">
            <button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setError(""); }}>
              Anmelden
            </button>
            <button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setError(""); }}>
              Registrieren
            </button>
          </div>
          <button className="booking-link" onClick={() => setShowBooking(true)}>
            Als Kundin einen Termin buchen
          </button>

          {authMode === "login" ? (
            <form onSubmit={handleLogin} className="auth-form">
              <h2>Willkommen zurück</h2>
              <label>
                E-Mail
                <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
              </label>
              <label>
                Passwort
                <input type="password" value={form.password} onChange={(e) => handleChange("password", e.target.value)} />
              </label>
              {error ? <div className="auth-error">{error}</div> : null}
              <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? "Bitte warten …" : "Einloggen"}</button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <h2>Inhaberkonto erstellen</h2>
              <p className="privacy-note">Das einmalige Geschäftskonto steuert Buchungen und Abwesenheiten. Kundinnen buchen Termine ohne Konto.</p>
              <label>
                Einmaliger Erstregistrierungsschlüssel
                <input
                  type="password"
                  autoComplete="off"
                  value={form.setupToken}
                  onChange={(e) => handleChange("setupToken", e.target.value)}
                  required
                />
              </label>
              <p className="privacy-note">Den Schlüssel finden Sie in der Konsole des Backend-Servers. Behandeln Sie ihn vertraulich.</p>
              <label>
                Name
                <input type="text" value={form.name} onChange={(e) => handleChange("name", e.target.value)} />
              </label>
              <label>
                E-Mail
                <input type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value)} />
              </label>
              <label>
                Passwort
                <input type="password" minLength={12} autoComplete="new-password" value={form.password} onChange={(e) => handleChange("password", e.target.value)} />
              </label>
              <label>
                Passwort bestätigen
                <input type="password" value={form.confirmPassword} onChange={(e) => handleChange("confirmPassword", e.target.value)} />
              </label>
              {error ? <div className="auth-error">{error}</div> : null}
              <button type="submit" className="auth-submit" disabled={submitting}>{submitting ? "Bitte warten …" : "Registrieren"}</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <Dashboard
      currentUser={currentUser}
      onLogout={handleLogout}
      actionError={error}
      onBook={() => setShowBooking(true)}
    />
  );
}

function Dashboard({
  currentUser,
  onLogout,
  actionError,
  onBook,
}: {
  currentUser: ApiUser;
  onLogout: () => void;
  actionError: string;
  onBook: () => void;
}) {
  const [page, setPage] = useState<PageId>("home");
  const current = pages.find((p) => p.id === page)!;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <strong>{company.shortName}</strong>
          <span>Business Dashboard</span>
        </div>
        <nav className="nav">
          {pages.map((p) => (
            <button
              key={p.id}
              className={p.id === page ? "active" : ""}
              onClick={() => setPage(p.id)}
            >
              <Icon name={p.id} />
              {p.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-hint">
          Verwalten Sie Online-Buchungen und planen Sie Abwesenheiten direkt im Kalender.
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="page-title">
            <h1>{current.label}</h1>
            <p>{current.hint}</p>
          </div>
          <div className="user-area">
            {actionError ? <div className="auth-error">{actionError}</div> : null}
            <button className="logout-btn" onClick={onBook}>Online-Buchung</button>
            <div className="user-chip">
              <div className="avatar">{currentUser.name.slice(0, 2).toUpperCase()}</div>
              <div>
                <b>{currentUser.name}</b>
                <small>Geschäftskonto</small>
              </div>
            </div>
            <button className="logout-btn" onClick={onLogout}>Abmelden</button>
          </div>
        </header>

        {page === "home" && <Home onGo={setPage} />}
        {page === "sales" && <Sales />}
        {page === "calendar" && <Calendar />}
        {page === "clients" && <Clients />}
        {page === "stock" && <Stock />}
        {page === "team" && <Team />}
      </main>
    </div>
  );
}

function PublicBooking({ onBack }: { onBack: () => void }) {
  const [services, setServices] = useState<BeautyService[]>([]);
  const [openingHours, setOpeningHours] = useState<OpeningHours | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(localDateString());
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selectedTime, setSelectedTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    date: string;
    time: string;
    serviceName: string;
    durationMinutes: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ services: BeautyService[]; openingHours: OpeningHours }>("/api/booking/services")
      .then((result) => {
        if (cancelled) return;
        setServices(result.services);
        setOpeningHours(result.openingHours);
        setServiceId(result.services[0]?.id ?? "");
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Dienstleistungen konnten nicht geladen werden.");
      })
      .finally(() => {
        if (!cancelled) setLoadingServices(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!serviceId || !date) return;
    let cancelled = false;
    setLoadingSlots(true);
    setSelectedTime("");
    setError("");
    apiRequest<Availability>(
      `/api/booking/availability?date=${encodeURIComponent(date)}&serviceId=${encodeURIComponent(serviceId)}`,
    )
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setAvailability(null);
          setError(requestError instanceof Error ? requestError.message : "Freie Termine konnten nicht geladen werden.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, serviceId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTime) {
      setError("Bitte wählen Sie zuerst eine freie Uhrzeit.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await apiRequest<{ appointment: NonNullable<typeof confirmation> }>(
        "/api/booking/appointments",
        "POST",
        { serviceId, date, time: selectedTime, name, phone },
      );
      setConfirmation(result.appointment);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Die Buchung ist fehlgeschlagen.");
      setAvailability(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (!loadingServices && services.length === 0) {
    return (
      <div className="auth-shell">
        <section className="auth-card booking-card">
          <div className="auth-brand">
            <div className="brand-mark">{company.shortName[0]}</div>
            <div><strong>{company.name}</strong><span>Online-Terminbuchung</span></div>
          </div>
          <h1>Terminbuchung derzeit nicht verfügbar</h1>
          <p className="muted">{error || "Die Online-Terminbuchung ist noch nicht freigeschaltet."}</p>
          <button className="logout-btn" onClick={onBack}>Zurück</button>
        </section>
      </div>
    );
  }

  if (confirmation) {
    return (
      <div className="auth-shell">
        <section className="auth-card booking-card">
          <div className="auth-brand">
            <div className="brand-mark">{company.shortName[0]}</div>
            <div><strong>{company.name}</strong><span>Terminbuchung</span></div>
          </div>
          <div className="booking-success">
            <h1>Vielen Dank für Ihre Buchung!</h1>
            <p>{confirmation.serviceName}</p>
            <strong>{formatDate(confirmation.date, { dateStyle: "full" })} · {confirmation.time} Uhr</strong>
            <p className="muted">Wir freuen uns auf Ihren Besuch. Bei Fragen kontaktieren Sie bitte direkt den Salon.</p>
          </div>
          <button className="logout-btn" onClick={onBack}>Zurück</button>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <section className="auth-card booking-card">
        <div className="auth-brand">
          <div className="brand-mark">{company.shortName[0]}</div>
          <div><strong>{company.name}</strong><span>Online-Terminbuchung</span></div>
        </div>
        <div className="booking-heading">
          <div>
            <h1>Behandlung buchen</h1>
            <p>Wählen Sie Behandlung, Tag und eine freie Uhrzeit. Ein Kundenkonto ist nicht erforderlich.</p>
          </div>
          <button className="text-button" onClick={onBack}>Anmelden</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Behandlung
            <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={loadingServices}>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} · {service.durationMinutes} Min. · {money(service.price)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Datum
            <input type="date" min={localDateString()} value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <div className="booking-slots">
            <span className="form-label">Freie Uhrzeiten</span>
            {loadingSlots ? <p className="muted">Verfügbarkeiten werden geladen …</p> : null}
            {!loadingSlots && availability?.closedReason ? <p className="closed-message">{availability.closedReason}</p> : null}
            {!loadingSlots && availability && !availability.closedReason && availability.slots.length === 0
              ? <p className="muted">An diesem Tag sind leider keine Termine mehr frei.</p>
              : null}
            {!loadingSlots && availability && availability.slots.length > 0 ? (
              <div className="time-slots">
                {availability.slots.map((time) => (
                  <button
                    type="button"
                    key={time}
                    className={`time-slot ${selectedTime === time ? "selected" : ""}`}
                    onClick={() => setSelectedTime(time)}
                  >
                    {time}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <label>
            Ihr Name
            <input required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Telefonnummer
            <input required type="tel" maxLength={25} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          {error ? <div className="auth-error">{error}</div> : null}
          <p className="privacy-note">Ihre Angaben werden zur Verwaltung und Bestätigung dieses Termins verwendet.</p>
          <button type="submit" className="auth-submit" disabled={submitting || loadingServices || loadingSlots || !services.length || !availability || !availability.slots.length}>
            {submitting ? "Wird gebucht …" : "Termin verbindlich buchen"}
          </button>
        </form>
        <p className="opening-note">
          Geöffnet Montag bis Samstag, {openingHours?.open}–{openingHours?.close} Uhr · Sonntag geschlossen
        </p>
      </section>
    </div>
  );
}

function Calendar() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [refreshKey, setRefreshKey] = useState(0);
  const [vacationStart, setVacationStart] = useState(localDateString());
  const [vacationEnd, setVacationEnd] = useState(localDateString());
  const [savingVacation, setSavingVacation] = useState(false);

  const monthKey = monthString(month);
  const { calendar, loading, error, setError } = useMonthlyCalendar(monthKey, refreshKey);

  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const calendarDays = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day < 1 || day > daysInMonth
      ? null
      : `${monthKey}-${String(day).padStart(2, "0")}`;
  });
  const appointmentsForSelectedDate = calendar.appointments
    .filter((appointment) => appointment.date === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time));
  const selectedVacation = calendar.vacations.find(
    (vacation) => vacation.startDate <= selectedDate && vacation.endDate >= selectedDate,
  );

  const changeMonth = (amount: number) => {
    const nextMonth = addMonths(month, amount);
    setMonth(nextMonth);
    setSelectedDate(`${monthString(nextMonth)}-01`);
  };

  const handleAddVacation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingVacation(true);
    setError("");
    try {
      await apiRequest("/api/admin/vacations", "POST", {
        startDate: vacationStart,
        endDate: vacationEnd,
      });
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Abwesenheit konnte nicht gespeichert werden.");
    } finally {
      setSavingVacation(false);
    }
  };

  const handleDeleteVacation = async (id: string) => {
    setError("");
    try {
      await apiRequest(`/api/admin/vacations/${encodeURIComponent(id)}`, "DELETE");
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Abwesenheit konnte nicht gelöscht werden.");
    }
  };

  return (
    <div className="calendar-layout">
      <section className="card calendar-card">
        <div className="section-head calendar-heading">
          <div>
            <h2>Terminkalender</h2>
            <p className="muted">Buchungen und geschlossene Urlaubstage im Überblick</p>
          </div>
          <div className="month-controls">
            <button className="calendar-arrow" aria-label="Vorheriger Monat" onClick={() => changeMonth(-1)}>‹</button>
            <strong>{new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(month)}</strong>
            <button className="calendar-arrow" aria-label="Nächster Monat" onClick={() => changeMonth(1)}>›</button>
          </div>
        </div>
        <div className="calendar-grid">
          {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
          {calendarDays.map((day, index) => {
            if (!day) return <div className="calendar-empty" key={`empty-${index}`} />;
            const count = calendar.appointments.filter((appointment) => appointment.date === day).length;
            const isVacation = calendar.vacations.some((vacation) => vacation.startDate <= day && vacation.endDate >= day);
            return (
              <button
                className={`calendar-day ${selectedDate === day ? "selected" : ""} ${isVacation ? "vacation" : ""}`}
                key={day}
                onClick={() => setSelectedDate(day)}
              >
                <span>{Number(day.slice(-2))}</span>
                {isVacation ? <small>Urlaub</small> : count > 0 ? <small>{count} {count === 1 ? "Termin" : "Termine"}</small> : null}
              </button>
            );
          })}
        </div>
        <p className="calendar-legend"><span className="legend-dot booked" /> Gebuchte Termine <span className="legend-dot vacation-dot" /> Urlaub / geschlossen</p>
        <div className="day-agenda">
          <h3>{formatDate(selectedDate, { dateStyle: "full" })}</h3>
          {loading ? <p className="muted">Kalender wird geladen …</p> : null}
          {error ? <div className="auth-error">{error}</div> : null}
          {!loading && selectedVacation ? <p className="closed-message">Salon geschlossen · Urlaub {dateRangeLabel(selectedVacation.startDate, selectedVacation.endDate)}</p> : null}
          {!loading && !appointmentsForSelectedDate.length && !selectedVacation ? <p className="muted">Für diesen Tag sind noch keine Termine gebucht.</p> : null}
          {appointmentsForSelectedDate.map((appointment) => (
            <div className="agenda-item" key={appointment.id}>
              <strong>{appointment.time}</strong>
              <div><b>{appointment.serviceName}</b><small>{appointment.name} · {appointment.phone}</small></div>
              <span>{money(appointment.price)}</span>
            </div>
          ))}
        </div>
      </section>

      <aside className="calendar-side">
        <section className="card vacation-card">
          <h2>Urlaub / Abwesenheit</h2>
          <p className="muted">Im gewählten Zeitraum können Kundinnen keine Termine buchen.</p>
          <form className="auth-form" onSubmit={handleAddVacation}>
            <label>Von<input type="date" min={localDateString()} value={vacationStart} onChange={(event) => setVacationStart(event.target.value)} required /></label>
            <label>Bis<input type="date" min={vacationStart} value={vacationEnd} onChange={(event) => setVacationEnd(event.target.value)} required /></label>
            <button className="auth-submit" type="submit" disabled={savingVacation}>{savingVacation ? "Wird gespeichert …" : "Zeitraum blockieren"}</button>
          </form>
          <div className="vacation-list">
            <h3>Geplante Abwesenheiten</h3>
            {calendar.vacations.length ? calendar.vacations.map((vacation) => (
              <div className="vacation-item" key={vacation.id}>
                <span>{dateRangeLabel(vacation.startDate, vacation.endDate)}</span>
                <button className="text-button danger-text" onClick={() => handleDeleteVacation(vacation.id)}>Aufheben</button>
              </div>
            )) : <p className="muted">Keine Abwesenheit in diesem Monat.</p>}
          </div>
        </section>
        <section className="card">
          <h2>Öffnungszeiten</h2>
          <p className="muted">Montag–Samstag · 09:00–18:00<br />Sonntag · geschlossen</p>
          <p className="privacy-note">Urlaub kann nicht eingetragen werden, wenn bereits bestätigte Termine im Zeitraum liegen.</p>
        </section>
      </aside>
    </div>
  );
}

function Home({ onGo }: { onGo: (p: PageId) => void }) {
  const today = localDateString();
  const { calendar, loading, error } = useMonthlyCalendar(monthString(new Date()));
  const todaysAppointments = calendar.appointments
    .filter((appointment) => appointment.date === today && appointment.status !== "cancelled")
    .sort((a, b) => a.time.localeCompare(b.time));
  const upcomingAppointments = calendar.appointments
    .filter((appointment) => appointment.date >= today && appointment.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 5);
  const revenueToday = todaysAppointments.reduce((total, appointment) => total + appointment.price, 0);

  return (
    <>
      <section className="grid-4">
        <article className="card stat">
          <div className="label">Umsatz heute</div>
          <div className="value">{loading ? "…" : money(revenueToday)}</div>
          <span className="muted">Summe der heutigen Buchungen</span>
        </article>
        <article className="card stat">
          <div className="label">Termine heute</div>
          <div className="value">{loading ? "…" : todaysAppointments.length}</div>
          <span className="muted">Bestätigte Online-Buchungen</span>
        </article>
        <article className="card stat">
          <div className="label">Termine diesen Monat</div>
          <div className="value">{loading ? "…" : calendar.appointments.length}</div>
          <span className="muted">Alle gespeicherten Buchungen</span>
        </article>
        <article className="card stat">
          <div className="label">Abwesenheiten diesen Monat</div>
          <div className="value">{loading ? "…" : calendar.vacations.length}</div>
          <span className="muted">Geplante Schließzeiten</span>
        </article>
      </section>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <article className="card">
          <div className="section-head">
            <h2>Nächste Termine</h2>
            <button className="text-button" onClick={() => onGo("sales")}>Alle Termine</button>
          </div>
          {error ? <div className="auth-error">{error}</div> : null}
          {loading ? <p className="muted">Termine werden geladen …</p> : null}
          {!loading && !error && upcomingAppointments.length === 0
            ? <p className="empty">Noch keine kommenden Termine vorhanden.</p>
            : null}
          {upcomingAppointments.map((appointment) => (
            <div className="agenda-item" key={appointment.id}>
              <strong>{formatDate(appointment.date)} · {appointment.time}</strong>
              <div><b>{appointment.serviceName}</b><small>{appointment.name} · {appointment.phone}</small></div>
              <span>{money(appointment.price)}</span>
            </div>
          ))}
        </article>

        <article className="card">
          <h2>Schnellzugriff</h2>
          <p className="muted">Öffnen Sie die Terminliste oder planen Sie eine Abwesenheit.</p>
          <div className="quick-actions">
            <button className="logout-btn" onClick={() => onGo("calendar")}>Kalender öffnen</button>
            <button className="logout-btn" onClick={() => onGo("sales")}>Termine ansehen</button>
          </div>
        </article>
      </div>
    </>
  );
}

function Sales() {
  const [q, setQ] = useState("");
  const { calendar, loading, error } = useMonthlyCalendar(monthString(new Date()));
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const appointments = [...calendar.appointments].sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
    if (!s) return appointments;
    return appointments.filter(
      (appointment) =>
        appointment.name.toLowerCase().includes(s) ||
        appointment.phone.toLowerCase().includes(s) ||
        appointment.serviceName.toLowerCase().includes(s),
    );
  }, [calendar.appointments, q]);

  return (
    <article className="card">
      <div className="section-head">
        <h2>Termine dieses Monats</h2>
        <input
          className="search"
          placeholder="Nach Kundin, Telefonnummer oder Leistung suchen"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error ? <div className="auth-error">{error}</div> : null}
      {loading ? <div className="empty">Termine werden geladen …</div> : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="empty">{calendar.appointments.length ? "Keine passenden Termine gefunden." : "Für diesen Monat sind noch keine Termine gebucht."}</div>
      ) : (
        !loading && !error ? <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Datum und Uhrzeit</th>
                <th>Kunde</th>
                <th>Telefon</th>
                <th>Leistung</th>
                <th>Betrag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((appointment) => (
                <tr key={appointment.id}>
                  <td><b>{formatDate(appointment.date)}</b><div className="muted">{appointment.time}</div></td>
                  <td>{appointment.name}</td>
                  <td>{appointment.phone}</td>
                  <td>{appointment.serviceName}</td>
                  <td>{money(appointment.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null
      )}
    </article>
  );
}

function Clients() {
  const [q, setQ] = useState("");
  const { calendar, loading, error } = useMonthlyCalendar(monthString(new Date()));
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const byPhone = new Map<string, { name: string; phone: string; appointments: Appointment[] }>();
    for (const appointment of calendar.appointments) {
      const client = byPhone.get(appointment.phone) ?? {
        name: appointment.name,
        phone: appointment.phone,
        appointments: [],
      };
      client.appointments.push(appointment);
      byPhone.set(appointment.phone, client);
    }
    return [...byPhone.values()]
      .filter((client) =>
        client.name.toLowerCase().includes(s) || client.phone.toLowerCase().includes(s),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [calendar.appointments, q]);

  return (
    <article className="card">
      <div className="section-head">
        <h2>Kundinnen und Kunden dieses Monats</h2>
        <input
          className="search"
          placeholder="Name oder Telefonnummer suchen"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {error ? <div className="auth-error">{error}</div> : null}
      {loading ? <div className="empty">Kundendaten werden geladen …</div> : null}
      {!loading && !error && rows.length === 0 ? (
        <div className="empty">{calendar.appointments.length ? "Keine passenden Kundinnen oder Kunden gefunden." : "Mit den Buchungen dieses Monats erscheinen hier Kundendaten."}</div>
      ) : null}
      {!loading && !error && rows.length > 0 ? <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Telefon</th>
              <th>Termine diesen Monat</th>
              <th>Letzter Termin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => {
              const latestAppointment = [...client.appointments].sort(
                (a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time),
              )[0];
              return <tr key={client.phone}>
                <td>
                  <b>{client.name}</b>
                </td>
                <td>{client.phone}</td>
                <td>{client.appointments.length}</td>
                <td>{formatDate(latestAppointment.date)} · {latestAppointment.time}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : null}
    </article>
  );
}

function Stock() {
  return (
    <article className="card">
      <div className="section-head">
        <h2>Materialien und Pflegeprodukte</h2>
      </div>
      <p className="empty">Die Bestandsverwaltung ist noch nicht mit dem Backend verbunden. Hier werden keine Beispieldaten angezeigt.</p>
    </article>
  );
}

function Team() {
  return (
    <article className="card">
      <h2>Team</h2>
      <p className="empty">Die Teamverwaltung ist noch nicht eingerichtet. Hier werden keine Beispieldaten angezeigt.</p>
    </article>
  );
}
