"use client";
// Tela da Gestão de Ponto v1.6 (gráfico e cartão individual), copiada sem alterações de visual do
// pacote GestaoPonto_v1.6_Grafico_Cartao_Individual/codigo-fonte/src/Home.tsx.
// Única diferença: os dados vêm do banco da plataforma (./plataforma) em vez do navegador (./local).

import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock3, Download, RefreshCw,
  FileText, Mail, Search, ShieldCheck, UploadCloud, Users, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import scalesData from "../scales.json";
import { platformFetch as fetch, getSettings, PlatformToolbar as LocalToolbar } from "./plataforma";

type Contact = {
  matricula: string; nome: string; email: string; area: string; funcao: string;
  chSemanal: number | null; tipoContrato: string; supervisor: string;
  supervisorEmail: string; director: string; directorEmail: string; unidade: string;
  admissao?: string; admissaoKey?: string; crCodigo?: string; crDescricao?: string;
};
type ReviewStatus = "pending" | "approved" | "ignored";
type Occurrence = {
  id: string; matricula: string; collaborator: string; email: string; area: string;
  supervisor: string; supervisorEmail: string; director: string; directorEmail: string;
  unidade: string; date: string; category: string;
  detail: string; punches: string[]; severity: "alta" | "média" | "baixa";
  status: ReviewStatus; schedule: string;
  notifiedAt?: string; notificationMethod?: "outlook-web" | "outlook-classic" | "automatic" | "manual";
  scaleSuggestion?: ScaleSuggestion;
};
type ScaleOption = { code: string; description: string; start: string; end: string; breakStart: string; breakEnd: string; rule: string; category: string };
type ScaleSuggestion = { status: "suggested" | "not-recommended"; code?: string; description?: string; weeklyMinutes: number; reason: string; cautions: string[] };
type UnmatchedPerson = { matricula: string; nome: string };
type BalanceRecord = { matricula: string; collaborator: string; email: string; area: string; supervisor: string; supervisorEmail: string; director: string; directorEmail: string; unidade: string; minutes: number; label: string; critical: boolean; sourceMonth: string; sourceFile: string };
type MonthlyBalanceRecord = { matricula: string; collaborator: string; email: string; area: string; supervisor: string; supervisorEmail: string; director: string; directorEmail: string; unidade: string; month: string; monthLabel: string; initialMinutes: number; creditMinutes: number; debitMinutes: number; accumulatedMinutes: number; accumulatedLabel: string; critical: boolean; fileName: string };
type MonthlySourceFile = { month: string; monthLabel: string; fileName: string; firstDate: string; lastDate: string; expectedLastDate: string; complete: boolean };
type PointIssue = { label: string; detail: string; quantityMinutes: number | null; justification: string };
type DailyRecord = { matricula: string; collaborator: string; email: string; area: string; supervisor: string; supervisorEmail: string; director: string; directorEmail: string; unidade: string; date: string; schedule: string; scheduleCode: string; timeCode: string; weeklyHours: number | null; punches: string[]; issues: string[]; issueEntries: PointIssue[]; nightAdditionalMinutes: number; workedMinutes: number; expectedMinutes: number; overtimeMinutes: number; bankMinutes: number; nonWorkingReason: string; weeklyMinutes: number };
type MonthlyDay = { matricula: string; collaborator: string; area: string; supervisor: string; unidade?: string; date: string; weeklyHours: number | null; schedule: string; scheduleCode: string; timeCode?: string; punches?: string[]; issues?: string[]; issueEntries?: PointIssue[]; nightAdditionalMinutes?: number; expectedMinutes: number; workedMinutes: number; nonWorkingReason: string; hasPunches: boolean; incomplete: boolean };
type HoursSummary = { matricula: string; collaborator: string; area: string; supervisor: string; month: string; monthLabel: string; weeklyHours: number | null; schedules: string[]; expectedMinutes: number; workedMinutes: number; bankMinutes: number; scheduledDays: number; nonWorkingDays: number; incompleteDays: number; officialInitialMinutes: number | null; officialCreditMinutes: number | null; officialDebitMinutes: number | null; officialAccumulatedMinutes: number | null; officialCritical: boolean; officialFileName: string };
type PriorityFilter = "all" | "interval" | "intershift" | "three-shifts" | "balance";
type CorrectionFilter = "all" | "Análise exclusiva do RH" | "Ausência de batida" | "Falta" | "Fora da escala" | "Batidas incompletas" | "Marcação errada" | "Marcação irregular";
type ParseResult = {
  occurrences: Occurrence[]; balances: BalanceRecord[]; days: DailyRecord[];
  monthlyBalances: MonthlyBalanceRecord[]; sourceFiles: MonthlySourceFile[];
  people: number; unmatched: number; unmatchedPeople: UnmatchedPerson[]; floating: number;
  period: string; editablePeriod: string; openStart: string; openEnd: string;
};
type NotificationApiResult = { key: string; status: "sent" | "already_sent" | "failed"; error?: string };
type AccessInfo = { role: "admin" | "director" | "supervisor" | "viewer"; canManage: boolean; label: string; supervisorEmails: string[]; email: string; displayName: string };
type SharedSnapshot = { analysisVersion: number; data: { contacts: Contact[]; inactiveMatriculas?: string[]; baseFileName: string; unitName: string; result: ParseResult | null; items: Occurrence[]; fileName: string; sourcePeriod?: string; monthlyDays?: MonthlyDay[]; monthlyBalances?: MonthlyBalanceRecord[] }; updatedByEmail: string; updatedAt: string };

declare global {
  interface Document {
    modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
  }
}

const scaleOptions = scalesData as ScaleOption[];
const RESPONSIBLES: Record<string, { name: string; email: string }> = {};
const DEFAULT_DIRECTOR = { name: "Direção a definir", email: "" };
const DEFAULT_UNIT = "Sua unidade SENAI";
const ANALYSIS_VERSION = 19;
const MONTHLY_ANALYSIS_START = "2026-01-01";
const MONTHLY_ANALYSIS_START_KEY = "20260101";
const OPERATIONAL_ANALYSIS_START = "21/08/2026";
const OPERATIONAL_ANALYSIS_START_KEY = "20260821";
const CRITICAL_BALANCE_MINUTES = 16 * 60;
const POINT_ADMIN_REPLY_TO = getSettings().rhEmail;
const POINT_SENDER_EMAIL = getSettings().rhEmail;
const ADJUSTMENT_CATEGORIES = new Set(["Ausência de batida", "Batidas incompletas", "Marcação irregular", "Marcação errada", "Falta", "Fora da escala"]);
const RH_ONLY_CATEGORIES = new Set(["Falta", "Fora da escala", "Marcação errada"]);
const AUTOMATIC_NOTIFICATION_CATEGORIES = new Set([
  "Ausência de batida",
  "Batidas incompletas",
]);
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTH_NUMBER_BY_NAME = new Map(MONTH_NAMES.map((name, index) => [normalize(name), index + 1]));

