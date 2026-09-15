"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { planejamentoApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Loader2, AlertTriangle, BarChart2, ChevronDown, ChevronRight,
  Check, Cpu, TrendingUp, TrendingDown, RefreshCw, Printer
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UCParaPlanejar {
  uc_id: number;
  uc_nome: string;
  carga_horaria: number;
  ordem: number;
  professor_preferido_id?: number;
  data_inicio?: string;
  nao_agendar?: boolean;
  dias_semana?: number[];
}

interface AlocacaoResult {
  uc_id: number;
  uc_nome: string;
  uc_codigo: string;
  etapa: string | null;
  carga_horaria: number;
  professor_id: number | null;
  professor_nome: string | null;
  aulas_necessarias: number;
  datas_aulas: string[];
  justificativa: string;
  alerta: string | null;
  score: number;
}

interface Analise {
  avaliacao_geral?: string;
  avaliacao_descricao?: string;
  alertas_criticos?: string[];
  sugestoes?: string[];
  resumo?: string;
  metricas?: Record<string, number>;
}

interface RegenciaProjecaoItem {
  professor_id: number;
  professor_nome: string;
  tipo: string;
  regencia_antes: number;
  horas_delta: number;
  direcao: "sobe" | "desce";
}

interface ImpactoData {
  mudancas: {
    uc_id: number;
    professor_atual_id: number;
    professor_atual_nome: string;
    professor_proposto_id: number;
    professor_proposto_nome: string;
  }[];
  mantidos_count: number;
  novos: {
    uc_id: number;
    professor_proposto_id: number;
    professor_proposto_nome: string;
  }[];
  sem_professor: number[];
  regencia_projecao: RegenciaProjecaoItem[];
  resumo: {
    total_ucs: number;
    com_professor: number;
    sem_professor: number;
    mudancas: number;
    mantidos: number;
  };
}

interface ResultadoGerado {
  evento_id: number;
  alocacoes: AlocacaoResult[];
  // Greedy fields
  regencia_projetada?: {
    professor_id: number;
    nome: string;
    tipo: string;
    horas_contratadas: number;
    horas_atuais: number;
    horas_planejadas: number;
    horas_projetadas: number;
    percentual_atual: number;
    percentual_projetado: number;
    meta: number | null;
  }[];
  conflitos?: { descricao?: string; uc_nome?: string; motivo?: string }[];
  alertas_regencia?: string[];
  total_aulas?: number;
  horas_planejadas?: number;
  analise?: Analise;
  // OR-Tools fields
  solver_status?: string;
  impacto?: ImpactoData;
  alertas?: Record<string, string>;
}

