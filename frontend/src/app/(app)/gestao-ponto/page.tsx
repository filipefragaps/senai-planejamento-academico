"use client";

import {
  AlertTriangle, CheckCircle2, ChevronDown, Clock3, Download, FileText,
  Mail, RefreshCw, Search, ShieldCheck, UploadCloud, Users, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BalanceRecord, Contact, DailyRecord, HoursSummary, ImportedBase, MonthlyDay,
  Occurrence, ParseResult, ReviewStatus,
  MONTHLY_ANALYSIS_START, OPERATIONAL_ANALYSIS_START,
  balanceExportRows, dailyExportRows, dateKey, displayIsoDate, downloadCsv,
  downloadExcel, durationLabel, emailBodyFor, hoursSummaryExportRows,
  isInNotificationWindow, isNotificationEligible, isRhOnly, isoDate,
  monthlyDayFromRecord, needsAutomaticNotification, needsPointAdjustment,
  normalize, notificationDrafts, notificationWindow, occurrenceExportRows,
  occurrenceStatusLabel, parseContactsFile, parsePoint, signedDurationLabel,
  summarizeMonthlyDays, todayIso, unmatchedExportRows, manualEmailRecipients,
} from "./parser";

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "gp_v1";
type GpSnapshot = {
  contacts: Contact[];
  inactiveMatriculas: string[];
  baseFileName: string;
  unitName: string;
  result: ParseResult | null;
  items: Occurrence[];
  fileName: string;
  rhEmail: string;
};
function saveSnapshot(data: GpSnapshot) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
}
function loadSnapshot(): GpSnapshot | null {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type PriorityFilter = "interval" | "intershift" | "three-shifts" | "balance";
type CorrectionFilter = "all" | "Análise exclusiva do RH" | "Ausência de batida" | "Falta" | "Fora da escala" | "Batidas incompletas" | "Marcação errada" | "Marcação irregular";

export default function GestaoPontoPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);

  // Base state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [inactiveMatriculas, setInactiveMatriculas] = useState<string[]>([]);
  const [baseFileName, setBaseFileName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [rhEmail, setRhEmail] = useState("");
  const [rhEmailDraft, setRhEmailDraft] = useState("");

  // Point data state
  const [result, setResult] = useState<ParseResult | null>(null);
  const [items, setItems] = useState<Occurrence[]>([]);
  const [fileName, setFileName] = useState("");

  // UI state
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "email" | ReviewStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<CorrectionFilter>("all");
  const [query, setQuery] = useState("");
  const [balanceQuery, setBalanceQuery] = useState("");
  const [hoursQuery, setHoursQuery] = useState("");
  const [hoursStart, setHoursStart] = useState(MONTHLY_ANALYSIS_START);
  const [hoursEnd, setHoursEnd] = useState(todayIso());
  const [criticalBalancesOnly, setCriticalBalancesOnly] = useState(false);
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [priorityList, setPriorityList] = useState<PriorityFilter | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [showEmailConfig, setShowEmailConfig] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const snap = loadSnapshot();
    if (snap) {
      setContacts(snap.contacts || []);
      setInactiveMatriculas(snap.inactiveMatriculas || []);
      setBaseFileName(snap.baseFileName || "");
      setUnitName(snap.unitName || "");
      setResult(snap.result || null);
      setItems(snap.items || []);
      setFileName(snap.fileName || "");
      setRhEmail(snap.rhEmail || "");
      setRhEmailDraft(snap.rhEmail || "");
    }
  }, []);

  function persist(partial: Partial<GpSnapshot>) {
    const current: GpSnapshot = { contacts, inactiveMatriculas, baseFileName, unitName, result, items, fileName, rhEmail };
    const next = { ...current, ...partial };
    saveSnapshot(next);
  }

  const currentNotificationWindow = notificationWindow();

  // ─── Filters ────────────────────────────────────────────────────────────────

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

  const matchesResponsible = useCallback((supervisor: string, supervisorEmail: string) =>
    responsibleFilter === "all" || (supervisorEmail || `name:${normalize(supervisor)}`) === responsibleFilter,
    [responsibleFilter]);

  const filteredItems = useMemo(() => items.filter((item) => matchesResponsible(item.supervisor, item.supervisorEmail)), [items, matchesResponsible]);
  const filteredBalances = useMemo(() => (result?.balances || []).filter((b) => matchesResponsible(b.supervisor, b.supervisorEmail)), [result, matchesResponsible]);
  const filteredDays = useMemo(() => (result?.days || []).filter((d) => matchesResponsible(d.supervisor, d.supervisorEmail)), [result, matchesResponsible]);

  const hoursSummaries = useMemo(() => summarizeMonthlyDays(filteredDays.map(monthlyDayFromRecord), hoursStart, hoursEnd), [filteredDays, hoursStart, hoursEnd]);
  const visibleHoursSummaries = useMemo(() => {
    const term = normalize(hoursQuery);
    return hoursSummaries.filter((row) => !term || normalize(`${row.collaborator} ${row.matricula} ${row.area}`).includes(term));
  }, [hoursSummaries, hoursQuery]);

  const hoursTotals = useMemo(() => visibleHoursSummaries.reduce((t, row) => ({ expected: t.expected + row.expectedMinutes, worked: t.worked + row.workedMinutes, bank: t.bank + row.bankMinutes }), { expected: 0, worked: 0, bank: 0 }), [visibleHoursSummaries]);

  const adjustmentItems = useMemo(() => filteredItems.filter(needsPointAdjustment), [filteredItems]);
  const counts = useMemo(() => ({
    pending: adjustmentItems.filter((i) => i.status === "pending").length,
    approved: adjustmentItems.filter((i) => i.status === "approved").length,
    ignored: adjustmentItems.filter((i) => i.status === "ignored").length,
    rhOnly: adjustmentItems.filter(isRhOnly).length,
    emailCases: adjustmentItems.filter((i) => i.status === "pending" && isNotificationEligible(i, rhEmail)).length,
    notificationReady: notificationDrafts(filteredItems.filter((i) => i.status === "pending"), rhEmail).length,
    notifiedPeople: new Set(filteredItems.filter((i) => isNotificationEligible(i, rhEmail) && i.status === "approved").map((i) => i.matricula)).size,
    missing: adjustmentItems.filter((i) => ["Ausência de batida", "Batidas incompletas", "Marcação irregular", "Marcação errada", "Falta"].includes(i.category)).length,
    schedules: adjustmentItems.filter((i) => i.category === "Fora da escala").length,
    interval: filteredItems.filter((i) => i.category === "Intervalo não respeitado" || i.category === "Intervalo irregular").length,
    intershift: filteredItems.filter((i) => i.category === "Interjornada menor que 11h").length,
    threeShifts: filteredItems.filter((i) => i.category === "Três turnos no mesmo dia").length,
    criticalBalances: filteredItems.filter((i) => i.category === "Saldo crítico de banco de horas").length,
  }), [filteredItems, adjustmentItems, rhEmail]);

  const visible = useMemo(() => {
    const term = normalize(query);
    return adjustmentItems.filter((item) => {
      const matchesCategory = categoryFilter === "all" || (categoryFilter === "Análise exclusiva do RH" ? isRhOnly(item) : item.category === categoryFilter);
      const matchesReview = filter === "all" || (filter === "email" ? item.status === "pending" && isNotificationEligible(item, rhEmail) : item.status === filter);
      return matchesReview && matchesCategory && (!term || normalize(`${item.collaborator} ${item.matricula} ${item.area} ${item.category}`).includes(term));
    });
  }, [adjustmentItems, filter, categoryFilter, query, rhEmail]);

  const visibleBalances = useMemo(() => {
    const term = normalize(balanceQuery);
    return filteredBalances.filter((b) => (!criticalBalancesOnly || b.critical) && (!term || normalize(`${b.collaborator} ${b.matricula} ${b.area}`).includes(term)));
  }, [filteredBalances, balanceQuery, criticalBalancesOnly]);

  const pendingOutlookItems = filteredItems.filter((i) => i.status === "pending" && isNotificationEligible(i, rhEmail));
  const pendingOutlookDrafts = notificationDrafts(pendingOutlookItems, rhEmail);
  const allPriorityItems = filteredItems.filter((i) => ["Intervalo não respeitado", "Intervalo irregular", "Interjornada menor que 11h", "Três turnos no mesmo dia", "Saldo crítico de banco de horas"].includes(i.category));

  // ─── Actions ─────────────────────────────────────────────────────────────────

  function changeStatus(ids: Iterable<string>, status: ReviewStatus) {
    const target = new Set(ids);
    const nextItems = items.map((item) => target.has(item.id) ? { ...item, status } : item);
    setItems(nextItems); setSelected(new Set());
    persist({ items: nextItems });
  }

  const openOutlookWeb = (sourceItems: Occurrence[]) => {
    const employeeIds = new Set(sourceItems.filter((i) => isNotificationEligible(i, rhEmail)).map((i) => i.matricula));
    const cumulativeItems = items.filter((i) => employeeIds.has(i.matricula) && isNotificationEligible(i, rhEmail) && i.status !== "ignored");
    const drafts = notificationDrafts(cumulativeItems, rhEmail);
    if (!drafts.length) { setNotice(`Esta ocorrência não pode ser enviada. Período disponível: ${currentNotificationWindow.label}.`); return; }
    if (drafts.length > 1) { setNotice("Para abrir no Outlook, selecione somente um colaborador por vez."); return; }
    const draft = drafts[0];
    const recipients = manualEmailRecipients(draft.item, rhEmail);
    const proceed = window.confirm(`Antes de enviar, confira:\n\n1. No campo De, selecione ${rhEmail || "(configure o e-mail do RH)"}\n2. O campo Para deve mostrar colaborador, supervisor e RH.\n\nClique em OK para abrir o rascunho.`);
    if (!proceed) return;
    const query2 = [`to=${recipients.map((email) => encodeURIComponent(email)).join(",")}`, `subject=${encodeURIComponent(`Verificação do registro de ponto — ${draft.item.collaborator}`)}`, `body=${encodeURIComponent(emailBodyFor(draft.item, draft.dates))}`].join("&");
    const w = window.open(`https://outlook.office.com/mail/deeplink/compose?${query2}`, "_blank");
    if (!w) { setNotice("O navegador bloqueou a nova janela. Libere pop-ups e tente novamente."); return; }
    w.opener = null;
    setSelected(new Set());
    setNotice(`Mensagem de ${draft.dates.length} data(s) aberta no Outlook. Confira e selecione "${rhEmail}" no campo De.`);
  };

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".txt")) { setNotice("Selecione um arquivo TXT exportado pelo sistema de ponto."); return; }
    if (!contacts.length) { setNotice("Importe primeiro a base de colaboradores e depois o TXT do ponto."); return; }
    setNotice("Lendo o arquivo...");
    try {
      const text = new TextDecoder("windows-1252").decode(await file.arrayBuffer());
      const parsed = parsePoint(text, contacts, inactiveMatriculas);
      setResult(parsed); setItems(parsed.occurrences); setFileName(file.name);
      persist({ result: parsed, items: parsed.occurrences, fileName: file.name });
      const adjustments = parsed.occurrences.filter(needsPointAdjustment).length;
      setNotice(adjustments > 0 ? `${adjustments} ajuste(s) de ponto identificado(s) para ${parsed.people} pessoa(s).` : "Arquivo lido com sucesso. Nenhum ajuste identificado.");
    } catch { setNotice("Não foi possível ler este TXT. Verifique se é um arquivo exportado pelo sistema de ponto."); }
  }

  async function importContacts(file: File) {
    setNotice("Validando a base de colaboradores...");
    try {
      const imported: ImportedBase = await parseContactsFile(file);
      setContacts(imported.contacts); setInactiveMatriculas(imported.inactiveMatriculas);
      setBaseFileName(imported.fileName); setUnitName(imported.unidade);
      setResult(null); setItems([]); setFileName("");
      persist({ contacts: imported.contacts, inactiveMatriculas: imported.inactiveMatriculas, baseFileName: imported.fileName, unitName: imported.unidade, result: null, items: [], fileName: "" });
      setNotice(`Base de ${imported.unidade} importada: ${imported.contacts.length} colaborador(es) ativo(s)${imported.inactiveSkipped ? ` e ${imported.inactiveSkipped} inativo(s) ignorado(s)` : ""}. Importe agora o TXT do ponto.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível importar a base."); }
  }

  function clearData() {
    if (!confirm("Remover os dados do ponto desta sessão?")) return;
    setResult(null); setItems([]); setFileName("");
    persist({ result: null, items: [], fileName: "" });
    setNotice("Dados do ponto removidos. Importe um novo TXT para começar.");
  }

  function saveRhEmail() {
    const trimmed = rhEmailDraft.trim().toLowerCase();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setNotice("Informe um e-mail válido."); return; }
    setRhEmail(trimmed); persist({ rhEmail: trimmed }); setShowEmailConfig(false);
    setNotice(trimmed ? `E-mail do RH salvo: ${trimmed}` : "E-mail do RH removido.");
  }

  const priorityItems = priorityList
    ? filteredItems.filter((i) => ({
      "interval": i.category === "Intervalo não respeitado" || i.category === "Intervalo irregular",
      "intershift": i.category === "Interjornada menor que 11h",
      "three-shifts": i.category === "Três turnos no mesmo dia",
      "balance": i.category === "Saldo crítico de banco de horas",
    }[priorityList]))
    : [];

  const priorityTitle: Record<PriorityFilter, string> = {
    "interval": "Intervalo não respeitado",
    "intershift": "Interjornada menor que 11h",
    "three-shifts": "Três turnos no mesmo dia",
    "balance": "Banco de horas acima do limite",
  };

  const peopleInView = responsibleFilter === "all" ? (result?.people || 0) : new Set([...filteredDays.map((d) => d.matricula), ...filteredItems.map((i) => i.matricula), ...filteredBalances.map((b) => b.matricula)]).size;

  function downloadCompleteWorkbook() {
    if (!result) return;
    downloadExcel("gestao-ponto-power-bi", [
      { name: "Base Power BI", rows: dailyExportRows(result, filteredItems) },
      { name: "Carga e Banco Mensal", rows: hoursSummaryExportRows(visibleHoursSummaries, hoursStart, hoursEnd) },
      { name: "Banco de Horas", rows: balanceExportRows(filteredBalances) },
      { name: "Ajustes", rows: occurrenceExportRows(adjustmentItems, filteredBalances) },
      { name: "Alertas Prioritários", rows: occurrenceExportRows(allPriorityItems, filteredBalances) },
      { name: "Não Localizados", rows: responsibleFilter === "all" ? unmatchedExportRows(result.unmatchedPeople) : [] },
    ]);
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="-m-6 min-h-screen bg-[#f4f7fb] text-[#17233a]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#003B8E] text-white shadow-sm">
              <Clock3 size={20} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-600">SENAI · Gestão</p>
              <h1 className="text-lg font-bold tracking-tight">Gestão de Ponto</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setRhEmailDraft(rhEmail); setShowEmailConfig(true); }} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${rhEmail ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <Mail size={13} />{rhEmail ? `RH: ${rhEmail}` : "Configurar e-mail do RH"}
            </button>
            {result && (
              <button onClick={clearData} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">
                <X size={15} />Limpar dados
              </button>
            )}
            <button onClick={() => baseInputRef.current && (baseInputRef.current.value = "", baseInputRef.current.click())} className="inline-flex items-center gap-2 rounded-lg border border-[#003B8E] bg-white px-3 py-2 text-sm font-bold text-[#003B8E] hover:bg-blue-50">
              <Users size={15} />Importar base
            </button>
            <button disabled={!contacts.length} onClick={() => inputRef.current && (inputRef.current.value = "", inputRef.current.click())} className="inline-flex items-center gap-2 rounded-lg bg-[#003B8E] px-4 py-2 text-sm font-bold text-white hover:bg-[#002d6e] disabled:cursor-not-allowed disabled:bg-slate-300">
              <UploadCloud size={15} />Importar TXT
            </button>
            <input ref={inputRef} className="hidden" type="file" accept=".txt,text/plain" onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void processFile(f); }} />
            <input ref={baseInputRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void importContacts(f); }} />
          </div>
        </div>
        {/* Responsible filter */}
        {contacts.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50/90">
            <div className="flex flex-col gap-2 px-6 py-2.5 sm:flex-row sm:items-center">
              <label htmlFor="resp-filter" className="text-xs font-bold uppercase tracking-wide text-slate-500">Responsável</label>
              <select id="resp-filter" value={responsibleFilter} onChange={(e) => { setResponsibleFilter(e.target.value); setSelected(new Set()); }} className="min-w-[240px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#003B8E] outline-none focus:border-[#003B8E]">
                <option value="all">Todos os responsáveis</option>
                {responsibleOptions.map((o) => <option key={o.key} value={o.key}>{o.name} · {o.people} colaborador(es)</option>)}
              </select>
              <span className="text-xs text-slate-500">Cards, listas, alertas e Excel seguem este filtro.</span>
            </div>
          </div>
        )}
      </header>

      <div className="px-6 py-6">
        {/* Section title */}
        <section className="mb-5 flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Painel de acompanhamento · {unitName || "Sua unidade SENAI"}</p>
            <h2 className="text-2xl font-bold tracking-tight">Ajustes e notificações de ponto</h2>
            <p className="mt-1 text-sm text-slate-500">Consulta mensal a partir de 01/01/2026. Alertas e banco acumulado a partir de 21/08/2026. Base: <strong>{baseFileName || "não importada"}</strong>.</p>
          </div>
          {fileName && (
            <div className="flex flex-col gap-3 sm:items-end">
              <div className="text-right text-sm text-slate-500">
                <div className="flex items-center justify-end gap-2"><FileText size={15} /><span className="font-semibold text-slate-700">{fileName}</span></div>
                <p className="mt-0.5">Período acumulado: {result?.period}</p>
                <p className="font-bold text-[#003B8E]">Período operacional: {result?.editablePeriod}</p>
              </div>
              {result && <button onClick={downloadCompleteWorkbook} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"><Download size={15} />Excel completo para Power BI</button>}
            </div>
          )}
        </section>

        {/* Empty state */}
        {!result && (
          <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div
              onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (contacts.length) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void processFile(f); }}
              className={`grid min-h-[380px] place-items-center rounded-2xl border-2 border-dashed bg-white p-8 text-center transition ${dragging ? "border-red-400 bg-red-50" : "border-slate-300 hover:border-[#003B8E]"}`}
            >
              <div className="max-w-md">
                {contacts.length ? (
                  <>
                    <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-blue-50 text-[#003B8E]"><UploadCloud size={28} /></div>
                    <h3 className="text-xl font-bold">Solte aqui o TXT acumulado do ponto</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Exporte o TXT desde 01/01/2026 no sistema FPW Gestão de Ponto e importe aqui.</p>
                    <button onClick={() => inputRef.current && (inputRef.current.value = "", inputRef.current.click())} className="mt-5 rounded-lg bg-[#003B8E] px-5 py-3 text-sm font-bold text-white hover:bg-[#002d6e]">Escolher arquivo TXT</button>
                  </>
                ) : (
                  <>
                    <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-700"><Users size={28} /></div>
                    <h3 className="text-xl font-bold">Comece pela base da unidade</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Importe a planilha de colaboradores com matrícula, supervisor e e-mails. Depois importe o TXT do ponto.</p>
                    <button onClick={() => baseInputRef.current && (baseInputRef.current.value = "", baseInputRef.current.click())} className="mt-5 rounded-lg bg-[#003B8E] px-5 py-3 text-sm font-bold text-white hover:bg-[#002d6e]">Importar base de colaboradores</button>
                  </>
                )}
              </div>
            </div>
            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={20} /></div>
                <h3 className="font-bold">Fluxo de uso</h3>
                <ol className="mt-3 space-y-3 text-sm text-slate-600">
                  {["Configure o e-mail do RH", "Importe a base da unidade (Excel)", "Importe o TXT acumulado do FPW", "O sistema detecta ocorrências automaticamente", "Abra o rascunho no Outlook Web para enviar"].map((step, i) => (
                    <li key={step} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{i + 1}</span><span className="pt-0.5">{step}</span></li>
                  ))}
                </ol>
              </div>
              {contacts.length > 0 && (
                <div className="rounded-2xl bg-[#003B8E] p-5 text-white shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-200">Base carregada · {unitName}</p>
                  <p className="mt-2 text-3xl font-bold">{contacts.length}</p>
                  <p className="mt-1 text-sm text-blue-100">colaboradores ativos</p>
                  <p className="mt-0.5 truncate text-xs text-blue-200">{baseFileName}</p>
                </div>
              )}
            </aside>
          </section>
        )}

        {result && (
          <>
            {/* Metrics */}
            <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
              {[
                { label: "Pessoas no arquivo", value: peopleInView, icon: Users },
                { label: "Mensagens a preparar", value: counts.notificationReady, icon: Clock3 },
                { label: "Análise exclusiva RH", value: counts.rhOnly, icon: ShieldCheck },
                { label: "Batidas para corrigir", value: counts.missing, icon: AlertTriangle },
                { label: "Escalas para analisar", value: counts.schedules, icon: ChevronDown },
                { label: "Banco acima de ±16h", value: counts.criticalBalances, icon: AlertTriangle },
                { label: "Pessoas notificadas", value: counts.notifiedPeople, icon: CheckCircle2 },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                    <Icon size={16} className="text-slate-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold">{value}</p>
                </div>
              ))}
            </section>

            {/* Unmatched warning */}
            {responsibleFilter === "all" && result.unmatched > 0 && (
              <button onClick={() => setShowUnmatched(true)} className="mb-5 flex w-full items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-left text-sm text-amber-900 hover:border-amber-400">
                <span className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0" size={17} /><span><strong>{result.unmatched} pessoa(s) não localizada(s) na base.</strong> Clique para ver a lista.</span></span>
                <span className="shrink-0 font-bold underline">Ver lista</span>
              </button>
            )}

            {/* Priority alerts */}
            <section className="mb-5 rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-red-700">Alertas prioritários</p>
                  <p className="mt-1 text-sm text-slate-500">Clique para filtrar as pessoas que precisam de verificação imediata.</p>
                </div>
                <button onClick={() => downloadExcel("alertas-prioritarios", [{ name: "Alertas", rows: occurrenceExportRows(allPriorityItems, filteredBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50"><Download size={13} />Baixar Excel</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {([
                  { key: "interval" as PriorityFilter, label: "Intervalo não respeitado", value: counts.interval, help: "Hora extra intervalo ou intervalo irregular" },
                  { key: "intershift" as PriorityFilter, label: "Interjornada menor que 11h", value: counts.intershift, help: "Saída de um dia até a entrada seguinte" },
                  { key: "three-shifts" as PriorityFilter, label: "Três turnos no mesmo dia", value: counts.threeShifts, help: "Seis ou mais marcações no dia" },
                  { key: "balance" as PriorityFilter, label: "Banco acima de ±16h", value: counts.criticalBalances, help: "Mais de dois dias positivos ou negativos" },
                ] as const).map((alert) => (
                  <button key={alert.key} onClick={() => setPriorityList(alert.key)} className={`rounded-xl border p-4 text-left transition ${priorityList === alert.key ? "border-red-500 bg-red-50 ring-2 ring-red-100" : "border-slate-200 hover:border-red-300 hover:bg-red-50/50"}`}>
                    <span className="flex items-center justify-between"><span className="font-bold text-slate-800">{alert.label}</span><span className="rounded-full bg-red-100 px-2.5 py-1 text-sm font-black text-red-700">{alert.value}</span></span>
                    <span className="mt-1.5 block text-xs text-slate-500">{alert.help}</span>
                    <span className="mt-2.5 block text-xs font-bold text-red-700">Ver lista de pessoas e datas</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Monthly hours */}
            <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#003B8E]">Carga horária mensal</p>
                    <h3 className="mt-1 text-lg font-bold">Carga prevista, horas batidas e banco de horas</h3>
                    <p className="mt-1 text-sm text-slate-500">Uma linha por colaborador por mês, de 01/01/2026 até hoje.</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                    <label className="text-xs font-bold text-slate-600"><span className="mb-1 block">Data inicial</span><input type="date" min={MONTHLY_ANALYSIS_START} max={todayIso()} value={hoursStart} onChange={(e) => setHoursStart(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#003B8E]" /></label>
                    <label className="text-xs font-bold text-slate-600"><span className="mb-1 block">Data final</span><input type="date" min={MONTHLY_ANALYSIS_START} max={todayIso()} value={hoursEnd} onChange={(e) => setHoursEnd(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#003B8E]" /></label>
                    <label className="relative min-w-[220px]"><span className="sr-only">Buscar</span><Search size={15} className="absolute left-3 top-1/2 mt-2.5 -translate-y-1/2 text-slate-400" /><input value={hoursQuery} onChange={(e) => setHoursQuery(e.target.value)} placeholder="Buscar colaborador ou matrícula" className="mt-5 w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#003B8E]" /></label>
                    <button disabled={!visibleHoursSummaries.length} onClick={() => downloadExcel("carga-banco-por-mes", [{ name: "Carga e Banco Mensal", rows: hoursSummaryExportRows(visibleHoursSummaries, hoursStart, hoursEnd) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Download size={13} />Baixar Excel</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-blue-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Carga prevista</p><p className="mt-1 text-xl font-black text-[#003B8E]">{durationLabel(hoursTotals.expected)}</p></div>
                  <div className="rounded-xl bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Horas batidas</p><p className="mt-1 text-xl font-black text-slate-800">{durationLabel(hoursTotals.worked)}</p></div>
                  <div className={`rounded-xl p-4 ${hoursTotals.bank > 0 ? "bg-emerald-50" : hoursTotals.bank < 0 ? "bg-red-50" : "bg-slate-100"}`}><p className={`text-xs font-bold uppercase tracking-wide ${hoursTotals.bank > 0 ? "text-emerald-700" : hoursTotals.bank < 0 ? "text-red-700" : "text-slate-600"}`}>Banco de horas</p><p className={`mt-1 text-xl font-black ${hoursTotals.bank > 0 ? "text-emerald-700" : hoursTotals.bank < 0 ? "text-red-700" : "text-slate-600"}`}>{signedDurationLabel(hoursTotals.bank)}</p></div>
                </div>
              </div>
              {hoursStart > hoursEnd ? (
                <div className="px-6 py-10 text-center text-sm font-semibold text-red-700">A data inicial não pode ser posterior à data final.</div>
              ) : (
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Mês</th><th className="px-5 py-3">Carga/escala</th><th className="px-5 py-3">Carga prevista</th><th className="px-5 py-3">Horas batidas</th><th className="px-5 py-3">Banco do mês</th><th className="px-5 py-3">Conferência</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleHoursSummaries.map((row: HoursSummary) => (
                        <tr key={`${row.matricula}-${row.month}`} className="hover:bg-slate-50">
                          <td className="px-5 py-4"><span className="block font-bold text-slate-800">{row.collaborator}</span><span className="text-xs text-slate-400">{row.matricula} · {row.area}</span></td>
                          <td className="whitespace-nowrap px-5 py-4 text-base font-black text-[#003B8E]">{row.monthLabel}</td>
                          <td className="max-w-[260px] px-5 py-4"><span className="block font-semibold text-slate-700">{row.weeklyHours ? `${row.weeklyHours}h semanais` : "Carga não informada"}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{row.schedules.join(" | ") || "Escala não identificada"}</span></td>
                          <td className="px-5 py-4"><span className="text-lg font-black text-[#003B8E]">{durationLabel(row.expectedMinutes)}</span><span className="block text-xs text-slate-400">{row.scheduledDays} dia(s)</span></td>
                          <td className="px-5 py-4 text-lg font-black text-slate-800">{durationLabel(row.workedMinutes)}</td>
                          <td className={`px-5 py-4 text-lg font-black ${row.bankMinutes > 0 ? "text-emerald-700" : row.bankMinutes < 0 ? "text-red-700" : "text-slate-600"}`}>{signedDurationLabel(row.bankMinutes)}</td>
                          <td className="px-5 py-4">{row.incompleteDays > 0 ? <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">{row.incompleteDays} dia(s) c/ batida incompleta</span> : <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">Cálculo completo</span>}<span className="mt-0.5 block text-xs text-slate-400">{row.nonWorkingDays} folga(s)/feriado(s)</span></td>
                        </tr>
                      ))}
                      {!visibleHoursSummaries.length && <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">Nenhum colaborador com registro de ponto encontrado neste período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">{visibleHoursSummaries.length} linha(s) mensais · {new Set(visibleHoursSummaries.map((r: HoursSummary) => r.matricula)).size} colaborador(es)</footer>
            </section>

            {/* Bank hours */}
            <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="font-bold">Banco de horas acumulado</h3>
                  <p className="mt-1 text-sm text-slate-500">Calculado desde 21/08/2026 — horas batidas menos horas previstas. Limite ±16h.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button onClick={() => downloadExcel("banco-de-horas", [{ name: "Banco de Horas", rows: balanceExportRows(visibleBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"><Download size={13} />Baixar Excel</button>
                  <button onClick={() => setCriticalBalancesOnly((v) => !v)} className={`rounded-lg border px-3 py-2.5 text-xs font-bold ${criticalBalancesOnly ? "border-red-500 bg-red-50 text-red-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{criticalBalancesOnly ? "Somente críticos ✓" : "Mostrar somente críticos"}</button>
                  <label className="relative min-w-[240px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={balanceQuery} onChange={(e) => setBalanceQuery(e.target.value)} placeholder="Buscar colaborador ou matrícula" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#003B8E]" /></label>
                </div>
              </div>
              <div className="max-h-[380px] overflow-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Área</th><th className="px-5 py-3">Saldo acumulado</th><th className="px-5 py-3">Situação</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleBalances.map((balance: BalanceRecord) => (
                      <tr key={balance.matricula} className={balance.critical ? "bg-red-50/70" : "hover:bg-slate-50"}>
                        <td className="px-5 py-4"><span className="block font-bold text-slate-800">{balance.collaborator}</span><span className="text-xs text-slate-400">Matrícula {balance.matricula}</span></td>
                        <td className="px-5 py-4 text-slate-600">{balance.area}</td>
                        <td className={`px-5 py-4 text-lg font-black ${balance.minutes > 0 ? "text-emerald-700" : balance.minutes < 0 ? "text-red-700" : "text-slate-600"}`}>{balance.label}</td>
                        <td className="px-5 py-4">{balance.critical ? <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">Limite ultrapassado</span> : <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">Dentro do limite</span>}</td>
                      </tr>
                    ))}
                    {!visibleBalances.length && <tr><td colSpan={4} className="px-6 py-10 text-center text-slate-400">Nenhum saldo encontrado nesta visualização.</td></tr>}
                  </tbody>
                </table>
              </div>
              <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">{visibleBalances.length} colaborador(es) · saldo desde 21/08/2026</footer>
            </section>

            {/* Notification info banner */}
            <div className={`mb-5 flex items-start gap-3 rounded-xl border p-4 text-sm border-blue-200 bg-blue-50 text-blue-950`}>
              <Mail className="mt-0.5 shrink-0" size={17} />
              <div>
                <p><strong>Envio manual pelo Outlook Web.</strong> Somente ausência de batida e batidas incompletas são notificadas ao colaborador e supervisor.</p>
                <p className="mt-1 font-bold text-blue-900">Período liberado: {currentNotificationWindow.label}.</p>
                <p className="mt-1 text-xs">Configure o e-mail do RH no topo para habilitar os botões de rascunho. As demais ocorrências ficam disponíveis somente para acompanhamento.</p>
                <div className="mt-3 flex gap-2">
                  <button disabled={!pendingOutlookDrafts.length || !rhEmail} onClick={() => downloadCsv(pendingOutlookItems, rhEmail, "lote-outlook-ponto")} className="inline-flex items-center gap-2 rounded-lg bg-[#003B8E] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#002d6e] disabled:cursor-not-allowed disabled:opacity-40"><Mail size={14} />Exportar CSV ({pendingOutlookDrafts.length} pessoa{pendingOutlookDrafts.length !== 1 ? "s" : ""})</button>
                </div>
              </div>
            </div>

            {/* Occurrences table */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="font-bold">Correções desde 21/08/2026</h3>
                <p className="mt-1 text-sm text-slate-500">O envio de e-mail fica limitado ao período aberto: {currentNotificationWindow.label}.</p>
              </div>
              <div className="flex flex-col gap-4 border-b border-slate-200 p-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                  {([["email", `Enviar e-mail (${counts.emailCases})`], ["pending", `Aguardando (${counts.pending})`], ["approved", `Tratadas (${counts.approved})`], ["ignored", `Sem envio (${counts.ignored})`], ["all", `Todos (${adjustmentItems.length})`]] as const).map(([value, label]) => (
                    <button key={value} onClick={() => { setFilter(value as typeof filter); setSelected(new Set()); }} className={`rounded-md px-3 py-2 text-xs font-bold transition ${filter === value ? "bg-white text-[#003B8E] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{label}</button>
                  ))}
                </div>
                <div className="flex flex-1 flex-wrap justify-end gap-2">
                  <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as CorrectionFilter); setSelected(new Set()); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-[#003B8E]">
                    <option value="all">Todos os tipos ({adjustmentItems.length})</option>
                    {(["Análise exclusiva do RH", "Ausência de batida", "Falta", "Fora da escala", "Batidas incompletas", "Marcação errada", "Marcação irregular"] as const).map((cat) => (
                      <option key={cat} value={cat}>{cat} ({cat === "Análise exclusiva do RH" ? adjustmentItems.filter(isRhOnly).length : adjustmentItems.filter((i) => i.category === cat).length})</option>
                    ))}
                  </select>
                  <label className="relative min-w-[200px] flex-1 xl:max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar pessoa, matrícula ou área" className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#003B8E]" /></label>
                  {selected.size > 0 && (
                    <>
                      <button onClick={() => { if (confirm("Confirme somente após enviar as mensagens pelo Outlook.")) changeStatus(selected, "approved"); }} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800">Registrar como enviado</button>
                      <button onClick={() => changeStatus(selected, "ignored")} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600"><X size={14} className="mr-1 inline" />Sem envio</button>
                      <button disabled={!rhEmail} onClick={() => openOutlookWeb(items.filter((i) => selected.has(i.id)))} className="rounded-lg bg-[#003B8E] px-3 py-2 text-xs font-bold text-white hover:bg-[#002d6e] disabled:opacity-40"><Mail size={14} className="mr-1 inline" />Abrir Outlook Web</button>
                    </>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Selecionar todas" checked={visible.length > 0 && visible.every((i) => selected.has(i.id))} onChange={() => { if (visible.every((i) => selected.has(i.id))) setSelected(new Set()); else setSelected(new Set(visible.map((i) => i.id))); }} /></th>
                      <th className="px-3 py-3">Colaborador</th>
                      <th className="px-3 py-3">Data</th>
                      <th className="px-3 py-3">Ocorrência</th>
                      <th className="px-3 py-3">Marcações</th>
                      <th className="px-3 py-3">Responsável</th>
                      <th className="px-3 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((item) => (
                      <tr key={item.id} className={`transition hover:bg-slate-50/80 ${isRhOnly(item) ? "bg-violet-50/40" : ""}`}>
                        <td className="px-4 py-4"><input type="checkbox" aria-label={`Selecionar ${item.collaborator}`} checked={selected.has(item.id)} onChange={() => setSelected((cur) => { const next = new Set(cur); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /></td>
                        <td className="px-3 py-4">
                          <button onClick={() => setDetail(item)} className="text-left">
                            <span className="block font-bold text-slate-800 hover:text-[#003B8E]">{item.collaborator}</span>
                            <span className="text-xs text-slate-400">{item.matricula} · {item.area}</span>
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 font-medium">{item.date}</td>
                        <td className="px-3 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.severity === "alta" ? "bg-red-100 text-red-800" : item.severity === "média" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{item.category}</span>
                          {isRhOnly(item) && <span className="ml-2 inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">Somente RH</span>}
                          <span className="mt-1 block max-w-[240px] truncate text-xs text-slate-500">{item.detail}</span>
                          {item.scaleSuggestion && <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${item.scaleSuggestion.status === "suggested" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-800"}`}>{item.scaleSuggestion.status === "suggested" ? `Sugestão: escala ${item.scaleSuggestion.code}` : "Troca não recomendada"}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 font-mono text-xs text-slate-600">{item.punches.join(" · ") || "—"}</td>
                        <td className="px-3 py-4"><span className="font-semibold">{item.supervisor}</span><span className="block text-xs text-slate-400">{isNotificationEligible(item, rhEmail) ? "para: colaborador, supervisor e RH" : isRhOnly(item) ? "somente análise do RH" : "período fechado"}</span></td>
                        <td className="px-3 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.status === "approved" ? "bg-emerald-100 text-emerald-800" : item.status === "ignored" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{occurrenceStatusLabel(item)}</span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          {isNotificationEligible(item, rhEmail) ? (
                            <button onClick={() => openOutlookWeb([item])} className="inline-flex items-center gap-1 rounded-md bg-[#003B8E] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#002d6e]"><Mail size={12} />Abrir e-mail</button>
                          ) : (
                            <button onClick={() => setDetail(item)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#003B8E] hover:text-[#003B8E]">Detalhes</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!visible.length && <tr><td colSpan={8} className="px-6 py-14 text-center text-slate-400">Nenhuma ocorrência nesta visualização.</td></tr>}
                  </tbody>
                </table>
              </div>
              <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">{visible.length} ajuste(s) desde 21/08/2026</p>
                <button onClick={() => downloadExcel("lista-correcoes", [{ name: "Correções", rows: occurrenceExportRows(visible, filteredBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={15} />Baixar em Excel</button>
              </footer>
            </section>
          </>
        )}
      </div>

      {/* Priority list modal */}
      {priorityList && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) setPriorityList(null); }}>
          <section className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 p-6">
              <div><p className="text-xs font-bold uppercase tracking-wider text-red-700">Alerta prioritário</p><h3 className="mt-1 text-xl font-bold">{priorityTitle[priorityList]}</h3><p className="mt-1 text-sm text-slate-500">{priorityItems.length} ocorrência(s).</p></div>
              <button onClick={() => setPriorityList(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </header>
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-5 py-3">Pessoa</th><th className="px-5 py-3">Data</th><th className="px-5 py-3">Marcações</th><th className="px-5 py-3">Detalhe</th><th className="px-5 py-3">Situação</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {priorityItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-5 py-4"><span className="block font-bold">{item.collaborator}</span><span className="text-xs text-slate-400">{item.matricula}</span></td>
                      <td className="whitespace-nowrap px-5 py-4 font-medium">{item.date}</td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-600">{item.punches.join(" · ") || "—"}</td>
                      <td className="max-w-[300px] px-5 py-4 text-xs leading-5 text-slate-600">{item.detail}</td>
                      <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.status === "approved" ? "bg-emerald-100 text-emerald-800" : item.status === "ignored" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{item.status === "pending" ? "Aguardando" : item.status === "approved" ? "Notificado" : "Não enviar"}</span></td>
                    </tr>
                  ))}
                  {!priorityItems.length && <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">Nenhuma ocorrência.</td></tr>}
                </tbody>
              </table>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
              <button onClick={() => downloadExcel(`alerta-${priorityList}`, [{ name: priorityTitle[priorityList], rows: occurrenceExportRows(priorityItems, filteredBalances) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={14} />Baixar Excel</button>
              <button onClick={() => setPriorityList(null)} className="rounded-lg bg-[#003B8E] px-4 py-2.5 text-sm font-bold text-white">Fechar</button>
            </footer>
          </section>
        </div>
      )}

      {/* Unmatched modal */}
      {showUnmatched && result && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) setShowUnmatched(false); }}>
          <section className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 p-6">
              <div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Cadastro pendente</p><h3 className="mt-1 text-xl font-bold">Pessoas não localizadas na base</h3></div>
              <button onClick={() => setShowUnmatched(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-6 py-3">Nome no ponto</th><th className="px-6 py-3">Matrícula</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {result.unmatchedPeople.map((p) => <tr key={p.matricula}><td className="px-6 py-4 font-semibold">{p.nome}</td><td className="px-6 py-4 font-mono text-slate-600">{p.matricula}</td></tr>)}
                </tbody>
              </table>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
              <button onClick={() => downloadExcel("nao-localizados", [{ name: "Não Localizados", rows: unmatchedExportRows(result.unmatchedPeople) }])} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50"><Download size={14} />Baixar Excel</button>
              <button onClick={() => setShowUnmatched(false)} className="rounded-lg bg-[#003B8E] px-4 py-2.5 text-sm font-bold text-white">Fechar</button>
            </footer>
          </section>
        </div>
      )}

      {/* RH Email config modal */}
      {showEmailConfig && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" onMouseDown={(e) => { if (e.currentTarget === e.target) setShowEmailConfig(false); }}>
          <section className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-200 p-6">
              <div><p className="text-xs font-bold uppercase tracking-wider text-[#003B8E]">Configuração</p><h3 className="mt-1 text-xl font-bold">E-mail do RH</h3><p className="mt-1 text-sm text-slate-500">Usado como remetente/destinatário nas notificações ao colaborador.</p></div>
              <button onClick={() => setShowEmailConfig(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </header>
            <div className="p-6">
              <label className="text-sm font-bold text-slate-700">E-mail do RH da unidade<input type="email" value={rhEmailDraft} onChange={(e) => setRhEmailDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveRhEmail(); }} placeholder="rh@suaunidade.com.br" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#003B8E]" /></label>
              <p className="mt-2 text-xs text-slate-500">Fica salvo neste navegador. Configure o mesmo endereço como remetente no Outlook antes de enviar.</p>
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
              <button onClick={() => setShowEmailConfig(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600">Cancelar</button>
              <button onClick={saveRhEmail} className="rounded-lg bg-[#003B8E] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#002d6e]">Salvar e-mail</button>
            </footer>
          </section>
        </div>
      )}

      {/* Detail panel */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={(e) => { if (e.currentTarget === e.target) setDetail(null); }}>
          <aside className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-wider text-red-600">Detalhes da ocorrência</p><h3 className="mt-1 text-xl font-bold">{detail.collaborator}</h3><p className="text-sm text-slate-500">Matrícula {detail.matricula} · {detail.area}</p></div>
              <button onClick={() => setDetail(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={19} /></button>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Data</p><p className="mt-1 font-bold">{detail.date}</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold uppercase text-slate-400">Marcações</p><p className="mt-1 font-mono text-sm font-bold">{detail.punches.join(" · ") || "—"}</p></div>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 p-4">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${detail.severity === "alta" ? "bg-red-100 text-red-800" : detail.severity === "média" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>{detail.category}</span>
              <p className="mt-3 text-sm leading-6 text-slate-600">{detail.detail}</p>
              <p className="mt-2 text-xs text-slate-400">Escala: {detail.schedule}</p>
            </div>
            {detail.scaleSuggestion && (
              <div className={`mt-4 rounded-xl border p-4 ${detail.scaleSuggestion.status === "suggested" ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`text-xs font-bold uppercase tracking-wide ${detail.scaleSuggestion.status === "suggested" ? "text-blue-700" : "text-amber-800"}`}>{detail.scaleSuggestion.status === "suggested" ? "Escala sugerida para conferência" : "Troca de escala não recomendada"}</p>
                {detail.scaleSuggestion.status === "suggested" && <><p className="mt-2 text-lg font-black text-slate-900">Código {detail.scaleSuggestion.code}</p><p className="mt-1 text-sm font-semibold text-slate-700">{detail.scaleSuggestion.description}</p></>}
                <p className="mt-2 text-sm leading-6 text-slate-700">{detail.scaleSuggestion.reason}</p>
                <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">{detail.scaleSuggestion.cautions.map((c) => <li key={c}>• {c}</li>)}</ul>
                <p className="mt-2 text-xs font-bold text-red-700">Não altera o ponto automaticamente. Valide com RH.</p>
              </div>
            )}
            <div className="mt-6">
              <p className="mb-3 text-sm font-bold">Destinatários</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Para</span><span className="max-w-[280px] truncate font-semibold">{detail.email || "E-mail não localizado"}</span></div>
                <div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">Supervisor</span><span className="max-w-[280px] truncate font-semibold">{detail.supervisorEmail || "—"}</span></div>
                <div className="flex justify-between rounded-lg bg-slate-50 p-3"><span className="text-slate-500">RH (remetente)</span><span className="max-w-[280px] truncate font-semibold">{rhEmail || "Não configurado"}</span></div>
              </div>
            </div>
            <div className="mt-6">
              <p className="mb-3 text-sm font-bold">Prévia da mensagem</p>
              <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-[#fbfcfe] p-4 text-sm leading-6 text-slate-600">
                {isRhOnly(detail) ? "Análise exclusiva do RH. Não será enviada ao colaborador." : needsAutomaticNotification(detail) && !isInNotificationWindow(detail) ? "Período fechado. Somente no histórico." : emailBodyFor(detail, [detail.date])}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => { changeStatus([detail.id], "ignored"); setDetail(null); }} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Não enviar</button>
              {detail.status !== "approved" && isNotificationEligible(detail, rhEmail) && <button onClick={() => openOutlookWeb([detail])} className="flex-1 rounded-lg bg-[#003B8E] px-4 py-3 text-sm font-bold text-white hover:bg-[#002d6e]"><Mail size={15} className="mr-1 inline" />Abrir no Outlook</button>}
              {detail.status !== "approved" && <button onClick={() => { if (confirm("Confirme somente após enviar a mensagem pelo Outlook.")) { changeStatus([detail.id], "approved"); setDetail(null); } }} className="flex-1 rounded-lg border border-emerald-300 px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50">Registrar envio</button>}
            </div>
          </aside>
        </div>
      )}

      {/* Toast notice */}
      {notice && (
        <div className="fixed bottom-5 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-2xl">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {notice}
          <button onClick={() => setNotice("")} className="ml-2 text-slate-400 hover:text-white"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
