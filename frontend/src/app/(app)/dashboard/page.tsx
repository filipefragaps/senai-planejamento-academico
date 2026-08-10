"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi, professoresApi, planejamentoApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { RegenciaBar } from "@/components/regencia-bar";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  Users, BookOpen, Calendar, TrendingUp, AlertTriangle, CheckCircle, X, Search,
} from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────

const MESES_NOME = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const MESES_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DIAS_SEMANA_PT = ["D","S","T","Q","Q","S","S"];

function yyyyMM(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function mesesNaJanela(inicio: string, fim: string) {
  const [ai, mi] = inicio.split("-").map(Number);
  const [af, mf] = fim.split("-").map(Number);
  const lista: { ano: number; mes: number; label: string; key: string }[] = [];
  let ano = ai, mes = mi;
  while (ano < af || (ano === af && mes <= mf)) {
    lista.push({ ano, mes, label: `${MESES_PT[mes - 1]}/${String(ano).slice(2)}`, key: yyyyMM(ano, mes) });
    if (mes === 12) { mes = 1; ano++; } else mes++;
  }
  return lista;
}

function ultimoDiaMes(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${yyyymm}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function horasAula(ini: string | null | undefined, fim: string | null | undefined): number {
  if (!ini || !fim) return 0;
  const [hi, mi] = ini.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  const diff = (hf * 60 + mf) - (hi * 60 + mi);
  return diff > 0 ? diff / 60 : 0;
}

function fmtData(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

const STATUS_CHIP: Record<string, string> = {
  Realizada:   "bg-green-100 text-green-800",
  Agendada:    "bg-blue-100 text-blue-800",
  Cancelada:   "bg-red-100 text-red-800",
  Substituída: "bg-purple-100 text-purple-800",
  Remarcada:   "bg-orange-100 text-orange-800",
};

// ── Calendar components ──────────────────────────────────────────────────────

function CalendarioMes({
  ano,
  mes,
  dateMap,
}: {
  ano: number;
  mes: number;
  dateMap: Map<string, any[]>;
}) {
  const hoje = new Date();
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const ultimoDia = new Date(ano, mes, 0).getDate();

  const cells: (number | null)[] = Array(primeiroDia).fill(null);
  for (let d = 1; d <= ultimoDia; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="bg-white border rounded-lg p-3">
      <p className="text-xs font-semibold text-center text-gray-600 mb-2">
        {MESES_NOME[mes - 1]} {ano}
      </p>
      <div className="grid grid-cols-7 gap-0.5">
        {DIAS_SEMANA_PT.map((d, i) => (
          <div key={i} className="h-5 flex items-center justify-center text-[10px] text-gray-400 font-medium">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-6" />;
          const key = `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const aulas = dateMap.get(key) ?? [];
          const temAula = aulas.length > 0;
          const todasCanceladas = temAula && aulas.every((a: any) => a.status === "Cancelada");
          const temRealizada = aulas.some((a: any) => a.status === "Realizada");
          const isHoje =
            hoje.getFullYear() === ano &&
            hoje.getMonth() + 1 === mes &&
            hoje.getDate() === d;

          let cls = "text-gray-500";
          if (todasCanceladas) cls = "bg-red-100 text-red-500";
          else if (temRealizada) cls = "bg-green-500 text-white font-semibold";
          else if (temAula) cls = "bg-blue-500 text-white font-semibold";
          else if (isHoje) cls = "ring-2 ring-blue-400 text-blue-600 font-semibold";

          return (
            <div key={i} className="flex items-center justify-center h-6">
              <span
                className={cn("h-6 w-6 flex items-center justify-center rounded-full text-[11px]", cls)}
                title={
                  temAula
                    ? `${aulas.length} aula(s) · ${aulas.map((a: any) => a.status).join(", ")}`
                    : undefined
                }
              >
                {d}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Professor Detail Modal ───────────────────────────────────────────────────

function ProfessorModal({
  prof,
  defaultInicio,
  defaultFim,
  onClose,
}: {
  prof: any;
  defaultInicio: string;
  defaultFim: string;
  onClose: () => void;
}) {
  const [inicio, setInicio] = useState(defaultInicio);
  const [fim, setFim] = useState(defaultFim);

  const dataInicio = `${inicio}-01`;
  const dataFim = ultimoDiaMes(fim);

  const { data: aulasRaw = [], isLoading: loadingAulas } = useQuery({
    queryKey: ["prof-aulas", prof.professor_id, inicio, fim],
    queryFn: () =>
      planejamentoApi.cronograma({
        professor_id: prof.professor_id,
        data_inicio: dataInicio,
        data_fim: dataFim,
        limit: 2000,
      }),
    enabled: !!prof,
    staleTime: 60_000,
  });

  const { data: regencia } = useQuery({
    queryKey: ["prof-regencia", prof.professor_id, inicio, fim],
    queryFn: () =>
      professoresApi.regencia(prof.professor_id, {
        data_inicio: dataInicio,
        data_fim: dataFim,
      }),
    enabled: !!prof,
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

  const totalHoras = useMemo(
    () =>
      (aulasRaw as any[]).reduce(
        (s, a) => s + horasAula(a.horario_inicio, a.horario_fim),
        0
      ),
    [aulasRaw]
  );
  const totalAulas = (aulasRaw as any[]).length;

  const gridCols =
    meses.length <= 1 ? "grid-cols-1" :
    meses.length <= 2 ? "grid-cols-2" :
    meses.length <= 4 ? "grid-cols-2 sm:grid-cols-2" :
    "grid-cols-3";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{prof.nome}</h2>
            <p className="text-sm text-gray-500">
              {prof.tipo} · {prof.horas_contratadas}h/semana contratadas
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          {/* Period selector */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-gray-600 font-medium">Período:</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">De</span>
              <input
                type="month"
                value={inicio}
                onChange={e => setInicio(e.target.value)}
                className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Até</span>
              <input
                type="month"
                value={fim}
                onChange={e => setFim(e.target.value)}
                className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-center">
              <p className="text-xs text-blue-600 font-medium">CH no Período</p>
              <p className="text-2xl font-bold text-blue-800 mt-1">{totalHoras.toFixed(1)}h</p>
            </div>
            <div className="rounded-lg bg-green-50 border border-green-100 p-4 text-center">
              <p className="text-xs text-green-600 font-medium">Total de Aulas</p>
              <p className="text-2xl font-bold text-green-800 mt-1">{totalAulas}</p>
            </div>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 text-center">
              <p className="text-xs text-indigo-600 font-medium">Regência do Período</p>
              <p className="text-2xl font-bold text-indigo-800 mt-1">
                {regencia ? `${(regencia as any).percentual_regencia?.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>

          {/* Calendar */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Calendário de Aulas</h3>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                  Realizada
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                  Agendada
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-red-100 border border-red-200 inline-block" />
                  Cancelada
                </span>
              </div>
            </div>
            {loadingAulas ? (
              <div className="text-center text-gray-400 py-8 text-sm">Carregando...</div>
            ) : (
              <div className={cn("grid gap-3", gridCols)}>
                {meses.map(({ ano, mes }) => (
                  <CalendarioMes key={`${ano}-${mes}`} ano={ano} mes={mes} dateMap={dateMap} />
                ))}
              </div>
            )}
          </div>

          {/* Aulas table */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              Aulas no Período ({totalAulas})
            </h3>
            {loadingAulas ? (
              <div className="text-center text-gray-400 py-6 text-sm">Carregando...</div>
            ) : totalAulas === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm border rounded-lg">
                Nenhuma aula encontrada no período selecionado.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Data</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Horário</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Evento / Turma</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">UC / Disciplina</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Ambiente</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(aulasRaw as any[])
                      .slice()
                      .sort((a: any, b: any) => (a.data > b.data ? 1 : -1))
                      .map((a: any, i: number) => (
                        <tr
                          key={a.id ?? i}
                          className={cn("border-b last:border-0", i % 2 === 0 ? "bg-white" : "bg-gray-50")}
                        >
                          <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtData(a.data)}</td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                            {a.horario_inicio?.slice(0, 5)} – {a.horario_fim?.slice(0, 5)}
                          </td>
                          <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={a.nome_evento}>
                            {a.nome_evento || "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-500 max-w-[150px] truncate" title={a.uc_nome}>
                            {a.uc_nome || "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                            {a.ambiente || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "px-2 py-0.5 rounded text-xs font-medium",
                                STATUS_CHIP[a.status] ?? "bg-gray-100 text-gray-600"
                              )}
                            >
                              {a.status}
                            </span>
                          </td>
                        </tr>
                      ))}
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

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, value, subtitle, icon: Icon, color }: any) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>
        <div className={cn("p-3 rounded-full", color)}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

// ── Eficiência de Produção ────────────────────────────────────────────────────

function EficienciaChart({ dados }: { dados: any[] }) {
  const maxCH = Math.max(...dados.map((d) => d.ch_estimada), 1);
  const HEIGHT = 180;
  const BAR_W = 36;
  const GAP = 10;
  const PAD_LEFT = 44;
  const PAD_TOP = 36;
  const PAD_BOTTOM = 28;
  const totalW = PAD_LEFT + dados.length * (BAR_W + GAP);
  const totalH = HEIGHT + PAD_TOP + PAD_BOTTOM;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${totalW} ${totalH}`}
      style={{ display: "block" }}
    >
      {/* Linhas de grade */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = PAD_TOP + HEIGHT * (1 - frac);
        const val = Math.round(frac * maxCH);
        return (
          <g key={frac}>
            <line x1={PAD_LEFT} y1={y} x2={totalW} y2={y} stroke="#e5e7eb" strokeWidth="1" />
            <text x={PAD_LEFT - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {val}h
            </text>
          </g>
        );
      })}

      {dados.map((d, i) => {
        const x = PAD_LEFT + i * (BAR_W + GAP);
        const total = d.ch_estimada || 0;
        const barH = HEIGHT * (total / maxCH);
        const hQ   = total > 0 ? (d.ch_quadro / total) * barH : 0;
        const hExt = total > 0 ? (d.ch_externos / total) * barH : 0;
        const hNao = barH - hQ - hExt;
        const yBase = PAD_TOP + HEIGHT;

        const pctQ   = total > 0 ? Math.round(d.ch_quadro / total * 100) : 0;
        const pctExt = total > 0 ? Math.round(d.ch_externos / total * 100) : 0;

        return (
          <g key={d.mes}>
            {/* Não realizada — cinza (topo, resíduo de arredondamento) */}
            {hNao > 0.5 && (
              <rect x={x} y={yBase - barH} width={BAR_W} height={hNao} fill="#e5e7eb" />
            )}
            {/* Externos / Sem docente — âmbar */}
            {hExt > 0.5 && (
              <rect x={x} y={yBase - hQ - hExt} width={BAR_W} height={hExt} fill="#f59e0b" />
            )}
            {/* Horas externos dentro do segmento âmbar */}
            {hExt > 20 && (
              <text
                x={x + BAR_W / 2} y={yBase - hQ - hExt / 2 + 3.5}
                textAnchor="middle" fontSize="7" fill="white" fontWeight="700"
              >
                {Math.round(d.ch_externos)}h
              </text>
            )}
            {/* Quadro — verde (base) */}
            {hQ > 0.5 && (
              <rect x={x} y={yBase - hQ} width={BAR_W} height={hQ} fill="#16a34a" />
            )}
            {/* Horas quadro dentro do segmento verde */}
            {hQ > 20 && (
              <text
                x={x + BAR_W / 2} y={yBase - hQ / 2 + 3.5}
                textAnchor="middle" fontSize="7" fill="white" fontWeight="700"
              >
                {Math.round(d.ch_quadro)}h
              </text>
            )}
            {/* Contorno da barra total */}
            {barH > 0 && (
              <rect x={x} y={yBase - barH} width={BAR_W} height={barH}
                fill="none" stroke="#d1d5db" strokeWidth="0.5" rx="1" />
            )}

            {/* % CLT (verde) — linha superior acima da barra */}
            {total > 0 && (
              <text
                x={x + BAR_W / 2} y={yBase - barH - 17}
                textAnchor="middle" fontSize="8.5" fill="#16a34a" fontWeight="700"
              >
                {pctQ}%
              </text>
            )}
            {/* % Externos (âmbar) — linha inferior acima da barra */}
            {total > 0 && (
              <text
                x={x + BAR_W / 2} y={yBase - barH - 5}
                textAnchor="middle" fontSize="8.5" fill="#d97706" fontWeight="700"
              >
                {pctExt}%
              </text>
            )}

            {/* Rótulo do mês */}
            <text x={x + BAR_W / 2} y={yBase + PAD_BOTTOM - 2}
              textAnchor="middle" fontSize="9" fill="#6b7280">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const hoje = new Date();
  const mesAtual = yyyyMM(hoje.getFullYear(), hoje.getMonth() + 1);
  const anoAtual = hoje.getFullYear();

  const [profSelecionado, setProfSelecionado] = useState<any | null>(null);
  const [regInicio, setRegInicio] = useState(mesAtual);
  const [regFim, setRegFim] = useState(mesAtual);
  const [filtroQuadroDb, setFiltroQuadroDb] = useState<"todos" | "quadro" | "extraquadro">("todos");
  const [filtroModalidadeDb, setFiltroModalidadeDb] = useState("");
  const [buscaTurma, setBuscaTurma] = useState("");
  const [filtroAndamento, setFiltroAndamento] = useState<"todos" | "nao_iniciada" | "em_andamento" | "concluida">("todos");
  const [eficienciaAno, setEficienciaAno] = useState(anoAtual);

  const TIPOS_QUADRO_DB = new Set(["Mensalista", "Horista", "Inclusão em Folha"]);
  const MODALIDADES_DB = [
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

  const regDataInicio = `${regInicio}-01`;
  const regDataFim = ultimoDiaMes(regFim);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: dashboardApi.get,
    refetchInterval: 60_000,
  });

  const { data: eficienciaData, isLoading: loadingEficiencia } = useQuery({
    queryKey: ["dashboard-eficiencia", eficienciaAno],
    queryFn: () => dashboardApi.eficiencia(eficienciaAno),
    staleTime: 120_000,
  });

  // Period-specific regência for the professor list
  const { data: regenciasPeriodo, isLoading: loadingRegencias } = useQuery({
    queryKey: ["regencias-periodo", regInicio, regFim],
    queryFn: () =>
      professoresApi.regencias({ data_inicio: regDataInicio, data_fim: regDataFim }),
    staleTime: 60_000,
  });

  // Normalize + filtros de quadro e modalidade
  const professoresLista = useMemo(() => {
    let lista = regenciasPeriodo
      ? (regenciasPeriodo as any[]).map((p: any) => ({
          professor_id: p.professor_id,
          nome: p.nome,
          tipo: p.tipo,
          quadro: p.quadro ?? TIPOS_QUADRO_DB.has(p.tipo),
          modalidades: p.modalidades ?? [],
          horas_contratadas: p.horas_contratadas,
          horas_ministradas_semana: p.horas_ministradas ?? 0,
          percentual_regencia: p.percentual_regencia,
          meta_regencia: p.meta_regencia,
          status_regencia: p.status_regencia ?? p.status,
        }))
      : (data?.professores ?? []);

    if (filtroQuadroDb === "quadro")      lista = lista.filter((p: any) => TIPOS_QUADRO_DB.has(p.tipo));
    if (filtroQuadroDb === "extraquadro") lista = lista.filter((p: any) => !TIPOS_QUADRO_DB.has(p.tipo));
    if (filtroModalidadeDb) {
      const mod = filtroModalidadeDb.toLowerCase();
      lista = lista.filter((p: any) =>
        (p.modalidades as string[]).some((m: string) => m.toLowerCase().includes(mod))
      );
    }

    return [...lista].sort((a: any, b: any) => b.percentual_regencia - a.percentual_regencia);
  }, [regenciasPeriodo, data?.professores, filtroQuadroDb, filtroModalidadeDb]);

  const periodoEhMultiploMeses = regInicio !== regFim;

  const turmasFiltradas = useMemo(() => {
    let lista = data?.turmas ?? [];
    if (buscaTurma) {
      const q = buscaTurma.toLowerCase();
      lista = lista.filter((t: any) =>
        t.nome_turma.toLowerCase().includes(q) ||
        (t.disciplina ?? "").toLowerCase().includes(q)
      );
    }
    if (filtroAndamento !== "todos") {
      lista = lista.filter((t: any) => {
        const p = t.progresso_percentual ?? 0;
        if (filtroAndamento === "nao_iniciada") return p === 0;
        if (filtroAndamento === "em_andamento") return p > 0 && p < 100;
        if (filtroAndamento === "concluida") return p >= 100;
        return true;
      });
    }
    return lista;
  }, [data?.turmas, buscaTurma, filtroAndamento]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Carregando dashboard...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-8 text-center text-red-500">
        Erro ao carregar dashboard. Verifique sua conexão com o servidor.
      </div>
    );
  }

  const g = data.global_kpis;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visão geral do planejamento acadêmico"
      />

<div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard title="Professores Ativos" value={g.total_professores_ativos} icon={Users} color="bg-blue-500" />
        <KpiCard title="Turmas Ativas" value={g.total_turmas_ativas} icon={BookOpen} color="bg-indigo-500" />
        <KpiCard
          title="Aulas Esta Semana"
          value={g.total_aulas_semana}
          subtitle={`${g.aulas_proxima_semana} na próxima semana`}
          icon={Calendar}
          color="bg-green-500"
        />
        <KpiCard
          title="Regência Média"
          value={`${g.taxa_regencia_media.toFixed(1)}%`}
          subtitle="Meta: 70%"
          icon={TrendingUp}
          color={g.taxa_regencia_media >= 70 ? "bg-green-500" : "bg-yellow-500"}
        />
      </div>

      {/* ── Eficiência de Produção ─────────────────────────────────────── */}
      <div className="card p-5 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Eficiência de Produção</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              CH estimada dos eventos ativos × entrega pelos professores do quadro (Mensalista · Horista · Inclusão em Folha)
            </p>
          </div>
          <select
            className="input text-sm py-1 px-2"
            value={eficienciaAno}
            onChange={(e) => setEficienciaAno(+e.target.value)}
          >
            {[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {loadingEficiencia ? (
          <div className="h-40 flex items-center justify-center text-gray-400 text-sm">Carregando...</div>
        ) : eficienciaData ? (
          <>
            {/* Cards resumo */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                {
                  label: "CH Estimada",
                  value: `${eficienciaData.total.ch_estimada.toFixed(0)}h`,
                  sub: "Total eventos ativos",
                  color: "text-gray-700",
                  bg: "bg-gray-50",
                },
                {
                  label: "CH Quadro Próprio",
                  value: `${eficienciaData.total.ch_quadro.toFixed(0)}h`,
                  sub: "Realizado + previsto pelo quadro",
                  color: "text-green-700",
                  bg: "bg-green-50",
                },
                {
                  label: "CH Externos",
                  value: `${eficienciaData.total.ch_externos.toFixed(0)}h`,
                  sub: "PJ · RPA · Sem docente",
                  color: "text-amber-700",
                  bg: "bg-amber-50",
                },
                {
                  label: "Eficiência Quadro",
                  value: `${eficienciaData.total.eficiencia_pct.toFixed(1)}%`,
                  sub: "CH quadro / CH estimada",
                  color: eficienciaData.total.eficiencia_pct >= 70 ? "text-green-700" : eficienciaData.total.eficiencia_pct >= 50 ? "text-amber-700" : "text-red-700",
                  bg: eficienciaData.total.eficiencia_pct >= 70 ? "bg-green-50" : eficienciaData.total.eficiencia_pct >= 50 ? "bg-amber-50" : "bg-red-50",
                },
              ].map((c) => (
                <div key={c.label} className={cn("rounded-lg p-3 border", c.bg)}>
                  <p className="text-xs text-gray-500 mb-1">{c.label}</p>
                  <p className={cn("text-2xl font-bold tabular-nums", c.color)}>{c.value}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{c.sub}</p>
                </div>
              ))}
            </div>

            {/* Gráfico de barras */}
            <div className="overflow-x-auto rounded">
              <div style={{ minWidth: Math.max(520, eficienciaData.por_mes.length * 48) }}>
                <EficienciaChart dados={eficienciaData.por_mes} />
              </div>
            </div>

            {/* Legenda */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 justify-center">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block bg-green-600" />
                <span className="text-[10px] text-gray-500">Quadro Próprio (CLT) — % e horas em verde</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block bg-amber-400" />
                <span className="text-[10px] text-gray-500">Externos + Sem Docente — % e horas em âmbar</span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="card p-4 text-center border-green-200">
          <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-green-700">{g.professores_ok}</p>
          <p className="text-sm text-gray-500">Regência OK (≥70%)</p>
        </div>
        <div className="card p-4 text-center border-yellow-200">
          <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-yellow-700">{g.professores_alerta}</p>
          <p className="text-sm text-gray-500">Em Alerta (50-70%)</p>
        </div>
        <div className="card p-4 text-center border-red-200">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-red-700">{g.professores_criticos}</p>
          <p className="text-sm text-gray-500">Críticos (&lt;50%)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Professores com seletor de período */}
        <div className="card p-5">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Regência por Professor</h2>
              <p className="text-xs text-gray-400 mt-0.5">Clique para ver calendário de aulas</p>
            </div>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="text-xs text-gray-500 font-medium">Período:</span>
            <input
              type="month"
              value={regInicio}
              onChange={e => setRegInicio(e.target.value)}
              className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="text-xs text-gray-400">até</span>
            <input
              type="month"
              value={regFim}
              onChange={e => setRegFim(e.target.value)}
              className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Filtros Quadro + Modalidade */}
          <div className="flex items-center gap-2 mt-2 mb-3 flex-wrap">
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {([
                { key: "todos",       label: "Todos" },
                { key: "quadro",      label: "Quadro" },
                { key: "extraquadro", label: "Extra" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFiltroQuadroDb(key)}
                  className={cn(
                    "px-2 py-0.5 rounded-md text-xs font-medium transition-all",
                    filtroQuadroDb === key
                      ? key === "quadro"
                        ? "bg-blue-600 text-white shadow"
                        : key === "extraquadro"
                        ? "bg-amber-500 text-white shadow"
                        : "bg-white text-gray-800 shadow"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              className="input text-xs py-1 px-1.5 flex-1 min-w-0"
              value={filtroModalidadeDb}
              onChange={e => setFiltroModalidadeDb(e.target.value)}
            >
              <option value="">Todas modalidades</option>
              {MODALIDADES_DB.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {(filtroQuadroDb !== "todos" || filtroModalidadeDb) && (
              <button
                onClick={() => { setFiltroQuadroDb("todos"); setFiltroModalidadeDb(""); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Professor list */}
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {loadingRegencias ? (
              <div className="text-center text-gray-400 py-8 text-sm">Carregando...</div>
            ) : professoresLista.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm">Nenhum professor encontrado.</div>
            ) : (
              professoresLista.map((p: any) => (
                <button
                  key={p.professor_id}
                  className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
                  onClick={() => setProfSelecionado(p)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="text-sm font-medium text-gray-800">{p.nome}</span>
                      <span className="ml-2 text-xs text-gray-400">{p.tipo}</span>
                    </div>
                    <StatusBadge status={p.status_regencia} />
                  </div>
                  <RegenciaBar percentual={p.percentual_regencia} meta={p.meta_regencia} />
                  <p className="text-xs text-gray-400 mt-1">
                    {(p.horas_ministradas_semana ?? 0).toFixed(1)}h
                    {periodoEhMultiploMeses ? " no período" : " neste mês"} ·{" "}
                    {p.horas_contratadas}h/sem contratadas
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Turmas */}
        <div className="card p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Progresso das Turmas</h2>

          {/* Busca */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              className="w-full pl-8 pr-8 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Buscar evento ou disciplina..."
              value={buscaTurma}
              onChange={(e) => setBuscaTurma(e.target.value)}
            />
            {buscaTurma && (
              <button onClick={() => setBuscaTurma("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filtros de andamento */}
          <div className="flex gap-1 mb-3 flex-wrap">
            {([
              { key: "todos",        label: "Todas" },
              { key: "nao_iniciada", label: "Não iniciada" },
              { key: "em_andamento", label: "Em andamento" },
              { key: "concluida",    label: "Concluída" },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFiltroAndamento(key)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-full border font-medium transition-colors",
                  filtroAndamento === key
                    ? key === "todos"        ? "bg-gray-700 text-white border-gray-700"
                    : key === "nao_iniciada" ? "bg-gray-200 text-gray-700 border-gray-300"
                    : key === "em_andamento" ? "bg-blue-600 text-white border-blue-600"
                    :                         "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Lista */}
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {turmasFiltradas.length === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm">Nenhuma turma encontrada.</div>
            ) : (
              turmasFiltradas.map((t: any) => {
                const p = t.progresso_percentual ?? 0;
                const barColor = p >= 100 ? "bg-green-500" : p > 0 ? "bg-blue-500" : "bg-gray-300";
                return (
                  <div key={t.evento_id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-800 truncate pr-2">{t.nome_turma}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{t.disciplina}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                        <div className={cn("h-1.5 rounded-full", barColor)} style={{ width: `${p}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {p.toFixed(0)}% ({t.aulas_realizadas}/{t.aulas_totais} aulas)
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Contador */}
          <p className="text-[10px] text-gray-400 mt-2 text-right">
            {turmasFiltradas.length} de {data.turmas?.length ?? 0} turma(s)
          </p>
        </div>
      </div>

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