interface Props {
  eventoId: number;
  nomeEvento: string;
  ucs: UCParaPlanejar[];
  modoSuperior?: boolean;
  cliparSemestre?: boolean;
  onClose: () => void;
  onConfirmado?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}/${m}`;
}

const AVALIACAO_CLS: Record<string, string> = {
  "Ótimo":   "text-green-700 bg-green-50 border-green-200",
  "Bom":     "text-blue-700 bg-blue-50 border-blue-200",
  "Atenção": "text-amber-700 bg-amber-50 border-amber-200",
  "Crítico": "text-red-700 bg-red-50 border-red-200",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AlocacaoCard({ a }: { a: AlocacaoResult }) {
  const [expandido, setExpandido] = useState(false);
  const isNaoAgendada = a.aulas_necessarias === 0 && !a.professor_id;
  return (
    <div className={cn(
      "border rounded-lg p-3",
      isNaoAgendada ? "border-blue-200 bg-blue-50/40" :
      a.alerta ? "border-amber-200 bg-amber-50/40" : "border-gray-200"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm text-gray-900 truncate">{a.uc_nome}</p>
            {isNaoAgendada && (
              <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wide">
                EaD
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {a.carga_horaria}h{!isNaoAgendada && ` · ${a.aulas_necessarias} aulas`}
          </p>
        </div>
        <div className="text-right shrink-0">
          {isNaoAgendada ? (
            <p className="text-sm text-blue-600 italic">Sem agendamento</p>
          ) : a.professor_nome ? (
            <p className="text-sm font-medium text-blue-700">{a.professor_nome}</p>
          ) : (
            <p className="text-sm font-medium text-red-600 italic">Sem professor</p>
          )}
          {a.professor_id && (
            <p className="text-[10px] text-gray-400">score {a.score.toFixed(2)}</p>
          )}
        </div>
      </div>

      {!isNaoAgendada && a.aulas_necessarias > 0 && a.datas_aulas.length === 0 && (
        <p className="text-xs text-red-600 mt-1.5 flex items-start gap-1 font-medium">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          Sem datas letivas disponíveis — nenhuma aula será agendada para esta UC.
        </p>
      )}
      {a.alerta && (
        <p className="text-xs text-amber-700 mt-1.5 flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          {a.alerta}
        </p>
      )}

      {a.datas_aulas.length > 0 && (
        <button
          className="text-[10px] text-gray-400 hover:text-gray-600 mt-1.5 flex items-center gap-1"
          onClick={() => setExpandido((v) => !v)}
        >
          {expandido ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {a.datas_aulas.length} datas planejadas
        </button>
      )}
      {expandido && (
        <div className="mt-1 flex flex-wrap gap-1">
          {a.datas_aulas.map((d) => (
            <span key={d} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 font-mono">
              {fmtDate(d)}
            </span>
          ))}
        </div>
      )}

      {a.justificativa && (
        <p className="text-[11px] text-gray-500 mt-1.5 italic">{a.justificativa}</p>
      )}
    </div>
  );
}

// ── Relatório de Impressão ────────────────────────────────────────────────────

function imprimirRelatorio(resultado: ResultadoGerado, nomeEvento: string, modoOtimizado: boolean) {
  // Build date → aulas map
  const dateMap: Record<string, { uc_nome: string; professor_nome: string | null; alerta: string | null }[]> = {};
  for (const aloc of resultado.alocacoes) {
    for (const d of aloc.datas_aulas) {
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push({ uc_nome: aloc.uc_nome, professor_nome: aloc.professor_nome, alerta: aloc.alerta });
    }
  }

  const allDates = Object.keys(dateMap).sort();
  if (allDates.length === 0 && resultado.alocacoes.length === 0) {
    alert("Nenhuma aula gerada para imprimir.");
    return;
  }

  // Color palette per UC
  const palette = ["#dbeafe","#d1fae5","#fef9c3","#fce7f3","#e0e7ff","#f3e8ff","#ffedd5","#cffafe","#dcfce7","#fef3c7"];
  const ucColors: Record<string, string> = {};
  let ci = 0;
  for (const aloc of resultado.alocacoes) {
    if (!ucColors[aloc.uc_nome]) { ucColors[aloc.uc_nome] = palette[ci++ % palette.length]; }
  }

  // Build months range
  const months: { year: number; month: number }[] = [];
  if (allDates.length > 0) {
    const minD = new Date(allDates[0] + "T00:00:00");
    const maxD = new Date(allDates[allDates.length - 1] + "T00:00:00");
    let cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
    const end = new Date(maxD.getFullYear(), maxD.getMonth(), 1);
    while (cur <= end) {
      months.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  }

  const DAY_NAMES = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const calendarHTML = months.map(({ year, month }) => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const emptyCells = Array.from({ length: firstWeekday }).map(() => `<div class="day empty"></div>`).join("");

    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const aulas = dateMap[ds] || [];
      const wd = new Date(year, month, d).getDay();
      const isWe = wd === 0 || wd === 6;
      const chips = aulas.map(a =>
        `<div class="chip" style="background:${ucColors[a.uc_nome] || "#f3f4f6"}">
          <div class="chip-uc">${a.uc_nome.length > 22 ? a.uc_nome.substring(0, 22) + "…" : a.uc_nome}</div>
          ${a.professor_nome
            ? `<div class="chip-prof">${a.professor_nome.split(" ").slice(0, 2).join(" ")}</div>`
            : `<div class="chip-sem">Sem professor</div>`}
         </div>`
      ).join("");
      return `<div class="day${isWe ? " we" : ""}${aulas.length ? " has-aula" : ""}">
        <span class="dn">${d}</span>${chips}</div>`;
    }).join("");

    return `<div class="month-block">
      <div class="month-title">${MONTH_NAMES[month]} ${year}</div>
      <div class="cal-grid">
        ${DAY_NAMES.map(n => `<div class="dh">${n}</div>`).join("")}
        ${emptyCells}${dayCells}
      </div></div>`;
  }).join("");

  // Allocations table
  const alocsRows = resultado.alocacoes.map(a =>
    `<tr${a.alerta ? ' class="warn-row"' : ""}>
      <td>${a.uc_nome}${a.etapa ? ` <span class="etapa">${a.etapa}</span>` : ""}${a.alerta ? " ⚠" : ""}</td>
      <td>${a.carga_horaria}h</td>
      <td>${a.professor_nome || "—"}</td>
      <td>${a.datas_aulas.length}</td>
      <td>${a.datas_aulas.length > 0 ? fmtDate(a.datas_aulas[0]) + "/" + new Date(a.datas_aulas[0]+"T00:00:00").getFullYear().toString().slice(2) : "—"}</td>
    </tr>`
  ).join("");

  // Impact section (OR-Tools)
  let impactoHTML = "";
  if (modoOtimizado && resultado.impacto) {
    const { resumo, mudancas, regencia_projecao } = resultado.impacto;
    impactoHTML = `
      <section>
        <h2>Impacto da Otimização</h2>
        <div class="summary-grid">
          <div class="s-card"><div class="s-num">${resumo.total_ucs}</div><div class="s-lbl">Total UCs</div></div>
          <div class="s-card ok"><div class="s-num">${resumo.com_professor}</div><div class="s-lbl">Alocadas</div></div>
          <div class="s-card${resumo.mudancas > 0 ? " warn" : ""}"><div class="s-num">${resumo.mudancas}</div><div class="s-lbl">Mudanças</div></div>
          <div class="s-card${resumo.sem_professor > 0 ? " danger" : ""}"><div class="s-num">${resumo.sem_professor}</div><div class="s-lbl">Sem professor</div></div>
        </div>
      </section>
      ${mudancas.length > 0 ? `
      <section>
        <h2>Mudanças de Professor</h2>
        <table><thead><tr><th>UC</th><th>Professor Atual</th><th>Professor Proposto</th></tr></thead>
        <tbody>${mudancas.map(m => `<tr>
          <td>UC ${m.uc_id}</td>
          <td class="strike">${m.professor_atual_nome}</td>
          <td class="bold green">${m.professor_proposto_nome}</td></tr>`).join("")}
        </tbody></table>
      </section>` : ""}
      ${regencia_projecao.length > 0 ? `
      <section>
        <h2>Projeção de Regência</h2>
        <table><thead><tr><th>Professor</th><th>Tipo</th><th>Regência atual</th><th>Variação (h)</th></tr></thead>
        <tbody>${regencia_projecao.map(r => `<tr>
          <td>${r.professor_nome}</td><td>${r.tipo}</td>
          <td>${r.regencia_antes.toFixed(1)}%</td>
          <td class="${r.direcao === "sobe" ? "verde" : "laranja"}">${r.horas_delta > 0 ? "+" : ""}${r.horas_delta}h</td></tr>`).join("")}
        </tbody></table>
      </section>` : ""}`;
  }

  const solverBadge = modoOtimizado
    ? `· Otimização CP-SAT${resultado.solver_status ? ` (${resultado.solver_status})` : ""}`
    : "· Modo Rápido (Greedy)";

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Planejamento – ${nomeEvento}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#111;padding:16px}
h1{font-size:15px;font-weight:700;margin-bottom:2px}
.sub{font-size:10px;color:#6b7280;margin-bottom:18px}
section{margin-bottom:22px}
h2{font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb}
table{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}
th{background:#f9fafb;padding:4px 7px;text-align:left;font-weight:600;border:1px solid #e5e7eb}
td{padding:3px 7px;border:1px solid #e5e7eb;vertical-align:top}
.strike{text-decoration:line-through;color:#9ca3af}
.bold{font-weight:600}.green{color:#15803d}.verde{color:#16a34a;font-weight:600}.laranja{color:#d97706;font-weight:600}
.warn-row td{background:#fffbeb}
.etapa{font-size:8px;color:#6b7280;margin-left:3px}
.summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px}
.s-card{border:1px solid #e5e7eb;border-radius:6px;padding:8px;text-align:center}
.s-card.ok{border-color:#86efac;background:#f0fdf4}
.s-card.warn{border-color:#fcd34d;background:#fffbeb}
.s-card.danger{border-color:#fca5a5;background:#fef2f2}
.s-num{font-size:22px;font-weight:700;line-height:1}
.s-lbl{font-size:9px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.month-block{margin-bottom:18px;page-break-inside:avoid}
.month-title{font-size:12px;font-weight:600;color:#1f2937;margin-bottom:5px}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#d1d5db;border:1px solid #d1d5db}
.dh{background:#f3f4f6;text-align:center;font-size:8px;font-weight:600;color:#6b7280;padding:3px 2px}
.day{background:#fff;min-height:52px;padding:2px 2px 2px 3px;position:relative}
.day.empty,.day.we{background:#f9fafb}
.dn{font-size:9px;color:#6b7280;display:block;margin-bottom:2px}
.chip{border-radius:3px;padding:2px 3px;margin-bottom:2px}
.chip-uc{font-size:8px;font-weight:600;color:#1f2937;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100%}
.chip-prof{font-size:7px;color:#4b5563;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.chip-sem{font-size:7px;color:#dc2626;font-style:italic}
.legend{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.leg-item{display:flex;align-items:center;gap:3px;font-size:9px;color:#374151}
.leg-swatch{width:10px;height:10px;border-radius:2px;flex-shrink:0}
@media print{body{padding:8px}.month-block{page-break-inside:avoid}section{page-break-inside:avoid}}
</style></head><body>
<h1>${nomeEvento}</h1>
<p class="sub">Gerado em ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})} ${solverBadge}</p>

${impactoHTML}

<section>
  <h2>Alocações de Professor por UC</h2>
  <table><thead><tr><th>Unidade Curricular</th><th>CH</th><th>Professor</th><th>Aulas</th><th>Início</th></tr></thead>
  <tbody>${alocsRows}</tbody></table>
</section>

${allDates.length > 0 ? `<section>
  <h2>Calendário Proposto</h2>
  <div class="legend">${Object.entries(ucColors).map(([name, color]) =>
    `<div class="leg-item"><div class="leg-swatch" style="background:${color}"></div>${name.length > 30 ? name.substring(0,30)+"…" : name}</div>`
  ).join("")}</div>
  <div style="margin-top:12px">${calendarHTML}</div>
