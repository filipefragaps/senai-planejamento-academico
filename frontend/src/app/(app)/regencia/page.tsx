"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { professoresApi, planejamentoApi, relatoriosApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { RegenciaBar } from "@/components/regencia-bar";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  Search, X, TrendingUp, CheckCircle, AlertTriangle, Zap, Download, ArrowUpDown,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── CalendarioMes ─────────────────────────────────────────────────────────────

function CalendarioMes({ ano, mes, dateMap }: { ano: number; mes: number; dateMap: Map<string, any[]> }) {
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
          if (!d) return <div key={i} className="h-6" />;
          const key = `${ano}-${String(mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const aulas = dateMap.get(key) ?? [];
          const temAula = aulas.length > 0;
          const todasCanceladas = temAula && aulas.every((a: any) => a.status === "Cancelada");
          const temRealizada = aulas.some((a: any) => a.status === "Realizada");
          const isHoje = hoje.getFullYear() === ano && hoje.getMonth()+1 === mes && hoje.getDate() === d;
          let cls = "text-gray-500";
          if (todasCanceladas) cls = "bg-red-100 text-red-500";
          else if (temRealizada) cls = "bg-green-500 text-white font-semibold";
          else if (temAula) cls = "bg-blue-500 text-white font-semibold";
          else if (isHoje) cls = "ring-2 ring-blue-400 text-blue-600 font-semibold";
          return (
            <div key={i} className="flex items-center justify-center h-6">
              <span className={cn("h-6 w-6 flex items-center justify-center rounded-full text-[11px]", cls)}
                title={temAula ? `${aulas.length} aula(s) · ${aulas.map((a: any) => a.status).join(", ")}` : undefined}>
                {d}
              </span>
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

  const totalHoras = (aulasRaw as any[]).reduce((s, a) => s + horasAula(a.horario_inicio, a.horario_fim), 0);
  const totalAulas = (aulasRaw as any[]).length;
  const gridCols = meses.length <= 1 ? "grid-cols-1" : meses.length <= 2 ? "grid-cols-2" : meses.length <= 4 ? "grid-cols-2" : "grid-cols-3";

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
          </div>
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
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Calendário de Aulas</h3>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" />Realizada</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />Agendada</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-200 inline-block" />Cancelada</span>
              </div>
            </div>
            {isLoading ? <div className="text-center text-gray-400 py-8 text-sm">Carregando...</div> : (
              <div className={cn("grid gap-3", gridCols)}>
                {meses.map(({ ano, mes }) => <CalendarioMes key={`${ano}-${mes}`} ano={ano} mes={mes} dateMap={dateMap} />)}
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Aulas no Período ({totalAulas})</h3>
            {isLoading ? (
              <div className="text-center text-gray-400 py-6 text-sm">Carregando...</div>
            ) : totalAulas === 0 ? (
              <div className="text-center text-gray-400 py-8 text-sm border rounded-lg">Nenhuma aula encontrada.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {["Data","Horário","Evento / Turma","UC / Disciplina","Ambiente","Status"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(aulasRaw as any[]).slice().sort((a: any, b: any) => a.data > b.data ? 1 : -1).map((a: any, i: number) => (
                      <tr key={a.id ?? i} className={cn("border-b last:border-0", i % 2 === 0 ? "bg-white" : "bg-gray-50")}>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtData(a.data)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-500">{a.horario_inicio?.slice(0,5)} – {a.horario_fim?.slice(0,5)}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate">{a.nome_evento || "—"}</td>
                        <td className="px-3 py-2 max-w-[150px] truncate text-gray-500">{a.uc_nome || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-500">{a.ambiente || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-medium", STATUS_CHIP[a.status] ?? "bg-gray-100 text-gray-600")}>{a.status}</span>
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
  const [ordem, setOrdem] = useState<"asc" | "desc">("asc"); // asc = pior primeiro
  const [profSelecionado, setProfSelecionado] = useState<any | null>(null);

  const regDataInicio = `${regInicio}-01`;
  const regDataFim = ultimoDiaMes(regFim);

  const { data: regencias = [], isLoading } = useQuery<any[]>({
    queryKey: ["regencias-pagina", regInicio, regFim],
    queryFn: () => professoresApi.regencias({ data_inicio: regDataInicio, data_fim: regDataFim }),
    staleTime: 60_000,
  });

  // Contagem por status
  const contagem = useMemo(() => {
    const c: Record<string, number> = { OK: 0, Alerta: 0, Critico: 0, Sobrecarga: 0 };
    for (const p of regencias) c[p.status ?? p.status_regencia] = (c[p.status ?? p.status_regencia] ?? 0) + 1;
    return c;
  }, [regencias]);

  // Filtro + busca + ordem
  const lista = useMemo(() => {
    let r = regencias.map((p: any) => ({
      ...p,
      professor_id: p.professor_id,
      status_regencia: p.status ?? p.status_regencia,
    }));
    if (filtroStatus !== "todos") r = r.filter(p => p.status_regencia === filtroStatus);
    if (busca) r = r.filter(p => p.nome.toLowerCase().includes(busca.toLowerCase()));
    r.sort((a, b) =>
      ordem === "asc"
        ? a.percentual_regencia - b.percentual_regencia
        : b.percentual_regencia - a.percentual_regencia
    );
    return r;
  }, [regencias, filtroStatus, busca, ordem]);

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
      <PageHeader title="Regência Docente" description="Acompanhamento da carga horária e meta de 70% por professor">
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
            <X className="h-3.5 w-3.5" /> Limpar filtros
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
            return (
              <button
                key={p.professor_id}
                onClick={() => setProfSelecionado(p)}
                className="card p-4 text-left hover:shadow-md hover:border-blue-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {/* Cabeçalho */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{p.nome}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{p.tipo} · {p.horas_contratadas}h/sem</p>
                  </div>
                  <span className={cn(
                    "shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold border",
                    statusStyle.bg, statusStyle.text, statusStyle.border
                  )}>
                    <Icon className="h-3 w-3" />
                    {p.status_regencia}
                  </span>
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
                        p.percentual_regencia >= 90 ? "bg-orange-400" :
                        p.percentual_regencia >= 70 ? "bg-green-500" :
                        p.percentual_regencia >= 50 ? "bg-yellow-400" : "bg-red-400"
                      )}
                      style={{ width: `${Math.min(p.percentual_regencia ?? 0, 100)}%` }}
                    />
                    {/* Marcador da meta em 70% */}
                    <div className="absolute top-0 h-3 w-0.5 bg-gray-500/60" style={{ left: "70%" }} />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>0%</span>
                    <span className="font-medium text-gray-500">▲ Meta 70%</span>
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
