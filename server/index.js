import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";

const scrypt = promisify(scryptCallback);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(process.env.AUTH_DATA_FILE || path.join(serverDir, "data", "users.json"));
const bookingDataFile = path.resolve(
  process.env.BOOKING_DATA_FILE || path.join(serverDir, "data", "bookings.json"),
);
const distDir = path.resolve(serverDir, "..", "dist");
const port = Number(process.env.API_PORT || 3001);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
let userWriteQueue = Promise.resolve();
let bookingWriteQueue = Promise.resolve();
const configuredSetupToken = process.env.LUNA_SETUP_TOKEN;
if (process.env.NODE_ENV === "production" && !configuredSetupToken) {
  throw new Error("Set LUNA_SETUP_TOKEN in the production environment before starting the server.");
}
if (configuredSetupToken && Buffer.byteLength(configuredSetupToken) < 32) {
  throw new Error("LUNA_SETUP_TOKEN must contain at least 32 bytes.");
}
let setupToken = configuredSetupToken || randomBytes(32).toString("base64url");
const bookingEnabled = process.env.NODE_ENV !== "production" || process.env.LUNA_BOOKING_ENABLED === "true";
const passwordSaltBytes = 16;
const passwordHashBytes = 64;
const cookieName = "luna_session";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const services = [
  { id: "manicure", name: "Maniküre", durationMinutes: 60, price: 48 },
  { id: "gel-manicure", name: "Maniküre mit Gel-Lack", durationMinutes: 90, price: 59 },
  { id: "pedicure", name: "Pediküre & Fußpflege", durationMinutes: 60, price: 69 },
  { id: "body-treatment", name: "Körperpflege", durationMinutes: 60, price: 89 },
  { id: "body-massage", name: "Körpermassage & Spa", durationMinutes: 90, price: 119 },
];
const openingHour = 9;
const closingHour = 18;
const bookingIntervalMinutes = 30;
const berlinDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readRequestJson(request) {
  if (!request.headers["content-type"]?.includes("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.status = 415;
    throw error;
  }

  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 16_384) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
  }

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const error = new Error("Request body must be a JSON object.");
      error.status = 400;
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.status) throw error;
    const invalidJson = new Error("Invalid JSON.");
    invalidJson.status = 400;
    throw invalidJson;
  }
}

function readCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const pair = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(name.length + 1));
  } catch {
    return null;
  }
}