</section>` : ""}

</body></html>`;

  const win = window.open("", "_blank", "width=1100,height=800");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  }
}


// ── ImpactoTab ────────────────────────────────────────────────────────────────

function ImpactoTab({ impacto, solverStatus }: { impacto: ImpactoData; solverStatus?: string }) {
  const STATUS_CLS: Record<string, string> = {
    OPTIMAL:  "bg-green-100 text-green-700",
    FEASIBLE: "bg-blue-100 text-blue-700",
    INFEASIBLE: "bg-red-100 text-red-700",
    TIMEOUT:  "bg-amber-100 text-amber-700",
  };
  return (
    <div className="space-y-4">
      {/* Status do solver */}
      {solverStatus && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Status do solver:</span>
          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded", STATUS_CLS[solverStatus] ?? "bg-gray-100 text-gray-600")}>
            {solverStatus}
          </span>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total", value: impacto.resumo.total_ucs },
          { label: "Alocadas", value: impacto.resumo.com_professor, cls: "text-green-700" },
          { label: "Mudanças", value: impacto.resumo.mudancas, cls: impacto.resumo.mudancas > 0 ? "text-amber-700" : "text-gray-500" },
          { label: "Sem prof.", value: impacto.resumo.sem_professor, cls: impacto.resumo.sem_professor > 0 ? "text-red-600" : "text-gray-500" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="border rounded-lg p-2 text-center">
            <p className={cn("text-lg font-bold", cls ?? "text-gray-900")}>{value}</p>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* Mudanças de professor */}
      {impacto.mudancas.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Mudanças de professor ({impacto.mudancas.length})
          </p>
          <div className="space-y-1.5">
            {impacto.mudancas.map((m) => (
              <div key={m.uc_id} className="border border-amber-200 bg-amber-50/50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-700 font-medium mb-0.5">UC {m.uc_id}</p>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-gray-500 line-through">{m.professor_atual_nome}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-medium text-gray-800">{m.professor_proposto_nome}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Novos sem professor anterior */}
      {impacto.novos.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Novas alocações ({impacto.novos.length})
          </p>
          <div className="space-y-1">
            {impacto.novos.map((n) => (
              <div key={n.uc_id} className="flex items-center gap-1.5 text-xs py-1 border-b last:border-0">
                <span className="text-green-500">+</span>
                <span className="font-medium text-gray-800">{n.professor_proposto_nome}</span>
                <span className="text-gray-400">→ UC {n.uc_id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Impacto na regência */}
      {impacto.regencia_projecao.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Impacto na regência
          </p>
          <div className="space-y-1.5">
            {impacto.regencia_projecao.map((r) => (
              <div key={r.professor_id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-gray-800">{r.professor_nome}</p>
                  <p className="text-[10px] text-gray-400">{r.tipo} · regência atual {r.regencia_antes.toFixed(1)}%</p>
                </div>
                <div className={cn(
                  "flex items-center gap-1 text-xs font-semibold",
                  r.direcao === "sobe" ? "text-green-600" : "text-amber-600"
                )}>
                  {r.direcao === "sobe"
                    ? <TrendingUp className="h-3.5 w-3.5" />
                    : <TrendingDown className="h-3.5 w-3.5" />}
                  {r.horas_delta > 0 ? "+" : ""}{r.horas_delta}h
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {impacto.resumo.sem_professor > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-700 mb-1">
            {impacto.resumo.sem_professor} UC(s) sem professor
          </p>
          <p className="text-xs text-red-600">
            O solver não encontrou professor disponível e habilitado. Atribua manualmente após confirmar.
          </p>
        </div>
      )}
    </div>
  );
}


// ── Main Component ─────────────────────────────────────────────────────────────

type Etapa = "idle" | "gerando" | "resultado";
type Algoritmo = "greedy" | "ortools";

export function PlanejamentoModal({ eventoId, nomeEvento, ucs, modoSuperior = false, cliparSemestre = false, onClose, onConfirmado }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("idle");
  const [algoritmo, setAlgoritmo] = useState<Algoritmo>("greedy");
  const [resultado, setResultado] = useState<ResultadoGerado | null>(null);
  const [substituirFuturas, setSubstituirFuturas] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<"alocacoes" | "regencia" | "analise" | "impacto">("alocacoes");

  const modoOtimizado = algoritmo === "ortools";

  const buildUCs = () => ucs.map((u) => ({
    uc_id: u.uc_id,
    ordem: u.ordem,
    professor_preferido_id: u.professor_preferido_id,
    data_inicio: u.data_inicio,
    nao_agendar: u.nao_agendar ?? false,
    dias_semana: u.dias_semana && u.dias_semana.length > 0 ? u.dias_semana : undefined,
  }));

  const gerar = useMutation({
    mutationFn: () => {
      const ucsOrdenadas = buildUCs();
      if (modoOtimizado) {
        return planejamentoApi.gerarOtimizado(eventoId, ucsOrdenadas, modoSuperior, cliparSemestre);
      }
      return planejamentoApi.gerar(eventoId, ucsOrdenadas, modoSuperior, cliparSemestre);
    },
    onMutate: () => setEtapa("gerando"),
    onSuccess: (data) => {
      setResultado(data);
      setEtapa("resultado");
      setAbaAtiva(modoOtimizado ? "impacto" : "alocacoes");
    },
    onError: (err: any) => {
      setEtapa("idle");
      toast.error(err?.response?.data?.detail || "Erro ao gerar planejamento");
    },
  });

  const confirmar = useMutation({
    mutationFn: () => {
      if (!resultado) throw new Error("Sem resultado para confirmar");
      return planejamentoApi.confirmar(eventoId, resultado.alocacoes, substituirFuturas);
    },
    onSuccess: (res) => {
      toast.success(`${res.inseridas ?? 0} aulas criadas com sucesso.`);
      onConfirmado?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao confirmar");
    },
  });

  const abas = modoOtimizado
    ? [
        { id: "impacto",   label: "Impacto" },
        { id: "alocacoes", label: `Alocações (${resultado?.alocacoes.length ?? 0})` },
      ]
    : [
        { id: "alocacoes", label: `Alocações (${resultado?.alocacoes.length ?? 0})` },
        { id: "regencia",  label: "Regência" },
        { id: "analise",   label: "Análise" },
      ] as const;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={etapa !== "gerando" ? onClose : undefined} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col pointer-events-auto">

          {/* Header */}
          <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Planejamento Automático</h2>
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{nomeEvento}</p>
            </div>
            {etapa !== "gerando" && (
              <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">

            {/* ── IDLE ── */}
            {etapa === "idle" && (
              <div className="p-6 space-y-5">
                {/* Seletor de algoritmo */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Modo de geração</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setAlgoritmo("greedy")}
                      className={cn(
                        "rounded-lg border-2 p-3 text-left transition-all",
                        algoritmo === "greedy"
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <RefreshCw className="h-3.5 w-3.5 text-blue-600" />
                        <span className="text-xs font-semibold text-gray-800">Rápido (Padrão)</span>
                      </div>
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        UC a UC por ordem pedagógica. Resultado imediato.
                        Bom para planejamentos simples.
                      </p>
                    </button>
                    <button
                      onClick={() => setAlgoritmo("ortools")}
                      className={cn(
                        "rounded-lg border-2 p-3 text-left transition-all",
                        algoritmo === "ortools"
                          ? "border-violet-500 bg-violet-50"
                          : "border-gray-200 hover:border-gray-300 bg-white"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Cpu className="h-3.5 w-3.5 text-violet-600" />
                        <span className="text-xs font-semibold text-gray-800">Otimizado (CP-SAT)</span>
                        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-violet-100 text-violet-700 uppercase tracking-wide">IA</span>
                      </div>
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        Resolve todas as UCs juntas. Evita conflitos globais.
                        Mostra impacto completo antes de salvar.
                      </p>
                    </button>
                  </div>
                  {algoritmo === "ortools" && (
                    <p className="text-[10px] text-violet-600 mt-1 flex items-center gap-1">
                      <Cpu className="h-3 w-3" />
                      Tempo máximo: 10 segundos. Retorna a melhor solução encontrada.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {ucs.length} UC{ucs.length !== 1 ? "s" : ""} selecionadas
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {ucs.map((u) => (
                      <div key={u.uc_id} className="flex justify-between text-sm py-1 border-b last:border-0">
                        <span className="text-gray-700">{u.ordem}. {u.uc_nome}</span>
                        <span className="text-gray-400 text-xs">{u.carga_horaria}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── GERANDO ── */}
            {etapa === "gerando" && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className={cn("h-10 w-10 animate-spin", modoOtimizado ? "text-violet-500" : "text-blue-500")} />
                <div className="text-center">
                  <p className="font-medium text-gray-800">
                    {modoOtimizado ? "Otimizando com CP-SAT..." : "Gerando planejamento..."}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    {modoOtimizado
                      ? "Resolvendo todas as UCs simultaneamente (até 10 segundos)"
                      : "Analisando disponibilidades, regência e aptidão dos professores"}
                  </p>
                </div>
              </div>
            )}

            {/* ── RESULTADO ── */}
            {etapa === "resultado" && resultado && (
              <div className="flex flex-col">
                {/* Stats bar */}
                <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-6 text-sm shrink-0 flex-wrap">
                  {algoritmo === "ortools" && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 uppercase tracking-wide flex items-center gap-1">
                      <Cpu className="h-3 w-3" />CP-SAT
                    </span>
                  )}
                  {modoOtimizado ? (
                    <>
                      <div>
                        <span className="text-gray-500">UCs:</span>{" "}
                        <span className="font-semibold text-gray-900">{resultado.alocacoes.length}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Alocadas:</span>{" "}
                        <span className="font-semibold text-gray-900">
                          {resultado.alocacoes.filter((a) => a.professor_id).length}
                        </span>
                      </div>
                      {resultado.solver_status && (
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded border",
                          resultado.solver_status === "OPTIMAL" ? "text-green-700 bg-green-50 border-green-200" :
                          resultado.solver_status === "FEASIBLE" ? "text-blue-700 bg-blue-50 border-blue-200" :
                          "text-amber-700 bg-amber-50 border-amber-200"
                        )}>
                          {resultado.solver_status}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        <span className="text-gray-500">Aulas:</span>{" "}
                        <span className="font-semibold text-gray-900">{resultado.total_aulas ?? 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Horas:</span>{" "}
                        <span className="font-semibold text-gray-900">{(resultado.horas_planejadas ?? 0).toFixed(1)}h</span>
                      </div>
                      {resultado.analise?.avaliacao_geral && (
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded border",
                          AVALIACAO_CLS[resultado.analise.avaliacao_geral] ?? "text-gray-700 bg-gray-50 border-gray-200"
                        )}>
                          {resultado.analise.avaliacao_geral}
                        </span>
                      )}
                      {(resultado.conflitos?.length ?? 0) > 0 && (
                        <div className="flex items-center gap-1 text-red-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span className="font-medium">{resultado.conflitos!.length} conflito(s)</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Tabs */}
                <div className="border-b px-6 flex gap-4 shrink-0">
                  {abas.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAbaAtiva(a.id as typeof abaAtiva)}
                      className={cn(
                        "py-2.5 text-sm border-b-2 -mb-px transition-colors",
                        abaAtiva === a.id
                          ? "border-blue-600 text-blue-700 font-medium"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>

                <div className="p-6 space-y-3">
                  {/* Aba Impacto (OR-Tools) */}
                  {abaAtiva === "impacto" && resultado.impacto && (
                    <ImpactoTab impacto={resultado.impacto} solverStatus={resultado.solver_status} />
                  )}

                  {/* Aba Alocações */}
                  {abaAtiva === "alocacoes" && (
                    <>
                      {resultado.alocacoes.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">Nenhuma alocação gerada.</p>
                      ) : (
                        resultado.alocacoes.map((a) => <AlocacaoCard key={a.uc_id} a={a} />)
                      )}
                      {(resultado.conflitos?.length ?? 0) > 0 && (
                        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-red-700 mb-1.5">Conflitos detectados</p>
                          {resultado.conflitos!.map((c, i) => (
                            <p key={i} className="text-xs text-red-600">
                              • {c.descricao ?? (c.uc_nome ? `${c.uc_nome}: ${c.motivo}` : JSON.stringify(c))}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Aba Regência */}
                  {abaAtiva === "regencia" && (
                    <>
                      {(resultado.alertas_regencia?.length ?? 0) > 0 && (
                        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-3">
                          {resultado.alertas_regencia!.map((a, i) => (
                            <p key={i} className="text-xs text-amber-700">⚠ {a}</p>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        {(resultado.regencia_projetada ?? [])
                          .filter((r: any) => (r.horas_planejadas ?? 0) > 0)
                          .map((r: any) => {
                            const atual = Math.min(r.percentual_atual ?? 0, 120);
                            const projetado = Math.min(r.percentual_projetado ?? 0, 120);
                            const meta = r.meta ?? 70;
                            const atingeMeta = projetado >= meta;
                            return (
                              <div key={r.professor_id} className="border rounded-lg p-3">
                                <div className="flex items-center justify-between mb-1.5">
                                  <div>
                                    <p className="text-sm font-medium text-gray-800">{r.nome}</p>
                                    <p className="text-[10px] text-gray-400">{r.tipo} · +{r.horas_planejadas}h neste planejamento</p>
                                  </div>
                                  <span className={cn(
                                    "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                    atingeMeta ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                                  )}>
                                    {atingeMeta ? "OK" : "Abaixo da meta"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden relative">
                                    <div className="absolute top-0 h-full w-px bg-gray-400 z-10" style={{ left: `${Math.min(meta, 100)}%` }} />
                                    <div
                                      className={cn("h-full rounded-full opacity-30", atingeMeta ? "bg-green-500" : "bg-amber-400")}
                                      style={{ width: `${projetado}%` }}
                                    />
                                    <div
                                      className={cn("h-full rounded-full absolute top-0 left-0", atingeMeta ? "bg-green-500" : "bg-amber-400")}
                                      style={{ width: `${atual}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-mono text-gray-500 w-14 text-right shrink-0">
                                    {(r.percentual_atual ?? 0).toFixed(0)}% → <span className="font-semibold text-gray-800">{(r.percentual_projetado ?? 0).toFixed(0)}%</span>
                                  </span>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-1">Meta: {meta}% · Atual: {(r.percentual_atual ?? 0).toFixed(1)}% · Projetado: {(r.percentual_projetado ?? 0).toFixed(1)}%</p>
                              </div>
                            );
                          })}
                        {(resultado.regencia_projetada ?? []).filter((r: any) => (r.horas_planejadas ?? 0) > 0).length === 0 && (
                          <p className="text-sm text-gray-400 text-center py-6">Nenhum professor alocado neste planejamento.</p>
                        )}
                      </div>
                    </>
                  )}

                  {/* Aba Análise */}
                  {abaAtiva === "analise" && (
                    <div className="space-y-4">
                      {resultado.analise?.avaliacao_descricao && (
                        <div className={cn(
                          "rounded-lg p-3 border",
                          AVALIACAO_CLS[resultado.analise.avaliacao_geral ?? ""] ?? "bg-gray-50 border-gray-200"
                        )}>
                          <p className="text-xs font-semibold mb-1 flex items-center gap-1">
                            <BarChart2 className="h-3 w-3" />
                            {resultado.analise.avaliacao_geral ?? "Avaliação"}
                          </p>
                          <p className="text-xs">{resultado.analise.avaliacao_descricao}</p>
                        </div>
                      )}

                      {resultado.analise?.alertas_criticos && resultado.analise.alertas_criticos.length > 0 && (
                        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-red-700 mb-1.5">Alertas Críticos</p>
                          {resultado.analise.alertas_criticos.map((a, i) => (
                            <p key={i} className="text-xs text-red-600">• {a}</p>
                          ))}
                        </div>
                      )}

                      {resultado.analise?.sugestoes && resultado.analise.sugestoes.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sugestões</p>
                          <ul className="space-y-1.5">
                            {resultado.analise.sugestoes.map((s, i) => (
                              <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                                <span className="text-blue-400 shrink-0 mt-0.5">→</span>
                                {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {resultado.analise?.metricas && (
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Métricas</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            {Object.entries(resultado.analise.metricas).map(([k, v]) => (
                              <div key={k} className="flex justify-between text-xs py-0.5 border-b border-gray-100">
                                <span className="text-gray-500 capitalize">{k.replace(/_/g, " ")}</span>
                                <span className="font-medium text-gray-800">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {resultado.analise?.resumo && (
                        <p className="text-xs text-gray-500 italic">{resultado.analise.resumo}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 shrink-0 flex items-center justify-between gap-3">
            {etapa === "resultado" && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={substituirFuturas}
                    onChange={(e) => setSubstituirFuturas(e.target.checked)}
                  />
                  <span className="text-xs text-gray-600">Substituir aulas futuras não travadas</span>
                </label>
                <button
                  onClick={() => resultado && imprimirRelatorio(resultado, nomeEvento, modoOtimizado)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                  title="Imprimir relatório com calendário de impacto"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Imprimir
                </button>
              </div>
            )}
            {etapa !== "resultado" && <div />}

            <div className="flex gap-2 shrink-0">
              {etapa !== "gerando" && (
                <button onClick={onClose} className="btn-secondary">Cancelar</button>
              )}
              {etapa === "idle" && (
                <button
                  onClick={() => gerar.mutate()}
                  disabled={ucs.length === 0}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                    algoritmo === "ortools"
                      ? "bg-violet-600 hover:bg-violet-700"
                      : "bg-blue-600 hover:bg-blue-700"
                  )}
                >
                  {algoritmo === "ortools"
                    ? <Cpu className="h-4 w-4" />
                    : <BarChart2 className="h-4 w-4" />}
                  {algoritmo === "ortools" ? "Otimizar com CP-SAT" : "Gerar"}
                </button>
              )}
              {etapa === "resultado" && (
                <>
                  <button
                    onClick={() => { setEtapa("idle"); setResultado(null); }}
                    className="btn-secondary"
                  >
                    Ajustar
                  </button>
                  <button
                    onClick={() => confirmar.mutate()}
                    disabled={confirmar.isPending || (
                      modoOtimizado
                        ? (resultado?.alocacoes.filter((a) => a.professor_id).length ?? 0) === 0
                        : (resultado?.total_aulas ?? 0) === 0
                    )}
                    title={
                      (modoOtimizado
                        ? (resultado?.alocacoes.filter((a) => a.professor_id).length ?? 0) === 0
                        : (resultado?.total_aulas ?? 0) === 0)
                        ? "Nenhuma aula foi planejada. Verifique os dias da semana e o período do evento."
                        : undefined
                    }
                    className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {confirmar.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Check className="h-4 w-4" />}
                    Confirmar e Salvar
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
