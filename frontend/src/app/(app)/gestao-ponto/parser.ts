import * as XLSX from "xlsx";
import scalesData from "./scales.json";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Contact = {
  matricula: string; nome: string; email: string; area: string; funcao: string;
  chSemanal: number | null; tipoContrato: string; supervisor: string;
  supervisorEmail: string; director: string; directorEmail: string; unidade: string;
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
};
export type ParseResult = {
  occurrences: Occurrence[]; balances: BalanceRecord[]; days: DailyRecord[];
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

const scaleOptions = scalesData as ScaleOption[];
const ADJUSTMENT_CATEGORIES = new Set(["Ausência de batida", "Batidas incompletas", "Marcação irregular", "Marcação errada", "Falta", "Fora da escala"]);
const RH_ONLY_CATEGORIES = new Set(["Falta", "Fora da escala", "Marcação errada"]);
const AUTOMATIC_NOTIFICATION_CATEGORIES = new Set(["Ausência de batida", "Batidas incompletas"]);

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
export function isoDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const [day, month, year] = value.split("/"); return `${year}-${month}-${day}`;
}
export function displayIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}
function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
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

// ─── Notification window ──────────────────────────────────────────────────────

export function notificationWindow(today = todayIso()) {
  const [year, month, day] = today.split("-").map(Number);
  const startMonth = day >= 21 ? month : month === 1 ? 12 : month - 1;
  const startYear = day >= 21 ? year : month === 1 ? year - 1 : year;
  const startIso = `${startYear}-${String(startMonth).padStart(2, "0")}-21`;
  const endIso = shiftIsoDate(today, -1);
  const startKey = startIso.replaceAll("-", "");
  const endKey = endIso.replaceAll("-", "");
  const startLabel = displayIsoDate(startIso);
  const endLabel = displayIsoDate(endIso);
  return {
    startIso, endIso, startKey, endKey, startLabel, endLabel,
    label: startKey <= endKey ? `${startLabel} a ${endLabel}` : `novo ciclo iniciado em ${startLabel}; nenhum dia concluído disponível`,
  };
}
export function isInNotificationWindow(item: Occurrence) {
  const period = notificationWindow();
  const itemKey = dateKey(item.date);
  return itemKey >= period.startKey && itemKey <= period.endKey;
}
export function isNotificationEligible(item: Occurrence, rhEmail: string) {
  if (![rhEmail, item.email, item.supervisorEmail].every(validEmail)) return false;
  return needsAutomaticNotification(item) && isInNotificationWindow(item);
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

export function parsePoint(text: string, contacts: Contact[], inactiveMatriculas: string[] = []): ParseResult {
  const contactMap = new Map(contacts.map((contact) => [contact.matricula, contact]));
  const inactiveSet = new Set(inactiveMatriculas);
  const blocks = text.split(/(?=CARTAO DE PONTO)/g);
  const occurrences: Occurrence[] = [];
  const seenPeople = new Set<string>();
  const unmatchedPeople = new Map<string, string>();
  const balances: BalanceRecord[] = [];
  const dailyRecords: DailyRecord[] = [];
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
      const expectedMinutes = restReason ? 0 : targetByPlan.get(planKey(day)) ?? fallbackExpected;
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

  const operationalDays = dailyRecords.filter((day) => dateKey(day.date) >= OPERATIONAL_ANALYSIS_START_KEY);
  const clockingEmployees = new Set(operationalDays.filter((day) => day.punches.length > 0).map((day) => day.matricula));
  const balanceByEmployee = new Map<string, BalanceRecord & { lastDate: string; schedule: string }>();
  for (const day of operationalDays) {
    if (!clockingEmployees.has(day.matricula)) continue;
    const current = balanceByEmployee.get(day.matricula) || {
      matricula: day.matricula, collaborator: day.collaborator, email: day.email, area: day.area,
      supervisor: day.supervisor, supervisorEmail: day.supervisorEmail, director: day.director,
      directorEmail: day.directorEmail, unidade: day.unidade, minutes: 0, label: "", critical: false,
      lastDate: day.date, schedule: day.schedule,
    };
    current.minutes += day.workedMinutes - day.expectedMinutes;
    if (dateKey(day.date) > dateKey(current.lastDate)) current.lastDate = day.date;
    balanceByEmployee.set(day.matricula, current);
  }
  for (const current of balanceByEmployee.values()) {
    const critical = Math.abs(current.minutes) > CRITICAL_BALANCE_MINUTES;
    const balance: BalanceRecord = { ...current, label: signedDurationLabel(current.minutes), critical };
    balances.push(balance);
    if (critical) {
      const direction = current.minutes > 0 ? "positivo" : "negativo";
      occurrences.push({
        id: `${current.matricula}-saldo-bh-${current.minutes}`, matricula: current.matricula,
        collaborator: current.collaborator, email: current.email, area: current.area,
        supervisor: current.supervisor, supervisorEmail: current.supervisorEmail, director: current.director,
        directorEmail: current.directorEmail, unidade: current.unidade, date: current.lastDate,
        category: "Saldo crítico de banco de horas",
        detail: `Saldo acumulado ${direction} de ${signedDurationLabel(current.minutes)} desde 21/08/2026.`,
        punches: [], severity: "alta", status: "pending", schedule: current.schedule,
      });
    }
  }
  balances.sort((a, b) => Number(b.critical) - Number(a.critical) || Math.abs(b.minutes) - Math.abs(a.minutes) || a.collaborator.localeCompare(b.collaborator));
  const operationalEnd = lastDate || formatDate(new Date());
  const activeOccurrences = occurrences.filter((item) => item.category === "Saldo crítico de banco de horas" || dateKey(item.date) >= OPERATIONAL_ANALYSIS_START_KEY);
  return {
    occurrences: activeOccurrences, balances, days: dailyRecords,
    people: seenPeople.size, unmatched: unmatchedPeople.size,
    unmatchedPeople: [...unmatchedPeople].map(([matricula, nome]) => ({ matricula, nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
    floating,
    period: firstDate && lastDate ? `${firstDate} a ${lastDate}` : "Período não identificado",
    editablePeriod: `${OPERATIONAL_ANALYSIS_START} a ${operationalEnd}`,
    openStart: OPERATIONAL_ANALYSIS_START, openEnd: operationalEnd,
  };
}

// ─── Base import ──────────────────────────────────────────────────────────────

function normalizedHeader(value: string) { return normalize(value).replace(/[^a-z0-9]/g, ""); }
function rowCell(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedHeader));
  const entry = Object.entries(row).find(([key]) => wanted.has(normalizedHeader(key)));
  return clean(String(entry?.[1] ?? ""));
}
export async function parseContactsFile(file: File): Promise<ImportedBase> {
  if (!/\.xlsx?$/i.test(file.name)) throw new Error("Use uma planilha Excel .xlsx ou .xls baseada no modelo fornecido.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const peopleSheetName = workbook.SheetNames.find((name) => normalizedHeader(name) === "colaboradores");
  const configSheetName = workbook.SheetNames.find((name) => normalizedHeader(name) === "configuracao");
  if (!peopleSheetName || !configSheetName) throw new Error("A planilha precisa ter as abas COLABORADORES e CONFIGURACAO.");
  const peopleRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[peopleSheetName], { defval: "", raw: false });
  const configRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[configSheetName], { defval: "", raw: false });
  const requiredHeaders = ["matricula", "nome", "email", "area", "chsemanal", "tipocontrato", "situacao", "supervisor", "emailsupervisor"];
  const firstRowHeaders = Object.keys(peopleRows[0] || {}).map(normalizedHeader);
  const missingHeaders = requiredHeaders.filter((header) => !firstRowHeaders.includes(header));
  if (missingHeaders.length) throw new Error(`Colunas obrigatórias ausentes: ${missingHeaders.join(", ").toUpperCase()}.`);
  const configRow = configRows.find((row) => Object.values(row).some((value) => clean(String(value ?? ""))));
  const unidade = configRow ? rowCell(configRow, ["UNIDADE"]) : "";
  const director = configRow ? rowCell(configRow, ["DIRETOR"]) : "";
  const directorEmail = configRow ? rowCell(configRow, ["EMAIL_DIRETOR", "E-MAIL DIRETOR"]) : "";
  if (!unidade || !director || !directorEmail || [unidade, director, directorEmail].some((value) => normalize(value) === "preencher")) throw new Error("Preencha UNIDADE, DIRETOR e EMAIL_DIRETOR na aba CONFIGURACAO.");
  if (!validEmail(directorEmail)) throw new Error("O EMAIL_DIRETOR da aba CONFIGURACAO não é válido.");
  const contacts: Contact[] = [];
  const inactiveMatriculas = new Set<string>();
  const errors: string[] = [];
  let inactiveSkipped = 0;
  const seen = new Set<string>();
  peopleRows.forEach((row, index) => {
    if (!Object.values(row).some((value) => clean(String(value ?? "")))) return;
    const line = index + 2;
    const matricula = rowCell(row, ["MATRICULA", "MATRÍCULA"]).replace(/\.0$/, "");
    const status = rowCell(row, ["SITUACAO", "SITUAÇÃO"]);
    if (!status) { errors.push(`linha ${line}: SITUAÇÃO não preenchida`); return; }
    if (normalize(status) !== "ativo") { inactiveSkipped += 1; if (matricula) inactiveMatriculas.add(matricula); return; }
    const nome = rowCell(row, ["NOME"]);
    const email = rowCell(row, ["EMAIL", "E-MAIL"]);
    const area = rowCell(row, ["AREA", "ÁREA"]);
    const funcao = rowCell(row, ["FUNCAO", "FUNÇÃO"]);
    const weeklyRaw = rowCell(row, ["CH_SEMANAL", "CH SEMANAL", "CARGA SEMANAL"]);
    const weekly = Number(weeklyRaw.replace(",", "."));
    const tipoContrato = rowCell(row, ["TIPO_CONTRATO", "TIPO CONTRATO"]);
    const supervisor = rowCell(row, ["SUPERVISOR"]);
    const supervisorEmail = rowCell(row, ["EMAIL_SUPERVISOR", "E-MAIL SUPERVISOR"]);
    const missing = [["MATRÍCULA", matricula], ["NOME", nome], ["EMAIL", email], ["ÁREA", area], ["CH_SEMANAL", weeklyRaw], ["TIPO_CONTRATO", tipoContrato], ["SUPERVISOR", supervisor], ["EMAIL_SUPERVISOR", supervisorEmail]].filter(([, value]) => !value).map(([label]) => label);
    if (missing.length) { errors.push(`linha ${line}: falta ${missing.join(", ")}`); return; }
    if (!validEmail(email)) { errors.push(`linha ${line}: EMAIL inválido`); return; }
    if (!validEmail(supervisorEmail)) { errors.push(`linha ${line}: EMAIL_SUPERVISOR inválido`); return; }
    if (!Number.isFinite(weekly) || weekly <= 0 || weekly > 60) { errors.push(`linha ${line}: CH_SEMANAL deve ser um número entre 1 e 60`); return; }
    if (seen.has(matricula)) { errors.push(`linha ${line}: matrícula ${matricula} duplicada`); return; }
    seen.add(matricula);
    contacts.push({ matricula, nome, email, area, funcao, chSemanal: weekly, tipoContrato, supervisor, supervisorEmail, director, directorEmail, unidade });
  });
  if (errors.length) throw new Error(`Corrija a base antes de importar: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; e mais ${errors.length - 5} erro(s)` : ""}.`);
  if (!contacts.length) throw new Error("Nenhum colaborador ativo válido foi encontrado na aba COLABORADORES.");
  return { contacts, inactiveMatriculas: [...inactiveMatriculas], unidade, fileName: file.name, inactiveSkipped };
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
      "Supervisor": item.supervisor, "E-mail supervisor": item.supervisorEmail, "Data": isoDate(item.date),
      "Tipo de ocorrência": item.category, "Detalhe": item.detail, "Severidade": item.severity,
      "Status da notificação": occurrenceStatusLabel(item),
      "Marcações": item.punches.join(" | "),
      "Saldo banco": balance?.label || "", "Banco acima de ±16h": balance?.critical ? "Sim" : "Não",
    };
  });
}
export function balanceExportRows(balances: BalanceRecord[]): ExportRow[] {
  return balances.map((b) => ({ "Matrícula": b.matricula, "Colaborador": b.collaborator, "Área": b.area, "Supervisor": b.supervisor, "Início do cálculo": OPERATIONAL_ANALYSIS_START, "Saldo (minutos)": b.minutes, "Saldo acumulado": b.label, "Acima de ±16h": b.critical ? "Sim" : "Não" }));
}
export function hoursSummaryExportRows(rows: HoursSummary[], periodStart: string, periodEnd: string): ExportRow[] {
  return rows.map((row) => ({
    "Matrícula": row.matricula, "Colaborador": row.collaborator, "Área": row.area, "Mês": row.monthLabel,
    "Início do período": displayIsoDate(periodStart), "Fim do período": displayIsoDate(periodEnd),
    "Carga semanal": row.weeklyHours ?? "", "Dias previstos": row.scheduledDays,
    "Horas previstas": row.expectedMinutes / 60, "Horas batidas": row.workedMinutes / 60,
    "Banco de horas do mês": row.bankMinutes / 60, "Dias c/ batida incompleta": row.incompleteDays,
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
    const balance = balanceMap.get(day.matricula);
    return {
      "Matrícula": day.matricula, "Colaborador": day.collaborator, "Área": day.area, "Data": isoDate(day.date),
      "Escala": day.schedule, "Qtd batidas": day.punches.length, "Marcações": day.punches.join(" | "),
      "Horas previstas": day.expectedMinutes / 60, "Horas trabalhadas": day.workedMinutes / 60,
      "Banco do dia": day.bankMinutes / 60, "Folga/feriado": day.nonWorkingReason,
      "Ocorrências": [...categories].join(" | "), "Saldo banco": balance?.label || "",
    };
  });
}