function needsPointAdjustment(item: Occurrence) {
  return ADJUSTMENT_CATEGORIES.has(item.category);
}
function isRhOnly(item: Occurrence) {
  return RH_ONLY_CATEGORIES.has(item.category);
}
function needsAutomaticNotification(item: Occurrence) {
  return AUTOMATIC_NOTIFICATION_CATEGORIES.has(item.category) && !isRhOnly(item);
}
function notificationKey(item: Occurrence) {
  return item.matricula;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function clean(value: string) { return value.trim().replace(/\s+/g, " "); }
function responsibleFor(area: string) {
  if (RESPONSIBLES[area]) return RESPONSIBLES[area];
  return { name: "Responsável a definir", email: "" };
}
function parseMinutes(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
function displayDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(value)) return value;
  const [day, month, year] = value.split("/"); return `${day}/${month}/20${year}`;
}
function dateKey(value: string) { const [d, m, y] = value.split("/"); return `${y}${m}${d}`; }
function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function yesterdayIso() { return shiftIsoDate(todayIso(), -1); }
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
function lastDayOfMonthIso(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}
function requiredMonthlyFiles(today = todayIso()) {
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
function notificationWindow(today = todayIso()) {
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
    startIso,
    endIso,
    startKey,
    endKey,
    startLabel,
    endLabel,
    cycleEndIso,
    cycleEndLabel,
    deadlineIso,
    deadlineLabel,
    gracePeriod,
    label: startKey <= endKey ? `${startLabel} a ${endLabel}` : `novo ciclo iniciado em ${startLabel}; nenhum dia concluído disponível`,
    deadlineText: gracePeriod
      ? `Ciclo encerrado em ${cycleEndLabel}; correções liberadas até ${deadlineLabel}.`
      : `Fechamento em ${cycleEndLabel}; correções liberadas até ${deadlineLabel}.`,
  };
}
function isInWindow(item: Occurrence, period = notificationWindow()) {
  const itemKey = dateKey(item.date);
  return itemKey >= period.startKey && itemKey <= period.endKey;
}
function isInNotificationWindow(item: Occurrence) {
  return isInWindow(item);
}
function isNotificationEligible(item: Occurrence) {
  if (![POINT_ADMIN_REPLY_TO, item.email, item.supervisorEmail].every(validEmail)) return false;
  return needsAutomaticNotification(item) && isInNotificationWindow(item);
}
function displayIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}
function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
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
function suggestScale(day: { date: string; punches: string[] }, weeklyMinutes: number, intershiftViolation: boolean, weeklyLimit: number): ScaleSuggestion {
  const cautions = ["Confirmar autorização prévia ou concordância do colaborador", "Validar a convenção/acordo coletivo e eventual adicional noturno"];
  if (day.punches.length < 2 || day.punches.length % 2 !== 0) return { status: "not-recommended", weeklyMinutes, reason: "As batidas estão incompletas. Corrija as marcações antes de avaliar uma escala.", cautions };
  const dailyMinutes = workedMinutes(day.punches);
  if (dailyMinutes > 10 * 60) return { status: "not-recommended", weeklyMinutes, reason: "A jornada efetiva ultrapassa 10 horas no dia. Não é adequado eliminar a ocorrência apenas trocando a escala.", cautions };
  if (weeklyMinutes > weeklyLimit) return { status: "not-recommended", weeklyMinutes, reason: `A semana já soma ${durationLabel(weeklyMinutes)}, acima da carga de ${durationLabel(weeklyLimit)}. O excedente deve continuar como hora extra ou banco de horas.`, cautions };
  if (intershiftViolation) return { status: "not-recommended", weeklyMinutes, reason: "Há descanso inferior a 11 horas entre jornadas. A troca de escala não corrige essa irregularidade.", cautions };
  const actualStart = day.punches[0], actualEnd = day.punches.at(-1)!;
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
function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${String(rest).padStart(2, "0")}`;
}
function signedDurationLabel(minutes: number) {
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
function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}
function roundToQuarterHour(minutes: number) { return Math.max(0, Math.round(minutes / 15) * 15); }
function monthKey(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "";
  const [, month, year] = value.split("/"); return `${year}-${month}`;
}
function monthLabel(value: string) {
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}
function monthlyDayFromRecord(day: DailyRecord): MonthlyDay {
  return {
    matricula: day.matricula, collaborator: day.collaborator, area: day.area, supervisor: day.supervisor,
    unidade: day.unidade, date: day.date, weeklyHours: day.weeklyHours, schedule: day.schedule, scheduleCode: day.scheduleCode,
    timeCode: day.timeCode, punches: day.punches, issues: day.issues, issueEntries: day.issueEntries,
    nightAdditionalMinutes: day.nightAdditionalMinutes,
    expectedMinutes: day.expectedMinutes, workedMinutes: day.workedMinutes, nonWorkingReason: day.nonWorkingReason,
    hasPunches: day.punches.length > 0, incomplete: day.punches.length % 2 !== 0,
  };
}
function summarizeMonthlyDays(days: MonthlyDay[], start: string, end: string) {
  if (!start || !end || start > end) return [] as HoursSummary[];
  const clockingEmployees = new Set(days.filter((day) => dateKey(day.date) >= MONTHLY_ANALYSIS_START_KEY && day.hasPunches).map((day) => day.matricula));
  const grouped = new Map<string, HoursSummary>();
  for (const day of days) {
    const dayIso = isoDate(day.date);
    const month = monthKey(day.date);
    if (!clockingEmployees.has(day.matricula) || dateKey(day.date) < MONTHLY_ANALYSIS_START_KEY || dayIso < start || dayIso > end) continue;
    const key = `${day.matricula}|${month}`;
    const current = grouped.get(key) || {
      matricula: day.matricula, collaborator: day.collaborator, area: day.area, supervisor: day.supervisor,
      month, monthLabel: monthLabel(month), weeklyHours: day.weeklyHours, schedules: [], expectedMinutes: 0, workedMinutes: 0, bankMinutes: 0,
      scheduledDays: 0, nonWorkingDays: 0, incompleteDays: 0, officialInitialMinutes: null, officialCreditMinutes: null,
      officialDebitMinutes: null, officialAccumulatedMinutes: null, officialCritical: false, officialFileName: "",
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
function attachOfficialMonthlyBalances(rows: HoursSummary[], balances: MonthlyBalanceRecord[]) {
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

function parsePoint(text: string, contacts: Contact[], inactiveMatriculas: string[] = [], sourceFile = "", declaredMonth = ""): ParseResult {
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
    const legacySupervisor = responsibleFor(area);
    const supervisor = { name: contact?.supervisor || legacySupervisor.name, email: contact?.supervisorEmail || legacySupervisor.email };
    const director = { name: contact?.director || DEFAULT_DIRECTOR.name, email: contact?.directorEmail || DEFAULT_DIRECTOR.email };
    const isHourly = /horista/i.test(normalize(contact?.tipoContrato || "")) || /horistas/i.test(normalize(schedule));
    const flexible = /flexivel|horistas/i.test(normalize(schedule)) || (schedule.match(/\d{2}:\d{2}/g) || []).length < 2;
    if (flexible) floating += 1;
    seenPeople.add(matricula);
    if (!contact) unmatchedPeople.set(matricula, collaborator);
    const scheduleTimes = schedule.match(/\d{2}:\d{2}/g) || [];
    type ParsedDayIssue = PointIssue;
    type ParsedDay = { date: string; punches: string[]; issueTexts: string[]; issueEntries: ParsedDayIssue[]; timeCode: string; scaleCode: string; nightAdditionalMinutes: number };
    const days = new Map<string, ParsedDay>();
    let currentDate = "";
    for (const line of block.split(/\r?\n/)) {
      const dayMatch = line.match(/^\s*[A-Za-zÀ-ÿ]{3}\s+(\d{2}\/\d{2}\/\d{2})\s?(.*)$/);
      const padded = line.padEnd(131, " ");
      const punches = Array.from(padded.slice(13, 60).matchAll(/(?<!\d)(\d{2}:\d{2})(?!\d)/g)).map((match) => match[1]);
      const issueLabel = clean(padded.slice(60, 90));
      const quantityMinutes = parseDurationMinutes(clean(padded.slice(90, 96)));
      const justification = clean(padded.slice(96, 125));
      const nightAdditionalMinutes = parseDurationMinutes(clean(padded.slice(125, 131))) || 0;
      const issueText = clean([padded.slice(60, 90), padded.slice(90, 96), padded.slice(96, 125)].join(" "));
      if (!dayMatch) {
        // Some reports wrap the 5th/6th punch onto the following line without
        // repeating the date. Those punches still belong to the dated row above.
        if (currentDate && /^\s{20,}/.test(line) && (punches.length > 0 || issueText || nightAdditionalMinutes > 0)) {
          const current = days.get(currentDate);
          if (current) {
            current.punches.push(...punches);
            current.nightAdditionalMinutes += nightAdditionalMinutes;
            if (issueText) {
              current.issueTexts.push(issueText);
              current.issueEntries.push({ label: issueLabel, detail: issueText, quantityMinutes, justification });
            }
          }
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
        existing.nightAdditionalMinutes += nightAdditionalMinutes;
        if (issueText) {
          existing.issueTexts.push(issueText);
          existing.issueEntries.push({ label: issueLabel, detail: issueText, quantityMinutes, justification });
        }
        if (timeCode) existing.timeCode = timeCode;
        if (scaleCode) existing.scaleCode = scaleCode;
      } else {
        days.set(date, { date, punches, issueTexts: issueText ? [issueText] : [], issueEntries: issueText ? [{ label: issueLabel, detail: issueText, quantityMinutes, justification }] : [], timeCode, scaleCode, nightAdditionalMinutes });
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
    const summaryMatches = [...block.matchAll(/Saldo BH Inicial\s*:\s*([+-]?\d{1,5}:\d{2}).*?Saldo BH Acumulado\s*:\s*([+-]?\d{1,5}:\d{2}).*?Cr[eé]ditos M[eê]s\s*:\s*([+-]?\d{1,5}:\d{2}).*?D[eé]bitos M[eê]s\s*:\s*([+-]?\d{1,5}:\d{2})/gi)];
    const officialSummary = summaryMatches.at(-1);
    if (officialSummary && sourceMonth) {
      const initialMinutes = parseSignedDurationMinutes(officialSummary[1]);
      const accumulatedMinutes = parseSignedDurationMinutes(officialSummary[2]);
      const creditMinutes = parseSignedDurationMinutes(officialSummary[3]);
      const debitMinutes = parseSignedDurationMinutes(officialSummary[4]);
      if ([initialMinutes, accumulatedMinutes, creditMinutes, debitMinutes].every((value) => value !== null)) {
        monthlyBalances.push({
          matricula, collaborator, email: contact?.email || "", area,
          supervisor: supervisor.name, supervisorEmail: supervisor.email,
          director: director.name, directorEmail: director.email, unidade: contact?.unidade || "",
          month: sourceMonth, monthLabel: monthLabel(sourceMonth), initialMinutes: initialMinutes!,
          creditMinutes: creditMinutes!, debitMinutes: debitMinutes!, accumulatedMinutes: accumulatedMinutes!,
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
      if ((extra > 0 || deficit > 0) && inferred > 0 && inferred <= 12 * 60) {
        inferredTargets.set(planKey(day), [...(inferredTargets.get(planKey(day)) || []), inferred]);
      }
      if (day.punches.length >= 2 && day.punches.length % 2 === 0 && actual > 0 && actual <= 12 * 60) {
        actualTargets.set(planKey(day), [...(actualTargets.get(planKey(day)) || []), actual]);
      }
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
        if (parseMinutes(last) < parseMinutes(penultimate)) {
          add(day, "Marcação errada", `A última batida (${last}) é menor que a anterior (${penultimate}). Verifique se a entrada do dia seguinte foi registrada como saída deste dia.`, "alta");
        }
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
        punches: day.punches, issues: day.issueTexts, issueEntries: day.issueEntries,
        nightAdditionalMinutes: day.nightAdditionalMinutes, workedMinutes: actualMinutes, expectedMinutes,
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

  // Cada competência traz uma fotografia oficial própria. O saldo acumulado
  // nunca é somado entre meses; o mês mais recente substitui o anterior.
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
  const operationalWindow = notificationWindow();
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
    editablePeriod: operationalWindow.label,
    openStart: operationalWindow.startLabel,
    openEnd: operationalWindow.endLabel,
  };
}

async function parseMonthlyFileSet(files: File[], contacts: Contact[], inactiveMatriculas: string[]): Promise<ParseResult> {
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
  const operationalWindow = notificationWindow();
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
    editablePeriod: operationalWindow.label,
    openStart: operationalWindow.startLabel,
    openEnd: operationalWindow.endLabel,
  };
}

function emailSubject(item: Occurrence) { return `Verificação do registro de ponto — ${item.collaborator}`; }
function emailBodyFor(item: Occurrence, dates: string[]) {
  const orderedDates = [...new Set(dates)].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  const dateText = orderedDates.length === 1
    ? `referente à data de ${orderedDates[0]}.`
    : `referente às datas abaixo:\n\n${orderedDates.map((date) => `• ${date}`).join("\n")}`;
  const justification = orderedDates.length === 1 ? "a justificativa" : "as justificativas";
  const adjustment = orderedDates.length === 1 ? "o ajuste" : "os ajustes";
  return `Olá, colaborador.\n\nIdentificamos uma inconsistência em seu registro de ponto ${dateText}\n\nPor favor, verifique e responda a todos com ${justification}.\n\nSupervisor responsável: após a resposta do colaborador, responda a todos, informando se concorda com ${justification} e se autoriza ${adjustment} do ponto.\n\nAtenciosamente,\nGestão de Ponto – SENAI`;
}
function emailBody(item: Occurrence) {
  if (isRhOnly(item)) return "Análise exclusiva do RH. Esta ocorrência não será enviada automaticamente ao colaborador nem ao supervisor.";
  if (needsAutomaticNotification(item) && !isInNotificationWindow(item)) return "Período já fechado no sistema de ponto. Esta ocorrência permanece somente no histórico e não será enviada ao colaborador.";
  return emailBodyFor(item, item.date.split("|").map((date) => date.trim()).filter(Boolean));
}
type NotificationDraft = { item: Occurrence; dates: string[]; categories: string[]; ids: string[] };
function notificationDrafts(sourceItems: Occurrence[]) {
  const grouped = new Map<string, NotificationDraft>();
  for (const item of sourceItems.filter(isNotificationEligible)) {
    if (!item.email || !item.supervisorEmail || item.status === "ignored") continue;
    const current = grouped.get(item.matricula);
    if (current) {
      current.dates = [...new Set([...current.dates, item.date])];
      current.categories = [...new Set([...current.categories, item.category])];
      current.ids.push(item.id);
    } else {
      grouped.set(item.matricula, { item, dates: [item.date], categories: [item.category], ids: [item.id] });
    }
  }
  return [...grouped.values()].map((draft) => ({ ...draft, dates: draft.dates.sort((a, b) => dateKey(a).localeCompare(dateKey(b))) }));
}
function manualEmailRecipients(item: Occurrence) {
  return [...new Set([item.email, item.supervisorEmail, POINT_ADMIN_REPLY_TO].filter(Boolean))];
}
function downloadCsv(items: Occurrence[], filePrefix = "emails-ponto") {
  const headers = ["Para", "Cc", "Responder para", "Assunto", "Mensagem", "Colaborador", "Matrícula", "Datas", "Ocorrências internas"];
  const rows = notificationDrafts(items).map(({ item, dates, categories }) => [
    manualEmailRecipients(item).join(";"),
    "",
    POINT_ADMIN_REPLY_TO,
    emailSubject(item),
    emailBodyFor(item, dates),
    item.collaborator,
    item.matricula,
    dates.join(" | "),
    categories.join(" | "),
  ]);
  const escape = (value: string) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(escape).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
}
type ExportRow = Record<string, string | number | boolean>;
function isoDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
  const [day, month, year] = value.split("/"); return `${year}-${month}-${day}`;
}
function reviewLabel(status: ReviewStatus) { return status === "pending" ? "Aguardando envio" : status === "approved" ? "Notificação enviada" : "Não enviar"; }
function occurrenceStatusLabel(item: Occurrence) {
  if (item.status === "ignored") return isRhOnly(item) ? "Sem providência" : "Não enviar";
  if (isRhOnly(item)) return item.status === "approved" ? "Providência registrada" : "Análise exclusiva do RH";
  if (item.status === "pending" && needsAutomaticNotification(item) && !isInNotificationWindow(item)) return "Período fechado";
  return item.status === "approved" ? "Notificação enviada" : "Aguardando notificação";
}
function occurrenceExportRows(entries: Occurrence[], balances: BalanceRecord[]): ExportRow[] {
  const balanceMap = new Map(balances.map((balance) => [balance.matricula, balance]));
  return entries.map((item) => {
    const balance = balanceMap.get(item.matricula);
    return {
      "Matrícula": item.matricula, "Colaborador": item.collaborator, "E-mail": item.email, "Área": item.area,
      "Supervisor": item.supervisor, "E-mail supervisor": item.supervisorEmail, "Diretor": item.director,
      "E-mail diretor": item.directorEmail, "Unidade": item.unidade, "Data": isoDate(item.date),
      "Tipo de ocorrência": item.category, "Detalhe": item.detail, "Severidade": item.severity,
      "Tratamento": isRhOnly(item) ? "Análise exclusiva do RH" : needsAutomaticNotification(item) && !isInNotificationWindow(item) ? "Período fechado - somente histórico" : "Notificação ao colaborador",
      "Status da notificação": occurrenceStatusLabel(item), "Quantidade de batidas": item.punches.length,
      "Batida 1": item.punches[0] || "", "Batida 2": item.punches[1] || "", "Batida 3": item.punches[2] || "",
      "Batida 4": item.punches[3] || "", "Batida 5": item.punches[4] || "", "Batida 6": item.punches[5] || "",
      "Marcações": item.punches.join(" | "), "Escala atual": item.schedule,
      "Escala sugerida - código": item.scaleSuggestion?.code || "", "Escala sugerida": item.scaleSuggestion?.description || "",
      "Decisão sobre escala": item.scaleSuggestion ? (item.scaleSuggestion.status === "suggested" ? "Conferir sugestão" : "Troca não recomendada") : "",
      "Motivo da sugestão": item.scaleSuggestion?.reason || "", "Horas registradas na semana": item.scaleSuggestion ? item.scaleSuggestion.weeklyMinutes / 60 : "",
      "Saldo banco (minutos)": balance?.minutes ?? "", "Saldo banco": balance?.label || "", "Banco acima de ±16h": balance?.critical ? "Sim" : "Não",
    };
  });
}
function dailyExportRows(result: ParseResult, entries: Occurrence[]): ExportRow[] {
  const occurrenceMap = new Map<string, Occurrence[]>();
  for (const item of entries) {
    const key = `${item.matricula}|${item.date}`;
    occurrenceMap.set(key, [...(occurrenceMap.get(key) || []), item]);
  }
  const balanceMap = new Map(result.balances.map((balance) => [balance.matricula, balance]));
  return result.days.map((day) => {
    const dayOccurrences = occurrenceMap.get(`${day.matricula}|${day.date}`) || [];
    const categories = new Set(dayOccurrences.map((item) => item.category));
    const suggestion = dayOccurrences.find((item) => item.scaleSuggestion)?.scaleSuggestion;
    const balance = balanceMap.get(day.matricula);
    return {
      "Matrícula": day.matricula, "Colaborador": day.collaborator, "E-mail": day.email, "Área": day.area,
      "Supervisor": day.supervisor, "E-mail supervisor": day.supervisorEmail, "Diretor": day.director, "E-mail diretor": day.directorEmail,
      "Unidade": day.unidade, "Data": isoDate(day.date), "Início da semana": weekKey(day.date),
      "Escala atual": day.schedule, "Código da escala": day.scheduleCode, "Código do horário": day.timeCode, "Carga semanal contratual": day.weeklyHours ?? "", "Quantidade de batidas": day.punches.length,
      "Batida 1": day.punches[0] || "", "Batida 2": day.punches[1] || "", "Batida 3": day.punches[2] || "",
      "Batida 4": day.punches[3] || "", "Batida 5": day.punches[4] || "", "Batida 6": day.punches[5] || "",
      "Marcações": day.punches.join(" | "), "Minutos previstos no dia": day.expectedMinutes, "Horas previstas no dia": day.expectedMinutes / 60,
      "Minutos trabalhados no dia": day.workedMinutes, "Horas trabalhadas no dia": day.workedMinutes / 60,
      "Minutos lançados no banco no dia": day.bankMinutes, "Banco de horas do dia": day.bankMinutes / 60, "Folga/feriado/afastamento": day.nonWorkingReason,
      "Minutos trabalhados na semana": day.weeklyMinutes, "Horas trabalhadas na semana": day.weeklyMinutes / 60,
      "Ocorrências": [...categories].join(" | "), "Detalhes do relatório": day.issues.join(" | "),
      "Status da notificação": dayOccurrences.length ? [...new Set(dayOccurrences.map((item) => reviewLabel(item.status)))].join(" | ") : "Sem ocorrência",
      "Severidade": [...new Set(dayOccurrences.map((item) => item.severity))].join(" | "),
      "Fora da escala": categories.has("Fora da escala") ? "Sim" : "Não", "Ausência de batida": categories.has("Ausência de batida") ? "Sim" : "Não",
      "Batidas incompletas": categories.has("Batidas incompletas") ? "Sim" : "Não", "Falta": categories.has("Falta") ? "Sim" : "Não",
      "Marcação errada": categories.has("Marcação errada") ? "Sim" : "Não", "Intervalo irregular": (categories.has("Intervalo não respeitado") || categories.has("Intervalo irregular")) ? "Sim" : "Não",
      "Interjornada menor que 11h": categories.has("Interjornada menor que 11h") ? "Sim" : "Não", "Três turnos no dia": categories.has("Três turnos no mesmo dia") ? "Sim" : "Não",
      "Escala sugerida - código": suggestion?.code || "", "Escala sugerida": suggestion?.description || "",
      "Decisão sobre escala": suggestion ? (suggestion.status === "suggested" ? "Conferir sugestão" : "Troca não recomendada") : "",
      "Motivo da sugestão": suggestion?.reason || "", "Saldo banco (minutos)": balance?.minutes ?? "", "Saldo banco": balance?.label || "",
      "Banco acima de ±16h": balance?.critical ? "Sim" : "Não", "Cadastro localizado": day.email ? "Sim" : "Não",
    };
  });
}
function balanceExportRows(balances: BalanceRecord[]): ExportRow[] {
  return balances.map((balance) => ({ "Matrícula": balance.matricula, "Colaborador": balance.collaborator, "E-mail": balance.email, "Área": balance.area, "Supervisor": balance.supervisor, "E-mail supervisor": balance.supervisorEmail, "Diretor": balance.director, "E-mail diretor": balance.directorEmail, "Unidade": balance.unidade, "Competência oficial": balance.sourceMonth ? monthLabel(balance.sourceMonth) : "", "Arquivo fonte": balance.sourceFile, "Critério": "Último Saldo BH Acumulado informado pelo FPW", "Saldo (minutos)": balance.minutes, "Saldo acumulado": balance.label, "Acima de ±16h": balance.critical ? "Sim" : "Não" }));
}
function monthlyBalanceExportRows(balances: MonthlyBalanceRecord[]): ExportRow[] {
  return balances.map((balance) => ({
    "Matrícula": balance.matricula, "Colaborador": balance.collaborator, "E-mail": balance.email,
    "Área": balance.area, "Supervisor": balance.supervisor, "E-mail supervisor": balance.supervisorEmail,
    "Competência": balance.monthLabel, "Saldo inicial (minutos)": balance.initialMinutes,
    "Créditos do mês (minutos)": balance.creditMinutes, "Débitos do mês (minutos)": balance.debitMinutes,
    "Saldo acumulado oficial (minutos)": balance.accumulatedMinutes,
    "Saldo acumulado oficial": balance.accumulatedLabel, "Acima de ±16h": balance.critical ? "Sim" : "Não",
    "Arquivo fonte": balance.fileName,
  }));
}
function sourceFilesExportRows(files: MonthlySourceFile[]): ExportRow[] {
  return files.map((file) => ({ "Competência": file.monthLabel, "Arquivo": file.fileName, "Primeira data": isoDate(file.firstDate), "Última data": isoDate(file.lastDate), "Data final exigida": file.expectedLastDate, "Validação": file.complete ? "Completo" : "Incompleto" }));
}
function hoursSummaryExportRows(rows: HoursSummary[], periodStart: string, periodEnd: string): ExportRow[] {
  return rows.map((row) => ({
    "Matrícula": row.matricula, "Colaborador": row.collaborator, "Área": row.area, "Responsável": row.supervisor,
    "Mês": row.monthLabel, "Início dos cálculos": "01/01/2026", "Início do período selecionado": displayIsoDate(periodStart), "Fim do período selecionado": displayIsoDate(periodEnd), "Carga semanal contratual": row.weeklyHours ?? "",
    "Escala(s) no período": row.schedules.join(" | "), "Dias previstos de trabalho": row.scheduledDays,
    "Folgas/feriados/afastamentos": row.nonWorkingDays, "Horas previstas": row.expectedMinutes / 60,
    "Horas batidas no ponto": row.workedMinutes / 60, "Diferença batidas menos previstas": row.bankMinutes / 60,
    "Saldo inicial oficial FPW": row.officialInitialMinutes === null ? "" : row.officialInitialMinutes / 60,
    "Créditos oficiais FPW": row.officialCreditMinutes === null ? "" : row.officialCreditMinutes / 60,
    "Débitos oficiais FPW": row.officialDebitMinutes === null ? "" : row.officialDebitMinutes / 60,
    "Saldo acumulado oficial FPW": row.officialAccumulatedMinutes === null ? "" : row.officialAccumulatedMinutes / 60,
    "Saldo oficial acima de ±16h": row.officialAccumulatedMinutes === null ? "" : row.officialCritical ? "Sim" : "Não",
    "Arquivo mensal": row.officialFileName,
    "Dias com batidas incompletas": row.incompleteDays,
  }));
}
function unmatchedExportRows(people: UnmatchedPerson[]): ExportRow[] { return people.map((person) => ({ "Matrícula": person.matricula, "Nome no ponto": person.nome, "Situação": "Verificar cadastro" })); }
function downloadExcel(filename: string, sheets: { name: string; rows: ExportRow[] }[]) {
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

function clockDurationLabel(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "";
  const absolute = Math.abs(minutes);
  const value = `${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  return minutes < 0 ? `-${value}` : value;
}
function weekdayShort(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return "";
  const [day, month, year] = value.split("/").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day))).replace(".", "");
}
function pointIssueSummary(day: MonthlyDay) {
  const entries = day.issueEntries || [];
  const fallback = (day.issues || []).join(" | ");
  return {
    irregularity: entries.map((entry) => entry.label).filter(Boolean).join(" | ") || day.nonWorkingReason || fallback,
    quantity: entries.map((entry) => clockDurationLabel(entry.quantityMinutes)).filter(Boolean).join(" | "),
    justification: entries.map((entry) => entry.justification).filter(Boolean).join(" | "),
  };
}
function pointCardExportRows(days: MonthlyDay[]): ExportRow[] {
  return days.map((day) => {
    const issue = pointIssueSummary(day);
    const punches = day.punches || [];
    return {
      "Dia sem.": weekdayShort(day.date), "Data": day.date, "Código horário": day.timeCode || "",
      "Código escala": day.scheduleCode || "", "Entrada 1": punches[0] || "", "Saída 1": punches[1] || "",
      "Entrada 2": punches[2] || "", "Saída 2": punches[3] || "", "Entrada 3": punches[4] || "",
      "Saída 3": punches[5] || "", "Irregularidade": issue.irregularity, "QTDE": issue.quantity,
      "Justificativa": issue.justification, "ADIC NO TURNO": day.nightAdditionalMinutes ? clockDurationLabel(day.nightAdditionalMinutes) : "",
      "Horas previstas": day.expectedMinutes / 60, "Horas batidas": day.workedMinutes / 60,
    };
  });
}

