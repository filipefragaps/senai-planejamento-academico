import * as XLSX from "xlsx";
import scalesData from "./scales.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Contact = {
  matricula: string; nome: string; email: string; area: string; funcao: string;
  chSemanal: number | null; tipoContrato: string; supervisor: string;
  supervisorEmail: string; director: string; directorEmail: string; unidade: string;
  admissao?: string; admissaoKey?: string; crCodigo?: string; crDescricao?: string;
};
export type ReviewStatus = "pending" | "approved" | "ignored";
export type ScaleOption = { code: string; description: string; start: string; end: string; breakStart: string; breakEnd: string; rule: string; category: string };
export type ScaleSuggestion = { status: "suggested" | "not-recommended"; code?: string; description?: string; weeklyMinutes: number; reason: string; cautions: string[] };
export type Occurrence = {
  id: string; matricula: string; collaborator: string; email: string; area: string;
  supervisor: string; supervisorEmail: string; director: string; directorEmail: string;
  unidade: string; date: string; category: string;
  detail: string; punches: string[]; severity: "alta" | "média" | "baixa";
  status: ReviewStatus; schedule: string;
  scaleSuggestion?: ScaleSuggestion;
};
export type UnmatchedPerson = { matricula: string; nome: string };
export type BalanceRecord = {
  matricula: string; collaborator: string; email: string; area: string;
  supervisor: string; supervisorEmail: string; director: string; directorEmail: string;
  unidade: string; minutes: number; label: string; critical: boolean;
  sourceMonth?: string; sourceFile?: string;
};
export type MonthlyBalanceRecord = {
  matricula: string; collaborator: string; email: string; area: string;
  supervisor: string; supervisorEmail: string; director: string; directorEmail: string;
  unidade: string; month: string; monthLabel: string;
  initialMinutes: number; creditMinutes: number; debitMinutes: number;
  accumulatedMinutes: number; accumulatedLabel: string; critical: boolean; fileName: string;
};
export type MonthlySourceFile = {
  month: string; monthLabel: string; fileName: string;
  firstDate: string; lastDate: string; expectedLastDate: string; complete: boolean;
};
export type DailyRecord = {
  matricula: string; collaborator: string; email: string; area: string;
  supervisor: string; supervisorEmail: string; director: string; directorEmail: string;
  unidade: string; date: string; schedule: string; scheduleCode: string; timeCode: string;
  weeklyHours: number | null; punches: string[]; issues: string[];
  workedMinutes: number; expectedMinutes: number; overtimeMinutes: number;
  bankMinutes: number; nonWorkingReason: string; weeklyMinutes: number;
};
export type MonthlyDay = {
  matricula: string; collaborator: string; area: string; supervisor: string;
  date: string; weeklyHours: number | null; schedule: string; scheduleCode: string;
  expectedMinutes: number; workedMinutes: number; nonWorkingReason: string;
  hasPunches: boolean; incomplete: boolean;
};
export type HoursSummary = {
  matricula: string; collaborator: string; area: string; supervisor: string;
  month: string; monthLabel: string; weeklyHours: number | null; schedules: string[];
  expectedMinutes: number; workedMinutes: number; bankMinutes: number;
  scheduledDays: number; nonWorkingDays: number; incompleteDays: number;
  officialInitialMinutes: number | null; officialCreditMinutes: number | null;
  officialDebitMinutes: number | null; officialAccumulatedMinutes: number | null;
  officialCritical: boolean; officialFileName: string;
};
export type ParseResult = {
  occurrences: Occurrence[]; balances: BalanceRecord[]; days: DailyRecord[];
  monthlyBalances: MonthlyBalanceRecord[]; sourceFiles: MonthlySourceFile[];
  people: number; unmatched: number; unmatchedPeople: UnmatchedPerson[]; floating: number;
  period: string; editablePeriod: string; openStart: string; openEnd: string;
};
export type ImportedBase = { contacts: Contact[]; inactiveMatriculas: string[]; unidade: string; fileName: string; inactiveSkipped: number };
type ExportRow = Record<string, string | number | boolean>;

// ─── Constants ────────────────────────────────────────────────────────────────

export const MONTHLY_ANALYSIS_START = "2026-01-01";
export const MONTHLY_ANALYSIS_START_KEY = "20260101";
export const OPERATIONAL_ANALYSIS_START = "21/08/2026";
export const OPERATIONAL_ANALYSIS_START_KEY = "20260821";
export const CRITICAL_BALANCE_MINUTES = 16 * 60;
export const ANALYSIS_VERSION = 18;

const scaleOptions = scalesData as ScaleOption[];
const ADJUSTMENT_CATEGORIES = new Set(["Ausência de batida", "Batidas incompletas", "Marcação irregular", "Marcação errada", "Falta", "Fora da escala"]);
const RH_ONLY_CATEGORIES = new Set(["Falta", "Fora da escala", "Marcação errada"]);
const AUTOMATIC_NOTIFICATION_CATEGORIES = new Set(["Ausência de batida", "Batidas incompletas"]);
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH_NUMBER_BY_NAME = new Map(MONTH_NAMES.map((name, index) => [normalize(name), index + 1]));

// ─── Category helpers ─────────────────────────────────────────────────────────

export function needsPointAdjustment(item: Occurrence) { return ADJUSTMENT_CATEGORIES.has(item.category); }
export function isRhOnly(item: Occurrence) { return RH_ONLY_CATEGORIES.has(item.category); }
export function needsAutomaticNotification(item: Occurrence) { return AUTOMATIC_NOTIFICATION_CATEGORIES.has(item.category) && !isRhOnly(item); }

// ─── String / date utilities ──────────────────────────────────────────────────

export function normalize(value: string) { return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
export function clean(value: string) { return value.trim().replace(/\s+/g, " "); }
export function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

function displayDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(value)) return value;
  const [day, month, year] = value.split("/"); return `${day}/${month}/20${year}`;
}
export function dateKey(value: string) {
  const [d, m, y] = value.split("/"); return `${y}${m}${d}`;
}
export function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function yesterdayIso() { return shiftIsoDate(todayIso(), -1); }
function lastDayOfMonthIso(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
export function isoDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const [day, month, year] = value.split("/"); return `${year}-${month}-${day}`;
}
export function displayIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}
function monthKey(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "";
  const [, month, year] = value.split("/"); return `${year}-${month}`;
}
function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}
function dateTimeMs(date: string, time: string) {
  const [day, month, year] = date.split("/").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}
function weekKey(date: string) {
  const [day, month, year] = date.split("/").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return value.toISOString().slice(0, 10);
}

// ─── Duration utilities ───────────────────────────────────────────────────────

