"use client";

import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { planejamentoApi, professoresApi, eventosApi, relatoriosApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, Loader2, X, Printer, CalendarDays, LayoutGrid, Filter, FileDown,
} from "lucide-react";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from "date-fns";
import { ptBR } from "date-fns/locale";

// ── Constantes ────────────────────────────────────────────────────────────────

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Paleta de cores para UCs (hex, fundo escuro + texto branco)
const UC_PALETTE = [
  "#7c3aed", "#0d9488", "#b45309", "#be185d",
  "#1d4ed8", "#047857", "#c2410c", "#0e7490",
  "#9f1239", "#4d7c0f", "#7e22ce", "#075985",
  "#92400e", "#1e40af", "#065f46", "#831843",
];

function buildUcColorMap(aulas: any[]): Map<number, string> {
  const map = new Map<number, string>();
  let idx = 0;
  for (const a of aulas) {
    const ucId = a.unidade_curricular_id;
    if (ucId != null && !map.has(ucId)) {
      map.set(ucId, UC_PALETTE[idx % UC_PALETTE.length]);
      idx++;
    }
  }
  return map;
}

function ucColor(ucId: number | null | undefined, map: Map<number, string>): string {
  if (!ucId) return "#6b7280";
  return map.get(ucId) ?? "#6b7280";
}

// Status dot para chips pequenos
const STATUS_DOT: Record<string, string> = {
  Realizada:   "#22c55e",
  Cancelada:   "#ef4444",
  Substituída: "#a855f7",
  Remarcada:   "#f97316",
  Agendada:    "#93c5fd",
};