function MonthlyBalanceChart({ balances, start, end }: { balances: MonthlyBalanceRecord[]; start: string; end: string }) {
  const [selectedEmployee, setSelectedEmployee] = useState("all");
  const employeeOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const balance of balances) values.set(balance.matricula, balance.collaborator);
    return [...values].map(([matricula, collaborator]) => ({ matricula, collaborator }))
      .sort((a, b) => a.collaborator.localeCompare(b.collaborator, "pt-BR"));
  }, [balances]);
  useEffect(() => {
    if (selectedEmployee !== "all" && !employeeOptions.some((option) => option.matricula === selectedEmployee)) setSelectedEmployee("all");
  }, [employeeOptions, selectedEmployee]);
  const bars = useMemo(() => {
    const firstMonth = start?.slice(0, 7) || "";
    const lastMonth = end?.slice(0, 7) || "9999-12";
    const grouped = new Map<string, number>();
    balances
      .filter((balance) => (!firstMonth || balance.month >= firstMonth) && balance.month <= lastMonth)
      .filter((balance) => selectedEmployee === "all" || balance.matricula === selectedEmployee)
      .forEach((balance) => grouped.set(balance.month, (grouped.get(balance.month) || 0) + balance.accumulatedMinutes));
    return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([month, minutes]) => ({ month, label: monthLabel(month), minutes }));
  }, [balances, start, end, selectedEmployee]);
  const maxAbsolute = Math.max(1, ...bars.map((bar) => Math.abs(bar.minutes)));
  const selectedName = selectedEmployee === "all" ? "Todos os colaboradores" : employeeOptions.find((option) => option.matricula === selectedEmployee)?.collaborator || "Colaborador";
  return <div className="border-b border-slate-200 bg-slate-50/60 px-5 py-5 lg:px-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-black text-slate-800">Evolução mensal do saldo oficial</p><p className="mt-1 text-xs leading-5 text-slate-500">Cada coluna usa o Saldo BH Acumulado do FPW. Positivo em verde e negativo em vermelho.</p></div>
      <label className="w-full text-xs font-bold uppercase tracking-wide text-slate-500 lg:w-[360px]">Colaborador
        <select value={selectedEmployee} onChange={(event) => setSelectedEmployee(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none focus:border-[#123d72]">
          <option value="all">Todos os colaboradores</option>{employeeOptions.map((option) => <option key={option.matricula} value={option.matricula}>{option.collaborator} · {option.matricula}</option>)}
        </select>
      </label>
    </div>
    {bars.length ? <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <div className="relative" style={{ minWidth: `${Math.max(680, bars.length * 92)}px` }}>
        <div className="pointer-events-none absolute inset-x-0 top-[128px] z-0 flex items-center"><span className="mr-2 text-[10px] font-bold text-slate-400">0h</span><span className="h-px flex-1 bg-slate-300"/></div>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(72px, 1fr))` }}>
          {bars.map((bar) => {
            const height = Math.max(2, Math.round((Math.abs(bar.minutes) / maxAbsolute) * 42));
            const positive = bar.minutes >= 0;
            return <div key={bar.month} className="relative z-10 text-center" title={`${selectedName} · ${bar.label}: ${signedDurationLabel(bar.minutes)}`}>
              <div className="relative h-64">
                <span className={`absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-black shadow-sm ${positive ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`} style={positive ? { bottom: `calc(50% + ${height}% + 4px)` } : { top: `calc(50% + ${height}% + 4px)` }}>{signedDurationLabel(bar.minutes)}</span>
                <span className={`absolute left-1/2 w-10 -translate-x-1/2 rounded-sm ${positive ? "bg-emerald-600" : "bg-red-600"}`} style={positive ? { height: `${height}%`, bottom: "50%" } : { height: `${height}%`, top: "50%" }}/>
              </div>
              <p className="mt-2 text-xs font-black text-slate-600">{bar.label}</p>
            </div>;
          })}
        </div>
      </div>
    </div> : <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-400">Não há saldos oficiais no período selecionado.</div>}
    <p className="mt-3 text-xs text-slate-500">Em “Todos os colaboradores”, a coluna é a soma dos saldos oficiais de quem registra ponto naquela competência. Selecione uma pessoa para acompanhar sua evolução individual.</p>
  </div>;
}

function PointCardConsultation({ days, balances }: { days: MonthlyDay[]; balances: MonthlyBalanceRecord[] }) {
  const employeeOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const day of days) if ((day.punches || []).length > 0 || day.hasPunches) values.set(day.matricula, day.collaborator);
    return [...values].map(([matricula, collaborator]) => ({ matricula, collaborator }))
      .sort((a, b) => a.collaborator.localeCompare(b.collaborator, "pt-BR"));
  }, [days]);
  const latestAvailable = useMemo(() => days.reduce((latest, day) => {
    const value = isoDate(day.date); return !latest || value > latest ? value : latest;
  }, ""), [days]);
  const initialEnd = latestAvailable || yesterdayIso();
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [start, setStart] = useState(initialEnd ? `${initialEnd.slice(0, 7)}-01` : MONTHLY_ANALYSIS_START);
  const [end, setEnd] = useState(initialEnd);
  useEffect(() => {
    if (selectedEmployee && !employeeOptions.some((option) => option.matricula === selectedEmployee)) setSelectedEmployee("");
  }, [employeeOptions, selectedEmployee]);
  const chooseEmployee = (matricula: string) => {
    setSelectedEmployee(matricula);
    if (!matricula) return;
    const employeeDates = days.filter((day) => day.matricula === matricula).map((day) => isoDate(day.date)).filter(Boolean).sort();
    const latest = employeeDates.at(-1);
    if (latest) { setStart(`${latest.slice(0, 7)}-01`); setEnd(latest); }
  };
  const cardDays = useMemo(() => days
    .filter((day) => day.matricula === selectedEmployee)
    .filter((day) => isoDate(day.date) >= start && isoDate(day.date) <= end)
    .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date))), [days, selectedEmployee, start, end]);
  const employee = days.find((day) => day.matricula === selectedEmployee);
  const schedules = [...new Set(cardDays.map((day) => day.scheduleCode ? `${day.scheduleCode} · ${day.schedule}` : day.schedule).filter(Boolean))];
  const balance = [...balances]
    .filter((item) => item.matricula === selectedEmployee && item.month <= end.slice(0, 7))
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const exportCard = () => {
    if (!employee || !cardDays.length) return;
    const summary: ExportRow = {
      "Matrícula": employee.matricula, "Colaborador": employee.collaborator, "Lotação": employee.area,
      "Unidade": employee.unidade || "", "Carga semanal": employee.weeklyHours ?? "", "Escala(s)": schedules.join(" | "),
      "Data inicial": displayIsoDate(start), "Data final": displayIsoDate(end), "Competência do resumo FPW": balance?.monthLabel || "",
      "Saldo BH inicial": balance ? clockDurationLabel(balance.initialMinutes) : "", "Créditos do mês": balance ? clockDurationLabel(balance.creditMinutes) : "",
      "Débitos do mês": balance ? clockDurationLabel(balance.debitMinutes) : "", "Saldo BH acumulado": balance ? clockDurationLabel(balance.accumulatedMinutes) : "",
    };
    downloadExcel(`cartao-ponto-${employee.matricula}`, [{ name: "Cartão de Ponto", rows: pointCardExportRows(cardDays) }, { name: "Resumo", rows: [summary] }]);
  };
  return <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 px-5 py-5 lg:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-wider text-[#123d72]">Consulta individual</p><h3 className="mt-1 text-lg font-bold text-slate-800">Cartão de ponto por pessoa e período</h3><p className="mt-1 text-sm leading-6 text-slate-500">Escolha o colaborador e uma data específica ou um período. O visual segue a organização do cartão do FPW, sem timbrado.</p></div>
        <button disabled={!cardDays.length} onClick={exportCard} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><Download size={16}/>Baixar cartão em Excel</button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Colaborador<select value={selectedEmployee} onChange={(event) => chooseEmployee(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-slate-700 outline-none focus:border-[#123d72]"><option value="">Selecione uma pessoa</option>{employeeOptions.map((option) => <option key={option.matricula} value={option.matricula}>{option.collaborator} · {option.matricula}</option>)}</select></label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Data inicial<input type="date" min={MONTHLY_ANALYSIS_START} max={latestAvailable || yesterdayIso()} value={start} onChange={(event) => setStart(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"/></label>
        <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Data final<input type="date" min={MONTHLY_ANALYSIS_START} max={latestAvailable || yesterdayIso()} value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"/></label>
      </div>
    </div>
    {!selectedEmployee ? <div className="px-6 py-14 text-center text-sm text-slate-400">Selecione um colaborador para visualizar o cartão de ponto.</div> : start > end ? <div className="px-6 py-14 text-center text-sm font-semibold text-red-700">A data inicial não pode ser posterior à data final.</div> : <>
      <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">
        {[{ label: "Colaborador", value: employee?.collaborator || "—" }, { label: "Matrícula", value: employee?.matricula || "—" }, { label: "Lotação", value: employee?.area || "—" }, { label: "Carga semanal", value: employee?.weeklyHours ? `${employee.weeklyHours}h` : "Não informada" }, { label: "Período", value: `${displayIsoDate(start)} a ${displayIsoDate(end)}` }].map((item) => <div key={item.label} className="bg-slate-50 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</p><p className="mt-1 text-sm font-bold text-slate-800">{item.value}</p></div>)}
      </div>
      <div className="border-b border-slate-200 bg-white px-5 py-3 text-xs text-slate-600"><strong>Escala(s):</strong> {schedules.join(" | ") || employee?.schedule || "Não identificada"}</div>
      <div className="max-h-[590px] overflow-auto"><table className="w-full min-w-[1480px] border-collapse text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Dia sem.</th><th className="px-3 py-3">Data</th><th className="px-3 py-3">Horário</th><th className="px-3 py-3">Escala</th><th className="px-3 py-3">Entrada 1</th><th className="px-3 py-3">Saída 1</th><th className="px-3 py-3">Entrada 2</th><th className="px-3 py-3">Saída 2</th><th className="px-3 py-3">Entrada 3</th><th className="px-3 py-3">Saída 3</th><th className="px-3 py-3">Irregularidade</th><th className="px-3 py-3">QTDE</th><th className="px-3 py-3">Justificativa</th><th className="px-3 py-3">Adic. no turno</th></tr></thead><tbody className="divide-y divide-slate-100">{cardDays.map((day) => { const punches = day.punches || []; const issue = pointIssueSummary(day); return <tr key={`${day.matricula}-${day.date}`} className="hover:bg-slate-50"><td className="px-3 py-3 font-bold text-slate-500">{weekdayShort(day.date)}</td><td className="whitespace-nowrap px-3 py-3 font-bold text-slate-800">{day.date}</td><td className="px-3 py-3 font-mono">{day.timeCode || "—"}</td><td className="px-3 py-3 font-mono">{day.scheduleCode || "—"}</td>{[0,1,2,3,4,5].map((index) => <td key={index} className="px-3 py-3 font-mono font-semibold text-slate-700">{punches[index] || ""}</td>)}<td className="max-w-[260px] px-3 py-3 text-slate-700">{issue.irregularity}</td><td className="whitespace-nowrap px-3 py-3 font-mono">{issue.quantity}</td><td className="max-w-[230px] px-3 py-3 text-slate-600">{issue.justification}</td><td className="whitespace-nowrap px-3 py-3 font-mono">{day.nightAdditionalMinutes ? clockDurationLabel(day.nightAdditionalMinutes) : ""}</td></tr>; })}{!cardDays.length && <tr><td colSpan={14} className="px-6 py-14 text-center text-slate-400">Nenhum registro encontrado para esta pessoa no período escolhido.</td></tr>}</tbody></table></div>
      <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">
        <div className="bg-slate-50 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Resumo oficial FPW</p><p className="mt-1 text-sm font-bold text-slate-800">{balance?.monthLabel || "Não informado"}</p></div>
        {[{ label: "Saldo BH inicial", minutes: balance?.initialMinutes }, { label: "Créditos do mês", minutes: balance?.creditMinutes }, { label: "Débitos do mês", minutes: balance?.debitMinutes }, { label: "Saldo BH acumulado", minutes: balance?.accumulatedMinutes }].map((item) => <div key={item.label} className="bg-slate-50 px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</p><p className={`mt-1 text-lg font-black ${item.minutes === undefined ? "text-slate-400" : item.minutes > 0 ? "text-emerald-700" : item.minutes < 0 ? "text-red-700" : "text-slate-700"}`}>{item.minutes === undefined ? "Não informado" : clockDurationLabel(item.minutes)}</p></div>)}
      </div>
    </>}
  </section>;
}

function MonthlyConsultation({
  access, days, balances, unitName, sourcePeriod, updatedAt, updatedBy, loading, error, onRefresh,
}: {
  access: AccessInfo;
  days: MonthlyDay[];
  balances: MonthlyBalanceRecord[];
  unitName: string;
  sourcePeriod: string;
  updatedAt: string;
  updatedBy: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const [start, setStart] = useState(MONTHLY_ANALYSIS_START);
  const [end, setEnd] = useState(yesterdayIso());
  const [query, setQuery] = useState("");
  const [responsible, setResponsible] = useState("all");
  const responsibleOptions = useMemo(() => [...new Set(days.map((day) => day.supervisor).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [days]);
  const responsibleDays = useMemo(() => days.filter((day) => responsible === "all" || day.supervisor === responsible), [days, responsible]);
  const filteredDays = useMemo(() => {
    const term = normalize(query);
    return responsibleDays.filter((day) => !term || normalize(`${day.collaborator} ${day.matricula} ${day.area}`).includes(term));
  }, [responsibleDays, query]);
  const responsibleBalances = useMemo(() => balances.filter((balance) => responsible === "all" || balance.supervisor === responsible), [balances, responsible]);
  const chartBalances = useMemo(() => {
    const clocking = new Set(responsibleDays.filter((day) => day.hasPunches || (day.punches || []).length > 0).map((day) => day.matricula));
    return responsibleBalances.filter((balance) => clocking.has(balance.matricula));
  }, [responsibleDays, responsibleBalances]);
  const visibleRows = useMemo(() => attachOfficialMonthlyBalances(summarizeMonthlyDays(filteredDays, start, end), responsibleBalances), [filteredDays, responsibleBalances, start, end]);
  const totals = useMemo(() => visibleRows.reduce((value, row) => ({
    expected: value.expected + row.expectedMinutes,
    worked: value.worked + row.workedMinutes,
    bank: value.bank + row.bankMinutes,
  }), { expected: 0, worked: 0, bank: 0 }), [visibleRows]);
  const updatedLabel = updatedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(updatedAt)) : "Ainda não salvo";
  return <main className="min-h-screen bg-[#f4f7fb] text-[#17233a]">
    <LocalToolbar/>
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#123d72] text-white shadow-sm"><Clock3 size={21}/></div><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d43137]">SENAI · Gestão</p><h1 className="text-lg font-bold tracking-tight">Consulta mensal do ponto</h1></div></div>
        <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">{access.label}</span><button disabled={loading} onClick={onRefresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"><RefreshCw size={16} className={loading ? "animate-spin" : ""}/>Atualizar</button></div>
      </div>
    </header>
    <div className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
      <section className="mb-5 flex flex-col gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-[#123d72]">{unitName || DEFAULT_UNIT}</p><p className="mt-1 text-sm text-blue-900/70">Consulta somente para leitura. Os dados são publicados pelo RH.</p></div><p className="text-xs text-blue-900/65">Atualizado em {updatedLabel}{updatedBy ? ` por ${updatedBy}` : ""}{sourcePeriod ? ` · arquivo: ${sourcePeriod}` : ""}</p></section>
      {error ? <section className="grid min-h-[320px] place-items-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm"><div><AlertTriangle size={30} className="mx-auto text-red-600"/><h2 className="mt-4 text-xl font-bold">Não foi possível abrir a consulta</h2><p className="mt-2 text-sm text-slate-600">{error}</p></div></section> : <><section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 lg:px-6"><div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-wider text-[#123d72]">Carga horária mensal</p><h2 className="mt-1 text-xl font-bold text-slate-800">Carga prevista, horas batidas e saldo oficial FPW</h2><p className="mt-1 text-sm leading-6 text-slate-500">Consulta de 01/01/2026 até ontem, organizada por colaborador e competência. A diferença entre batidas e carga prevista serve para conferência; a evolução oficial vem do Saldo BH Acumulado de cada arquivo mensal.</p></div><button disabled={!visibleRows.length} onClick={() => downloadExcel("consulta-mensal-do-ponto", [{ name: "Carga e Banco Mensal", rows: hoursSummaryExportRows(visibleRows, start, end) }])} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><Download size={16}/>Baixar Excel</button></div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[165px_165px_220px_1fr]"><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Data inicial<input type="date" min={MONTHLY_ANALYSIS_START} max={yesterdayIso()} value={start} onChange={(event) => setStart(event.target.value < MONTHLY_ANALYSIS_START ? MONTHLY_ANALYSIS_START : event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"/></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Data final<input type="date" min={MONTHLY_ANALYSIS_START} max={yesterdayIso()} value={end} onChange={(event) => setEnd(event.target.value > yesterdayIso() ? yesterdayIso() : event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"/></label><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Responsável<select value={responsible} onChange={(event) => setResponsible(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"><option value="all">Todos os responsáveis</option>{responsibleOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label className="relative self-end"><span className="sr-only">Buscar colaborador</span><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar colaborador, matrícula ou área" className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#123d72]"/></label></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Carga prevista no período</p><p className="mt-1 text-xl font-black text-[#123d72]">{durationLabel(totals.expected)}</p></div><div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Horas batidas no ponto</p><p className="mt-1 text-xl font-black text-slate-800">{durationLabel(totals.worked)}</p></div><div className={`rounded-xl p-4 ${totals.bank > 0 ? "bg-emerald-50" : totals.bank < 0 ? "bg-red-50" : "bg-slate-100"}`}><p className={`text-xs font-bold uppercase tracking-wide ${totals.bank > 0 ? "text-emerald-700" : totals.bank < 0 ? "text-red-700" : "text-slate-600"}`}>Diferença para conferência</p><p className={`mt-1 text-xl font-black ${totals.bank > 0 ? "text-emerald-700" : totals.bank < 0 ? "text-red-700" : "text-slate-700"}`}>{signedDurationLabel(totals.bank)}</p></div></div>
        </div>
        <MonthlyBalanceChart balances={chartBalances} start={start} end={end}/>
        {start > end ? <div className="px-6 py-12 text-center text-sm font-semibold text-red-700">A data inicial não pode ser posterior à data final.</div> : <div className="max-h-[650px] overflow-auto"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Mês</th><th className="px-5 py-3">Carga/escala</th><th className="px-5 py-3">Carga prevista</th><th className="px-5 py-3">Horas batidas</th><th className="px-5 py-3">Diferença</th><th className="px-5 py-3">Saldo oficial FPW</th><th className="px-5 py-3">Conferência</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row) => <tr key={`${row.matricula}-${row.month}`} className="hover:bg-slate-50"><td className="px-5 py-4"><span className="block font-bold text-slate-800">{row.collaborator}</span><span className="text-xs text-slate-400">{row.matricula} · {row.area}</span></td><td className="whitespace-nowrap px-5 py-4 text-base font-black text-[#123d72]">{row.monthLabel}</td><td className="max-w-[300px] px-5 py-4"><span className="block font-semibold text-slate-700">{row.weeklyHours ? `${row.weeklyHours}h semanais` : "Carga semanal não informada"}</span><span className="mt-1 block truncate text-xs text-slate-500" title={row.schedules.join(" | ")}>{row.schedules.join(" | ") || "Escala não identificada"}</span></td><td className="px-5 py-4"><span className="text-lg font-black text-[#123d72]">{durationLabel(row.expectedMinutes)}</span><span className="block text-xs text-slate-400">{row.scheduledDays} dia(s) previsto(s)</span></td><td className="px-5 py-4 text-lg font-black text-slate-800">{durationLabel(row.workedMinutes)}</td><td className={`px-5 py-4 text-lg font-black ${row.bankMinutes > 0 ? "text-emerald-700" : row.bankMinutes < 0 ? "text-red-700" : "text-slate-600"}`}>{signedDurationLabel(row.bankMinutes)}</td><td className={`px-5 py-4 text-lg font-black ${row.officialAccumulatedMinutes === null ? "text-slate-400" : row.officialAccumulatedMinutes > 0 ? "text-emerald-700" : row.officialAccumulatedMinutes < 0 ? "text-red-700" : "text-slate-600"}`}>{row.officialAccumulatedMinutes === null ? "Não informado" : signedDurationLabel(row.officialAccumulatedMinutes)}{row.officialAccumulatedMinutes !== null && <span className="mt-1 block text-[11px] font-semibold text-slate-400">Inicial {signedDurationLabel(row.officialInitialMinutes || 0)} · créditos {durationLabel(row.officialCreditMinutes || 0)} · débitos {durationLabel(row.officialDebitMinutes || 0)}</span>}</td><td className="px-5 py-4">{row.incompleteDays ? <span className="severity severity-alta">{row.incompleteDays} dia(s) com batida incompleta</span> : <span className="status status-approved">Cálculo completo</span>}{row.officialCritical && <span className="ml-2 severity severity-alta">Saldo acima de ±16h</span>}<span className="mt-1 block text-xs text-slate-400">{row.nonWorkingDays} folga(s)/feriado(s)/afastamento(s)</span></td></tr>)}{!visibleRows.length && <tr><td colSpan={8} className="px-6 py-14 text-center text-slate-400">Nenhum colaborador que registra ponto foi encontrado neste período.</td></tr>}</tbody></table></div>}
      </section><PointCardConsultation days={responsibleDays} balances={responsibleBalances}/></>}
    </div>
  </main>;
}

type ImportedBase = { contacts: Contact[]; inactiveMatriculas: string[]; unidade: string; fileName: string; inactiveSkipped: number };
function normalizedHeader(value: string) { return normalize(value).replace(/[^a-z0-9]/g, ""); }
function rowCell(row: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedHeader));
  const entry = Object.entries(row).find(([key]) => wanted.has(normalizedHeader(key)));
  return clean(String(entry?.[1] ?? ""));
}
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
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
async function parseContactsFile(file: File): Promise<ImportedBase> {
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
  const director = directorRow ? rowCell(directorRow, ["NOME"]) : DEFAULT_DIRECTOR.name;
  const directorEmail = directorRow ? rowCell(directorRow, ["EMAIL", "E-MAIL"]) : "";
  const unidade = activeRows[0] ? rowCell(activeRows[0], ["LOTAÇÃO", "LOTACAO"]) : DEFAULT_UNIT;
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
    const cargo = rowCell(row, ["CARGO"]);
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
    const assignmentText = normalize(`${crDescricao} ${funcao} ${cargo}`);
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

export default function Home() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [inactiveMatriculas, setInactiveMatriculas] = useState<string[]>([]);
  const [baseFileName, setBaseFileName] = useState("Nenhuma base importada");
  const [unitName, setUnitName] = useState(DEFAULT_UNIT);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [items, setItems] = useState<Occurrence[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"email" | "all" | ReviewStatus>("pending");
  const [categoryFilter, setCategoryFilter] = useState<CorrectionFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [balanceQuery, setBalanceQuery] = useState("");
  const [hoursQuery, setHoursQuery] = useState("");
  const [hoursStart, setHoursStart] = useState("");
  const [hoursEnd, setHoursEnd] = useState("");
  const [criticalBalancesOnly, setCriticalBalancesOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetailState] = useState<Occurrence | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [priorityList, setPriorityList] = useState<PriorityFilter | null>(null);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [mailSender, setMailSender] = useState("");
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState("");
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [sharedLoading, setSharedLoading] = useState(true);
  const [sharedError, setSharedError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [lastUpdatedBy, setLastUpdatedBy] = useState("");
  const [consultationDays, setConsultationDays] = useState<MonthlyDay[]>([]);
  const [consultationBalances, setConsultationBalances] = useState<MonthlyBalanceRecord[]>([]);
  const [sourcePeriod, setSourcePeriod] = useState("");
  const [savingShared, setSavingShared] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  const canManage = Boolean(access?.canManage);
  const currentNotificationWindow = notificationWindow();
  const requiredPointFiles = requiredMonthlyFiles();

  const setDetail = (item: Occurrence | null) => {
    if (!item) { setDetailState(null); return; }
    if (isRhOnly(item)) {
      setDetailState({ ...item, email: "", supervisorEmail: "", director: "", directorEmail: "" });
      return;
    }
    if (needsAutomaticNotification(item) && !isInNotificationWindow(item)) {
      setDetailState({ ...item, director: "", directorEmail: "" });
      return;
    }
    const dates = itemsRef.current
      .filter((entry) => entry.matricula === item.matricula && isNotificationEligible(entry) && entry.status !== "ignored")
      .map((entry) => entry.date)
      .filter((date, index, values) => values.indexOf(date) === index)
      .sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
    setDetailState({ ...item, date: dates.join(" | ") || item.date, director: "RH", directorEmail: POINT_ADMIN_REPLY_TO });
  };

  useEffect(() => { itemsRef.current = items; }, [items]);

  const loadSharedData = useCallback(async (showNotice = false) => {
    setSharedLoading(true);
    setSharedError("");
    try {
      const response = await fetch("/api/point-data", { cache: "no-store" });
      const payload = await response.json() as { access?: AccessInfo; snapshot?: SharedSnapshot | null; error?: string };
      if (!response.ok || !payload.access) throw new Error(payload.error || "Não foi possível carregar os dados locais.");
      setAccess(payload.access);
      const snapshot = payload.snapshot;
      if (!snapshot) {
        setContacts([]); setInactiveMatriculas([]); setBaseFileName("Nenhuma base importada"); setUnitName(DEFAULT_UNIT);
        setResult(null); setItems([]); setFileName(""); setLastUpdatedAt(""); setLastUpdatedBy(""); setConsultationDays([]); setConsultationBalances([]); setSourcePeriod("");
        if (showNotice) setNotice("Ainda não há dados locais pelo RH.");
        return;
      }
      const data = snapshot.data;
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      setInactiveMatriculas(Array.isArray(data.inactiveMatriculas) ? data.inactiveMatriculas : []);
      setBaseFileName(data.baseFileName || "Base local");
      setUnitName(data.unitName || data.contacts?.[0]?.unidade || DEFAULT_UNIT);
      setLastUpdatedAt(snapshot.updatedAt || "");
      setLastUpdatedBy(snapshot.updatedByEmail || "");
      setConsultationDays(Array.isArray(data.monthlyDays) ? data.monthlyDays : []);
      setConsultationBalances(Array.isArray(data.monthlyBalances) ? data.monthlyBalances : []);
      setSourcePeriod(data.sourcePeriod || "");
      if (snapshot.analysisVersion !== ANALYSIS_VERSION) {
        setResult(null); setItems([]); setFileName(""); setConsultationDays([]); setConsultationBalances([]);
        setNotice(payload.access.canManage ? "As regras de análise foram atualizadas. Atualize a base CSV do FPW e importe novamente todos os TXT mensais." : "O RH está atualizando os cálculos do painel. Tente novamente em instantes.");
        return;
      }
      const loadedResult = data.result;
      const loadedItems = Array.isArray(data.items) ? data.items : [];
      if (loadedResult) {
        const derivedUnmatched = [...new Map(loadedItems.filter((item) => !item.email).map((item) => [item.matricula, { matricula: item.matricula, nome: item.collaborator }])).values()];
        setResult({ ...loadedResult, balances: loadedResult.balances || [], days: loadedResult.days || [], monthlyBalances: loadedResult.monthlyBalances || [], sourceFiles: loadedResult.sourceFiles || [], unmatchedPeople: loadedResult.unmatchedPeople || derivedUnmatched });
        setItems(loadedItems); setFileName(data.fileName || "");
        setHoursStart(MONTHLY_ANALYSIS_START); setHoursEnd(yesterdayIso());
      } else {
        setResult(null); setItems([]); setFileName(""); setHoursStart(""); setHoursEnd(""); setConsultationBalances([]);
      }
      setSelected(new Set()); setDetail(null); setShowUnmatched(false); setPriorityList(null);
      if (showNotice) setNotice("Dados locais atualizados.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar os dados locais.";
      setSharedError(message);
      if (showNotice) setNotice(message);
    } finally {
      setSharedLoading(false);
    }
  }, []);

  const saveSharedSnapshot = useCallback(async (data: SharedSnapshot["data"]) => {
    setSavingShared(true);
    try {
      const response = await fetch("/api/point-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisVersion: ANALYSIS_VERSION, data }),
      });
      const payload = await response.json() as { snapshot?: SharedSnapshot; error?: string };
      if (!response.ok || !payload.snapshot) throw new Error(payload.error || "Não foi possível salvar os dados locais.");
      setLastUpdatedAt(payload.snapshot.updatedAt || "");
      setLastUpdatedBy(payload.snapshot.updatedByEmail || "");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar os dados locais.");
      return false;
    } finally {
      setSavingShared(false);
    }
  }, []);

  useEffect(() => { void loadSharedData(); }, [loadSharedData]);

  useEffect(() => {
    if (!access?.canManage) {
      setMailConfigured(false);
      setMailSender("");
      return;
    }
    let active = true;
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Conexão indisponível");
        return response.json() as Promise<{ configured?: boolean; sender?: string }>;
      })
      .then((connection) => {
        if (!active) return;
        setMailConfigured(Boolean(connection.configured));
        setMailSender(connection.sender || "");
      })
      .catch(() => {
        if (active) setMailConfigured(false);
      });
    return () => { active = false; };
  }, [access?.canManage]);

  useEffect(() => {
    if (!canManage) return;
    const context = document.modelContext; if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => { try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch {} };
    register({ name: "get_point_review_summary", title: "Consultar resumo da gestão de ponto", description: "Retorna os ajustes de ponto, notificações e alertas prioritários do período ainda corrigível.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => { const period = notificationWindow(); const operational = itemsRef.current.filter((item) => isInWindow(item, period)); const adjustments = operational.filter(needsPointAdjustment); return ({ adjustments_total: adjustments.length, rh_only: adjustments.filter(isRhOnly).length, correction_period: period.label, correction_deadline: period.deadlineLabel, notifications_waiting: operational.filter((i) => isNotificationEligible(i) && i.status === "pending").length, notifications_sent: operational.filter((i) => isNotificationEligible(i) && i.status === "approved").length, notifications_suppressed: operational.filter((i) => isNotificationEligible(i) && i.status === "ignored").length, priority_alerts: operational.filter((i) => i.category === "Intervalo não respeitado" || i.category === "Intervalo irregular" || i.category === "Interjornada menor que 11h" || i.category === "Três turnos no mesmo dia" || i.category === "Saldo crítico de banco de horas").length, critical_balance_alerts: operational.filter((i) => i.category === "Saldo crítico de banco de horas").length }); } });
    register({ name: "get_point_notification_status", title: "Consultar notificações automáticas de ponto", description: "Retorna mensagens acumuladas por colaborador, sem expor o tipo da ocorrência.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: () => ({ notifications: notificationDrafts(itemsRef.current).map(({ item, dates }) => ({ notification_key: notificationKey(item), status: occurrenceStatusLabel(item), to: [item.email], cc: [item.supervisorEmail, POINT_ADMIN_REPLY_TO].filter(Boolean), reply_to: POINT_ADMIN_REPLY_TO, dates, subject: emailSubject(item), body: emailBodyFor(item, dates) })) }) });
    return () => lifecycle.abort();
  }, [canManage]);

  const resetAnalysisState = () => {
    setResult(null); setItems([]); setSelected(new Set()); setFilter("pending"); setCategoryFilter("all"); setPriorityFilter("all");
    setResponsibleFilter("all"); setQuery(""); setBalanceQuery(""); setHoursQuery(""); setHoursStart(""); setHoursEnd(""); setCriticalBalancesOnly(false); setFileName(""); setDetail(null); setShowUnmatched(false); setPriorityList(null);
    setConsultationDays([]); setConsultationBalances([]); setSourcePeriod("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const sendNotifications = async (sourceItems: Occurrence[], baseItems = itemsRef.current, dataResult = result, dataFileName = fileName) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    const notifications = notificationDrafts(sourceItems);
    if (!notifications.length) {
      const period = notificationWindow();
      setNotice(`Nenhuma notificação pôde ser preparada no período aberto: ${period.label}. Verifique também os e-mails dos colaboradores e responsáveis.`);
      return;
    }
    if (!mailConfigured) {
      setNotice(`${notifications.length} notificação${notifications.length === 1 ? " preparada" : "ões preparadas"}. Use o botão Outlook Web ou Outlook clássico para preparar o rascunho, ou exporte o CSV. O envio é feito no Outlook.`);
      return;
    }

    setSending(true);
    setSendProgress(`Enviando 0 de ${notifications.length}`);
    const results: NotificationApiResult[] = [];
    try {
      for (let index = 0; index < notifications.length; index += 20) {
        const batch = notifications.slice(index, index + 20);
        const response = await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notifications: batch.map(({ item, categories, dates }) => ({
            employeeId: item.matricula,
            employeeName: item.collaborator,
            employeeEmail: item.email,
            supervisorEmail: item.supervisorEmail,
            rhEmail: POINT_ADMIN_REPLY_TO,
            dates,
            categories,
          })) }),
        });
        const payload = await response.json() as { configured?: boolean; results?: NotificationApiResult[]; error?: string };
        if (!response.ok) {
          if (payload.configured === false) setMailConfigured(false);
          throw new Error(payload.error || "O lote não pôde ser enviado.");
        }
        results.push(...(payload.results || []));
        setSendProgress(`Enviando ${Math.min(index + batch.length, notifications.length)} de ${notifications.length}`);
      }
      const completed = new Set(results.filter((result) => result.status === "sent" || result.status === "already_sent").map((result) => result.key));
      const completedIds = new Set(notifications.filter((draft) => completed.has(notificationKey(draft.item))).flatMap((draft) => draft.ids));
      const notifiedAt = new Date().toISOString();
      const nextItems = baseItems.map((item) => completedIds.has(item.id) ? { ...item, status: "approved" as ReviewStatus, notifiedAt, notificationMethod: "automatic" as const } : item);
      itemsRef.current = nextItems;
      setItems(nextItems);
      if (dataResult) await saveSharedSnapshot({ contacts, inactiveMatriculas, baseFileName, unitName, result: dataResult, items: nextItems, fileName: dataFileName });
      const sent = results.filter((result) => result.status === "sent").length;
      const duplicates = results.filter((result) => result.status === "already_sent").length;
      const failed = results.filter((result) => result.status === "failed").length;
      setNotice(`${sent} notificação${sent === 1 ? " enviada" : "ões enviadas"}${duplicates ? ` · ${duplicates} já enviada${duplicates === 1 ? "" : "s"} anteriormente` : ""}${failed ? ` · ${failed} falhou${failed === 1 ? "" : "ram"}` : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "O envio automático não pôde ser concluído.");
    } finally {
      setSending(false);
      setSendProgress("");
      setSelected(new Set());
    }
  };

  const recordManualNotification = async (draft: NotificationDraft, method: "outlook-web" | "outlook-classic") => {
    const target = new Set(draft.ids);
    const notifiedAt = new Date().toISOString();
    const previousItems = itemsRef.current;
    const nextItems = previousItems.map((item) => target.has(item.id)
      ? { ...item, status: "approved" as ReviewStatus, notifiedAt, notificationMethod: method }
      : item);
    itemsRef.current = nextItems;
    setItems(nextItems);
    setSelected(new Set());
    if (result) {
      const saved = await saveSharedSnapshot({ contacts, inactiveMatriculas, baseFileName, unitName, result, items: nextItems, fileName });
      if (!saved) {
        itemsRef.current = previousItems;
        setItems(previousItems);
        return false;
      }
    }
    setNotice(`E-mail de ${draft.item.collaborator} registrado como enviado. O botão foi retirado da lista “Enviar e-mail”.`);
    return true;
  };

  const openOutlookClassic = async (sourceItems: Occurrence[]) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    const employeeIds = new Set(sourceItems.filter(isNotificationEligible).map((item) => item.matricula));
    const cumulativeItems = itemsRef.current.filter((item) => employeeIds.has(item.matricula) && isNotificationEligible(item) && item.status !== "ignored");
    const drafts = notificationDrafts(cumulativeItems);
    if (!drafts.length) {
      const period = notificationWindow();
      setNotice(`Esta ocorrência não pode ser enviada. Período disponível: ${period.label}. Também são necessários os e-mails do colaborador e do responsável.`);
      return;
    }
    if (drafts.length > 1) {
      setNotice("Para o teste no Outlook clássico, selecione somente um colaborador por vez.");
      return;
    }
    const draft = drafts[0];
    const recipients = manualEmailRecipients(draft.item);
    const query = [
      `subject=${encodeURIComponent(emailSubject(draft.item))}`,
      `body=${encodeURIComponent(emailBodyFor(draft.item, draft.dates))}`,
    ].join("&");
    const recorded = await recordManualNotification(draft, "outlook-classic");
    if (!recorded) return;
    window.location.href = `mailto:${recipients.map((email) => encodeURIComponent(email)).join(",")}?${query}`;
  };

  const openOutlookWeb = async (sourceItems: Occurrence[]) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    const employeeIds = new Set(sourceItems.filter(isNotificationEligible).map((item) => item.matricula));
    const cumulativeItems = itemsRef.current.filter((item) => employeeIds.has(item.matricula) && isNotificationEligible(item) && item.status !== "ignored");
    const drafts = notificationDrafts(cumulativeItems);
    if (!drafts.length) {
      const period = notificationWindow();
      setNotice(`Esta ocorrência não pode ser enviada. Período disponível: ${period.label}. Também são necessários os e-mails do colaborador e do responsável.`);
      return;
    }
    if (drafts.length > 1) {
      setNotice("Para abrir no Outlook, selecione somente um colaborador por vez.");
      return;
    }
    const draft = drafts[0];
    const proceed = window.confirm(
      `Antes de enviar, confira:\n\n1. O campo Para deve mostrar colaborador, supervisor e RH.\n2. No campo De, selecione ${POINT_SENDER_EMAIL}.\n\nNão envie se algum destinatário estiver faltando ou se outro remetente estiver aparecendo.\n\nClique em OK para abrir o rascunho.`
    );
    if (!proceed) return;
    const recipients = manualEmailRecipients(draft.item);
    const query = [
      `to=${recipients.map((email) => encodeURIComponent(email)).join(",")}`,
      `subject=${encodeURIComponent(emailSubject(draft.item))}`,
      `body=${encodeURIComponent(emailBodyFor(draft.item, draft.dates))}`,
    ].join("&");
    const composeWindow = window.open(`https://outlook.office.com/mail/deeplink/compose?${query}`, "_blank");
    if (!composeWindow) {
      setNotice("O navegador bloqueou a nova janela. Libere pop-ups para este site e tente novamente.");
      return;
    }
    composeWindow.opener = null;
    await recordManualNotification(draft, "outlook-web");
  };

  const processFiles = async (files: File[]) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    if (!contacts.length) { setNotice("Importe primeiro o Relatório - Cargos e Funções - Empregados.csv e depois os TXT mensais do ponto."); return; }
    const previousItems = itemsRef.current;
    setNotice(`Validando ${files.length} arquivo${files.length === 1 ? "" : "s"} mensal${files.length === 1 ? "" : "is"} e substituindo os dados anteriores...`);
    try {
      const parsed = await parseMonthlyFileSet(files, contacts, inactiveMatriculas);
      const previousStatus = new Map<string, Occurrence>(previousItems.map((item) => [`${item.matricula}|${item.date}|${item.category}`, item]));
      const occurrences = parsed.occurrences.map((item) => {
        const previous = previousStatus.get(`${item.matricula}|${item.date}|${item.category}`);
        return previous && previous.status !== "pending"
          ? { ...item, status: previous.status, notifiedAt: previous.notifiedAt, notificationMethod: previous.notificationMethod }
          : item;
      });
      const reconciled = { ...parsed, occurrences };
      const sourceName = `${reconciled.sourceFiles.length} arquivos mensais · ${reconciled.sourceFiles[0]?.monthLabel || ""} a ${reconciled.sourceFiles.at(-1)?.monthLabel || ""}`;
      resetAnalysisState();
      setResult(reconciled); setItems(occurrences); itemsRef.current = occurrences; setFileName(sourceName); setHoursStart(MONTHLY_ANALYSIS_START); setHoursEnd(yesterdayIso());
      setConsultationDays(reconciled.days.map(monthlyDayFromRecord)); setConsultationBalances(reconciled.monthlyBalances); setSourcePeriod(reconciled.period);
      const published = await saveSharedSnapshot({ contacts, inactiveMatriculas, baseFileName, unitName, result: reconciled, items: occurrences, fileName: sourceName });
      if (!published) return;
      const operationalOccurrences = occurrences.filter((item) => isInNotificationWindow(item));
      const adjustments = operationalOccurrences.filter(needsPointAdjustment).length;
      if (occurrences.length) {
        if (mailConfigured) {
          setNotice(`${adjustments} ajuste${adjustments === 1 ? "" : "s"} de ponto identificado${adjustments === 1 ? "" : "s"}. Preparando as notificações automáticas...`);
          await sendNotifications(operationalOccurrences.filter((item) => item.status === "pending"), occurrences, reconciled, sourceName);
        } else {
          const prepared = notificationDrafts(operationalOccurrences.filter((item) => item.status === "pending")).length;
          const rhOnly = operationalOccurrences.filter(isRhOnly).length;
          setNotice(`${reconciled.sourceFiles.length} competências validadas · ${prepared} mensagem${prepared === 1 ? " acumulada preparada" : "s acumuladas preparadas"} para o Outlook clássico · ${rhOnly} ocorrência${rhOnly === 1 ? "" : "s"} para análise exclusiva do RH.`);
        }
      } else {
        setNotice("Arquivos mensais validados sem reaproveitar dados anteriores, mas nenhum ajuste foi identificado.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível ler os TXT mensais. Os dados anteriores foram mantidos; tente importar novamente.");
    }
  };
  const clearLoadedData = async () => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    resetAnalysisState();
    const published = await saveSharedSnapshot({ contacts, inactiveMatriculas, baseFileName, unitName, result: null, items: [], fileName: "" });
    if (published) setNotice("Dados do ponto removidos para todos os acessos. Importe os arquivos mensais para começar.");
  };
  const importContacts = async (file: File) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    setNotice("Validando a base CSV do FPW...");
    try {
      const imported = await parseContactsFile(file);
      setContacts(imported.contacts); setInactiveMatriculas(imported.inactiveMatriculas); setBaseFileName(imported.fileName); setUnitName(imported.unidade);
      resetAnalysisState();
      const published = await saveSharedSnapshot({ contacts: imported.contacts, inactiveMatriculas: imported.inactiveMatriculas, baseFileName: imported.fileName, unitName: imported.unidade, result: null, items: [], fileName: "" });
      if (published) setNotice(`Base de ${imported.unidade} publicada: ${imported.contacts.length} colaborador(es) ativo(s)${imported.inactiveSkipped ? ` e ${imported.inactiveSkipped} inativo(s) ignorado(s)` : ""}. Importe agora os TXT mensais do ponto.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível importar a base CSV do FPW.");
    }
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => { const files = Array.from(event.target.files || []) as File[]; if (files.length) void processFiles(files); };
  const onBaseFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void importContacts(file); };
  const openFilePicker = () => { if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; } if (inputRef.current) { inputRef.current.value = ""; inputRef.current.click(); } };
  const openBasePicker = () => { if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; } if (baseInputRef.current) { baseInputRef.current.value = ""; baseInputRef.current.click(); } };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); const files = Array.from(event.dataTransfer.files || []) as File[]; if (files.length) void processFiles(files); };
  const responsibleOptions = useMemo(() => {
    const options = new Map<string, { key: string; name: string; email: string; people: number }>();
    for (const contact of contacts) {
      const key = contact.supervisorEmail || `name:${normalize(contact.supervisor)}`;
      const current = options.get(key);
      if (current) current.people += 1;
      else options.set(key, { key, name: contact.supervisor, email: contact.supervisorEmail, people: 1 });
    }
    return [...options.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [contacts]);
  const matchesResponsible = useCallback((supervisor: string, supervisorEmail: string) => responsibleFilter === "all" || (supervisorEmail || `name:${normalize(supervisor)}`) === responsibleFilter, [responsibleFilter]);
  const filteredItems = useMemo(() => items.filter((item) => matchesResponsible(item.supervisor, item.supervisorEmail)), [items, matchesResponsible]);
  const operationalItems = useMemo(() => filteredItems.filter((item) => isInWindow(item, currentNotificationWindow)), [filteredItems, currentNotificationWindow.startKey, currentNotificationWindow.endKey]);
  const filteredBalances = useMemo(() => (result?.balances || []).filter((balance) => matchesResponsible(balance.supervisor, balance.supervisorEmail)), [result, matchesResponsible]);
  const filteredMonthlyBalances = useMemo(() => (result?.monthlyBalances || []).filter((balance) => matchesResponsible(balance.supervisor, balance.supervisorEmail)), [result, matchesResponsible]);
  const filteredDays = useMemo(() => (result?.days || []).filter((day) => matchesResponsible(day.supervisor, day.supervisorEmail)), [result, matchesResponsible]);
  const chartMonthlyBalances = useMemo(() => {
    const clocking = new Set(filteredDays.filter((day) => day.punches.length > 0).map((day) => day.matricula));
    return filteredMonthlyBalances.filter((balance) => clocking.has(balance.matricula));
  }, [filteredDays, filteredMonthlyBalances]);
  const hoursSummaries = useMemo(() => {
    return attachOfficialMonthlyBalances(summarizeMonthlyDays(filteredDays.map(monthlyDayFromRecord), hoursStart, hoursEnd), filteredMonthlyBalances);
  }, [filteredDays, filteredMonthlyBalances, hoursStart, hoursEnd]);
  const visibleHoursSummaries = useMemo(() => {
    const term = normalize(hoursQuery);
    return hoursSummaries.filter((row) => !term || normalize(`${row.collaborator} ${row.matricula} ${row.area}`).includes(term));
  }, [hoursSummaries, hoursQuery]);
  const hoursTotals = useMemo(() => visibleHoursSummaries.reduce((totals, row) => ({
    expected: totals.expected + row.expectedMinutes, worked: totals.worked + row.workedMinutes, bank: totals.bank + row.bankMinutes,
  }), { expected: 0, worked: 0, bank: 0 }), [visibleHoursSummaries]);
  const peopleInView = useMemo(() => responsibleFilter === "all" ? (result?.people || 0) : new Set([...filteredDays.map((day) => day.matricula), ...filteredItems.map((item) => item.matricula), ...filteredBalances.map((balance) => balance.matricula)]).size, [responsibleFilter, result, filteredDays, filteredItems, filteredBalances]);
  const selectedResponsibleName = responsibleFilter === "all" ? "Todos os responsáveis" : responsibleOptions.find((option) => option.key === responsibleFilter)?.name || "Responsável selecionado";
  const adjustmentItems = useMemo(() => operationalItems.filter(needsPointAdjustment), [operationalItems]);
  const counts = useMemo(() => ({
    pending: adjustmentItems.filter((i) => i.status === "pending").length,
    approved: adjustmentItems.filter((i) => i.status === "approved").length,
    ignored: adjustmentItems.filter((i) => i.status === "ignored").length,
    rhOnly: adjustmentItems.filter(isRhOnly).length,
    emailCases: adjustmentItems.filter((i) => i.status === "pending" && isNotificationEligible(i) && Boolean(i.email) && Boolean(i.supervisorEmail)).length,
    notificationReady: notificationDrafts(operationalItems.filter((item) => item.status === "pending")).length,
    notifiedPeople: new Set(operationalItems.filter((item) => isNotificationEligible(item) && item.status === "approved").map((item) => item.matricula)).size,
    missing: adjustmentItems.filter((i) => i.category === "Ausência de batida" || i.category === "Batidas incompletas" || i.category === "Marcação irregular" || i.category === "Marcação errada" || i.category === "Falta").length,
    schedules: adjustmentItems.filter((i) => i.category === "Fora da escala").length,
    interval: operationalItems.filter((i) => i.category === "Intervalo não respeitado" || i.category === "Intervalo irregular").length,
    intershift: operationalItems.filter((i) => i.category === "Interjornada menor que 11h").length,
    threeShifts: operationalItems.filter((i) => i.category === "Três turnos no mesmo dia").length,
    criticalBalances: operationalItems.filter((i) => i.category === "Saldo crítico de banco de horas").length,
  }), [operationalItems, adjustmentItems]);
  const visible = useMemo(() => {
    const term = normalize(query);
    return adjustmentItems.filter((item) => {
      const matchesCategory = categoryFilter === "all" || (categoryFilter === "Análise exclusiva do RH" ? isRhOnly(item) : item.category === categoryFilter);
      const matchesReview = filter === "all" || (filter === "email" ? item.status === "pending" && isNotificationEligible(item) && Boolean(item.email) && Boolean(item.supervisorEmail) : item.status === filter);
      return matchesReview && matchesCategory && (!term || normalize(`${item.collaborator} ${item.matricula} ${item.area} ${item.category}`).includes(term));
    });
  }, [adjustmentItems, filter, categoryFilter, query]);
  const visibleBalances = useMemo(() => {
    const term = normalize(balanceQuery);
    return filteredBalances.filter((balance) => (!criticalBalancesOnly || balance.critical) && (!term || normalize(`${balance.collaborator} ${balance.matricula} ${balance.area}`).includes(term)));
  }, [filteredBalances, balanceQuery, criticalBalancesOnly]);
  const changeStatus = (ids: Iterable<string>, status: ReviewStatus) => {
    if (!canManage) { setNotice("Seu acesso é somente para consulta."); return; }
    const target = new Set(ids);
    const changedAt = new Date().toISOString();
    const nextItems = itemsRef.current.map((item) => target.has(item.id) ? {
      ...item,
      status,
      notifiedAt: status === "approved" && isNotificationEligible(item) ? changedAt : undefined,
      notificationMethod: status === "approved" && isNotificationEligible(item) ? "manual" as const : undefined,
    } : item);
    itemsRef.current = nextItems;
    setItems(nextItems); setSelected(new Set());
    if (result) void saveSharedSnapshot({ contacts, inactiveMatriculas, baseFileName, unitName, result, items: nextItems, fileName });
    setNotice(status === "ignored" ? `${target.size} ocorrência${target.size === 1 ? " marcada" : "s marcadas"} para não enviar.` : `${target.size} situação${target.size === 1 ? " atualizada" : " atualizadas"}.`);
  };
  const toggleAll = () => { if (visible.length && visible.every((item) => selected.has(item.id))) setSelected(new Set()); else setSelected(new Set(visible.map((item) => item.id))); };
  const approved = operationalItems.filter((item) => item.status === "approved" && item.email);
  const pendingOutlookItems = operationalItems.filter((item) => item.status === "pending" && isNotificationEligible(item));
  const pendingOutlookDrafts = notificationDrafts(pendingOutlookItems);
  const pendingDraftByEmployee = new Map(pendingOutlookDrafts.map((draft) => [draft.item.matricula, draft]));
  const primaryVisibleNotificationId = new Map<string, string>();
  for (const item of visible) {
    if (item.status === "pending" && item.email && isNotificationEligible(item) && !primaryVisibleNotificationId.has(item.matricula)) {
      primaryVisibleNotificationId.set(item.matricula, item.id);
    }
  }
  const downloadOutlookBatch = () => {
    if (!pendingOutlookDrafts.length) {
      setNotice("Não há mensagens pendentes com e-mails completos para este responsável.");
      return;
    }
    downloadCsv(pendingOutlookItems, "lote-outlook-ponto");
    setNotice(`Lote preparado para ${pendingOutlookDrafts.length} colaborador${pendingOutlookDrafts.length === 1 ? "" : "es"}. O CSV contém as mensagens e destinatários para conferência. O envio desta versão é manual no Outlook.`);
  };
  const priorityItems = priorityList === "interval" ? operationalItems.filter((item) => item.category === "Intervalo não respeitado" || item.category === "Intervalo irregular") : priorityList === "intershift" ? operationalItems.filter((item) => item.category === "Interjornada menor que 11h") : priorityList === "three-shifts" ? operationalItems.filter((item) => item.category === "Três turnos no mesmo dia") : priorityList === "balance" ? operationalItems.filter((item) => item.category === "Saldo crítico de banco de horas") : [];
  const priorityTitle = priorityList === "interval" ? "Intervalo não respeitado" : priorityList === "intershift" ? "Interjornada menor que 11h" : priorityList === "three-shifts" ? "Três turnos no mesmo dia" : priorityList === "balance" ? "Banco de horas acima do limite" : "Alertas prioritários";
  const allPriorityItems = operationalItems.filter((item) => item.category === "Intervalo não respeitado" || item.category === "Intervalo irregular" || item.category === "Interjornada menor que 11h" || item.category === "Três turnos no mesmo dia" || item.category === "Saldo crítico de banco de horas");
  const downloadCompleteWorkbook = () => {
    if (!result) return;
    const filteredResult = { ...result, days: filteredDays, balances: filteredBalances };
    downloadExcel("gestao-ponto-power-bi", [
      { name: "Base Power BI", rows: dailyExportRows(filteredResult, filteredItems) },
      { name: "Carga e Banco Mensal", rows: hoursSummaryExportRows(hoursSummaries, hoursStart, hoursEnd) },
      { name: "Evolução Oficial FPW", rows: monthlyBalanceExportRows(filteredMonthlyBalances) },
      { name: "Banco de Horas", rows: balanceExportRows(filteredBalances) },
      { name: "Ajustes", rows: occurrenceExportRows(adjustmentItems, filteredBalances) },
      { name: "Alertas Prioritários", rows: occurrenceExportRows(allPriorityItems, filteredBalances) },
      { name: "Não Localizados", rows: responsibleFilter === "all" ? unmatchedExportRows(result.unmatchedPeople) : [] },
      { name: "Arquivos Mensais", rows: sourceFilesExportRows(result.sourceFiles) },
      { name: "Resumo", rows: [{ "Arquivo fonte": fileName, "Período acumulado do arquivo": result.period, "Período ainda corrigível": currentNotificationWindow.label, "Prazo final para correção": currentNotificationWindow.deadlineLabel, "Responsável selecionado": selectedResponsibleName, "Pessoas exibidas": peopleInView, "Ajustes a realizar": counts.pending, "Análise exclusiva do RH": counts.rhOnly, "Mensagens acumuladas a preparar": counts.notificationReady, "Batidas para corrigir": counts.missing, "Escalas para analisar": counts.schedules, "Saldos acima de ±16h": counts.criticalBalances, "Alertas prioritários": allPriorityItems.length }] },
    ]);
  };
  const updatedLabel = lastUpdatedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(lastUpdatedAt)) : "Ainda não salvo";
  if (access && !canManage) return <MonthlyConsultation access={access} days={consultationDays} balances={consultationBalances} unitName={unitName} sourcePeriod={sourcePeriod} updatedAt={lastUpdatedAt} updatedBy={lastUpdatedBy} loading={sharedLoading} error={sharedError} onRefresh={() => void loadSharedData(true)}/>;
  return <main className="min-h-screen bg-[#f4f7fb] text-[#17233a]">
    <LocalToolbar/>
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#123d72] text-white shadow-sm"><Clock3 size={21}/></div><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d43137]">SENAI · Gestão</p><h1 className="text-lg font-bold tracking-tight">Gestão de ponto</h1></div></div>
      <div className="hidden flex-col items-center gap-1 lg:flex"><div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${canManage ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{access?.label || "Carregando acesso"}</span><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${mailConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{mailConfigured ? `Envio automático ativo${mailSender ? ` · ${mailSender}` : ""}` : `Remetente manual · ${POINT_SENDER_EMAIL}`}</span></div><p className="text-[11px] text-slate-500">Atualizado em {updatedLabel}{lastUpdatedBy ? ` por ${lastUpdatedBy}` : ""}</p></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><button disabled={sharedLoading} onClick={() => void loadSharedData(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-40"><RefreshCw size={16} className={sharedLoading ? "animate-spin" : ""}/>Atualizar</button>{canManage && <>{result && <button disabled={savingShared} onClick={() => void clearLoadedData()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"><X size={16}/>Limpar dados</button>}<button disabled={savingShared} onClick={openBasePicker} className="inline-flex items-center gap-2 rounded-lg border border-[#123d72] bg-white px-3 py-2.5 text-sm font-bold text-[#123d72] shadow-sm transition hover:bg-blue-50 disabled:opacity-40"><Users size={17}/>Atualizar base FPW</button><button disabled={!contacts.length || savingShared} onClick={openFilePicker} className="inline-flex items-center gap-2 rounded-lg bg-[#123d72] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0d315d] disabled:cursor-not-allowed disabled:bg-slate-300"><UploadCloud size={17}/>Importar TXT mensais</button></>}</div><input ref={inputRef} className="hidden" type="file" accept=".txt,text/plain" multiple onChange={onFile}/><input ref={baseInputRef} className="hidden" type="file" accept=".csv,text/csv" onChange={onBaseFile}/>
    </div>{contacts.length > 0 && <div className="border-t border-slate-100 bg-slate-50/90"><div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-5 py-2.5 sm:flex-row sm:items-center lg:px-8"><label htmlFor="responsible-filter" className="text-xs font-bold uppercase tracking-wide text-slate-500">Visualizar responsável</label><select id="responsible-filter" value={responsibleFilter} onChange={(event) => { setResponsibleFilter(event.target.value); setSelected(new Set()); setQuery(""); setBalanceQuery(""); setHoursQuery(""); setPriorityFilter("all"); setPriorityList(null); }} className="min-w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#123d72] outline-none focus:border-[#123d72]"><option value="all">Todos os responsáveis</option>{responsibleOptions.map((option) => <option key={option.key} value={option.key}>{option.name} · {option.people} colaborador(es)</option>)}</select><span className="text-xs text-slate-500">Cards, listas, alertas, banco de horas e Excel seguem este filtro.</span></div></div>}</header>

    <div className="mx-auto max-w-[1500px] px-5 py-7 lg:px-8">
      <section className="mb-6 flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Painel de acompanhamento · {unitName}</p><h2 className="text-2xl font-bold tracking-tight lg:text-3xl">Ajustes e notificações de ponto</h2><p className="mt-1 text-sm text-slate-500">A consulta mensal começa em 01/01/2026. Os quantitativos operacionais mostram somente o que ainda pode ser corrigido; o saldo atual vem do último arquivo mensal oficial. Base ativa: <strong>{baseFileName}</strong>.</p></div>{fileName && <div className="flex flex-col gap-3 sm:items-end"><div className="text-right text-sm text-slate-500"><div className="flex items-center justify-end gap-2"><FileText size={16}/><span className="font-semibold text-slate-700">{fileName}</span></div><p className="mt-1">Período histórico: {result?.period}</p><p className="font-bold text-[#123d72]">Período ainda corrigível: {currentNotificationWindow.label}</p><p className="text-xs font-semibold text-amber-700">{currentNotificationWindow.deadlineText}</p></div>{result && <button onClick={downloadCompleteWorkbook} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800"><Download size={16}/>Excel completo para Power BI</button>}</div>}</section>

      {sharedLoading ? <section className="grid min-h-[430px] place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div><RefreshCw size={30} className="mx-auto animate-spin text-[#123d72]"/><h3 className="mt-4 text-xl font-bold">Carregando dados locais</h3><p className="mt-2 text-sm text-slate-500">Aguarde enquanto o painel consulta a última atualização do RH.</p></div></section> : sharedError ? <section className="grid min-h-[360px] place-items-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm"><div className="max-w-lg"><AlertTriangle size={32} className="mx-auto text-red-600"/><h3 className="mt-4 text-xl font-bold">Não foi possível abrir o painel</h3><p className="mt-2 text-sm text-slate-600">{sharedError}</p><button onClick={() => void loadSharedData(true)} className="mt-5 rounded-lg bg-[#123d72] px-5 py-3 text-sm font-bold text-white">Tentar novamente</button></div></section> : !result ? (canManage ? <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div onDragOver={(e) => { e.preventDefault(); if (contacts.length) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className={`grid min-h-[430px] place-items-center rounded-2xl border-2 border-dashed bg-white p-8 text-center transition ${dragging ? "border-[#d43137] bg-red-50" : "border-slate-300 hover:border-[#123d72]"}`}><div className="w-full max-w-2xl">{contacts.length ? <><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-[#123d72]"><UploadCloud size={30}/></div><h3 className="text-xl font-bold">Selecione os arquivos mensais do ponto</h3><p className="mt-2 text-sm leading-6 text-slate-500">Escolha todos juntos: um TXT por competência, de janeiro até o dia anterior. O sistema confere mês faltando, mês repetido e a data final de cada arquivo.</p><div className="mt-5 grid grid-cols-2 gap-2 text-left sm:grid-cols-3 md:grid-cols-5">{requiredPointFiles.map((item) => <div key={item.month} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><span className="block text-xs font-black text-[#123d72]">{item.monthLabel}</span><span className="mt-0.5 block text-[10px] text-slate-500">até {displayIsoDate(item.expectedLastDate)}</span></div>)}</div><button disabled={sending} onClick={openFilePicker} className="mt-6 rounded-lg bg-[#123d72] px-5 py-3 text-sm font-bold text-white hover:bg-[#0d315d] disabled:opacity-50">{sending ? sendProgress : `Escolher ${requiredPointFiles.length} arquivos mensais`}</button><p className="mt-4 text-xs text-slate-400">Formato aceito: TXT do relatório Cartão de Ponto · seleção múltipla</p></> : <><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-700"><Users size={30}/></div><h3 className="text-xl font-bold">Comece pelo relatório de empregados do FPW</h3><p className="mt-2 text-sm leading-6 text-slate-500">No FPwReports, gere “Relatório - Cargos e Funções - Empregados”, converta para CSV e importe aqui. Colaboradores inativos serão desconsiderados.</p><button onClick={openBasePicker} className="mt-6 rounded-lg bg-[#123d72] px-5 py-3 text-sm font-bold text-white hover:bg-[#0d315d]">Importar base CSV do FPW</button><p className="mt-3 text-xs font-semibold text-slate-500">Nome recomendado: Relatório - Cargos e Funções - Empregados.csv</p></>}</div></div>
        <aside className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={21}/></div><h3 className="font-bold">Fluxo dos arquivos mensais</h3><ol className="mt-4 space-y-4 text-sm text-slate-600">{["Atualize a base CSV do FPW", "Selecione todos os TXT mensais", "O sistema valida janeiro até ontem", "Confira saldos e prepare os e-mails"].map((step, index) => <li key={step} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol></div><div className="rounded-2xl bg-[#123d72] p-6 text-white shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-blue-200">Base carregada · {unitName}</p><p className="mt-2 text-3xl font-bold">{contacts.length}</p><p className="mt-1 truncate text-sm font-semibold text-blue-50">{baseFileName}</p><p className="mt-1 text-sm text-blue-100">{contacts.length ? "colaboradores ativos disponíveis para cruzamento" : "importe a base CSV do FPW para começar"}</p><div className="mt-5 grid gap-2"><button onClick={openBasePicker} className="rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#123d72] hover:bg-blue-50">Atualizar base FPW</button><p className="rounded-lg border border-blue-300 px-4 py-2.5 text-center text-xs font-bold text-white">FPwReports › Relatórios › Gerador de Relatórios</p></div></div></aside>
      </section> : <section className="grid min-h-[430px] place-items-center rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div className="max-w-lg"><ShieldCheck size={36} className="mx-auto text-[#123d72]"/><h3 className="mt-4 text-xl font-bold">Aguardando atualização do RH</h3><p className="mt-2 text-sm leading-6 text-slate-600">Seu acesso está ativo e é somente para consulta. Assim que o RH publicar a base e o TXT, os dados autorizados para o seu perfil aparecerão aqui.</p><button onClick={() => void loadSharedData(true)} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#123d72] px-5 py-3 text-sm font-bold text-white"><RefreshCw size={16}/>Atualizar painel</button></div></section>) : <>
        <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">{[
          { label: "Pessoas no arquivo", value: peopleInView, icon: Users, color: "blue" }, { label: "Mensagens a preparar", value: counts.notificationReady, icon: Clock3, color: "amber" }, { label: "Análise exclusiva RH", value: counts.rhOnly, icon: ShieldCheck, color: "violet" }, { label: "Batidas para corrigir", value: counts.missing, icon: AlertTriangle, color: "red" }, { label: "Escalas para analisar", value: counts.schedules, icon: ChevronDown, color: "violet" }, { label: "Banco acima de ±16h", value: counts.criticalBalances, icon: AlertTriangle, color: "red" }, { label: "Pessoas notificadas", value: counts.notifiedPeople, icon: CheckCircle2, color: "green" },
        ].map(({label,value,icon:Icon,color}) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><Icon size={17} className={`metric-${color}`}/></div><p className="mt-3 text-2xl font-bold">{value}</p></div>)}</section>
        <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Arquivos mensais validados</p><p className="mt-1 text-sm text-emerald-950">{result.sourceFiles.length} competências, de {result.sourceFiles[0]?.monthLabel} a {result.sourceFiles.at(-1)?.monthLabel}. O último arquivo chega até {result.sourceFiles.at(-1)?.lastDate}.</p></div><div className="flex flex-wrap gap-1.5">{result.sourceFiles.map((source) => <span key={source.month} title={source.fileName} className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-xs font-black text-emerald-800">{source.monthLabel} ✓</span>)}</div></div></section>
        {responsibleFilter === "all" && result.unmatched > 0 && <button onClick={() => setShowUnmatched(true)} className="mb-5 flex w-full items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-900 transition hover:border-amber-500 hover:bg-amber-100"><span className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><span><strong>{result.unmatched} pessoa(s) não localizada(s) na base ativa.</strong> Clique para abrir a lista com nomes e matrículas.</span></span><span className="shrink-0 font-bold underline">Ver lista</span></button>}
        <section className="mb-5 rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="text-xs font-bold uppercase tracking-wider text-red-700">Alertas prioritários</p><p className="mt-1 text-sm text-slate-500">Somente ocorrências do período ainda corrigível: {currentNotificationWindow.label}. {currentNotificationWindow.deadlineText}</p></div><div className="flex gap-2"><button onClick={() => result && downloadExcel("alertas-prioritarios", [{ name: "Alertas", rows: occurrenceExportRows(allPriorityItems, filteredBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"><Download size={14}/>Baixar Excel</button>{priorityFilter !== "all" && <button onClick={() => setPriorityFilter("all")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Limpar filtro</button>}</div></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              { key: "interval", label: "Intervalo não respeitado", value: counts.interval, help: "Hora Extra Intervalo ou intervalo irregular" },
              { key: "intershift", label: "Interjornada menor que 11h", value: counts.intershift, help: "Saída de um dia até a entrada seguinte" },
              { key: "three-shifts", label: "Três turnos no mesmo dia", value: counts.threeShifts, help: "Seis ou mais marcações no dia" },
              { key: "balance", label: "Banco acima de ±16h", value: counts.criticalBalances, help: "Mais de dois dias positivos ou negativos" },
            ].map((alert) => <button key={alert.key} onClick={() => setPriorityList(alert.key as PriorityFilter)} className={`rounded-xl border p-4 text-left transition ${priorityFilter === alert.key ? "border-red-500 bg-red-50 ring-2 ring-red-100" : "border-slate-200 hover:border-red-300 hover:bg-red-50/50"}`}><span className="flex items-center justify-between"><span className="font-bold text-slate-800">{alert.label}</span><span className="rounded-full bg-red-100 px-2.5 py-1 text-sm font-black text-red-700">{alert.value}</span></span><span className="mt-2 block text-xs text-slate-500">{alert.help}</span><span className="mt-3 block text-xs font-bold text-red-700">Abrir lista de pessoas e datas</span></button>)}
          </div>
        </section>
        <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-wider text-[#123d72]">Carga horária mensal</p><h3 className="mt-1 text-lg font-bold text-slate-800">Carga prevista, horas batidas e saldo oficial FPW</h3><p className="mt-1 text-sm leading-6 text-slate-500">Uma linha por colaborador e competência, de 01/01/2026 até ontem. A diferença entre batidas e carga prevista é uma conferência; a evolução oficial usa o Saldo BH Acumulado informado em cada arquivo mensal, sem somar saldos entre meses.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <label className="text-xs font-bold text-slate-600"><span className="mb-1 block">Data inicial</span><input type="date" min={MONTHLY_ANALYSIS_START} max={yesterdayIso()} value={hoursStart} onChange={(event) => setHoursStart(event.target.value < MONTHLY_ANALYSIS_START ? MONTHLY_ANALYSIS_START : event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#123d72]"/></label>
                <label className="text-xs font-bold text-slate-600"><span className="mb-1 block">Data final</span><input type="date" min={MONTHLY_ANALYSIS_START} max={yesterdayIso()} value={hoursEnd} onChange={(event) => setHoursEnd(event.target.value > yesterdayIso() ? yesterdayIso() : event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#123d72]"/></label>
                <label className="relative min-w-[250px] flex-1"><span className="sr-only">Buscar colaborador</span><Search size={16} className="absolute left-3 top-1/2 mt-2 -translate-y-1/2 text-slate-400"/><input value={hoursQuery} onChange={(event) => setHoursQuery(event.target.value)} placeholder="Buscar colaborador ou matrícula" className="mt-5 w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#123d72]"/></label>
                <button disabled={!visibleHoursSummaries.length} onClick={() => downloadExcel("carga-e-banco-por-mes", [{ name: "Carga e Banco Mensal", rows: hoursSummaryExportRows(visibleHoursSummaries, hoursStart, hoursEnd) }])} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><Download size={14}/>Baixar Excel</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Carga prevista no período</p><p className="mt-1 text-xl font-black text-[#123d72]">{durationLabel(hoursTotals.expected)}</p></div><div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Horas batidas no ponto</p><p className="mt-1 text-xl font-black text-slate-800">{durationLabel(hoursTotals.worked)}</p></div><div className={`rounded-xl p-4 ${hoursTotals.bank > 0 ? "bg-emerald-50" : hoursTotals.bank < 0 ? "bg-red-50" : "bg-slate-100"}`}><p className={`text-xs font-bold uppercase tracking-wide ${hoursTotals.bank > 0 ? "text-emerald-700" : hoursTotals.bank < 0 ? "text-red-700" : "text-slate-600"}`}>Diferença para conferência</p><p className={`mt-1 text-xl font-black ${hoursTotals.bank > 0 ? "text-emerald-700" : hoursTotals.bank < 0 ? "text-red-700" : "text-slate-700"}`}>{signedDurationLabel(hoursTotals.bank)}</p></div></div>
          </div>
          <MonthlyBalanceChart balances={chartMonthlyBalances} start={hoursStart} end={hoursEnd}/>
          {hoursStart && hoursEnd && hoursStart > hoursEnd ? <div className="px-6 py-12 text-center text-sm font-semibold text-red-700">A data inicial não pode ser posterior à data final.</div> : <div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Mês</th><th className="px-5 py-3">Carga/escala</th><th className="px-5 py-3">Carga prevista</th><th className="px-5 py-3">Horas batidas</th><th className="px-5 py-3">Diferença</th><th className="px-5 py-3">Saldo oficial FPW</th><th className="px-5 py-3">Conferência</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleHoursSummaries.map((row) => <tr key={`${row.matricula}-${row.month}`} className="hover:bg-slate-50"><td className="px-5 py-4"><span className="block font-bold text-slate-800">{row.collaborator}</span><span className="text-xs text-slate-400">{row.matricula} · {row.area}</span></td><td className="whitespace-nowrap px-5 py-4 text-base font-black text-[#123d72]">{row.monthLabel}</td><td className="max-w-[300px] px-5 py-4"><span className="block font-semibold text-slate-700">{row.weeklyHours ? `${row.weeklyHours}h semanais` : "Carga semanal não informada"}</span><span className="mt-1 block truncate text-xs text-slate-500" title={row.schedules.join(" | ")}>{row.schedules.join(" | ") || "Escala não identificada"}</span></td><td className="px-5 py-4"><span className="text-lg font-black text-[#123d72]">{durationLabel(row.expectedMinutes)}</span><span className="block text-xs text-slate-400">{row.scheduledDays} dia(s) previsto(s)</span></td><td className="px-5 py-4 text-lg font-black text-slate-800">{durationLabel(row.workedMinutes)}</td><td className={`px-5 py-4 text-lg font-black ${row.bankMinutes > 0 ? "text-emerald-700" : row.bankMinutes < 0 ? "text-red-700" : "text-slate-600"}`}>{signedDurationLabel(row.bankMinutes)}</td><td className={`px-5 py-4 text-lg font-black ${row.officialAccumulatedMinutes === null ? "text-slate-400" : row.officialAccumulatedMinutes > 0 ? "text-emerald-700" : row.officialAccumulatedMinutes < 0 ? "text-red-700" : "text-slate-600"}`}>{row.officialAccumulatedMinutes === null ? "Não informado" : signedDurationLabel(row.officialAccumulatedMinutes)}{row.officialAccumulatedMinutes !== null && <span className="mt-1 block text-[11px] font-semibold text-slate-400">Inicial {signedDurationLabel(row.officialInitialMinutes || 0)} · créditos {durationLabel(row.officialCreditMinutes || 0)} · débitos {durationLabel(row.officialDebitMinutes || 0)}</span>}</td><td className="px-5 py-4">{row.incompleteDays ? <span className="severity severity-alta">{row.incompleteDays} dia(s) com batida incompleta</span> : <span className="status status-approved">Cálculo completo</span>}{row.officialCritical && <span className="ml-2 severity severity-alta">Saldo acima de ±16h</span>}<span className="mt-1 block text-xs text-slate-400">{row.nonWorkingDays} folga(s)/feriado(s)/afastamento(s)</span></td></tr>)}{!visibleHoursSummaries.length && <tr><td colSpan={8} className="px-6 py-14 text-center text-slate-400">Nenhum colaborador que registra ponto foi encontrado neste período.</td></tr>}</tbody></table></div>}
          <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">{visibleHoursSummaries.length} linha(s) mensais · {new Set(visibleHoursSummaries.map((row) => row.matricula)).size} colaborador(es) · o filtro por responsável do topo também é aplicado</footer>
        </section>
        <PointCardConsultation days={filteredDays.map(monthlyDayFromRecord)} balances={filteredMonthlyBalances}/>
        <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="font-bold text-slate-800">Banco de horas acumulado oficial</h3><p className="mt-1 text-sm text-slate-500">Usa o último Saldo BH Acumulado informado pelo FPW na competência mais recente importada ({result.sourceFiles.at(-1)?.monthLabel || "não identificada"}). Não soma os saldos de janeiro a outubro. Positivo em verde, negativo em vermelho; acima de +16h ou abaixo de −16h: limite ultrapassado.</p></div><div className="flex flex-col gap-2 sm:flex-row"><button onClick={() => result && downloadExcel("banco-de-horas", [{ name: "Banco de Horas", rows: balanceExportRows(visibleBalances) }])} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"><Download size={14}/>Baixar Excel</button><button onClick={() => setCriticalBalancesOnly((value) => !value)} className={`rounded-lg border px-3 py-2.5 text-xs font-bold ${criticalBalancesOnly ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{criticalBalancesOnly ? "Mostrando somente críticos" : "Mostrar somente críticos"}</button><label className="relative min-w-[260px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={balanceQuery} onChange={(event) => setBalanceQuery(event.target.value)} placeholder="Buscar colaborador ou matrícula" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#123d72]"/></label></div></div>
          <div className="max-h-[430px] overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Área</th><th className="px-5 py-3">Saldo acumulado</th><th className="px-5 py-3">Situação</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleBalances.map((balance) => { const balanceAlert = items.find((item) => item.category === "Saldo crítico de banco de horas" && item.matricula === balance.matricula); return <tr key={balance.matricula} className={balance.critical ? "bg-red-50/70" : "hover:bg-slate-50"}><td className="px-5 py-4"><span className="block font-bold text-slate-800">{balance.collaborator}</span><span className="text-xs text-slate-400">Matrícula {balance.matricula}</span></td><td className="px-5 py-4 text-slate-600">{balance.area}</td><td className={`px-5 py-4 text-lg font-black ${balance.minutes > 0 ? "text-emerald-700" : balance.minutes < 0 ? "text-red-700" : "text-slate-600"}`}>{balance.label}</td><td className="px-5 py-4">{balance.critical ? <span className="severity severity-alta">Limite ultrapassado</span> : <span className="status status-approved">Dentro do limite</span>}</td><td className="px-5 py-4 text-right">{balanceAlert ? <button onClick={() => setDetail(balanceAlert)} className="rounded-md bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800">Revisar alerta</button> : <span className="text-xs text-slate-400">Acompanhar</span>}</td></tr>; })}{!visibleBalances.length && <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">Nenhum saldo encontrado nesta visualização.</td></tr>}</tbody></table></div>
          <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">{visibleBalances.length} colaborador(es) exibido(s) · fotografia oficial de {result.sourceFiles.at(-1)?.monthLabel || "competência não identificada"}</footer>
        </section>
        {canManage && <div className={`mb-5 flex items-start gap-3 rounded-xl border p-4 text-sm ${mailConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-blue-200 bg-blue-50 text-blue-950"}`}>
          <Mail className="mt-0.5 shrink-0" size={18}/>
          <div className="min-w-0 flex-1">
            <p><strong>{mailConfigured ? "Envio automático ativo." : "Preparação individual pelo Outlook Web."}</strong> Somente ausência de batida e quantidade ímpar de registros entram na mensagem; as datas são reunidas por colaborador e o tipo da ocorrência não é revelado.</p>
            <p className="mt-1 font-bold text-blue-900">Período liberado para envio: {currentNotificationWindow.label}. {currentNotificationWindow.deadlineText} Registros anteriores não entram nos quantitativos nem nos e-mails.</p>
            <p className="mt-1">No envio manual, colaborador, supervisor e RH aparecem juntos no campo Para para garantir a entrega; a direção não é incluída nestas notificações. Antes de enviar, o campo <strong>De</strong> precisa mostrar <strong>{POINT_SENDER_EMAIL}</strong>. {sending && <span className="font-bold">{sendProgress}.</span>}</p>
            <p className="mt-1 text-xs">As demais ocorrências continuam disponíveis somente para acompanhamento e decisão do RH. O lote respeita o filtro de responsável escolhido no topo.</p>
            {!mailConfigured && <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <a href="./LEIA-ME.txt" download className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-xs font-bold text-blue-800 hover:bg-blue-50"><Download size={15}/>Instruções de uso</a>
              <button disabled={!pendingOutlookDrafts.length} onClick={downloadOutlookBatch} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#123d72] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#0d315d] disabled:cursor-not-allowed disabled:opacity-40"><Mail size={15}/>Exportar mensagens CSV ({pendingOutlookDrafts.length} pessoa{pendingOutlookDrafts.length === 1 ? "" : "s"})</button>
            </div>}
          </div>
        </div>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-bold text-slate-800">Correções do período disponível</h3><p className="mt-1 text-sm text-slate-500">Somente ocorrências de {currentNotificationWindow.label}. {currentNotificationWindow.deadlineText}</p></div>
          <div className="flex flex-col gap-4 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">{[["email",`Enviar e-mail (${counts.emailCases})`],["pending",`Aguardando ação (${counts.pending})`],["approved",`Tratadas/notificadas (${counts.approved})`],["ignored",`Sem envio/providência (${counts.ignored})`],["all",`Todos os ajustes (${adjustmentItems.length})`]].map(([value,label]) => <button key={value} onClick={() => { setFilter(value as typeof filter); setSelected(new Set()); }} className={`rounded-md px-3 py-2 text-xs font-bold transition ${filter === value ? "bg-white text-[#123d72] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>)}</div>
            <div className="flex flex-1 flex-wrap justify-end gap-2"><label className="min-w-[220px]"><span className="sr-only">Filtrar por tipo de correção</span><select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as CorrectionFilter); setSelected(new Set()); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#123d72]"><option value="all">Todos os tipos ({adjustmentItems.length})</option>{(["Análise exclusiva do RH", "Ausência de batida", "Falta", "Fora da escala", "Batidas incompletas", "Marcação errada", "Marcação irregular"] as CorrectionFilter[]).map((category) => <option key={category} value={category}>{category} ({category === "Análise exclusiva do RH" ? adjustmentItems.filter(isRhOnly).length : adjustmentItems.filter((item) => item.category === category).length})</option>)}</select></label><label className="relative min-w-[220px] flex-1 xl:max-w-xs"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value) setPriorityFilter("all"); }} placeholder="Buscar pessoa, matrícula ou área" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#123d72]"/></label>{canManage && selected.size > 0 && <><button onClick={() => { if (confirm("Você já enviou estas mensagens pelo Outlook? Confirme somente depois do envio.")) changeStatus(selected,"approved"); }} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800">Registrar como enviado</button><button onClick={() => changeStatus(selected,"ignored")} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><X size={15} className="mr-1 inline"/>Sem envio/providência</button>{mailConfigured ? <button disabled={sending} onClick={() => void sendNotifications(items.filter((item) => selected.has(item.id)))} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-40"><Mail size={15} className="mr-1 inline"/>Enviar agora</button> : <><button onClick={() => void openOutlookWeb(items.filter((item) => selected.has(item.id)))} className="rounded-lg bg-[#123d72] px-3 py-2 text-xs font-bold text-white hover:bg-[#0d315d]"><Mail size={15} className="mr-1 inline"/>Abrir no Outlook Web</button><button onClick={() => void openOutlookClassic(items.filter((item) => selected.has(item.id)))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">Tentar Outlook clássico</button></>}</>}</div>
          </div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] border-collapse text-left text-sm"><thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">{canManage && <th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Selecionar todas" checked={visible.length > 0 && visible.every((i) => selected.has(i.id))} onChange={toggleAll}/></th>}<th className="px-3 py-3">Colaborador</th><th className="px-3 py-3">Data</th><th className="px-3 py-3">Ocorrência</th><th className="px-3 py-3">Marcações</th><th className="px-3 py-3">Responsável</th><th className="px-3 py-3">Situação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{visible.map((item) => {
              const draft = pendingDraftByEmployee.get(item.matricula);
              const isPrimaryAction = primaryVisibleNotificationId.get(item.matricula) === item.id;
              const groupedOccurrenceCount = draft?.ids.length || 1;
              const groupedDateCount = draft?.dates.length || 1;
              return <tr key={item.id} className={`transition hover:bg-slate-50/80 ${isRhOnly(item) ? "bg-violet-50/40" : ""}`}>
                {canManage && <td className="px-4 py-4"><input type="checkbox" aria-label={`Selecionar ${item.collaborator}`} checked={selected.has(item.id)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}/></td>}
                <td className="px-3 py-4"><button onClick={() => setDetail(item)} className="text-left"><span className="block font-bold text-slate-800 hover:text-[#123d72]">{item.collaborator}</span><span className="text-xs text-slate-400">{item.matricula} · {item.area}</span>{isPrimaryAction && groupedOccurrenceCount > 1 && <span className="mt-1 block text-[11px] font-bold text-blue-700">1 e-mail reunirá {groupedOccurrenceCount} ocorrências em {groupedDateCount} data{groupedDateCount === 1 ? "" : "s"}</span>}</button></td>
                <td className="whitespace-nowrap px-3 py-4 font-medium">{item.date}</td>
                <td className="px-3 py-4"><span className={`severity severity-${item.severity}`}>{item.category}</span>{isRhOnly(item) && <span className="ml-2 inline-flex rounded-full bg-violet-100 px-2 py-1 text-[11px] font-bold text-violet-800">Somente RH</span>}<span className="mt-1 block max-w-[260px] truncate text-xs text-slate-500">{item.detail}</span>{item.scaleSuggestion && <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${item.scaleSuggestion.status === "suggested" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>{item.scaleSuggestion.status === "suggested" ? `Sugestão: escala ${item.scaleSuggestion.code}` : "Troca não recomendada"}</span>}</td>
                <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-slate-600">{item.punches.join(" · ") || "—"}</td>
                <td className="px-3 py-4"><span className="font-semibold">{item.supervisor}</span><span className="block text-xs text-slate-400">{isNotificationEligible(item) ? "recebem: colaborador, supervisor e RH" : needsAutomaticNotification(item) ? "período fechado — sem envio" : "somente para análise do RH"}</span></td>
                <td className="px-3 py-4"><span className={`status status-${item.status}`}>{occurrenceStatusLabel(item)}</span></td>
                <td className="px-4 py-4 text-right">{!canManage ? <button onClick={() => setDetail(item)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#123d72] hover:text-[#123d72]">Ver detalhes</button> : item.status === "pending" && item.email && isNotificationEligible(item) ? (isPrimaryAction ? (mailConfigured ? <button disabled={sending} onClick={() => void sendNotifications(items.filter((entry) => entry.matricula === item.matricula))} className="inline-flex items-center gap-1 rounded-md bg-[#123d72] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"><Mail size={13}/>Enviar 1 e-mail</button> : <button onClick={() => void openOutlookWeb([item])} className="inline-flex items-center gap-1 rounded-md bg-[#123d72] px-3 py-1.5 text-xs font-bold text-white"><Mail size={13}/>Abrir 1 e-mail</button>) : <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700"><Mail size={13}/>No mesmo e-mail</span>) : <button onClick={() => setDetail(item)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#123d72] hover:text-[#123d72]">Ver detalhes</button>}</td>
              </tr>;
            })}{!visible.length && <tr><td colSpan={canManage ? 8 : 7} className="px-6 py-16 text-center text-slate-400">Nenhuma ocorrência nesta visualização.</td></tr>}</tbody>
          </table></div>
          <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{visible.length} ajuste(s) no período {currentNotificationWindow.label} · {canManage ? "mensagens agrupadas por colaborador" : "acesso somente para consulta"}</p><div className="flex flex-col gap-2 sm:flex-row"><button onClick={() => result && downloadExcel("lista-de-correcoes", [{ name: "Correções", rows: occurrenceExportRows(visible, filteredBalances) }])} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={16}/>Baixar esta consulta em Excel</button>{canManage && <button disabled={!approved.length} onClick={() => downloadCsv(approved)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d43137] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#bb282e] disabled:cursor-not-allowed disabled:opacity-40"><Download size={16}/>Baixar registro das notificações</button>}</div></footer>
        </section>
      </>}
    </div>

    {priorityList && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setPriorityList(null); }}><section className="w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-200 p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-red-700">Alerta prioritário para notificação</p><h3 className="mt-1 text-xl font-bold">{priorityTitle}</h3><p className="mt-1 text-sm text-slate-500">{priorityItems.length} ocorrência(s) encontrada(s). A mensagem enviada informa somente a data.</p></div><button onClick={() => setPriorityList(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20}/></button></header><div className="max-h-[62vh] overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Pessoa</th><th className="px-5 py-3">Data</th><th className="px-5 py-3">Marcações</th><th className="px-5 py-3">Detalhe</th><th className="px-5 py-3">Situação</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody className="divide-y divide-slate-100">{priorityItems.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="px-5 py-4"><span className="block font-bold text-slate-800">{item.collaborator}</span><span className="text-xs text-slate-400">Matrícula {item.matricula} · {item.area}</span></td><td className="whitespace-nowrap px-5 py-4 font-semibold">{item.date}</td><td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-600">{item.punches.join(" · ") || "—"}</td><td className="max-w-[330px] px-5 py-4 text-xs leading-5 text-slate-600">{item.detail}</td><td className="px-5 py-4"><span className={`status status-${item.status}`}>{item.status === "pending" ? "Aguardando envio" : item.status === "approved" ? "Notificada" : "Não enviar"}</span></td><td className="px-5 py-4 text-right"><button onClick={() => { setPriorityList(null); setDetail(item); }} className="rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:border-[#123d72] hover:text-[#123d72]">Ver detalhes</button></td></tr>)}{priorityItems.length === 0 && <tr><td colSpan={6} className="px-6 py-14 text-center text-slate-400">Nenhuma ocorrência neste alerta.</td></tr>}</tbody></table></div><footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4"><button onClick={() => result && downloadExcel(`alerta-${priorityList}`, [{ name: priorityTitle, rows: occurrenceExportRows(priorityItems, filteredBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={15}/>Baixar Excel</button><button onClick={() => setPriorityList(null)} className="rounded-lg bg-[#123d72] px-4 py-2.5 text-sm font-bold text-white">Fechar</button></footer></section></div>}
    {showUnmatched && result && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowUnmatched(false); }}><section className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-200 p-6"><div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Cadastro pendente</p><h3 className="mt-1 text-xl font-bold">Pessoas não localizadas na base ativa</h3><p className="mt-1 text-sm text-slate-500">Confirme a matrícula, a situação cadastral e o e-mail antes de liberar notificações.</p></div><button onClick={() => setShowUnmatched(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20}/></button></header><div className="max-h-[60vh] overflow-y-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-6 py-3">Nome no ponto</th><th className="px-6 py-3">Matrícula</th><th className="px-6 py-3">Situação</th></tr></thead><tbody className="divide-y divide-slate-100">{result.unmatchedPeople.map((person) => <tr key={person.matricula}><td className="px-6 py-4 font-semibold text-slate-800">{person.nome}</td><td className="px-6 py-4 font-mono text-slate-600">{person.matricula}</td><td className="px-6 py-4"><span className="status status-pending">Verificar cadastro</span></td></tr>)}</tbody></table></div><footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4"><button onClick={() => downloadExcel("pessoas-nao-localizadas", [{ name: "Não Localizados", rows: unmatchedExportRows(result.unmatchedPeople) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={15}/>Baixar Excel</button><button onClick={() => setShowUnmatched(false)} className="rounded-lg bg-[#123d72] px-4 py-2.5 text-sm font-bold text-white">Fechar</button></footer></section></div>}
    {notice && <div className="fixed bottom-5 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-2xl"><CheckCircle2 size={17} className="text-emerald-400"/>{notice}<button onClick={() => setNotice("")} className="ml-2 text-slate-400 hover:text-white"><X size={16}/></button></div>}
    {detail && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={(e) => { if (e.currentTarget === e.target) setDetail(null); }}><aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-[#d43137]">Detalhes da ocorrência</p><h3 className="mt-1 text-xl font-bold">{detail.collaborator}</h3><p className="text-sm text-slate-500">Matrícula {detail.matricula} · {detail.area}</p></div><button onClick={() => setDetail(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20}/></button></div><div className="mt-7 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Data</p><p className="mt-1 font-bold">{detail.date}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Marcações</p><p className="mt-1 font-mono text-sm font-bold">{detail.punches.join(" · ") || "—"}</p></div></div><div className="mt-5 rounded-xl border border-slate-200 p-4"><span className={`severity severity-${detail.severity}`}>{detail.category}</span><p className="mt-3 text-sm leading-6 text-slate-600">{detail.detail}</p><p className="mt-2 text-xs text-slate-400">Horário informado: {detail.schedule}</p></div>{detail.scaleSuggestion && <div className={`mt-5 rounded-xl border p-4 ${detail.scaleSuggestion.status === "suggested" ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}><p className={`text-xs font-bold uppercase tracking-wide ${detail.scaleSuggestion.status === "suggested" ? "text-blue-700" : "text-amber-800"}`}>{detail.scaleSuggestion.status === "suggested" ? "Escala sugerida para conferência" : "Troca de escala não recomendada"}</p>{detail.scaleSuggestion.status === "suggested" && <><p className="mt-2 text-lg font-black text-slate-900">Código {detail.scaleSuggestion.code}</p><p className="mt-1 text-sm font-semibold text-slate-700">{detail.scaleSuggestion.description}</p></>}<p className="mt-3 text-sm leading-6 text-slate-700">{detail.scaleSuggestion.reason}</p><p className="mt-2 text-xs font-bold text-slate-600">Horas registradas na semana: {durationLabel(detail.scaleSuggestion.weeklyMinutes)}</p><ul className="mt-3 space-y-1 text-xs leading-5 text-slate-600">{detail.scaleSuggestion.cautions.map((caution) => <li key={caution}>• {caution}</li>)}</ul><p className="mt-3 text-xs font-bold text-red-700">Não altera o ponto automaticamente. Valide com RH antes de mudar a escala.</p></div>}{canManage ? <><div className="mt-7"><p className="mb-3 text-sm font-bold">Destinatários</p><div className="space-y-2 text-sm"><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Para</span><span className="max-w-[300px] truncate font-semibold">{detail.email || "E-mail não localizado"}</span></div><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Também recebem</span><span className="max-w-[300px] truncate text-right font-semibold">{[detail.supervisorEmail,POINT_ADMIN_REPLY_TO].filter(Boolean).join("; ") || "—"}</span></div><div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Responder para</span><span className="max-w-[300px] truncate text-right font-semibold">{POINT_ADMIN_REPLY_TO}</span></div></div></div><div className="mt-7"><p className="mb-3 text-sm font-bold">Prévia da mensagem</p><div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-[#fbfcfe] p-4 text-sm leading-6 text-slate-600">{emailBody(detail)}</div></div><p className={`mt-4 rounded-lg p-3 text-xs font-semibold ${detail.status === "approved" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>{detail.status === "approved" ? "A notificação desta pessoa e data já foi registrada como enviada." : needsAutomaticNotification(detail) && !isInNotificationWindow(detail) ? `Período fechado. Período disponível: ${currentNotificationWindow.label}.` : mailConfigured ? "A notificação será enviada automaticamente, sem revelar o tipo da ocorrência." : "Prepare a mensagem no Outlook e registre o envio depois de enviar."}</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => { changeStatus([detail.id],"ignored"); setDetail(null); }} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Não enviar</button>{detail.status === "approved" && isNotificationEligible(detail) ? <button onClick={() => { const ids = itemsRef.current.filter((item) => item.matricula === detail.matricula && item.status === "approved" && isNotificationEligible(item)).map((item) => item.id); changeStatus(ids,"pending"); setDetail(null); }} className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 hover:bg-amber-100">Desfazer registro do envio</button> : <button disabled={!detail.email || !detail.supervisorEmail || !isNotificationEligible(detail) || sending} onClick={() => { if (confirm("Confirme somente se esta mensagem já foi enviada pelo Outlook.")) { changeStatus([detail.id],"approved"); setDetail(null); } }} className="flex-1 rounded-lg bg-[#123d72] px-4 py-3 text-sm font-bold text-white hover:bg-[#0d315d] disabled:opacity-40"><Mail size={16} className="mr-1 inline"/>Registrar envio manual</button>}</div></> : <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><p className="font-bold">Acesso somente para consulta</p><p className="mt-1 leading-6">Você pode conferir esta ocorrência, aplicar filtros e baixar os relatórios autorizados. Importações, alterações e notificações ficam restritas ao RH.</p></div>}</aside></div>}
  </main>;
}

export { competenceFromText, notificationWindow, parseContactsFile, parseMonthlyFileSet, parsePoint, requiredMonthlyFiles };