export function durationLabel(minutes: number) {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  return `${hours}h${String(rest).padStart(2, "0")}`;
}
export function signedDurationLabel(minutes: number) {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "";
  return `${sign}${durationLabel(Math.abs(minutes))}`;
}
function parseDurationMinutes(raw: string) {
  const match = raw.match(/(\d{1,4}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function parseSignedDurationMinutes(raw: string) {
  const match = clean(raw).match(/^([+-]?)(\d{1,5}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}
function parseMinutes(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
function forwardMinutes(start: string, end: string) {
  const first = parseMinutes(start), last = parseMinutes(end);
  return last >= first ? last - first : 24 * 60 - first + last;
}
function workedMinutes(punches: string[]) {
  let total = 0;
  for (let index = 0; index + 1 < punches.length; index += 2) total += forwardMinutes(punches[index], punches[index + 1]);
  return total;
}
function clockDistance(a: string, b: string) {
  const difference = Math.abs(parseMinutes(a) - parseMinutes(b));
  return Math.min(difference, 24 * 60 - difference);
}
function scalePaidMinutes(scale: ScaleOption) {
  if (!scale.start || !scale.end) return null;
  const span = forwardMinutes(scale.start, scale.end);
  const breakMinutes = scale.breakStart && scale.breakEnd ? forwardMinutes(scale.breakStart, scale.breakEnd) : 0;
  return span - breakMinutes;
}
function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}
function roundToQuarterHour(minutes: number) { return Math.max(0, Math.round(minutes / 15) * 15); }

// ─── Notification window (v1.5: prazo de correção) ────────────────────────────
// Ciclo do ponto: dia 21 ao dia 20 do mês seguinte. Após o fechamento (dia 20), o ciclo
// encerrado segue corrigível até o fim do 2º dia útil seguinte (sem fins de semana e
// feriados nacionais fixos). Depois disso, a janela passa ao novo ciclo, iniciado no dia 21.

const BRAZIL_NATIONAL_HOLIDAYS = new Set([
  "01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25",
]);
function isBusinessDayIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday >= 1 && weekday <= 5 && !BRAZIL_NATIONAL_HOLIDAYS.has(value.slice(5));
}
function addBusinessDays(value: string, count: number) {
  let cursor = value;
  let added = 0;
  while (added < count) {
    cursor = shiftIsoDate(cursor, 1);
    if (isBusinessDayIso(cursor)) added += 1;
  }
  return cursor;
}
function yearMonthWithOffset(year: number, month: number, offset: number) {
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

export type NotificationWindow = ReturnType<typeof notificationWindow>;

export function notificationWindow(today = todayIso()) {
  const [year, month, day] = today.split("-").map(Number);
  const currentClosingIso = `${year}-${String(month).padStart(2, "0")}-20`;
  const currentDeadlineIso = addBusinessDays(currentClosingIso, 2);
  const keepPreviousCycle = day <= 20 || today <= currentDeadlineIso;
  const startMonth = yearMonthWithOffset(year, month, keepPreviousCycle ? -1 : 0);
  const cycleEndMonth = yearMonthWithOffset(startMonth.year, startMonth.month, 1);
  const startIso = `${startMonth.year}-${String(startMonth.month).padStart(2, "0")}-21`;
  const cycleEndIso = `${cycleEndMonth.year}-${String(cycleEndMonth.month).padStart(2, "0")}-20`;
  const deadlineIso = addBusinessDays(cycleEndIso, 2);
  const endIso = shiftIsoDate(today, -1);
  const startKey = startIso.replaceAll("-", "");
  const endKey = endIso.replaceAll("-", "");
  const startLabel = displayIsoDate(startIso);
  const endLabel = displayIsoDate(endIso);
  const deadlineLabel = displayIsoDate(deadlineIso);
  const cycleEndLabel = displayIsoDate(cycleEndIso);
  const gracePeriod = today > cycleEndIso && today <= deadlineIso;
  return {
    startIso, endIso, startKey, endKey, startLabel, endLabel,
    cycleEndIso, cycleEndLabel, deadlineIso, deadlineLabel, gracePeriod,
    label: startKey <= endKey ? `${startLabel} a ${endLabel}` : `novo ciclo iniciado em ${startLabel}; nenhum dia concluído disponível`,
    deadlineText: gracePeriod
      ? `Ciclo encerrado em ${cycleEndLabel}; correções liberadas até ${deadlineLabel}.`
      : `Fechamento em ${cycleEndLabel}; correções liberadas até ${deadlineLabel}.`,
  };
}
/** Ocorrência dentro do período ainda corrigível (cartões, filtros, alertas e e-mails). */
export function isInWindow(item: Occurrence, period: NotificationWindow = notificationWindow()) {
  const itemKey = dateKey(item.date);
  return itemKey >= period.startKey && itemKey <= period.endKey;
}
export function isInNotificationWindow(item: Occurrence) {
  return isInWindow(item);
}
export function isNotificationEligible(item: Occurrence, rhEmail: string) {
  if (![rhEmail, item.email, item.supervisorEmail].every(validEmail)) return false;
  return needsAutomaticNotification(item) && isInNotificationWindow(item);
}

// ─── Monthly files utilities ──────────────────────────────────────────────────

function competenceFromText(text: string) {
  const match = text.match(/M[eê]s\s*\/\s*Ano\s+Compet[eê]ncia\s*:\s*([A-Za-zÀ-ÿ]+)\s*\/\s*(\d{4})/i);
  if (!match) return "";
  const month = MONTH_NUMBER_BY_NAME.get(normalize(match[1]));
  return month ? `${match[2]}-${String(month).padStart(2, "0")}` : "";
}

function expectedLastDateForMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const yesterday = yesterdayIso();
  return yesterday.startsWith(`${month}-`) ? yesterday : lastDayOfMonthIso(year, monthNumber);
}

export function requiredMonthlyFiles(today = todayIso()) {
  const yesterday = shiftIsoDate(today, -1);
  const [targetYear, targetMonth] = yesterday.split("-").map(Number);
  const rows: { month: string; monthLabel: string; expectedLastDate: string }[] = [];
  for (let month = 1; month <= targetMonth; month += 1) {
    const key = `${targetYear}-${String(month).padStart(2, "0")}`;
    rows.push({
      month: key,
      monthLabel: `${String(month).padStart(2, "0")}/${targetYear}`,
      expectedLastDate: month === targetMonth ? yesterday : lastDayOfMonthIso(targetYear, month),
    });
  }
  return rows;
}

// ─── Monthly summary ──────────────────────────────────────────────────────────

export function monthlyDayFromRecord(day: DailyRecord): MonthlyDay {
  return {
    matricula: day.matricula, collaborator: day.collaborator, area: day.area, supervisor: day.supervisor,
    date: day.date, weeklyHours: day.weeklyHours, schedule: day.schedule, scheduleCode: day.scheduleCode,
    expectedMinutes: day.expectedMinutes, workedMinutes: day.workedMinutes, nonWorkingReason: day.nonWorkingReason,
    hasPunches: day.punches.length > 0, incomplete: day.punches.length % 2 !== 0,
  };
}
export function summarizeMonthlyDays(days: MonthlyDay[], start: string, end: string): HoursSummary[] {
  if (!start || !end || start > end) return [];
  const clockingEmployees = new Set(days.filter((day) => dateKey(day.date) >= MONTHLY_ANALYSIS_START_KEY && day.hasPunches).map((day) => day.matricula));
  const grouped = new Map<string, HoursSummary>();
  for (const day of days) {
    const dayIso = isoDate(day.date);
    const month = monthKey(day.date);
    if (!clockingEmployees.has(day.matricula) || dateKey(day.date) < MONTHLY_ANALYSIS_START_KEY || dayIso < start || dayIso > end) continue;
    const key = `${day.matricula}|${month}`;
    const current = grouped.get(key) || {
      matricula: day.matricula, collaborator: day.collaborator, area: day.area, supervisor: day.supervisor,
      month, monthLabel: monthLabel(month), weeklyHours: day.weeklyHours, schedules: [],
      expectedMinutes: 0, workedMinutes: 0, bankMinutes: 0, scheduledDays: 0, nonWorkingDays: 0, incompleteDays: 0,
      officialInitialMinutes: null, officialCreditMinutes: null, officialDebitMinutes: null,
      officialAccumulatedMinutes: null, officialCritical: false, officialFileName: "",
    };
    const scheduleLabel = day.scheduleCode ? `${day.scheduleCode} · ${day.schedule}` : day.schedule;
    if (scheduleLabel && !current.schedules.includes(scheduleLabel)) current.schedules.push(scheduleLabel);
    current.expectedMinutes += day.expectedMinutes;
    current.workedMinutes += day.workedMinutes;
    current.bankMinutes += day.workedMinutes - day.expectedMinutes;
    if (day.expectedMinutes > 0) current.scheduledDays += 1;
    if (day.nonWorkingReason) current.nonWorkingDays += 1;
    if (day.incomplete) current.incompleteDays += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => a.collaborator.localeCompare(b.collaborator, "pt-BR") || a.month.localeCompare(b.month));
}
export function attachOfficialMonthlyBalances(rows: HoursSummary[], balances: MonthlyBalanceRecord[]): HoursSummary[] {
  const official = new Map(balances.map((balance) => [`${balance.matricula}|${balance.month}`, balance]));
  return rows.map((row) => {
    const balance = official.get(`${row.matricula}|${row.month}`);
    return balance ? {
      ...row,
      officialInitialMinutes: balance.initialMinutes,
      officialCreditMinutes: balance.creditMinutes,
      officialDebitMinutes: balance.debitMinutes,
      officialAccumulatedMinutes: balance.accumulatedMinutes,
      officialCritical: balance.critical,
      officialFileName: balance.fileName,
    } : row;
  });
}

// ─── Scale suggestion ─────────────────────────────────────────────────────────

function suggestScale(day: { date: string; punches: string[] }, weeklyMinutes: number, intershiftViolation: boolean, weeklyLimit: number): ScaleSuggestion {
  const cautions = ["Confirmar autorização prévia ou concordância do colaborador", "Validar a convenção/acordo coletivo e eventual adicional noturno"];
  if (day.punches.length < 2 || day.punches.length % 2 !== 0) return { status: "not-recommended", weeklyMinutes, reason: "As batidas estão incompletas. Corrija as marcações antes de avaliar uma escala.", cautions };
  const dailyMinutes = workedMinutes(day.punches);
  if (dailyMinutes > 10 * 60) return { status: "not-recommended", weeklyMinutes, reason: "A jornada efetiva ultrapassa 10 horas no dia. Não é adequado eliminar a ocorrência apenas trocando a escala.", cautions };
  if (weeklyMinutes > weeklyLimit) return { status: "not-recommended", weeklyMinutes, reason: `A semana já soma ${durationLabel(weeklyMinutes)}, acima da carga de ${durationLabel(weeklyLimit)}. O excedente deve continuar como hora extra ou banco de horas.`, cautions };
  if (intershiftViolation) return { status: "not-recommended", weeklyMinutes, reason: "Há descanso inferior a 11 horas entre jornadas. A troca de escala não corrige essa irregularidade.", cautions };
  const actualStart = day.punches[0], actualEnd = day.punches[day.punches.length - 1]!;
  const ranked = scaleOptions.flatMap((scale) => {
    const paid = scalePaidMinutes(scale);
    if (paid === null || paid <= 0 || paid > 10 * 60 || scale.category === "12x36" || /12\s*(por|x)\s*36/i.test(scale.description)) return [];
    const span = forwardMinutes(scale.start, scale.end);
    const breakMinutes = scale.breakStart && scale.breakEnd ? forwardMinutes(scale.breakStart, scale.breakEnd) : 0;
    if (span > 6 * 60 && (breakMinutes < 60 || breakMinutes > 120)) return [];
    const score = clockDistance(actualStart, scale.start) + clockDistance(actualEnd, scale.end) + Math.abs(dailyMinutes - paid) * 0.4;
    return [{ scale, score }];
  }).sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (!best || best.score > 210) return { status: "not-recommended", weeklyMinutes, reason: "Nenhuma escala cadastrada ficou suficientemente próxima das marcações deste dia.", cautions };
  const span = forwardMinutes(best.scale.start, best.scale.end);
  if (span > 4 * 60 && span <= 6 * 60 && !(best.scale.breakStart && best.scale.breakEnd)) cautions.unshift("Garantir intervalo de 15 minutos, ainda que não apareça na descrição da escala");
  return { status: "suggested", code: best.scale.code, description: best.scale.description, weeklyMinutes, reason: `É a escala cadastrada mais próxima das marcações ${actualStart}–${actualEnd}.`, cautions };
}

// ─── Issue classification ─────────────────────────────────────────────────────

function classify(text: string) {
  const value = normalize(text);
  if (value.includes("hora extra intervalo")) return { category: "Intervalo não respeitado", severity: "alta" as const };
  if (value.includes("intervalo irregular")) return { category: "Intervalo irregular", severity: "alta" as const };
  if (/s\/marcacao|sem marcacao/.test(value)) return { category: "Ausência de batida", severity: "alta" as const };
  if (value.includes("falta")) return { category: "Falta", severity: "alta" as const };
  if (value.includes("irregular")) return { category: "Marcação irregular", severity: "alta" as const };
  if (value.includes("entrada em atraso")) return { category: "Atraso", severity: "média" as const };
  if (value.includes("saida antecipada")) return { category: "Saída antecipada", severity: "média" as const };
  if (value.includes("hora extra")) return { category: "Hora extra", severity: "baixa" as const };
  return null;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parsePoint(text: string, contacts: Contact[], inactiveMatriculas: string[] = [], sourceFile = "", declaredMonth = ""): ParseResult {
  const contactMap = new Map(contacts.map((contact) => [contact.matricula, contact]));
  const inactiveSet = new Set(inactiveMatriculas);
  const blocks = text.split(/(?=CARTAO DE PONTO)/g);
  const occurrences: Occurrence[] = [];
  const seenPeople = new Set<string>();
  const unmatchedPeople = new Map<string, string>();
  const balances: BalanceRecord[] = [];
  const monthlyBalances: MonthlyBalanceRecord[] = [];
  const dailyRecords: DailyRecord[] = [];
  const sourceMonth = declaredMonth || competenceFromText(text);
  let floating = 0, firstDate = "", lastDate = "";

  for (const block of blocks) {
    const employeeMatch = block.match(/Funcionario\s*:\s*(.*?)\s*\r?\n/i);
    const idMatch = block.match(/Matricula\s*:\s*(\d+)/i);
    const scheduleMatch = block.match(/Hor\. de Trab\.:\s*(.*?)\s*\r?\n/i);
    if (!employeeMatch || !idMatch || !scheduleMatch) continue;
    const matricula = idMatch[1];
    if (inactiveSet.has(matricula)) continue;
    const collaborator = clean(employeeMatch[1]);
    const schedule = clean(scheduleMatch[1]);
    const contact = contactMap.get(matricula);
    const area = contact?.area || "Cadastro não localizado";
    const supervisor = { name: contact?.supervisor || "Responsável a definir", email: contact?.supervisorEmail || "" };
    const director = { name: contact?.director || "Direção a definir", email: contact?.directorEmail || "" };
    const isHourly = /horista/i.test(normalize(contact?.tipoContrato || "")) || /horistas/i.test(normalize(schedule));
    const flexible = /flexivel|horistas/i.test(normalize(schedule)) || (schedule.match(/\d{2}:\d{2}/g) || []).length < 2;
    if (flexible) floating += 1;
    seenPeople.add(matricula);
    if (!contact) unmatchedPeople.set(matricula, collaborator);
    const scheduleTimes = schedule.match(/\d{2}:\d{2}/g) || [];

    type ParsedDayIssue = { label: string; detail: string; quantityMinutes: number | null };
    type ParsedDay = { date: string; punches: string[]; issueTexts: string[]; issueEntries: ParsedDayIssue[]; timeCode: string; scaleCode: string };
    const days = new Map<string, ParsedDay>();
    let currentDate = "";

    for (const line of block.split(/\r?\n/)) {
      const dayMatch = line.match(/^\s*[A-Za-zÀ-ÿ]{3}\s+(\d{2}\/\d{2}\/\d{2})\s?(.*)$/);
      const padded = line.padEnd(131, " ");
      const punches = Array.from(padded.slice(13, 60).matchAll(/(?<!\d)(\d{2}:\d{2})(?!\d)/g)).map((match) => match[1]);
      const issueLabel = clean(padded.slice(60, 90));
      const quantityMinutes = parseDurationMinutes(clean(padded.slice(90, 96)));
      const issueText = clean([padded.slice(60, 90), padded.slice(90, 96), padded.slice(96, 125)].join(" "));
      if (!dayMatch) {
        if (currentDate && /^\s{20,}/.test(line) && (punches.length > 0 || issueText)) {
          const current = days.get(currentDate);
          if (current) { current.punches.push(...punches); if (issueText) { current.issueTexts.push(issueText); current.issueEntries.push({ label: issueLabel, detail: issueText, quantityMinutes }); } }
        }
        continue;
      }
      const date = displayDate(dayMatch[1]);
      currentDate = date;
      const timeCode = clean(padded.slice(13, 19));
      const scaleCode = clean(padded.slice(19, 24));
      const existing = days.get(date);
      if (existing) {
        existing.punches.push(...punches);
        if (issueText) { existing.issueTexts.push(issueText); existing.issueEntries.push({ label: issueLabel, detail: issueText, quantityMinutes }); }
        if (timeCode) existing.timeCode = timeCode;
        if (scaleCode) existing.scaleCode = scaleCode;
      } else {
        days.set(date, { date, punches, issueTexts: issueText ? [issueText] : [], issueEntries: issueText ? [{ label: issueLabel, detail: issueText, quantityMinutes }] : [], timeCode, scaleCode });
      }
      if (!firstDate || dateKey(date) < dateKey(firstDate)) firstDate = date;
      if (!lastDate || dateKey(date) > dateKey(lastDate)) lastDate = date;
    }

    const add = (day: { date: string; punches: string[] }, category: string, detail: string, severity: Occurrence["severity"], scaleSuggestion?: ScaleSuggestion) => occurrences.push({
      id: `${matricula}-${day.date}-${category}-${occurrences.length}`, matricula, collaborator,
      email: contact?.email || "", area, supervisor: supervisor.name, supervisorEmail: supervisor.email,
      director: director.name, directorEmail: director.email, unidade: contact?.unidade || "",
      date: day.date, category, detail: detail || category, punches: day.punches, severity, status: "pending", schedule, scaleSuggestion,
    });

    const orderedDays = [...days.values()].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));

    // Parse official BH summary for this employee in this monthly file
    const summaryMatches = [...block.matchAll(/Saldo BH Inicial\s*:\s*([+-]?\d{1,5}:\d{2})[\s\S]*?Saldo BH Acumulado\s*:\s*([+-]?\d{1,5}:\d{2})[\s\S]*?Cr[eé]ditos M[eê]s\s*:\s*([+-]?\d{1,5}:\d{2})[\s\S]*?D[eé]bitos M[eê]s\s*:\s*([+-]?\d{1,5}:\d{2})/gi)];
    const officialSummary = summaryMatches.at(-1);
    if (officialSummary && sourceMonth) {
      const initialMinutes = parseSignedDurationMinutes(officialSummary[1]);
      const accumulatedMinutes = parseSignedDurationMinutes(officialSummary[2]);
      const creditMinutes = parseSignedDurationMinutes(officialSummary[3]);
      const debitMinutes = parseSignedDurationMinutes(officialSummary[4]);
      if ([initialMinutes, accumulatedMinutes, creditMinutes, debitMinutes].every((v) => v !== null)) {
        monthlyBalances.push({
          matricula, collaborator, email: contact?.email || "", area,
          supervisor: supervisor.name, supervisorEmail: supervisor.email,
          director: director.name, directorEmail: director.email, unidade: contact?.unidade || "",
          month: sourceMonth, monthLabel: monthLabel(sourceMonth),
          initialMinutes: initialMinutes!, creditMinutes: creditMinutes!,
          debitMinutes: debitMinutes!, accumulatedMinutes: accumulatedMinutes!,
          accumulatedLabel: signedDurationLabel(accumulatedMinutes!),
          critical: Math.abs(accumulatedMinutes!) > CRITICAL_BALANCE_MINUTES,
          fileName: sourceFile,
        });
      }
    }

    const nonWorkingReason = (day: ParsedDay) => {
      const combined = normalize(day.issueTexts.join(" "));
      const explicitRest = /folga|ferias|afastamento|licenca|atestado|recesso|feriado|independencia do brasil|confraternizacao universal|tiradentes|dia do trabalho|nossa senhora aparecida|finados|proclamacao da republica|natal|corpus christi|carnaval|paixao de cristo/.test(combined);
      const deficit = /falta|entrada em atraso|saida antecipada|s\/marcacao|sem marcacao/.test(combined);
      if (explicitRest) return day.issueTexts[0] || "Folga/feriado";
      if (day.punches.length === 0 && day.issueTexts.length > 0 && !deficit && !combined.includes("hora extra")) return day.issueTexts[0];
      return "";
    };
    const regularOvertimeMinutes = (day: ParsedDay) => day.issueEntries.reduce((total, issue) => {
      const label = normalize(issue.label);
      return total + (label.includes("hora extra") && !label.includes("intervalo") ? issue.quantityMinutes || 0 : 0);
    }, 0);
    const deficitMinutes = (day: ParsedDay) => day.issueEntries.reduce((total, issue) => {
      const label = normalize(issue.label);
      return total + (/falta|entrada em atraso|saida antecipada|s\/marcacao|sem marcacao/.test(label) ? issue.quantityMinutes || 0 : 0);
    }, 0);
    const planKey = (day: ParsedDay) => `${day.timeCode}|${day.scaleCode}`;
    const inferredTargets = new Map<string, number[]>();
    const actualTargets = new Map<string, number[]>();
    for (const day of orderedDays) {
      if (nonWorkingReason(day)) continue;
      const actual = workedMinutes(day.punches);
      const extra = regularOvertimeMinutes(day);
      const deficit = deficitMinutes(day);
      const inferred = actual - extra + deficit;
      if ((extra > 0 || deficit > 0) && inferred > 0 && inferred <= 12 * 60) inferredTargets.set(planKey(day), [...(inferredTargets.get(planKey(day)) || []), inferred]);
      if (day.punches.length >= 2 && day.punches.length % 2 === 0 && actual > 0 && actual <= 12 * 60) actualTargets.set(planKey(day), [...(actualTargets.get(planKey(day)) || []), actual]);
    }
    const targetByPlan = new Map<string, number>();
    for (const day of orderedDays) {
      const key = planKey(day);
      if (targetByPlan.has(key)) continue;
      const inferred = median(inferredTargets.get(key) || []);
      if (inferred !== null) { targetByPlan.set(key, roundToQuarterHour(inferred)); continue; }
      const actual = median(actualTargets.get(key) || []);
      if (actual !== null) { targetByPlan.set(key, roundToQuarterHour(actual)); continue; }
      const scale = scaleOptions.find((option) => option.code === day.scaleCode);
      const scaleMinutes = scale ? scalePaidMinutes(scale) : null;
      if (scaleMinutes !== null && scaleMinutes > 0) targetByPlan.set(key, scaleMinutes);
    }
    const workedDays = orderedDays.filter((day) => day.punches.length > 0);
    const weeklyWorked = new Map<string, number>();
    for (const day of workedDays) weeklyWorked.set(weekKey(day.date), (weeklyWorked.get(weekKey(day.date)) || 0) + workedMinutes(day.punches));
    const intershiftViolationDates = new Set<string>();
    for (let index = 1; index < workedDays.length; index += 1) {
      const previous = workedDays[index - 1];
      const current = workedDays[index];
      const previousExit = previous.punches[previous.punches.length - 1];
      const currentEntry = current.punches[0];
      const restMinutes = Math.round((dateTimeMs(current.date, currentEntry) - dateTimeMs(previous.date, previousExit)) / 60000);
      if (restMinutes > 0 && restMinutes < 11 * 60) intershiftViolationDates.add(current.date);
    }
    for (const day of orderedDays) {
      const classified = new Set<string>();
      for (const issueText of day.issueTexts) {
        const classification = classify(issueText);
        if (classification && !classified.has(classification.category)) {
          if (classification.category === "Falta" && day.punches.length > 0) continue;
          classified.add(classification.category);
          add(day, classification.category, issueText, classification.severity);
        }
      }
      if (day.punches.length % 2 === 1 && !classified.has("Ausência de batida")) add(day, "Batidas incompletas", `Quantidade ímpar de registros no dia: ${day.punches.length} batida(s)`, "alta");
      if (day.punches.length >= 2) {
        const penultimate = day.punches[day.punches.length - 2];
        const last = day.punches[day.punches.length - 1];
        if (parseMinutes(last) < parseMinutes(penultimate)) add(day, "Marcação errada", `A última batida (${last}) é menor que a anterior (${penultimate}). Verifique se a entrada do dia seguinte foi registrada como saída deste dia.`, "alta");
      }
      if (day.punches.length >= 6) add(day, "Três turnos no mesmo dia", `${day.punches.length} marcações: ${day.punches.join(" · ")}`, "alta");
      if (!flexible && scheduleTimes.length >= 2 && day.punches.length >= 2) {
        const outside = parseMinutes(day.punches[0]) < parseMinutes(scheduleTimes[0]!) - 30 || parseMinutes(day.punches[day.punches.length - 1]) > parseMinutes(scheduleTimes[1]!) + 30;
        const excused = day.issueTexts.some((value) => /folga|feriado|ferias|afastamento/.test(normalize(value)));
        if (outside && !excused && classified.size === 0) {
          const limit = (contact?.chSemanal || 40) * 60;
          const suggestion = suggestScale(day, weeklyWorked.get(weekKey(day.date)) || 0, intershiftViolationDates.has(day.date), limit);
          add(day, "Fora da escala", `Registros ${day.punches.join(" · ")} — contrato ${schedule}`, "média", suggestion);
        }
      }
    }
    for (const day of orderedDays) {
      const restReason = nonWorkingReason(day);
      const sameWeekScheduled = orderedDays.filter((entry) => weekKey(entry.date) === weekKey(day.date) && !nonWorkingReason(entry)).length;
      const fallbackExpected = contact?.chSemanal && sameWeekScheduled ? Math.round((contact.chSemanal * 60) / sameWeekScheduled) : 0;
      const [calendarDay, calendarMonth, calendarYear] = day.date.split("/").map(Number);
      const weekday = new Date(Date.UTC(calendarYear, calendarMonth - 1, calendarDay)).getUTCDay();
      const afterAdmission = !contact?.admissaoKey || dateKey(day.date) >= contact.admissaoKey;
      const hourlyExpected = contact?.chSemanal && afterAdmission && !restReason && weekday >= 1 && weekday <= 5 ? Math.round((contact.chSemanal * 60) / 5) : 0;
      const expectedMinutes = !afterAdmission ? 0 : isHourly ? hourlyExpected : restReason ? 0 : targetByPlan.get(planKey(day)) ?? fallbackExpected;
      const actualMinutes = workedMinutes(day.punches);
      const reportedOvertime = regularOvertimeMinutes(day);
      const reportedDeficit = deficitMinutes(day);
      const bankCredit = reportedOvertime || (restReason && actualMinutes > 0 ? actualMinutes : 0);
      dailyRecords.push({
        matricula, collaborator, email: contact?.email || "", area, supervisor: supervisor.name, supervisorEmail: supervisor.email,
        director: director.name, directorEmail: director.email, unidade: contact?.unidade || "",
        date: day.date, schedule, scheduleCode: day.scaleCode, timeCode: day.timeCode, weeklyHours: contact?.chSemanal || null,
        punches: day.punches, issues: day.issueTexts, workedMinutes: actualMinutes, expectedMinutes,
        overtimeMinutes: bankCredit, bankMinutes: bankCredit - reportedDeficit, nonWorkingReason: restReason,
        weeklyMinutes: weeklyWorked.get(weekKey(day.date)) || 0,
      });
    }
    for (let index = 1; index < workedDays.length; index += 1) {
      const previous = workedDays[index - 1];
      const current = workedDays[index];
      const previousExit = previous.punches[previous.punches.length - 1];
      const currentEntry = current.punches[0];
      const restMinutes = Math.round((dateTimeMs(current.date, currentEntry) - dateTimeMs(previous.date, previousExit)) / 60000);
      if (restMinutes > 0 && restMinutes < 11 * 60) {
        add(current, "Interjornada menor que 11h", `Descanso de ${durationLabel(restMinutes)}: saída em ${previous.date} às ${previousExit} e nova entrada em ${current.date} às ${currentEntry}`, "alta");
      }
    }
  }

  // Deriva saldo atual dos dados oficiais FPW (última competência do arquivo)
  for (const official of monthlyBalances) {
    balances.push({
      matricula: official.matricula, collaborator: official.collaborator, email: official.email,
      area: official.area, supervisor: official.supervisor, supervisorEmail: official.supervisorEmail,
      director: official.director, directorEmail: official.directorEmail, unidade: official.unidade,
      minutes: official.accumulatedMinutes, label: official.accumulatedLabel, critical: official.critical,
      sourceMonth: official.month, sourceFile: official.fileName,
    });
    if (official.critical) {
      const day = dailyRecords.filter((record) => record.matricula === official.matricula)
        .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)))[0];
      const direction = official.accumulatedMinutes > 0 ? "positivo" : "negativo";
      occurrences.push({
        id: `${official.matricula}-saldo-bh-${official.month}-${official.accumulatedMinutes}`,
        matricula: official.matricula, collaborator: official.collaborator, email: official.email,
        area: official.area, supervisor: official.supervisor, supervisorEmail: official.supervisorEmail,
        director: official.director, directorEmail: official.directorEmail, unidade: official.unidade,
        date: day?.date || lastDate, category: "Saldo crítico de banco de horas",
        detail: `Saldo BH Acumulado oficial ${direction} de ${official.accumulatedLabel}, informado pelo FPW na competência ${official.monthLabel}. Limite de ±16h ultrapassado.`,
        punches: [], severity: "alta", status: "pending", schedule: day?.schedule || "",
      });
    }
  }

  balances.sort((a, b) => Number(b.critical) - Number(a.critical) || Math.abs(b.minutes) - Math.abs(a.minutes) || a.collaborator.localeCompare(b.collaborator));
  const activeOccurrences = occurrences.filter((item) => item.category === "Saldo crítico de banco de horas" || dateKey(item.date) >= OPERATIONAL_ANALYSIS_START_KEY);
  return {
    occurrences: activeOccurrences,
    balances,
    days: dailyRecords,
    monthlyBalances,
    sourceFiles: sourceMonth ? [{
      month: sourceMonth, monthLabel: monthLabel(sourceMonth), fileName: sourceFile,
      firstDate, lastDate, expectedLastDate: displayIsoDate(expectedLastDateForMonth(sourceMonth)),
      complete: Boolean(lastDate) && isoDate(lastDate) === expectedLastDateForMonth(sourceMonth),
    }] : [],
    people: seenPeople.size,
    unmatched: unmatchedPeople.size,
    unmatchedPeople: [...unmatchedPeople].map(([matricula, nome]) => ({ matricula, nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    floating,
    period: firstDate && lastDate ? `${firstDate} a ${lastDate}` : "Período não identificado",
    editablePeriod: notificationWindow().label,
    openStart: notificationWindow().startLabel, openEnd: notificationWindow().endLabel,
  };
}

// ─── Multi-file monthly import ────────────────────────────────────────────────

export async function parseMonthlyFileSet(files: File[], contacts: Contact[], inactiveMatriculas: string[]): Promise<ParseResult> {
  if (!files.length) throw new Error("Selecione os arquivos mensais do ponto.");
  const invalid = files.filter((file) => !file.name.toLowerCase().endsWith(".txt"));
  if (invalid.length) throw new Error(`Use somente arquivos TXT. Arquivo inválido: ${invalid[0].name}.`);
  const required = requiredMonthlyFiles();
  const requiredMap = new Map(required.map((item) => [item.month, item]));
  const decoded = await Promise.all(files.map(async (file) => ({
    file,
    text: new TextDecoder("windows-1252").decode(await file.arrayBuffer()),
  })));
  const byMonth = new Map<string, { file: File; text: string }>();
  for (const entry of decoded) {
    const month = competenceFromText(entry.text);
    if (!month) throw new Error(`Não foi possível identificar Mês/Ano Competência em ${entry.file.name}.`);
    if (!requiredMap.has(month)) throw new Error(`${entry.file.name} pertence à competência ${monthLabel(month)}, fora do período solicitado.`);
    if (byMonth.has(month)) throw new Error(`Há dois arquivos da competência ${monthLabel(month)}. Mantenha somente o relatório mais recente desse mês.`);
    byMonth.set(month, entry);
  }
  const missing = required.filter((item) => !byMonth.has(item.month));
  if (missing.length) throw new Error(`Faltam os arquivos de: ${missing.map((item) => item.monthLabel).join(", ")}. Selecione todos juntos, de janeiro até ontem.`);

  const parsed: ParseResult[] = [];
  for (const requiredFile of required) {
    const entry = byMonth.get(requiredFile.month)!;
    const result = parsePoint(entry.text, contacts, inactiveMatriculas, entry.file.name, requiredFile.month);
    const source = result.sourceFiles[0];
    const expectedFirst = `${requiredFile.month}-01`;
    if (!source || !source.firstDate || isoDate(source.firstDate) !== expectedFirst) {
      throw new Error(`${entry.file.name} não começa em 01/${requiredFile.month.slice(5)}/${requiredFile.month.slice(0, 4)}.`);
    }
    if (!source.lastDate || isoDate(source.lastDate) !== requiredFile.expectedLastDate) {
      throw new Error(`${entry.file.name} termina em ${source?.lastDate || "data não identificada"}. Para ${requiredFile.monthLabel}, o arquivo deve chegar até ${displayIsoDate(requiredFile.expectedLastDate)}.`);
    }
    const inconsistent = result.monthlyBalances.find((balance) => balance.initialMinutes + balance.creditMinutes - balance.debitMinutes !== balance.accumulatedMinutes);
    if (inconsistent) throw new Error(`O resumo oficial de ${inconsistent.collaborator}, em ${entry.file.name}, não fecha: saldo inicial + créditos − débitos difere do saldo acumulado.`);
    parsed.push(result);
  }

  const latest = parsed.at(-1)!;
  const allDays = parsed.flatMap((result) => result.days);
  const uniqueDays = [...new Map(allDays.map((day) => [`${day.matricula}|${day.date}`, day])).values()]
    .sort((a, b) => a.matricula.localeCompare(b.matricula) || dateKey(a.date).localeCompare(dateKey(b.date)));
  const baseOccurrences = parsed.flatMap((result) => result.occurrences)
    .filter((item) => item.category !== "Saldo crítico de banco de horas");
  const latestCritical = latest.occurrences.filter((item) => item.category === "Saldo crítico de banco de horas");
  const occurrences = [...baseOccurrences, ...latestCritical];
  const seenOccurrence = new Set(occurrences.map((item) => `${item.matricula}|${item.date}|${item.category}`));
  const daysByEmployee = new Map<string, DailyRecord[]>();
  for (const day of uniqueDays.filter((entry) => entry.punches.length > 0)) {
    daysByEmployee.set(day.matricula, [...(daysByEmployee.get(day.matricula) || []), day]);
  }
  for (const employeeDays of daysByEmployee.values()) {
    employeeDays.sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
    for (let index = 1; index < employeeDays.length; index += 1) {
      const previous = employeeDays[index - 1];
      const current = employeeDays[index];
      if (dateKey(current.date) < OPERATIONAL_ANALYSIS_START_KEY) continue;
      const previousExit = previous.punches.at(-1)!;
      const currentEntry = current.punches[0];
      const restMinutes = Math.round((dateTimeMs(current.date, currentEntry) - dateTimeMs(previous.date, previousExit)) / 60000);
      const key = `${current.matricula}|${current.date}|Interjornada menor que 11h`;
      if (restMinutes > 0 && restMinutes < 11 * 60 && !seenOccurrence.has(key)) {
        occurrences.push({
          id: `${current.matricula}-${current.date}-Interjornada entre competências`, matricula: current.matricula,
          collaborator: current.collaborator, email: current.email, area: current.area,
          supervisor: current.supervisor, supervisorEmail: current.supervisorEmail,
          director: current.director, directorEmail: current.directorEmail, unidade: current.unidade,
          date: current.date, category: "Interjornada menor que 11h",
          detail: `Descanso de ${durationLabel(restMinutes)}: saída em ${previous.date} às ${previousExit} e nova entrada em ${current.date} às ${currentEntry}`,
          punches: current.punches, severity: "alta", status: "pending", schedule: current.schedule,
        });
        seenOccurrence.add(key);
      }
    }
  }
  occurrences.sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || a.collaborator.localeCompare(b.collaborator, "pt-BR"));
  const unmatched = new Map(parsed.flatMap((result) => result.unmatchedPeople).map((person) => [person.matricula, person]));
  const allMonthlyBalances = parsed.flatMap((result) => result.monthlyBalances)
    .sort((a, b) => a.month.localeCompare(b.month) || a.collaborator.localeCompare(b.collaborator, "pt-BR"));
  const allSourceFiles = parsed.flatMap((result) => result.sourceFiles);
  const allMatriculas = new Set(uniqueDays.map((day) => day.matricula));
  const floatingMatriculas = new Set(uniqueDays.filter((day) => /flexivel|horistas/i.test(normalize(day.schedule)) || (day.schedule.match(/\d{2}:\d{2}/g) || []).length < 2).map((day) => day.matricula));
  const firstDate = uniqueDays.reduce((value, day) => !value || dateKey(day.date) < dateKey(value) ? day.date : value, "");
  const lastDate = uniqueDays.reduce((value, day) => !value || dateKey(day.date) > dateKey(value) ? day.date : value, "");
  return {
    occurrences,
    balances: latest.balances,
    days: uniqueDays,
    monthlyBalances: allMonthlyBalances,
    sourceFiles: allSourceFiles,
    people: allMatriculas.size,
    unmatched: unmatched.size,
    unmatchedPeople: [...unmatched.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    floating: floatingMatriculas.size,
    period: firstDate && lastDate ? `${firstDate} a ${lastDate}` : "Período não identificado",
    editablePeriod: notificationWindow().label,
    openStart: notificationWindow().startLabel,
    openEnd: notificationWindow().endLabel,
  };
}

// ─── FPW CSV base import ──────────────────────────────────────────────────────

function normalizedHeader(value: string) { return normalize(value).replace(/[^a-z0-9]/g, ""); }
function rowCell(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedHeader));
  const entry = Object.entries(row).find(([key]) => wanted.has(normalizedHeader(key)));
  return clean(String(entry?.[1] ?? ""));
}
function parseSemicolonCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ";" && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => clean(value))) rows.push(row); }
  return rows;
}