function sessionCookie(token, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function readUsers() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const users = JSON.parse(contents);
    if (!Array.isArray(users)) throw new Error("User data must be a JSON array.");
    return users;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeUsers(users) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  const tempFile = `${dataFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempFile, JSON.stringify(users, null, 2), { encoding: "utf8", flag: "wx" });
  await rename(tempFile, dataFile);
}

async function ensureJsonFile(filePath, initialValue) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, JSON.stringify(initialValue), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

async function withFileWriteLock(filePath, initialValue, operation) {
  await ensureJsonFile(filePath, initialValue);
  const release = await lockfile.lock(filePath, {
    retries: { retries: 20, minTimeout: 50, maxTimeout: 250 },
    stale: 30_000,
    update: 10_000,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

function withUserWriteLock(operation) {
  const run = () => withFileWriteLock(dataFile, [], operation);
  const result = userWriteQueue.then(run, run);
  userWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

function withBookingWriteLock(operation) {
  const run = () => withFileWriteLock(bookingDataFile, { appointments: [], vacations: [] }, operation);
  const result = bookingWriteQueue.then(run, run);
  bookingWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readBookingData() {
  try {
    const contents = await readFile(bookingDataFile, "utf8");
    const data = JSON.parse(contents);
    if (!data || !Array.isArray(data.appointments) || !Array.isArray(data.vacations)) {
      throw new Error("Booking data has an invalid format.");
    }
    return data;
  } catch (error) {
    if (error.code === "ENOENT") return { appointments: [], vacations: [] };
    throw error;
  }
}

async function writeBookingData(data) {
  await mkdir(path.dirname(bookingDataFile), { recursive: true });
  const tempFile = `${bookingDataFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" });
  await rename(tempFile, bookingDataFile);
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function berlinToday() {
  return berlinDateFormatter.format(new Date());
}

function dayOfWeek(date) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function isOnVacation(vacations, date) {
  return vacations.some((vacation) => vacation.startDate <= date && vacation.endDate >= date);
}

function createTimeSlots(date, service, appointments, vacations) {
  if (dayOfWeek(date) === 0 || isOnVacation(vacations, date)) return [];

  const slots = [];
  const currentTimeParts = date === berlinToday()
    ? new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date()).split(":").map(Number)
    : [0, 0];
  const currentMinute = date === berlinToday() ? currentTimeParts[0] * 60 + currentTimeParts[1] : -1;
  const startMinute = openingHour * 60;
  const endMinute = closingHour * 60 - service.durationMinutes;

  for (let minute = startMinute; minute <= endMinute; minute += bookingIntervalMinutes) {
    const hour = Math.floor(minute / 60);
    const minutePart = minute % 60;
    const time = `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
    if (date === berlinToday() && minute <= currentMinute) continue;

    const overlaps = appointments.some((appointment) => {
      if (appointment.date !== date || appointment.status === "cancelled") return false;
      const appointmentStart = Number(appointment.time.slice(0, 2)) * 60 + Number(appointment.time.slice(3, 5));
      return minute < appointmentStart + appointment.durationMinutes && minute + service.durationMinutes > appointmentStart;
    });
    if (!overlaps) slots.push(time);
  }
  return slots;
}

function getSessionUser(request) {
  const session = getSession(request);
  return session ? readUsers().then((users) => users.find((user) => user.id === session.userId) || null) : null;
}

async function hashPassword(password, salt = randomBytes(passwordSaltBytes)) {
  const derivedKey = await scrypt(password, salt, passwordHashBytes);
  return {
    salt: salt.toString("base64"),
    passwordHash: Buffer.from(derivedKey).toString("base64"),
  };
}

async function verifyPassword(password, user) {
  const salt = Buffer.from(user.salt, "base64");
  const expectedHash = Buffer.from(user.passwordHash, "base64");
  if (salt.length !== passwordSaltBytes || expectedHash.length !== passwordHashBytes) return false;
  const actualHash = Buffer.from(await scrypt(password, salt, passwordHashBytes));
  return timingSafeEqual(actualHash, expectedHash);
}

function publicUser(user) {
  return { name: user.name, email: user.email };
}

function matchesSetupToken(candidate) {
  if (!setupToken || typeof candidate !== "string") return false;
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const setupDigest = createHash("sha256").update(setupToken).digest();
  return timingSafeEqual(candidateDigest, setupDigest);
}

function getSession(request) {
  const token = readCookie(request, cookieName);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

async function handleApi(request, response, url) {
  if (url.pathname.startsWith("/api/booking/") && !bookingEnabled) {
    return sendJson(response, 503, { error: "Die Online-Terminbuchung ist noch nicht freigeschaltet." });
  }

  if (request.method === "GET" && url.pathname === "/api/booking/services") {
    return sendJson(response, 200, {
      services,
      openingHours: { open: `${String(openingHour).padStart(2, "0")}:00`, close: `${String(closingHour).padStart(2, "0")}:00` },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/booking/availability") {
    const date = url.searchParams.get("date");
    const service = services.find((item) => item.id === url.searchParams.get("serviceId"));
    if (!isValidDate(date)) return sendJson(response, 400, { error: "Bitte wählen Sie ein gültiges Datum." });
    if (!service) return sendJson(response, 400, { error: "Bitte wählen Sie eine gültige Dienstleistung." });

    const data = await readBookingData();
    return sendJson(response, 200, {
      date,
      closedReason: date < berlinToday()
        ? "Vergangene Tage können nicht gebucht werden."
        : dayOfWeek(date) === 0
          ? "Sonntags geschlossen."
          : isOnVacation(data.vacations, date)
          ? "An diesem Tag ist der Salon geschlossen."
          : null,
      slots: createTimeSlots(date, service, data.appointments, data.vacations),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/booking/appointments") {
    const body = await readRequestJson(request);
    const service = services.find((item) => item.id === body.serviceId);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const date = body.date;
    const time = body.time;
    if (!service || !isValidDate(date) || typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
      return sendJson(response, 400, { error: "Bitte prüfen Sie Dienstleistung, Datum und Uhrzeit." });
    }
    if (!name || name.length > 100 || !/^\+?[0-9\s()./-]{7,25}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
      return sendJson(response, 400, { error: "Bitte geben Sie Ihren Namen und eine gültige Telefonnummer ein." });
    }

    const appointment = await withBookingWriteLock(async () => {
      const data = await readBookingData();
      if (date < berlinToday()) return { error: "Termine in der Vergangenheit können nicht gebucht werden." };
      if (!createTimeSlots(date, service, data.appointments, data.vacations).includes(time)) {
        return { error: "Dieser Termin ist leider nicht mehr verfügbar. Bitte wählen Sie eine andere Uhrzeit." };
      }
      const newAppointment = {
        id: randomBytes(12).toString("hex"),
        name,
        phone,
        serviceId: service.id,
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        date,
        time,
        status: "confirmed",
        createdAt: new Date().toISOString(),
      };
      await writeBookingData({ ...data, appointments: [...data.appointments, newAppointment] });
      return newAppointment;
    });
    if (appointment.error) return sendJson(response, 409, { error: appointment.error });
    return sendJson(response, 201, {
      appointment: {
        date: appointment.date,
        time: appointment.time,
        serviceName: appointment.serviceName,
        durationMinutes: appointment.durationMinutes,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/calendar") {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: "Bitte melden Sie sich an, um den Kalender zu öffnen." });

    const month = url.searchParams.get("month");
    if (!/^\d{4}-\d{2}$/.test(month || "")) return sendJson(response, 400, { error: "Bitte wählen Sie einen gültigen Monat." });
    const startDate = `${month}-01`;
    if (!isValidDate(startDate)) return sendJson(response, 400, { error: "Bitte wählen Sie einen gültigen Monat." });
    const endDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const data = await readBookingData();
    return sendJson(response, 200, {
      appointments: data.appointments.filter((appointment) => appointment.date >= startDate && appointment.date <= endDate),
      vacations: data.vacations.filter((vacation) => vacation.startDate <= endDate && vacation.endDate >= startDate),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/admin/vacations") {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: "Bitte melden Sie sich an, um Abwesenheiten zu planen." });

    const body = await readRequestJson(request);
    const { startDate, endDate } = body;
    if (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate || startDate < berlinToday()) {
      return sendJson(response, 400, { error: "Bitte wählen Sie einen gültigen Zeitraum ab heute." });
    }
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
    if (days > 365) return sendJson(response, 400, { error: "Ein Abwesenheitszeitraum darf höchstens ein Jahr umfassen." });

    const vacation = await withBookingWriteLock(async () => {
      const data = await readBookingData();
      const conflict = data.appointments.some(
        (appointment) =>
          appointment.status !== "cancelled" &&
          appointment.date >= startDate &&
          appointment.date <= endDate,
      );
      if (conflict) return { error: "appointment-conflict" };
      if (data.vacations.some((vacation) => vacation.startDate <= endDate && vacation.endDate >= startDate)) {
        return { error: "vacation-conflict" };
      }

      const newVacation = {
        id: randomBytes(12).toString("hex"),
        startDate,
        endDate,
        createdAt: new Date().toISOString(),
      };
      await writeBookingData({ ...data, vacations: [...data.vacations, newVacation] });
      return { vacation: newVacation };
    });
    if (vacation.error === "appointment-conflict") {
      return sendJson(response, 409, { error: "Im gewählten Zeitraum gibt es bereits bestätigte Termine. Bitte stimmen Sie diese erst mit den Kundinnen ab." });
    }
    if (vacation.error === "vacation-conflict") {
      return sendJson(response, 409, { error: "Der Zeitraum überschneidet sich mit einer bereits geplanten Abwesenheit." });
    }
    return sendJson(response, 201, { vacation: vacation.vacation });
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/vacations/")) {
    const user = await getSessionUser(request);
    if (!user) return sendJson(response, 401, { error: "Bitte melden Sie sich an, um Abwesenheiten zu ändern." });

    const id = url.pathname.slice("/api/admin/vacations/".length);
    const removed = await withBookingWriteLock(async () => {
      const data = await readBookingData();
      const vacations = data.vacations.filter((vacation) => vacation.id !== id);
      if (vacations.length === data.vacations.length) return false;
      await writeBookingData({ ...data, vacations });
      return true;
    });
    if (!removed) return sendJson(response, 404, { error: "Abwesenheit nicht gefunden." });
    return sendJson(response, 200, { removed: true });
  }

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const session = getSession(request);
    if (!session) {
      const hasCookie = readCookie(request, cookieName);
      return sendJson(response, 200, { user: null }, hasCookie ? { "Set-Cookie": sessionCookie("", 0) } : {});
    }

    const users = await readUsers();
    const user = users.find((candidate) => candidate.id === session.userId);
    if (!user) {
      sessions.delete(readCookie(request, cookieName));
      return sendJson(response, 200, { user: null }, { "Set-Cookie": sessionCookie("", 0) });
    }
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readRequestJson(request);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return sendJson(response, 400, { error: "Bitte geben Sie einen gültigen Namen und eine gültige E-Mail-Adresse ein." });
    }
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 128) {
      return sendJson(response, 400, { error: "Das Passwort muss mindestens 12 Zeichen lang sein und darf höchstens 128 Byte umfassen." });
    }

    const registration = await withUserWriteLock(async () => {
      const users = await readUsers();
      if (users.length > 0) return { error: "owner-exists" };
      if (!matchesSetupToken(body.setupToken)) return { error: "setup-token-invalid" };

      const credentials = await hashPassword(password);
      const newUser = {
        id: randomBytes(16).toString("hex"),
        name,
        email,
        ...credentials,
        createdAt: new Date().toISOString(),
      };
      await writeUsers([...users, newUser]);
      setupToken = null;
      return { user: newUser };
    });
    if (registration.error === "owner-exists") {
      return sendJson(response, 403, { error: "Das Inhaberkonto ist bereits eingerichtet. Kundinnen können Termine ohne Konto buchen." });
    }
    if (registration.error === "setup-token-invalid") {
      return sendJson(response, 403, { error: "Der Erstregistrierungsschlüssel ist ungültig." });
    }
    const user = registration.user;

    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetimeMs });
    return sendJson(response, 201, { user: publicUser(user) }, {
      "Set-Cookie": sessionCookie(token, Math.floor(sessionLifetimeMs / 1000)),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readRequestJson(request);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (Buffer.byteLength(password, "utf8") > 128) {
      return sendJson(response, 401, { error: "E-Mail oder Passwort ist ungültig." });
    }
    const users = await readUsers();
    const user = users.find((candidate) => candidate.email === email);

    if (!user || !(await verifyPassword(password, user))) {
      return sendJson(response, 401, { error: "E-Mail oder Passwort ist ungültig." });
    }

    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionLifetimeMs });
    return sendJson(response, 200, { user: publicUser(user) }, {
      "Set-Cookie": sessionCookie(token, Math.floor(sessionLifetimeMs / 1000)),
    });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = readCookie(request, cookieName);
    if (token) sessions.delete(token);
    return sendJson(response, 200, { user: null }, { "Set-Cookie": sessionCookie("", 0) });
  }

  sendJson(response, 404, { error: "Nicht gefunden." });
}

async function serveStatic(request, response, url) {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(response, 400, { error: "Ungültiger Pfad." });
  }

  const filePath = path.resolve(distDir, `.${requestedPath}`);
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${path.sep}`)) {
    return sendJson(response, 403, { error: "Zugriff verweigert." });
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error.code !== "ENOENT" && error.message !== "Not a file") throw error;
    if (path.extname(requestedPath)) return sendJson(response, 404, { error: "Nicht gefunden." });
    const indexPath = path.join(distDir, "index.html");
    try {
      const html = await readFile(indexPath);
      response.writeHead(200, { "Cache-Control": "no-cache", "Content-Type": "text/html; charset=utf-8" });
      if (request.method === "HEAD") response.end();
      else response.end(html);
    } catch (indexError) {
      if (indexError.code !== "ENOENT") throw indexError;
      sendJson(response, 503, { error: "Frontend nicht gebaut. Bitte zuerst npm run build ausführen." });
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response, url);
    } else {
      sendJson(response, 405, { error: "Methode nicht erlaubt." }, { Allow: "GET, HEAD" });
    }
  } catch (error) {
    console.error("Request failed:", error);
    if (!response.headersSent) {
      sendJson(response, error.status || 500, {
        error: error.status ? error.message : "Interner Serverfehler.",
      });
    } else {
      response.destroy(error);
    }
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Beauty Studio Backend läuft auf http://localhost:${port}`);
  if (!configuredSetupToken && process.env.NODE_ENV !== "production") {
    console.log(`Einmaliger Erstregistrierungsschlüssel (vertraulich): ${setupToken}`);
  }
});
