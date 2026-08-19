"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { professoresApi, planejamentoApi, relatoriosApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { RegenciaBar } from "@/components/regencia-bar";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  Search, X, TrendingUp, CheckCircle, AlertTriangle, Zap, Download, ArrowUpDown, Info, ChevronDown, EyeOff, Eye,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function getInitials(nome: string) {
  return nome.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function yyyyMM(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}
function ultimoDiaMes(yyyymm: string) {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${yyyymm}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}
function horasAula(ini?: string | null, fim?: string | null) {
  if (!ini || !fim) return 0;
  const [hi, mi] = ini.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  const d = (hf * 60 + mf) - (hi * 60 + mi);
  return d > 0 ? d / 60 : 0;
}
function fmtData(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const MESES_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DIAS_ABREV = ["D","S","T","Q","Q","S","S"];
const MESES_NOME = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const STATUS_CHIP: Record<string, string> = {
  Realizada: "bg-green-100 text-green-800", Agendada: "bg-blue-100 text-blue-800",
  Cancelada: "bg-red-100 text-red-800", Substituída: "bg-purple-100 text-purple-800",
  Remarcada: "bg-orange-100 text-orange-800",
};

function mesesNaJanela(inicio: string, fim: string) {
  const [ai, mi] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  const lista: { ano: number; mes: number }[] = [];
  let ano = ai, mes = mi;
  while (ano < af || (ano === af && mes <= mf)) {
    lista.push({ ano, mes });
    if (mes === 12) { mes = 1; ano++; } else mes++;
  }
  return lista;
}

// ── Turnos ────────────────────────────────────────────────────────────────────

const TURNOS = [
  { key: "todos", label: "Todos", color: "", dot: "" },
  { key: "manha", label: "Manhã",  color: "bg-amber-500",  dot: "bg-amber-400"  },
  { key: "tarde", label: "Tarde",  color: "bg-blue-500",   dot: "bg-blue-400"   },
  { key: "noite", label: "Noite",  color: "bg-indigo-600", dot: "bg-indigo-500" },
];

function getTurnoKey(horario_inicio: string | null | undefined): string {
  if (!horario_inicio) return "manha";
  const h = parseInt(horario_inicio.split(":")[0], 10);
  if (h < 12) return "manha";
  if (h < 18) return "tarde";
  return "noite";
}

// ── CalendarioMes ─────────────────────────────────────────────────────────────

function CalendarioMes({ ano, mes, dateMap, turnoFiltro }: {
  ano: number; mes: number; dateMap: Map<string, any[]>; turnoFiltro: string;
}) {
  const hoje = new Date();
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const cells: (number | null)[] = Array(primeiroDia).fill(null);
  for (let d = 1; d <= ultimoDia; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white border rounded-lg p-3">
      <p className="text-xs font-semibold text-center text-gray-600 mb-2">{MESES_NOME[mes - 1]} {ano}</p>
      <div className="grid grid-cols-7 gap-0.5">
        {DIAS_ABREV.map((d, i) => (
          <div key={i} className="h-5 flex items-center justify-center text-[10px] text-gray-400 font-medium">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-8" />;
          const key = `${ano}-${String(mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const todasAulas = dateMap.get(key) ?? [];
          const aulas = turnoFiltro === "todos" ? todasAulas : todasAulas.filter((a: any) => getTurnoKey(a.horario_inicio) === turnoFiltro);
          const temAula = aulas.length > 0;
          const todasCanceladas = temAula && aulas.every((a: any) => a.status === "Cancelada");
          const temRealizada = aulas.some((a: any) => a.status === "Realizada");
          const isHoje = hoje.getFullYear() === ano && hoje.getMonth()+1 === mes && hoje.getDate() === d;

          // Turnos presentes no dia (para dots)
          const turnosNoDia = turnoFiltro === "todos"
            ? Array.from(new Set(todasAulas.map((a: any) => getTurnoKey(a.horario_inicio))))
            : [];

          let cls = "text-gray-500";
          if (todasCanceladas) cls = "bg-red-100 text-red-500";
          else if (temRealizada) cls = "bg-green-500 text-white font-semibold";
          else if (temAula) cls = "bg-blue-500 text-white font-semibold";
          else if (isHoje) cls = "ring-2 ring-blue-400 text-blue-600 font-semibold";

          const turnoInfo = TURNOS.find(t => t.key !== "todos" && todasAulas.some((a: any) => getTurnoKey(a.horario_inicio) === t.key));
          const title = temAula
            ? `${aulas.length} aula(s) · ${aulas.map((a: any) => `${a.horario_inicio?.slice(0,5)} ${a.status}`).join(", ")}`
            : undefined;

          return (
            <div key={i} className="flex flex-col items-center h-8 gap-0.5">
              <span className={cn("h-6 w-6 flex items-center justify-center rounded-full text-[11px]", cls)} title={title}>
                {d}
              </span>
              {/* Dots de turno (só quando filtro = todos) */}
              {turnoFiltro === "todos" && turnosNoDia.length > 0 && (
                <div className="flex gap-0.5">
                  {turnosNoDia.map(tk => {
                    const t = TURNOS.find(x => x.key === tk);
                    return t ? <span key={tk} className={cn("w-1.5 h-1.5 rounded-full", t.dot)} /> : null;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ProfessorModal ────────────────────────────────────────────────────────────

function ProfessorModal({ prof, defaultInicio, defaultFim, onClose }: {
  prof: any; defaultInicio: string; defaultFim: string; onClose: () => void;
}) {
  const [inicio, setInicio] = useState(defaultInicio);
  const [fim, setFim] = useState(defaultFim);
  const [turnoFiltro, setTurnoFiltro] = useState("todos");
  const dataInicio = `${inicio}-01`;
  const dataFim = ultimoDiaMes(fim);

  const { data: aulasRaw = [], isLoading } = useQuery({
    queryKey: ["prof-aulas-reg", prof.professor_id, inicio, fim],
    queryFn: () => planejamentoApi.cronograma({ professor_id: prof.professor_id, data_inicio: dataInicio, data_fim: dataFim, limit: 2000 }),
    staleTime: 60_000,
  });
  const { data: regencia } = useQuery({
    queryKey: ["prof-regencia-reg", prof.professor_id, inicio, fim],
    queryFn: () => professoresApi.regencia(prof.professor_id, { data_inicio: dataInicio, data_fim: dataFim }),
    staleTime: 60_000,
  });

  const meses = useMemo(() => mesesNaJanela(inicio, fim), [inicio, fim]);
  const dateMap = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const a of aulasRaw as any[]) {
      if (!a.data) continue;
      const existing = map.get(a.data) ?? [];
      existing.push(a);
      map.set(a.data, existing);
    }
    return map;
  }, [aulasRaw]);

  // Aulas filtradas pelo turno selecionado
  const aulasFiltered = useMemo(() =>
    turnoFiltro === "todos"
      ? (aulasRaw as any[])
      : (aulasRaw as any[]).filter(a => getTurnoKey(a.horario_inicio) === turnoFiltro),
    [aulasRaw, turnoFiltro]
  );

  // Quantos turnos distintos o professor tem aulas (Realizada ou Agendada)?
  const turnosAtivos = useMemo(() => {
    const aptas = (aulasRaw as any[]).filter(a => a.status === "Realizada" || a.status === "Agendada");
    return new Set(aptas.map(a => getTurnoKey(a.horario_inicio)));
  }, [aulasRaw]);

  // Horas do turno selecionado (aulas aptas)
  const horasTurno = useMemo(() =>
    aulasFiltered
      .filter(a => a.status === "Realizada" || a.status === "Agendada")
      .reduce((s: number, a: any) => s + horasAula(a.horario_inicio, a.horario_fim), 0),
    [aulasFiltered]
  );

  // Base proporcional: divide horas_periodo pelo nº de turnos ativos quando filtrando por turno
  const horasPeriodo = (regencia as any)?.horas_periodo ?? 0;
  const numTurnos = turnosAtivos.size || 1;
  const periodoEfetivo = turnoFiltro === "todos" ? horasPeriodo : horasPeriodo / numTurnos;
  const percentualTurno = periodoEfetivo > 0 ? (horasTurno / periodoEfetivo) * 100 : 0;

  const totalHoras = aulasFiltered.reduce((s: number, a: any) => s + horasAula(a.horario_inicio, a.horario_fim), 0);
  const totalAulas = aulasFiltered.length;
  const gridCols = meses.length <= 1 ? "grid-cols-1" : meses.length <= 2 ? "grid-cols-2" : meses.length <= 4 ? "grid-cols-2" : "grid-cols-3";

  const turnoAtivo = TURNOS.find(t => t.key === turnoFiltro)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{prof.nome}</h2>
            <p className="text-sm text-gray-500">{prof.tipo} · {prof.horas_contratadas}h/semana contratadas</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-500"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Período + filtro de turno */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-gray-600 font-medium">Período:</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">De</span>
              <input type="month" value={inicio} onChange={e => setInicio(e.target.value)} className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Até</span>
              <input type="month" value={fim} onChange={e => setFim(e.target.value)} className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            {/* Botões de turno */}
            <div className="flex items-center gap-1 ml-auto bg-gray-100 rounded-lg p-1">
              {TURNOS.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTurnoFiltro(t.key)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-all",
                    turnoFiltro === t.key
                      ? t.key === "todos"
                        ? "bg-white shadow text-gray-800"
                        : cn("text-white shadow", t.color)
                      : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-center">
              <p className="text-xs text-blue-600 font-medium">CH no Período</p>
              <p className="text-2xl font-bold text-blue-800 mt-1">{totalHoras.toFixed(1)}h</p>
              {turnoFiltro !== "todos" && <p className="text-[10px] text-blue-400 mt-0.5">{turnoAtivo.label}</p>}
            </div>
            <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-center">
              <p className="text-xs text-green-600 font-medium">Total de Aulas</p>
              <p className="text-2xl font-bold text-green-800 mt-1">{totalAulas}</p>
              {turnoFiltro !== "todos" && <p className="text-[10px] text-green-400 mt-0.5">{turnoAtivo.label}</p>}
            </div>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 text-center">
              <p className="text-xs text-indigo-600 font-medium">Regência do Período</p>
              <p className="text-2xl font-bold text-indigo-800 mt-1">
                {turnoFiltro === "todos"
                  ? (regencia ? `${(regencia as any).percentual_regencia?.toFixed(1)}%` : "—")
                  : `${percentualTurno.toFixed(1)}%`
                }
              </p>
              {turnoFiltro !== "todos" && (
                <p className="text-[10px] text-indigo-400 mt-0.5">
                  {horasTurno.toFixed(1)}h / {periodoEfetivo.toFixed(0)}h ({numTurnos} turno{numTurnos > 1 ? "s" : ""})
                </p>
              )}
              {turnoFiltro === "todos" && (regencia as any)?.horas_excedentes > 0 && (
                <p className="text-[10px] text-amber-500 mt-0.5">
                  +{(regencia as any).horas_excedentes.toFixed(1)}h acima da CH mínima
                </p>
              )}
            </div>
          </div>

          {/* Observação Horista — horas excedentes */}
          {(regencia as any)?.observacao && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <span className="font-semibold">Horas excedentes registradas · </span>
                {(regencia as any).observacao}
              </div>
            </div>
          )}

          {/* Calendário */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-gray-700">Calendário de Aulas</h3>
              <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />Realizada</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />Agendada</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-200 inline-block" />Cancelada</span>
                {turnoFiltro === "todos" && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Manhã</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Tarde</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />Noite</span>
                  </>
                )}
              </div>
            </div>
            {isLoading ? <div className="text-center text-gray-400 py-8 text-sm">Carregando...</div> : (
              <div className={cn("grid gap-3", gridCols)}>
                {meses.map(({ ano, mes }) => (
                  <CalendarioMes key={`${ano}-${mes}`} ano={ano} mes={mes} dateMap={dateMap} turnoFiltro={turnoFiltro} />
                ))}
              </div>
            )}
          </div>

          {/* Tabela de aulas */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Aulas no Período ({totalAulas}{turnoFiltro !== "todos" ? ` · ${turnoAtivo.label}` : ""})
            </h3>
            {isLoading ? (
              <div className="text-center text-gray-400 py-6 text-sm">Carregando...</div>
            ) : totalAulas === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm border rounded-lg">Nenhuma aula encontrada.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {["Data","Turno","Horário","Evento / Turma","UC / Disciplina","Ambiente","Status"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {aulasFiltered.slice().sort((a: any, b: any) => a.data > b.data ? 1 : -1).map((a: any, i: number) => {
                      const tk = getTurnoKey(a.horario_inicio);
                      const turnoInfo = TURNOS.find(t => t.key === tk);
                      return (
                        <tr key={a.id ?? i} className={cn("border-b last:border-0", i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                          <td className="px-3 py-2 whitespace-nowrap">{fmtData(a.data)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold text-white", turnoInfo?.color ?? "bg-gray-400")}>
                              {turnoInfo?.label ?? "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">{a.horario_inicio?.slice(0,5)} – {a.horario_fim?.slice(0,5)}</td>
                          <td className="px-3 py-2 max-w-[180px] truncate">{a.nome_evento || "—"}</td>
                          <td className="px-3 py-2 max-w-[150px] truncate text-gray-500">{a.uc_nome || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">{a.ambiente || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={cn("px-2 py-0.5 rounded text-xs font-medium", STATUS_CHIP[a.status] ?? "bg-gray-100 text-gray-600")}>{a.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Constantes de modalidade ──────────────────────────────────────────────────

const MODALIDADES = [
  "11 - APRENDIZAGEM INDUSTRIAL BÁSICA - FORM. INICIAL",
  "3 - INICIAÇÃO PROFISSIONAL - FORM. INICIAL E CONTINUADA",
  "21 - QUALIFICAÇÃO PROFISSIONAL BÁSICA - FORM. INICIAL E CONTINUADA",
  "31 - HABILITAÇÃO TÉCNICA - EDUC. PROF. TÉCNICA",
  "33 - HABILITAÇÃO TÉCNICA A DISTÂNCIA - EDUC. PROF. TÉCNICA",
  "35 - TÉCNICO ENSINO MÉDIO - SEDUC",
  "41 - GRADUAÇÃO TECNOLÓGICA - EDUCAÇÃO SUPERIOR",
  "51 - APERFEIÇOAMENTO PROFISSIONAL - FORM. INICIAL E CONTINUADA",
  "53 - APERFEIÇOAMENTO PROFISSIONAL - EDU. PROF. TEC",
  "54 - APERFEIÇOAMENTO PROFISSIONAL - AÇÕES MÓVEIS",
  "81 - GRADUAÇÃO - BACHARELADO (SUPERIOR)",
  "91 - PÓS-GRADUAÇÃO LATO SENSU ESPECIALIZAÇÃO",
];

const TIPOS_QUADRO = new Set(["Mensalista", "Horista", "Inclusão em Folha"]);

// ── Constantes de status ──────────────────────────────────────────────────────

const FILTROS_STATUS = [
  { key: "todos", label: "Todos" },
  { key: "OK", label: "OK ≥70%", icon: CheckCircle, color: "text-green-700 bg-green-50 border-green-200" },
  { key: "Alerta", label: "Alerta 50–70%", icon: AlertTriangle, color: "text-yellow-700 bg-yellow-50 border-yellow-200" },
  { key: "Critico", label: "Crítico <50%", icon: AlertTriangle, color: "text-red-700 bg-red-50 border-red-200" },
  { key: "Sobrecarga", label: "Sobrecarga >90%", icon: Zap, color: "text-orange-700 bg-orange-50 border-orange-200" },
];

const STATUS_CARD_STYLE: Record<string, { bg: string; text: string; border: string; icon: any }> = {
  OK:         { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200",  icon: CheckCircle },
  Alerta:     { bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", icon: AlertTriangle },
  Critico:    { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",    icon: AlertTriangle },
  Sobrecarga: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", icon: Zap },
};

// ── Página principal ──────────────────────────────────────────────────────────

export default function RegenciaPage() {
  const hoje = new Date();
  const mesAtual = yyyyMM(hoje.getFullYear(), hoje.getMonth() + 1);

  const [regInicio, setRegInicio] = useState(mesAtual);
  const [regFim, setRegFim] = useState(mesAtual);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroQuadro, setFiltroQuadro] = useState<"todos" | "quadro" | "extraquadro">("todos");
  const [filtroModalidades, setFiltroModalidades] = useState<string[]>([]);
  const [modalidadeOpen, setModalidadeOpen] = useState(false);
  const modalidadeRef = useRef<HTMLDivElement>(null);
  const [ordem, setOrdem] = useState<"asc" | "desc">("asc"); // asc = pior primeiro

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (modalidadeRef.current && !modalidadeRef.current.contains(e.target as Node)) {
        setModalidadeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  const [profSelecionado, setProfSelecionado] = useState<any | null>(null);
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem("regencia-excluidos");
      if (raw) setExcluidos(new Set(JSON.parse(raw) as number[]));
    } catch {}
  }, []);

  function toggleExcluido(id: number) {
    setExcluidos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem("regencia-excluidos", JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  const regDataInicio = `${regInicio}-01`;
  const regDataFim = ultimoDiaMes(regFim);

  const { data: regencias = [], isLoading } = useQuery<any[]>({
    queryKey: ["regencias-pagina", regInicio, regFim],
    queryFn: () => professoresApi.regencias({ data_inicio: regDataInicio, data_fim: regDataFim }),
    staleTime: 60_000,
  });

  // Filtro + busca + ordem
  const lista = useMemo(() => {
    let r = regencias.map((p: any) => ({
      ...p,
      professor_id: p.professor_id,
      status_regencia: p.status ?? p.status_regencia,
    }));
    if (filtroStatus !== "todos") r = r.filter(p => p.status_regencia === filtroStatus);
    if (filtroQuadro === "quadro")      r = r.filter(p => TIPOS_QUADRO.has(p.tipo));
    if (filtroQuadro === "extraquadro") r = r.filter(p => !TIPOS_QUADRO.has(p.tipo));
    if (filtroModalidades.length > 0) {
      r = r.filter(p =>
        (p.modalidades as string[] ?? []).some((m: string) =>
          filtroModalidades.some(fm => m.toLowerCase().includes(fm.toLowerCase()))
        )
      );
    }
    if (busca) r = r.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()));
    r.sort((a, b) =>
      ordem === "asc"
        ? a.percentual_regencia - b.percentual_regencia
        : b.percentual_regencia - a.percentual_regencia
    );
    return r;
  }, [regencias, filtroStatus, filtroQuadro, filtroModalidades, busca, ordem]);

  // Contagem recalculada sobre a lista já filtrada por quadro+modalidade (ignora filtroStatus)
  const contagem = useMemo(() => {
    const c: Record<string, number> = { OK: 0, Alerta: 0, Critico: 0, Sobrecarga: 0 };
    let base = regencias.map((p: any) => ({ ...p, status_regencia: p.status ?? p.status_regencia }));
    if (filtroQuadro === "quadro")      base = base.filter(p => TIPOS_QUADRO.has(p.tipo));
    if (filtroQuadro === "extraquadro") base = base.filter(p => !TIPOS_QUADRO.has(p.tipo));
    if (filtroModalidades.length > 0) {
      base = base.filter(p =>
        (p.modalidades as string[] ?? []).some((m: string) =>
          filtroModalidades.some(fm => m.toLowerCase().includes(fm.toLowerCase()))
        )
      );
    }
    for (const p of base) c[p.status_regencia] = (c[p.status_regencia] ?? 0) + 1;
    return c;
  }, [regencias, filtroQuadro, filtroModalidades]);

  const mediaRegencia = useMemo(() => {
    let base = (regencias as any[]).map((p: any) => ({ ...p, status_regencia: p.status ?? p.status_regencia }));
    if (filtroQuadro === "quadro")      base = base.filter(p => TIPOS_QUADRO.has(p.tipo));
    if (filtroQuadro === "extraquadro") base = base.filter(p => !TIPOS_QUADRO.has(p.tipo));
    if (filtroModalidades.length > 0) {
      base = base.filter(p =>
        (p.modalidades as string[] ?? []).some((m: string) =>
          filtroModalidades.some(fm => m.toLowerCase().includes(fm.toLowerCase()))
        )
      );
    }
    const total = base.length;
    const incluidos = base.filter(p => !excluidos.has(p.professor_id));
    if (incluidos.length === 0) return null;
    const soma = incluidos.reduce((s: number, p: any) => s + (p.percentual_regencia ?? 0), 0);
    return { media: soma / incluidos.length, count: incluidos.length, total };
  }, [regencias, excluidos, filtroQuadro, filtroModalidades]);

  async function exportarExcel() {
    try {
      const res = await relatoriosApi.regencia();
      downloadBlob(res.data as Blob, `regencia_${regInicio}_${regFim}.xlsx`);
    } catch {
      alert("Erro ao exportar");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Regência Docente" description="Mensalistas: meta 70% da CH contratada · Horistas: meta 100% da CH mínima contratada">
        <button onClick={exportarExcel}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors">
          <Download className="h-4 w-4" /> Exportar Excel
        </button>
      </PageHeader>

      {/* Seletor de período */}
      <div className="card px-5 py-4 flex items-center gap-4 flex-wrap">
        <TrendingUp className="h-4 w-4 text-gray-400 shrink-0" />
        <span className="text-sm font-medium text-gray-700">Período:</span>
        <input type="month" value={regInicio} onChange={e => setRegInicio(e.target.value)}
          className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <span className="text-xs text-gray-400">até</span>
        <input type="month" value={regFim} onChange={e => setRegFim(e.target.value)}
          className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
      </div>

      {/* Card de regência média */}
      {mediaRegencia && (
        <div className="card px-5 py-4 flex items-center gap-5">
          <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <TrendingUp className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Regência Média</p>
            <div className="flex items-baseline gap-3 mt-0.5">
              <span className={cn(
                "text-3xl font-bold",
                mediaRegencia.media >= 70 ? "text-green-700" : mediaRegencia.media >= 50 ? "text-yellow-700" : "text-red-700"
              )}>
                {mediaRegencia.media.toFixed(1)}%
              </span>
              <span className="text-sm text-gray-400">{mediaRegencia.count} de {mediaRegencia.total} professor(es)</span>
            </div>
          </div>
          <div className="shrink-0 text-right space-y-1">
            <p className="text-xs text-gray-400">Meta: 70%</p>
            <span className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded-full",
              mediaRegencia.media >= 70 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            )}>
              {mediaRegencia.media >= 70 ? "Atingida" : "Abaixo da meta"}
            </span>
            {excluidos.size > 0 && (
              <p className="text-[10px] text-amber-600 flex items-center gap-1 justify-end">
                <EyeOff className="h-3 w-3" />{excluidos.size} excluído(s)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(STATUS_CARD_STYLE).map(([status, style]) => {
          const Icon = style.icon;
          return (
            <button key={status}
              onClick={() => setFiltroStatus(filtroStatus === status ? "todos" : status)}
              className={cn(
                "card p-4 text-left transition-all hover:shadow-md border-2",
                filtroStatus === status ? `${style.bg} ${style.border}` : "border-transparent hover:border-gray-200"
              )}>
              <div className="flex items-center justify-between mb-2">
                <Icon className={cn("h-5 w-5", style.text)} />
                <span className={cn("text-2xl font-bold", style.text)}>{contagem[status] ?? 0}</span>
              </div>
              <p className={cn("text-xs font-semibold", style.text)}>
                {status === "OK" && "Regência OK"}
                {status === "Alerta" && "Em Alerta"}
                {status === "Critico" && "Crítico"}
                {status === "Sobrecarga" && "Sobrecarga"}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {status === "OK" && "≥ 70% da meta"}
                {status === "Alerta" && "50–70% da meta"}
                {status === "Critico" && "< 50% da meta"}
                {status === "Sobrecarga" && "> 90% da carga"}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filtros de Quadro e Modalidade */}
      <div className="card px-4 py-3 flex items-center gap-3 flex-wrap">
        {/* Quadro / Extraquadro */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {([
            { key: "todos",       label: "Todos" },
            { key: "quadro",      label: "Quadro" },
            { key: "extraquadro", label: "Extraquadro" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFiltroQuadro(key)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                filtroQuadro === key
                  ? key === "quadro"
                    ? "bg-blue-600 text-white shadow"
                    : key === "extraquadro"
                    ? "bg-amber-500 text-white shadow"
                    : "bg-white text-gray-800 shadow"
                  : "text-gray-500 hover:text-gray-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Modalidade — multi-select dropdown */}
        <div ref={modalidadeRef} className="relative">
          <button
            onClick={() => setModalidadeOpen(o => !o)}
            className={cn(
              "input text-sm py-1.5 px-3 min-w-[280px] flex items-center justify-between gap-2 text-left",
              filtroModalidades.length > 0 && "border-blue-400 bg-blue-50"
            )}
          >
            <span className="truncate text-gray-700">
              {filtroModalidades.length === 0
                ? "Todas as modalidades"
                : filtroModalidades.length === 1
                ? filtroModalidades[0]
                : `${filtroModalidades.length} modalidades selecionadas`}
            </span>
            <ChevronDown className={cn("h-4 w-4 text-gray-400 shrink-0 transition-transform", modalidadeOpen && "rotate-180")} />
          </button>

          {modalidadeOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 bg-white border rounded-lg shadow-lg w-[360px] py-1 max-h-72 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-1.5 border-b sticky top-0 bg-white">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Modalidades</span>
                {filtroModalidades.length > 0 && (
                  <button onClick={() => setFiltroModalidades([])} className="text-xs text-blue-600 hover:text-blue-800">
                    Limpar seleção
                  </button>
                )}
              </div>
              {MODALIDADES.map(m => (
                <label key={m} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filtroModalidades.includes(m)}
                    onChange={e => {
                      setFiltroModalidades(prev =>
                        e.target.checked ? [...prev, m] : prev.filter(x => x !== m)
                      );
                    }}
                    className="rounded border-gray-300 text-blue-600 h-4 w-4 shrink-0"
                  />
                  <span className="text-sm text-gray-700 leading-tight">{m}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {(filtroQuadro !== "todos" || filtroModalidades.length > 0) && (
          <button
            onClick={() => { setFiltroQuadro("todos"); setFiltroModalidades([]); }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      {/* Barra de busca + controles */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="input pl-9 w-full" placeholder="Buscar professor..."
            value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <button onClick={() => setOrdem(o => o === "asc" ? "desc" : "asc")}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors">
          <ArrowUpDown className="h-4 w-4" />
          {ordem === "asc" ? "Menor % primeiro" : "Maior % primeiro"}
        </button>
        {(filtroStatus !== "todos" || busca) && (
          <button onClick={() => { setFiltroStatus("todos"); setBusca(""); }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700">
            <X className="h-3.5 w-3.5" /> Limpar busca
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{lista.length} professor(es)</span>
      </div>

      {/* Lista de professores */}
      {isLoading ? (
        <div className="card p-12 text-center text-gray-400">Carregando...</div>
      ) : lista.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">Nenhum professor encontrado.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((p: any) => {
            const statusStyle = STATUS_CARD_STYLE[p.status_regencia] ?? STATUS_CARD_STYLE.Alerta;
            const Icon = statusStyle.icon;
            const isExcluido = excluidos.has(p.professor_id);
            return (
              <button
                key={p.professor_id}
                onClick={() => setProfSelecionado(p)}
                className={cn(
                  "card p-4 text-left hover:shadow-md hover:border-blue-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300",
                  isExcluido && "opacity-60"
                )}
              >
                {/* Cabeçalho */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {p.foto ? (
                      <img src={p.foto} alt={p.nome} className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-200" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/10">
                        <span className="text-xs font-bold text-primary select-none">{getInitials(p.nome)}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{p.nome}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{p.tipo} · {p.horas_contratadas}h/sem</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); toggleExcluido(p.professor_id); }}
                      title={isExcluido ? "Incluir na regência média" : "Excluir da regência média"}
                      className={cn(
                        "p-1 rounded-full transition-colors",
                        isExcluido
                          ? "bg-amber-100 text-amber-500 hover:bg-amber-200"
                          : "text-gray-300 hover:text-amber-400 hover:bg-amber-50"
                      )}
                    >
                      {isExcluido ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <span className={cn(
                      "shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border",
                      statusStyle.bg, statusStyle.text, statusStyle.border
                    )}>
                      <Icon className="h-3 w-3" />
                      {p.status_regencia}
                    </span>
                  </div>
                </div>

                {/* Barra de regência com marcador de meta */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-bold text-base", statusStyle.text)}>
                      {(p.percentual_regencia ?? 0).toFixed(1)}%
                    </span>
                    <span className="text-gray-400">
                      {(p.horas_ministradas ?? 0).toFixed(1)}h ministradas
                    </span>
                  </div>

                  {/* Barra dupla: preenchida = atual, linha tracejada = meta */}
                  <div className="relative h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={cn(
                        "h-3 rounded-full transition-all",
                        p.tipo === "Horista"
                          ? (p.percentual_regencia >= 100 ? "bg-green-500" : p.percentual_regencia >= 50 ? "bg-yellow-400" : "bg-red-400")
                          : (p.percentual_regencia >= 90 ? "bg-orange-400" : p.percentual_regencia >= 70 ? "bg-green-500" : p.percentual_regencia >= 50 ? "bg-yellow-400" : "bg-red-400")
                      )}
                      style={{ width: `${Math.min(p.percentual_regencia ?? 0, 100)}%` }}
                    />
                    {/* Marcador da meta na posição correta por tipo */}
                    <div className="absolute top-0 h-3 w-0.5 bg-gray-500/60" style={{ left: `${p.meta_regencia ?? 70}%` }} />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>0%</span>
                    <span className="font-medium text-gray-500 flex items-center gap-1">
                      ▲ Meta {p.meta_regencia ?? 70}%
                      {p.observacao && (
                        <span title={p.observacao} className="text-amber-500 cursor-help">
                          <Info className="h-3 w-3" />
                        </span>
                      )}
                    </span>
                    <span>100%</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Modal de detalhe */}
      {profSelecionado && (
        <ProfessorModal
          prof={profSelecionado}
          defaultInicio={regInicio}
          defaultFim={regFim}
          onClose={() => setProfSelecionado(null)}
        />
      )}
    </div>
  );
}