const STATUS_BADGE: Record<string, string> = {
  Realizada:   "bg-green-100 text-green-700 border-green-200",
  Agendada:    "bg-blue-100 text-blue-700 border-blue-200",
  Cancelada:   "bg-red-100 text-red-700 border-red-200",
  Substituída: "bg-purple-100 text-purple-700 border-purple-200",
  Remarcada:   "bg-orange-100 text-orange-700 border-orange-200",
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function CronogramaPage() {
  const hoje = new Date();
  const [modo, setModo] = useState<"mes" | "semana">("mes");
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());
  const [semana, setSemana] = useState(hoje);
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [professorFiltro, setProfessorFiltro] = useState("");
  const [eventoFiltro, setEventoFiltro] = useState("");
  const tabelaRef = useRef<HTMLDivElement>(null);

  // Datas de busca conforme modo
  const dataInicio =
    modo === "mes"
      ? `${ano}-${String(mes).padStart(2, "0")}-01`
      : format(startOfWeek(semana, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const dataFim =
    modo === "mes"
      ? new Date(ano, mes, 0).toISOString().slice(0, 10)
      : format(endOfWeek(semana, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: rawAulas = [], isLoading } = useQuery({
    queryKey: ["cronograma-global", dataInicio, dataFim, professorFiltro, eventoFiltro],
    queryFn: () =>
      planejamentoApi.cronograma({
        data_inicio: dataInicio,
        data_fim: dataFim,
        professor_id: professorFiltro ? +professorFiltro : undefined,
        evento_id: eventoFiltro ? +eventoFiltro : undefined,
        limit: 2000,
      }),
  });

  const { data: professores = [] } = useQuery({
    queryKey: ["professores-ativos"],
    queryFn: () => professoresApi.listar({ ativo: true }),
  });

  const { data: todosEventos = [] } = useQuery({
    queryKey: ["todos-eventos-cronograma"],
    queryFn: () => eventosApi.listar(),
    staleTime: 300_000,
  });

  const eventoMap = useMemo(() =>
    new Map((todosEventos as any[]).map((e: any) => [e.id, e.nome_turma ?? e.disciplina ?? ""])),
    [todosEventos]
  );
  const profMap = useMemo(() =>
    new Map((professores as any[]).map((p: any) => [p.id, p.nome ?? ""])),
    [professores]
  );

  // Enriquecer aulas com nomes caso não venham do backend
  const aulas = useMemo(() =>
    (rawAulas as any[]).map((a: any) => ({
      ...a,
      nome_evento: a.nome_evento || eventoMap.get(a.evento_id) || null,
      professor_nome: a.professor_nome || profMap.get(a.professor_id) || null,
    })),
    [rawAulas, eventoMap, profMap]
  );

  // Mapa de cores por UC
  const ucColorMap = useMemo(() => buildUcColorMap(aulas), [aulas]);

  // Legenda de UCs quando filtrado por evento
  const ucLegend = useMemo(() => {
    if (!eventoFiltro) return [];
    const visto = new Map<number, string>();
    for (const a of aulas) {
      if (a.unidade_curricular_id && a.uc_nome && !visto.has(a.unidade_curricular_id)) {
        visto.set(a.unidade_curricular_id, a.uc_nome);
      }
    }
    return Array.from(visto.entries()).map(([id, nome]) => ({ id, nome, cor: ucColor(id, ucColorMap) }));
  }, [aulas, eventoFiltro, ucColorMap]);

  // Indexar aulas por data
  const aulasPorDia = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const a of aulas) {
      if (!a.data) continue;
      const k = (a.data as string).slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [aulas]);

  const hojeStr = hoje.toISOString().slice(0, 10);
  const aulasNoDia = diaSelecionado
    ? (aulasPorDia.get(diaSelecionado) ?? []).slice().sort(
        (a: any, b: any) => (a.horario_inicio ?? "").localeCompare(b.horario_inicio ?? "")
      )
    : [];

  function imprimirDia() {
    if (!diaSelecionado) return;
    const dataFormatada = new Date(diaSelecionado + "T12:00:00").toLocaleDateString("pt-BR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const rows = aulasNoDia.map((a: any) => {
      const cor = ucColor(a.unidade_curricular_id, ucColorMap);
      const dot = STATUS_DOT[a.status] ?? "#9ca3af";
      return `<tr>
        <td style="width:16px;padding:8px 6px 8px 12px">
          <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${cor}"></span>
        </td>
        <td style="font-family:monospace;white-space:nowrap;padding:8px 12px">${(a.horario_inicio ?? "").slice(0, 5)} – ${(a.horario_fim ?? "").slice(0, 5)}</td>
        <td style="padding:8px 12px">${a.nome_evento ?? "—"}</td>
        <td style="padding:8px 12px;font-weight:500">${a.uc_nome ?? "—"}</td>
        <td style="padding:8px 12px;color:${a.professor_nome ? "#111827" : "#9ca3af"}">${a.professor_nome ?? "Não definido"}</td>
        <td style="padding:8px 12px;color:#6b7280">${a.ambiente ?? a.sala ?? "—"}</td>
        <td style="padding:8px 12px">
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:${dot};border:1px solid ${dot}55;background:${dot}18">${a.status}</span>
        </td>
      </tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Cronograma – ${dataFormatada}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:24px}
h1{font-size:17px;margin-bottom:4px}p.sub{font-size:12px;color:#6b7280;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:12px}
thead tr{background:#1d4ed8;color:#fff}
th{padding:8px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
tbody tr:nth-child(even) td{background:#f9fafb}
td{border-bottom:1px solid #f3f4f6;vertical-align:middle}
@media print{body{padding:0}}</style></head>
<body><h1>${dataFormatada}</h1>
<p class="sub">${aulasNoDia.length} aula(s) agendada(s)</p>
<table><thead><tr><th></th><th>Horário</th><th>Evento / Turma</th><th>UC / Disciplina</th><th>Professor</th><th>Ambiente</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
    const win = window.open("", "_blank", "width=950,height=700");
    if (!win) { window.print(); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  async function exportarExcel() {
    const params: Record<string, any> = {
      data_inicio: dataInicio,
      data_fim: dataFim,
    };
    if (professorFiltro) params.professor_id = +professorFiltro;
    if (eventoFiltro) params.evento_id = +eventoFiltro;
    const res = await relatoriosApi.historico(params);
    downloadBlob(res.data as Blob, `cronograma_${dataInicio}_${dataFim}.xlsx`);
  }

  function handleDiaClick(d: string) {
    const novo = diaSelecionado === d ? null : d;
    setDiaSelecionado(novo);
    if (novo) setTimeout(() => tabelaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  // ── Calendário mensal ──────────────────────────────────────────────────────
  function prevMes() {
    if (mes === 1) { setMes(12); setAno(ano - 1); } else setMes(mes - 1);
    setDiaSelecionado(null);
  }
  function nextMes() {
    if (mes === 12) { setMes(1); setAno(ano + 1); } else setMes(mes + 1);
    setDiaSelecionado(null);
  }

  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const diasNoMes = new Date(ano, mes, 0).getDate();

  // ── Cronograma semanal ─────────────────────────────────────────────────────
  const semanaInicio = startOfWeek(semana, { weekStartsOn: 1 });
  const semanaFim = endOfWeek(semana, { weekStartsOn: 1 });
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanaInicio);
    d.setDate(d.getDate() + i);
    return d;
  });

  const eventoSelecionadoNome = eventoFiltro
    ? ((todosEventos as any[]).find((e: any) => String(e.id) === eventoFiltro)?.nome_turma ?? "")
    : "";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <PageHeader title="Cronograma" description="Visualização de todas as aulas agendadas">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtro evento */}
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <select
              className="input pl-8 w-52 text-sm"
              value={eventoFiltro}
              onChange={(e) => { setEventoFiltro(e.target.value); setDiaSelecionado(null); }}
            >
              <option value="">Todos os eventos</option>
              {(todosEventos as any[]).map((e: any) => (
                <option key={e.id} value={e.id}>{e.nome_turma}</option>
              ))}
            </select>
          </div>

          {/* Filtro professor */}
          <select
            className="input w-44 text-sm"
            value={professorFiltro}
            onChange={(e) => { setProfessorFiltro(e.target.value); setDiaSelecionado(null); }}
          >
            <option value="">Todos os professores</option>
            {(professores as any[]).map((p: any) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>

          {/* Exportar Excel */}
          <button
            onClick={exportarExcel}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors"
            title="Exportar cronograma atual para Excel"
          >
            <FileDown className="h-4 w-4" />
            Excel
          </button>

          {/* Toggle modo */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => { setModo("mes"); setDiaSelecionado(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-2 text-sm transition-colors",
                modo === "mes" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50")}
            >
              <LayoutGrid className="h-4 w-4" /> Mês
            </button>
            <button
              onClick={() => { setModo("semana"); setDiaSelecionado(null); }}
              className={cn("flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-l border-gray-200",
                modo === "semana" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50")}
            >
              <CalendarDays className="h-4 w-4" /> Semana
            </button>
          </div>
        </div>
      </PageHeader>

      {/* Legenda de UCs (quando evento selecionado) */}
      {ucLegend.length > 0 && (
        <div className="card px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            UCs — {eventoSelecionadoNome}
          </p>
          <div className="flex flex-wrap gap-2">
            {ucLegend.map((l) => (
              <span key={l.id} className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: l.cor }} />
                {l.nome}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Navegação ── */}
      <div className="card px-5 py-3 flex items-center justify-between">
        <button
          onClick={modo === "mes" ? prevMes : () => { setSemana(s => subWeeks(s, 1)); setDiaSelecionado(null); }}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {modo === "mes" ? (
          <div className="flex items-center gap-3">
            <select
              className="input text-sm py-1.5 px-3 font-semibold"
              value={mes}
              onChange={(e) => { setMes(+e.target.value); setDiaSelecionado(null); }}
            >
              {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input
              type="number"
              className="input text-sm py-1.5 px-3 w-20 font-semibold"
              value={ano}
              min={2020} max={2035}
              onChange={(e) => { if (+e.target.value > 2000) { setAno(+e.target.value); setDiaSelecionado(null); } }}
            />
            <span className="text-xs text-gray-400">{aulas.length} aula(s)</span>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-semibold text-gray-800">
              {format(semanaInicio, "dd 'de' MMMM", { locale: ptBR })} –{" "}
              {format(semanaFim, "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
            </p>
            <p className="text-xs text-gray-400">Semana {format(semana, "w")} • {aulas.length} aulas</p>
          </div>
        )}

        <button
          onClick={modo === "mes" ? nextMes : () => { setSemana(s => addWeeks(s, 1)); setDiaSelecionado(null); }}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* ── Grade do calendário ── */}
      {isLoading ? (
        <div className="card flex items-center justify-center py-24 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando aulas...
        </div>
      ) : modo === "mes" ? (
        /* ── MODO MÊS ── */
        <div className="card p-4">
          <div className="grid grid-cols-7 border-b pb-2 mb-2">
            {DIAS_SEMANA_PT.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: primeiroDia }).map((_, i) => (
              <div key={`v${i}`} className="min-h-[100px]" />
            ))}

            {Array.from({ length: diasNoMes }).map((_, i) => {
              const dia = i + 1;
              const dateStr = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
              const aulasAqui = aulasPorDia.get(dateStr) ?? [];
              const isSel = diaSelecionado === dateStr;
              const isHoje = dateStr === hojeStr;

              return (
                <button
                  key={dia}
                  onClick={() => handleDiaClick(dateStr)}
                  className={cn(
                    "min-h-[100px] rounded-xl border p-2 text-left flex flex-col gap-1 transition-all cursor-pointer",
                    isSel
                      ? "border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-200"
                      : aulasAqui.length > 0
                        ? "border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm"
                        : "border-gray-100 bg-gray-50/70 hover:border-gray-200"
                  )}
                >
                  <span className={cn(
                    "text-sm font-bold self-start w-7 h-7 flex items-center justify-center rounded-full shrink-0",
                    isHoje ? "bg-blue-600 text-white" : isSel ? "bg-blue-100 text-blue-700" : "text-gray-700"
                  )}>
                    {dia}
                  </span>

                  {aulasAqui.length > 0 && (
                    <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                      {aulasAqui.slice(0, 3).map((a: any, ai: number) => {
                        const cor = ucColor(a.unidade_curricular_id, ucColorMap);
                        const statusDot = STATUS_DOT[a.status];
                        const ucLabel = (a.uc_nome || a.nome_evento || "Aula").split(" ").slice(0, 2).join(" ");
                        const profLabel = a.professor_nome?.split(" ")[0] ?? "";
                        return (
                          <div key={ai} className="rounded overflow-hidden" style={{ backgroundColor: cor }}>
                            <div className="px-1.5 py-0.5 flex items-center gap-1">
                              {statusDot && (
                                <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusDot }} />
                              )}
                              <span className="text-[9px] font-semibold text-white truncate flex-1 leading-tight">
                                {(a.horario_inicio ?? "").slice(0, 5)} {ucLabel}
                              </span>
                            </div>
                            {profLabel && (
                              <div className="px-1.5 pb-0.5">
                                <span className="text-[8px] text-white/80 truncate block">{profLabel}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {aulasAqui.length > 3 && (
                        <span className="text-[9px] text-gray-400 pl-1 font-medium">
                          +{aulasAqui.length - 3} mais
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── MODO SEMANA ── */
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7">
            {diasSemana.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const aulasAqui = (aulasPorDia.get(dateStr) ?? []).sort(
                (a: any, b: any) => (a.horario_inicio ?? "").localeCompare(b.horario_inicio ?? "")
              );
              const isHoje = dateStr === hojeStr;
              const isSel = diaSelecionado === dateStr;

              return (
                <div key={dateStr} className={cn("border-r last:border-r-0", isSel ? "bg-blue-50/50" : "")}>
                  <button
                    onClick={() => handleDiaClick(dateStr)}
                    className={cn(
                      "w-full text-center px-2 py-3 border-b transition-colors",
                      isHoje ? "bg-blue-600 text-white" : "bg-gray-50 hover:bg-blue-50 text-gray-700"
                    )}
                  >
                    <p className={cn("text-[10px] font-semibold uppercase tracking-wider", isHoje ? "text-blue-100" : "text-gray-400")}>
                      {DIAS_SEMANA_PT[day.getDay()]}
                    </p>
                    <p className={cn("text-xl font-bold", isHoje ? "text-white" : "")}>
                      {format(day, "dd")}
                    </p>
                    {aulasAqui.length > 0 && (
                      <span className={cn("text-[10px]", isHoje ? "text-blue-200" : "text-gray-400")}>
                        {aulasAqui.length} aula(s)
                      </span>
                    )}
                  </button>

                  <div className="p-1.5 space-y-1.5 min-h-[180px]">
                    {aulasAqui.length === 0 ? (
                      <p className="text-[11px] text-gray-300 text-center pt-6">—</p>
                    ) : (
                      aulasAqui.map((a: any) => {
                        const cor = ucColor(a.unidade_curricular_id, ucColorMap);
                        const bgHex = cor + "18"; // ~10% opacity
                        return (
                          <div
                            key={a.id}
                            className="rounded-lg p-1.5 cursor-pointer hover:opacity-90 transition-opacity"
                            style={{ borderLeft: `3px solid ${cor}`, backgroundColor: bgHex }}
                            onClick={() => handleDiaClick(dateStr)}
                          >
                            <p className="font-semibold text-[10px] text-gray-700 font-mono">
                              {(a.horario_inicio ?? "").slice(0, 5)}–{(a.horario_fim ?? "").slice(0, 5)}
                            </p>
                            <p className="text-[11px] font-medium text-gray-800 truncate mt-0.5">
                              {a.uc_nome || a.nome_evento || "—"}
                            </p>
                            {a.professor_nome && (
                              <p className="text-[10px] text-gray-500 truncate">{a.professor_nome}</p>
                            )}
                            <div className="flex items-center justify-between mt-0.5">
                              {a.nome_evento && a.uc_nome && (
                                <p className="text-[9px] text-gray-400 truncate">{a.nome_evento}</p>
                              )}
                              <span
                                className="text-[8px] font-medium px-1 py-px rounded ml-auto shrink-0"
                                style={{
                                  backgroundColor: STATUS_DOT[a.status] ?? "#9ca3af",
                                  color: "white",
                                }}
                              >
                                {a.status}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Painel de detalhes do dia ── */}
      {diaSelecionado && (
        <div ref={tabelaRef} className="card overflow-hidden print:shadow-none">
          <div className="flex items-center justify-between px-5 py-4 bg-blue-600 text-white print:bg-blue-600">
            <div>
              <h2 className="font-bold text-base">
                {new Date(diaSelecionado + "T12:00:00").toLocaleDateString("pt-BR", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                })}
              </h2>
              <p className="text-blue-200 text-sm mt-0.5">
                {aulasNoDia.length === 0
                  ? "Nenhuma aula agendada"
                  : `${aulasNoDia.length} aula(s)`}
                {eventoSelecionadoNome ? ` · ${eventoSelecionadoNome}` : ""}
                {professorFiltro && (professores as any[]).find((p: any) => String(p.id) === professorFiltro)
                  ? ` · Prof. ${(professores as any[]).find((p: any) => String(p.id) === professorFiltro)?.nome}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                onClick={imprimirDia}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
              >
                <Printer className="h-4 w-4" /> Imprimir
              </button>
              <button
                onClick={() => setDiaSelecionado(null)}
                className="p-1.5 hover:bg-white/20 rounded-lg text-blue-200 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {aulasNoDia.length === 0 ? (
            <div className="py-10 text-center text-gray-400">Nenhuma aula agendada para este dia.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left font-semibold w-4" />
                    <th className="px-4 py-3 text-left font-semibold">Horário</th>
                    <th className="px-4 py-3 text-left font-semibold">Evento / Turma</th>
                    <th className="px-4 py-3 text-left font-semibold">UC / Disciplina</th>
                    <th className="px-4 py-3 text-left font-semibold">Professor</th>
                    <th className="px-4 py-3 text-left font-semibold">Ambiente</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aulasNoDia.map((a: any) => (
                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{ backgroundColor: ucColor(a.unidade_curricular_id, ucColorMap) }}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">
                        {(a.horario_inicio ?? "").slice(0, 5)} – {(a.horario_fim ?? "").slice(0, 5)}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{a.nome_evento || "—"}</td>
                      <td className="px-4 py-3 text-gray-700">{a.uc_nome || <span className="text-gray-400">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {a.professor_nome || <span className="text-gray-400 italic">Não definido</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{a.ambiente || a.sala || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                          STATUS_BADGE[a.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                        )}>
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
      )}
    </div>
  );
}