export async function parseContactsFile(file: File): Promise<ImportedBase> {
  if (!/\.csv$/i.test(file.name)) throw new Error("Use o CSV gerado em FPwReports: Relatório - Cargos e Funções - Empregados.");
  const rows = parseSemicolonCsv(new TextDecoder("windows-1252").decode(await file.arrayBuffer()));
  if (rows.length < 2) throw new Error("O CSV do FPW está vazio ou não pôde ser lido.");
  const rawHeaders = rows[0].map(clean);
  const headers = rawHeaders.map(normalizedHeader);
  const requiredHeaders = ["matricula", "nome", "situacao", "lotacao", "codigocr", "descricaocr", "chsemanal", "tipocontrato", "email", "admissao"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw new Error(`Colunas obrigatórias ausentes no relatório FPW: ${missingHeaders.join(", ").toUpperCase()}.`);
  const peopleRows = rows.slice(1).map((values) => Object.fromEntries(rawHeaders.map((header, index) => [header, values[index] ?? ""])));
  const employmentStatus = (row: Record<string, unknown>) => normalize(rowCell(row, ["SITUAÇÃO", "SITUACAO"]));
  const isInactive = (row: Record<string, unknown>) => /aposentadoria por invalidez|deslig|transferencia|rescis|demit/.test(employmentStatus(row));
  const activeRows = peopleRows.filter((row) => Boolean(employmentStatus(row)) && !isInactive(row));
  const inactiveRows = peopleRows.filter(isInactive);
  const roleText = (row: Record<string, unknown>) => normalize(`${rowCell(row, ["FUNÇÃO", "FUNCAO"])} ${rowCell(row, ["CARGO"])}`);
  const directorRow = activeRows.find((row) => roleText(row).includes("diretor"));
  const director = directorRow ? rowCell(directorRow, ["NOME"]) : "Direção a definir";
  const directorEmail = directorRow ? rowCell(directorRow, ["EMAIL", "E-MAIL"]) : "";
  const unidade = activeRows[0] ? rowCell(activeRows[0], ["LOTAÇÃO", "LOTACAO"]) : "Sua unidade SENAI";
  const supervisorRow = (pattern: RegExp) => activeRows.find((row) => pattern.test(roleText(row)));
  const supervisorIdentity = (row?: Record<string, unknown>) => row ? { name: rowCell(row, ["NOME"]), email: rowCell(row, ["EMAIL", "E-MAIL"]) } : { name: director, email: directorEmail };
  const administrative = supervisorIdentity(supervisorRow(/supervisor administrativo/));
  const educational = supervisorIdentity(supervisorRow(/supervisor educacional/));
  const technical = supervisorIdentity(supervisorRow(/supervisor tecnico/));
  const contacts: Contact[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  activeRows.forEach((row, index) => {
    const line = index + 2;
    const matricula = rowCell(row, ["MATRÍCULA", "MATRICULA"]).replace(/\.0$/, "");
    if (!matricula) return;
    const nome = rowCell(row, ["NOME"]);
    const emailRaw = rowCell(row, ["EMAIL", "E-MAIL"]);
    const funcao = rowCell(row, ["FUNÇÃO", "FUNCAO"]);
    const crCodigo = rowCell(row, ["CODIGO CR", "CÓDIGO CR"]);
    const crDescricao = rowCell(row, ["DESCRIÇÃO CR", "DESCRICAO CR"]);
    const weeklyRaw = rowCell(row, ["CH SEMANAL", "CH_SEMANAL"]);
    const weekly = Number(weeklyRaw.replace(",", "."));
    const tipoContrato = rowCell(row, ["TIPO CONTRATO", "TIPO_CONTRATO"]);
    const admissao = rowCell(row, ["ADMISSÃO", "ADMISSAO"]);
    const admissionParts = admissao.split("/");
    const admissaoKey = admissionParts.length === 3 ? `${admissionParts[2]}${admissionParts[1]}${admissionParts[0]}` : "";
    if (!nome || !Number.isFinite(weekly) || weekly <= 0 || weekly > 60 || !tipoContrato) {
      errors.push(`linha ${line}: confira matrícula, nome, CH semanal e tipo de contrato`); return;
    }
    if (seen.has(matricula)) { errors.push(`linha ${line}: matrícula ${matricula} duplicada`); return; }
    seen.add(matricula);
    const assignmentText = normalize(`${crDescricao} ${funcao}`);
    let supervisor: { name: string; email: string };
    if (assignmentText.includes("diretor")) supervisor = { name: "Direção", email: "" };
    else if (assignmentText.includes("supervisor")) supervisor = { name: director, email: directorEmail };
    else if (crCodigo.startsWith("307")) supervisor = administrative;
    else if (crCodigo.startsWith("303100")) supervisor = educational;
    else supervisor = technical;
    contacts.push({ matricula, nome, email: validEmail(emailRaw) ? emailRaw : "", area: crDescricao || "Área não identificada", funcao, chSemanal: weekly, tipoContrato, supervisor: supervisor.name, supervisorEmail: supervisor.email, director, directorEmail, unidade, admissao, admissaoKey, crCodigo, crDescricao });
  });
  if (errors.length) throw new Error(`Corrija a base antes de importar: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; e mais ${errors.length - 5} erro(s)` : ""}.`);
  if (!contacts.length) throw new Error("Nenhum colaborador ativo válido foi encontrado no relatório FPW.");
  const inactiveMatriculas = inactiveRows.map((row) => rowCell(row, ["MATRÍCULA", "MATRICULA"]).replace(/\.0$/, "")).filter(Boolean);
  return { contacts, inactiveMatriculas, unidade, fileName: file.name, inactiveSkipped: inactiveRows.length };
}

// ─── Notification helpers ─────────────────────────────────────────────────────

export function emailSubject(item: Occurrence) { return `Verificação do registro de ponto — ${item.collaborator}`; }
export function emailBodyFor(item: Occurrence, dates: string[]) {
  const orderedDates = [...new Set(dates)].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  const dateText = orderedDates.length === 1 ? `referente à data de ${orderedDates[0]}.` : `referente às datas abaixo:\n\n${orderedDates.map((date) => `• ${date}`).join("\n")}`;
  const justification = orderedDates.length === 1 ? "a justificativa" : "as justificativas";
  const adjustment = orderedDates.length === 1 ? "o ajuste" : "os ajustes";
  return `Olá, colaborador.\n\nIdentificamos uma inconsistência em seu registro de ponto ${dateText}\n\nPor favor, verifique e responda a todos com ${justification}.\n\nSupervisor responsável: após a resposta do colaborador, responda a todos, informando se concorda com ${justification} e se autoriza ${adjustment} do ponto.\n\nAtenciosamente,\nGestão de Ponto – SENAI`;
}
export function occurrenceStatusLabel(item: Occurrence) {
  if (item.status === "ignored") return isRhOnly(item) ? "Sem providência" : "Não enviar";
  if (isRhOnly(item)) return item.status === "approved" ? "Providência registrada" : "Análise exclusiva do RH";
  if (item.status === "pending" && needsAutomaticNotification(item) && !isInNotificationWindow(item)) return "Período fechado";
  return item.status === "approved" ? "Notificação preparada/enviada" : "Aguardando notificação";
}

export type NotificationDraft = { item: Occurrence; dates: string[]; categories: string[]; ids: string[] };
export function notificationDrafts(sourceItems: Occurrence[], rhEmail: string) {
  const grouped = new Map<string, NotificationDraft>();
  for (const item of sourceItems.filter((i) => isNotificationEligible(i, rhEmail))) {
    if (!item.email || !item.supervisorEmail || item.status === "ignored") continue;
    const current = grouped.get(item.matricula);
    if (current) { current.dates = [...new Set([...current.dates, item.date])]; current.categories = [...new Set([...current.categories, item.category])]; current.ids.push(item.id); }
    else grouped.set(item.matricula, { item, dates: [item.date], categories: [item.category], ids: [item.id] });
  }
  return [...grouped.values()].map((draft) => ({ ...draft, dates: draft.dates.sort((a, b) => dateKey(a).localeCompare(dateKey(b))) }));
}
export function manualEmailRecipients(item: Occurrence, rhEmail: string) {
  return [...new Set([item.email, item.supervisorEmail, rhEmail].filter(Boolean))];
}

// ─── CSV export ───────────────────────────────────────────────────────────────

export function downloadCsv(items: Occurrence[], rhEmail: string, filePrefix = "emails-ponto") {
  const headers = ["Para", "Cc", "Responder para", "Assunto", "Mensagem", "Colaborador", "Matrícula", "Datas", "Ocorrências internas"];
  const rows = notificationDrafts(items, rhEmail).map(({ item, dates, categories }) => [
    manualEmailRecipients(item, rhEmail).join(";"), "", rhEmail, emailSubject(item), emailBodyFor(item, dates),
    item.collaborator, item.matricula, dates.join(" | "), categories.join(" | "),
  ]);
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = "﻿" + [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

// ─── Excel export ─────────────────────────────────────────────────────────────

export function downloadExcel(filename: string, sheets: { name: string; rows: ExportRow[] }[]) {
  const workbook = XLSX.utils.book_new();
  const exportedAt = new Date().toLocaleString("pt-BR");
  for (const sheetData of sheets) {
    const sourceRows = sheetData.rows.length ? sheetData.rows : [{ "Resultado": "Nenhum registro nesta consulta" }];
    const rows: ExportRow[] = sourceRows.map((row) => ({ ...row, "Exportado em": exportedAt }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0]);
    worksheet["!autofilter"] = { ref: worksheet["!ref"] || `A1:${XLSX.utils.encode_col(Math.max(headers.length - 1, 0))}1` };
    worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(45, Math.max(12, header.length + 2, ...rows.slice(0, 100).map((row) => String(row[header] ?? "").length + 2))) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetData.name.slice(0, 31));
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  XLSX.writeFile(workbook, `${filename}-${stamp}.xlsx`, { compression: true });
}

export function occurrenceExportRows(entries: Occurrence[], balances: BalanceRecord[]): ExportRow[] {
  const balanceMap = new Map(balances.map((b) => [b.matricula, b]));
  return entries.map((item) => {
    const balance = balanceMap.get(item.matricula);
    return {
      "Matrícula": item.matricula, "Colaborador": item.collaborator, "E-mail": item.email, "Área": item.area,
      "Supervisor": item.supervisor, "E-mail supervisor": item.supervisorEmail,
      "Diretor": item.director, "E-mail diretor": item.directorEmail, "Unidade": item.unidade,
      "Data": isoDate(item.date), "Tipo de ocorrência": item.category, "Detalhe": item.detail, "Severidade": item.severity,
      "Tratamento": isRhOnly(item) ? "Análise exclusiva do RH" : needsAutomaticNotification(item) && !isInNotificationWindow(item) ? "Período fechado - somente histórico" : "Notificação ao colaborador",
      "Status da notificação": occurrenceStatusLabel(item), "Quantidade de batidas": item.punches.length,
      "Batida 1": item.punches[0] || "", "Batida 2": item.punches[1] || "", "Batida 3": item.punches[2] || "",
      "Batida 4": item.punches[3] || "", "Batida 5": item.punches[4] || "", "Batida 6": item.punches[5] || "",
      "Marcações": item.punches.join(" | "), "Escala atual": item.schedule,
      "Escala sugerida - código": item.scaleSuggestion?.code || "", "Escala sugerida": item.scaleSuggestion?.description || "",
      "Decisão sobre escala": item.scaleSuggestion ? (item.scaleSuggestion.status === "suggested" ? "Conferir sugestão" : "Troca não recomendada") : "",
      "Motivo da sugestão": item.scaleSuggestion?.reason || "",
      "Saldo banco (minutos)": balance?.minutes ?? "", "Saldo banco": balance?.label || "", "Banco acima de ±16h": balance?.critical ? "Sim" : "Não",
    };
  });
}
export function balanceExportRows(balances: BalanceRecord[]): ExportRow[] {
  return balances.map((b) => ({
    "Matrícula": b.matricula, "Colaborador": b.collaborator, "E-mail": b.email,
    "Área": b.area, "Supervisor": b.supervisor, "E-mail supervisor": b.supervisorEmail,
    "Diretor": b.director, "E-mail diretor": b.directorEmail, "Unidade": b.unidade,
    "Competência oficial": b.sourceMonth ? monthLabel(b.sourceMonth) : "",
    "Arquivo fonte": b.sourceFile || "",
    "Critério": "Último Saldo BH Acumulado informado pelo FPW",
    "Saldo (minutos)": b.minutes, "Saldo acumulado": b.label, "Acima de ±16h": b.critical ? "Sim" : "Não",
  }));
}
export function monthlyBalanceExportRows(balances: MonthlyBalanceRecord[]): ExportRow[] {
  return balances.map((b) => ({
    "Matrícula": b.matricula, "Colaborador": b.collaborator, "E-mail": b.email,
    "Área": b.area, "Supervisor": b.supervisor, "E-mail supervisor": b.supervisorEmail,
    "Competência": b.monthLabel,
    "Saldo inicial (minutos)": b.initialMinutes, "Créditos do mês (minutos)": b.creditMinutes,
    "Débitos do mês (minutos)": b.debitMinutes, "Saldo acumulado oficial (minutos)": b.accumulatedMinutes,
    "Saldo acumulado oficial": b.accumulatedLabel, "Acima de ±16h": b.critical ? "Sim" : "Não",
    "Arquivo fonte": b.fileName,
  }));
}
export function sourceFilesExportRows(files: MonthlySourceFile[]): ExportRow[] {
  return files.map((file) => ({
    "Competência": file.monthLabel, "Arquivo": file.fileName,
    "Primeira data": isoDate(file.firstDate), "Última data": isoDate(file.lastDate),
    "Data final exigida": file.expectedLastDate, "Validação": file.complete ? "Completo" : "Incompleto",
  }));
}
export function hoursSummaryExportRows(rows: HoursSummary[], periodStart: string, periodEnd: string): ExportRow[] {
  return rows.map((row) => ({
    "Matrícula": row.matricula, "Colaborador": row.collaborator, "Área": row.area, "Responsável": row.supervisor,
    "Mês": row.monthLabel,
    "Início dos cálculos": "01/01/2026",
    "Início do período selecionado": displayIsoDate(periodStart), "Fim do período selecionado": displayIsoDate(periodEnd),
    "Carga semanal contratual": row.weeklyHours ?? "",
    "Escala(s) no período": row.schedules.join(" | "),
    "Dias previstos de trabalho": row.scheduledDays,
    "Folgas/feriados/afastamentos": row.nonWorkingDays,
    "Horas previstas": row.expectedMinutes / 60,
    "Horas batidas no ponto": row.workedMinutes / 60,
    "Diferença batidas menos previstas": row.bankMinutes / 60,
    "Saldo inicial oficial FPW": row.officialInitialMinutes === null ? "" : row.officialInitialMinutes / 60,
    "Créditos oficiais FPW": row.officialCreditMinutes === null ? "" : row.officialCreditMinutes / 60,
    "Débitos oficiais FPW": row.officialDebitMinutes === null ? "" : row.officialDebitMinutes / 60,
    "Saldo acumulado oficial FPW": row.officialAccumulatedMinutes === null ? "" : row.officialAccumulatedMinutes / 60,
    "Saldo oficial acima de ±16h": row.officialAccumulatedMinutes === null ? "" : row.officialCritical ? "Sim" : "Não",
    "Arquivo mensal": row.officialFileName,
    "Dias com batidas incompletas": row.incompleteDays,
  }));
}
export function unmatchedExportRows(people: UnmatchedPerson[]): ExportRow[] {
  return people.map((p) => ({ "Matrícula": p.matricula, "Nome no ponto": p.nome, "Situação": "Verificar cadastro" }));
}
export function dailyExportRows(result: ParseResult, entries: Occurrence[]): ExportRow[] {
  const occurrenceMap = new Map<string, Occurrence[]>();
  for (const item of entries) { const key = `${item.matricula}|${item.date}`; occurrenceMap.set(key, [...(occurrenceMap.get(key) || []), item]); }
  const balanceMap = new Map(result.balances.map((b) => [b.matricula, b]));
  return result.days.map((day) => {
    const dayOccurrences = occurrenceMap.get(`${day.matricula}|${day.date}`) || [];
    const categories = new Set(dayOccurrences.map((item) => item.category));
    const suggestion = dayOccurrences.find((item) => item.scaleSuggestion)?.scaleSuggestion;
    const balance = balanceMap.get(day.matricula);
    return {
      "Matrícula": day.matricula, "Colaborador": day.collaborator, "E-mail": day.email, "Área": day.area,
      "Supervisor": day.supervisor, "E-mail supervisor": day.supervisorEmail,
      "Diretor": day.director, "E-mail diretor": day.directorEmail, "Unidade": day.unidade,
      "Data": isoDate(day.date), "Início da semana": weekKey(day.date),
      "Escala atual": day.schedule, "Código da escala": day.scheduleCode, "Código do horário": day.timeCode,
      "Carga semanal contratual": day.weeklyHours ?? "", "Quantidade de batidas": day.punches.length,
      "Batida 1": day.punches[0] || "", "Batida 2": day.punches[1] || "", "Batida 3": day.punches[2] || "",
      "Batida 4": day.punches[3] || "", "Batida 5": day.punches[4] || "", "Batida 6": day.punches[5] || "",
      "Marcações": day.punches.join(" | "), "Minutos previstos no dia": day.expectedMinutes, "Horas previstas no dia": day.expectedMinutes / 60,
      "Minutos trabalhados no dia": day.workedMinutes, "Horas trabalhadas no dia": day.workedMinutes / 60,
      "Minutos lançados no banco no dia": day.bankMinutes, "Banco de horas do dia": day.bankMinutes / 60,
      "Folga/feriado/afastamento": day.nonWorkingReason,
      "Minutos trabalhados na semana": day.weeklyMinutes, "Horas trabalhadas na semana": day.weeklyMinutes / 60,
      "Ocorrências": [...categories].join(" | "), "Detalhes do relatório": day.issues.join(" | "),
      "Fora da escala": categories.has("Fora da escala") ? "Sim" : "Não",
      "Ausência de batida": categories.has("Ausência de batida") ? "Sim" : "Não",
      "Batidas incompletas": categories.has("Batidas incompletas") ? "Sim" : "Não",
      "Falta": categories.has("Falta") ? "Sim" : "Não",
      "Marcação errada": categories.has("Marcação errada") ? "Sim" : "Não",
      "Intervalo irregular": (categories.has("Intervalo não respeitado") || categories.has("Intervalo irregular")) ? "Sim" : "Não",
      "Interjornada menor que 11h": categories.has("Interjornada menor que 11h") ? "Sim" : "Não",
      "Três turnos no dia": categories.has("Três turnos no mesmo dia") ? "Sim" : "Não",
      "Escala sugerida - código": suggestion?.code || "", "Escala sugerida": suggestion?.description || "",
      "Decisão sobre escala": suggestion ? (suggestion.status === "suggested" ? "Conferir sugestão" : "Troca não recomendada") : "",
      "Motivo da sugestão": suggestion?.reason || "",
      "Saldo banco (minutos)": balance?.minutes ?? "", "Saldo banco": balance?.label || "",
      "Banco acima de ±16h": balance?.critical ? "Sim" : "Não",
    };
  });
}
