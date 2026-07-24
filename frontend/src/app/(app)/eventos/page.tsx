"use client";

import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventosApi, ofertasApi, planejamentoApi } from "@/lib/api";
import { LimparBdButton } from "@/components/limpar-bd-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { CronogramaTable, AulaRow } from "@/components/cronograma-table";
import { AulaEditDrawer } from "@/components/aula-edit-drawer";
import { PlanejamentoModal, UCParaPlanejar } from "@/components/planejamento-modal";
import { toast } from "sonner";
import {
  Search, Plus, Upload, Loader2, RefreshCw, ArrowUp, ArrowDown, X, Download,
  ChevronLeft, ChevronRight, Trash2,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { downloadModeloHistorico } from "@/lib/templates";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Evento {
  id: number;
  nome_turma: string;
  disciplina: string;
  status: string;
  data_inicio: string;
  data_fim: string;
  curso_id: number | null;
  oferta_id: number | null;
  horas_semanais: number;
  horario_inicio: string | null;
  horario_fim: string | null;
  modalidade: string;
  professores_preferidos?: number[] | null;
  modulo_etapa_inicial?: string | null;
}

interface Oferta {
  id: number;
  codigo_evento: string;
  nome_curso: string;
  area: string | null;
  modalidade: string;
  carga_horaria: number;
  hora_inicio: string | null;
  hora_termino: string | null;
  data_inicio: string | null;
  data_termino: string | null;
  turno: string | null;
  dias_semana_texto: string | null;
  status: string;
}

interface UCItem {
  id: number;
  codigo_uc: string;
  nome: string;
  tipo: string;
  modulo_etapa: string | null;
  sequencia: number | null;
  carga_horaria: number;
  professor_preferido_id?: number;
  nao_agendar?: boolean;
}

const DIAS_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

// Parser de dias da semana em texto (ex: "Segunda e Quarta" → [0, 2])
const _DIAS_PARSER: Record<string, number> = {
  seg: 0, segunda: 0,
  ter: 1, terca: 1, "terça": 1,
  qua: 2, quarta: 2,
  qui: 3, quinta: 3,
  sex: 4, sexta: 4,
  sab: 5, sabado: 5, "sábado": 5,
  dom: 6, domingo: 6,
};
function parsearDiasSemana(texto: string): number[] {
  const dias: number[] = [];
  for (const p of texto.toLowerCase().split(/[,/\s\-e]+/)) {
    const k = p.trim();
    if (k in _DIAS_PARSER && !dias.includes(_DIAS_PARSER[k])) {
      dias.push(_DIAS_PARSER[k]);
    }
  }
  return dias.sort((a, b) => a - b);
}

// ── Sub-components ────────────────────────────────────────────────────────────

// ── Paleta de cores para UCs ──────────────────────────────────────────────────

const MESES_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const DIAS_CAL = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

const UC_PALETTE = [
  "#7c3aed", "#0d9488", "#b45309", "#be185d",
  "#1d4ed8", "#047857", "#c2410c", "#0e7490",
  "#9f1239", "#4d7c0f", "#7e22ce", "#075985",
  "#92400e", "#1e40af", "#065f46", "#831843",
];

function buildUcColorMap(aulas: AulaRow[]): Map<number, string> {
  const map = new Map<number, string>();
  let idx = 0;
  for (const a of aulas) {
    const id = a.unidade_curricular_id;
    if (id != null && !map.has(id)) {
      map.set(id, UC_PALETTE[idx % UC_PALETTE.length]);
      idx++;
    }
  }
  return map;
}

function ucCor(id: number | null | undefined, map: Map<number, string>): string {
  if (!id) return "#6b7280";
  return map.get(id) ?? "#6b7280";
}

const STATUS_DOT_HEX: Record<string, string> = {
  Realizada: "#22c55e", Cancelada: "#ef4444",
  Substituída: "#a855f7", Remarcada: "#f97316", Agendada: "#93c5fd",
};
const STATUS_BADGE: Record<string, string> = {
  Realizada:   "bg-green-100 text-green-700 border-green-200",
  Agendada:    "bg-blue-100 text-blue-700 border-blue-200",
  Cancelada:   "bg-red-100 text-red-700 border-red-200",
  Substituída: "bg-purple-100 text-purple-700 border-purple-200",
  Remarcada:   "bg-orange-100 text-orange-700 border-orange-200",
};

// ── Calendário Mensal ─────────────────────────────────────────────────────────

interface CalendarioProps {
  mes: number; ano: number;
  aulas: AulaRow[];
  loading: boolean;
  diaSelecionado: string | null;
  onDiaClick: (d: string | null) => void;
  onMes: (m: number) => void;
  onAno: (a: number) => void;
  onAulaClick: (a: AulaRow) => void;
  // seletor de evento interno
  eventos?: Evento[];
  eventoAtualId?: number | null;
  onEventoChange?: (ev: Evento | null) => void;
}

function CalendarioMes({
  mes, ano, aulas, loading, diaSelecionado, onDiaClick, onMes, onAno, onAulaClick,
  eventos, eventoAtualId, onEventoChange,
}: CalendarioProps) {
  const primeiroDia = new Date(ano, mes - 1, 1).getDay();
  const diasNoMes   = new Date(ano, mes, 0).getDate();
  const hojeStr     = new Date().toISOString().slice(0, 10);

  // Cores por UC
  const ucColorMap = useMemo(() => buildUcColorMap(aulas), [aulas]);

  // Legenda de UCs (ordem de primeiro aparecimento)
  const ucLegend = useMemo(() => {
    const visto = new Map<number, string>();
    for (const a of aulas) {
      if (a.unidade_curricular_id && a.uc_nome && !visto.has(a.unidade_curricular_id)) {
        visto.set(a.unidade_curricular_id, a.uc_nome);
      }
    }
    return Array.from(visto.entries()).map(([id, nome]) => ({ id, nome, cor: ucCor(id, ucColorMap) }));
  }, [aulas, ucColorMap]);

  // Indexar aulas por data
  const aulasPorDia = useMemo(() => {
    const map = new Map<string, AulaRow[]>();
    for (const a of aulas) {
      if (!a.data) continue;
      const k = a.data.slice(0, 10);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [aulas]);

  function prevMes() {
    if (mes === 1) { onMes(12); onAno(ano - 1); } else onMes(mes - 1);
    onDiaClick(null);
  }
  function nextMes() {
    if (mes === 12) { onMes(1); onAno(ano + 1); } else onMes(mes + 1);
    onDiaClick(null);
  }

  const aulasNoDia = diaSelecionado ? (aulasPorDia.get(diaSelecionado) ?? []).slice().sort(
    (a, b) => (a.horario_inicio ?? "").localeCompare(b.horario_inicio ?? "")
  ) : [];

  return (
    <div className="p-4 space-y-3">
      {/* ── Seletor de evento (quando passado) ── */}
      {eventos && onEventoChange && (
        <div className="flex items-center gap-2 pb-1 border-b">
          <span className="text-xs font-semibold text-gray-500 shrink-0">Evento:</span>
          <select
            className="input flex-1 text-sm py-1.5"
            value={eventoAtualId ?? ""}
            onChange={(e) => {
              const id = +e.target.value;
              onEventoChange(eventos.find((ev) => ev.id === id) ?? null);
              onDiaClick(null);
            }}
          >
            <option value="" disabled>— Selecione —</option>
            {eventos.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.nome_turma}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Legenda de UCs ── */}
      {ucLegend.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ucLegend.map((l) => (
            <span key={l.id} className="flex items-center gap-1 text-[10px] text-gray-600">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: l.cor }} />
              {l.nome}
            </span>
          ))}
        </div>
      )}

      {/* ── Cabeçalho: navegação mês/ano ── */}
      <div className="flex items-center gap-2">
        <button onClick={prevMes} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 flex-1 justify-center">
          <select
            className="input text-sm py-1.5 px-3 font-medium"
            value={mes}
            onChange={(e) => { onMes(+e.target.value); onDiaClick(null); }}
          >
            {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input
            type="number"
            className="input text-sm py-1.5 px-3 w-20 font-medium"
            value={ano}
            min={2020} max={2035}
            onChange={(e) => { if (+e.target.value > 2000) { onAno(+e.target.value); onDiaClick(null); } }}
          />
        </div>
        <button onClick={nextMes} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── Grade do calendário ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando aulas...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 border-b pb-1">
            {DIAS_CAL.map((d) => (
              <div key={d} className="text-center text-xs font-semibold text-gray-400 py-1 uppercase tracking-wide">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: primeiroDia }).map((_, i) => (
              <div key={`vazio-${i}`} className="min-h-[90px]" />
            ))}

            {Array.from({ length: diasNoMes }).map((_, i) => {
              const dia = i + 1;
              const dateStr = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
              const aulasAqui = aulasPorDia.get(dateStr) ?? [];
              const isSel  = diaSelecionado === dateStr;
              const isHoje = dateStr === hojeStr;

              return (
                <button
                  key={dia}
                  onClick={() => onDiaClick(isSel ? null : dateStr)}
                  className={cn(
                    "min-h-[90px] rounded-xl border p-2 text-left flex flex-col gap-1 transition-all cursor-pointer",
                    isSel
                      ? "border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-200"
                      : aulasAqui.length > 0
                        ? "border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-sm"
                        : "border-gray-100 bg-gray-50/60 hover:border-gray-200 hover:bg-gray-100/60"
                  )}
                >
                  <span className={cn(
                    "text-sm font-bold leading-none self-start min-w-[22px] min-h-[22px] flex items-center justify-center rounded-full",
                    isHoje ? "bg-blue-600 text-white" : isSel ? "text-blue-700" : "text-gray-700"
                  )}>
                    {dia}
                  </span>

                  {aulasAqui.length > 0 && (
                    <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                      {aulasAqui.slice(0, 3).map((a, ai) => {
                        const cor = ucCor(a.unidade_curricular_id, ucColorMap);
                        const dot = STATUS_DOT_HEX[a.status];
                        const label = (a.uc_nome || a.nome_evento || "Aula").split(" ").slice(0, 2).join(" ");
                        const prof = a.professor_nome?.split(" ")[0] ?? "";
                        return (
                          <div key={ai} className="rounded overflow-hidden" style={{ backgroundColor: cor }}>
                            <div className="px-1.5 py-0.5 flex items-center gap-1">
                              {dot && <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dot }} />}
                              <span className="text-[9px] font-semibold text-white truncate flex-1 leading-tight">
                                {a.horario_inicio?.slice(0, 5)} {label}
                              </span>
                            </div>
                            {prof && (
                              <div className="px-1.5 pb-0.5">
                                <span className="text-[8px] text-white/80 truncate block">{prof}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {aulasAqui.length > 3 && (
                        <span className="text-[9px] text-gray-500 pl-1 font-medium">+{aulasAqui.length - 3} mais</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Painel do dia selecionado ── */}
          {diaSelecionado && (
            <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white">
                <div>
                  <p className="font-semibold text-sm">
                    {new Date(diaSelecionado + "T12:00:00").toLocaleDateString("pt-BR", {
                      weekday: "long", day: "numeric", month: "long", year: "numeric",
                    })}
                  </p>
                  <p className="text-blue-200 text-xs mt-0.5">
                    {aulasNoDia.length === 0 ? "Nenhuma aula" : `${aulasNoDia.length} aula(s)`}
                  </p>
                </div>
                <button onClick={() => onDiaClick(null)} className="p-1.5 rounded-lg hover:bg-blue-500 text-blue-200 hover:text-white transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {aulasNoDia.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">Nenhuma aula agendada para este dia.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                        <th className="px-3 py-2 text-left font-semibold w-4" />
                        <th className="px-4 py-2 text-left font-semibold">Horário</th>
                        <th className="px-4 py-2 text-left font-semibold">UC / Disciplina</th>
                        <th className="px-4 py-2 text-left font-semibold">Professor</th>
                        <th className="px-4 py-2 text-left font-semibold">Ambiente</th>
                        <th className="px-4 py-2 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {aulasNoDia.map((a) => (
                        <tr key={a.id} onClick={() => onAulaClick(a)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                          <td className="px-3 py-3">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: ucCor(a.unidade_curricular_id, ucColorMap) }} />
                          </td>
                          <td className="px-4 py-3 font-mono text-gray-700 whitespace-nowrap">
                            {a.horario_inicio?.slice(0, 5)} – {a.horario_fim?.slice(0, 5)}
                          </td>
                          <td className="px-4 py-3 text-gray-900 font-medium">{a.uc_nome || a.nome_evento || "—"}</td>
                          <td className="px-4 py-3 text-gray-600">
                            {a.professor_nome || <span className="text-gray-400 italic">Não definido</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-500">{a.ambiente || "—"}</td>
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
        </>
      )}
    </div>
  );
}

// ── EventoCard ────────────────────────────────────────────────────────────────

function EventoCard({
  ev, selecionado, onClick,
}: { ev: Evento; selecionado: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3 rounded-lg border transition-colors",
        selecionado
          ? "border-blue-500 bg-blue-50"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-medium text-sm text-gray-900 line-clamp-2 leading-tight">{ev.nome_turma}</p>
        <StatusBadge status={ev.status} />
      </div>
      <p className="text-xs text-gray-500 truncate">{ev.disciplina}</p>
      <p className="text-[10px] text-gray-400 mt-1">
        {formatDate(ev.data_inicio)} – {formatDate(ev.data_fim)}
      </p>
    </button>
  );
}

function RegenciaCard({ r }: { r: { professor_id: number; nome: string; percentual_regencia: number; status_regencia: string } }) {
  const pct = Math.min(r.percentual_regencia, 120);
  const colorCls =
    pct >= 70 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  const statusCls: Record<string, string> = {
    OK:        "text-green-700 bg-green-100",
    Alerta:    "text-amber-700 bg-amber-100",
    Crítico:   "text-red-700 bg-red-100",
    Sobrecarga:"text-purple-700 bg-purple-100",
  };
  return (
    <div className="border rounded-lg p-3 bg-white">
      <div className="flex justify-between items-center mb-2">
        <p className="text-sm font-medium text-gray-800 truncate">{r.nome}</p>
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", statusCls[r.status_regencia] ?? "text-gray-600 bg-gray-100")}>
          {r.status_regencia}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden relative">
          <div className="absolute top-0 left-0 h-full opacity-20 bg-gray-400" style={{ width: "70%" }} />
          <div className={cn("h-full rounded-full", colorCls)} style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-xs text-gray-600 w-10 text-right">{r.percentual_regencia.toFixed(0)}%</span>
      </div>
      <p className="text-[10px] text-gray-400 mt-1">Meta 70% · Projetado</p>
    </div>
  );
}

// ── Picker de Oferta SENAI ────────────────────────────────────────────────────

interface OfertaPickerProps {
  onClose: () => void;
  onEventoCriado: (evento: Evento) => void;
}

function OfertaPickerModal({ onClose, onEventoCriado }: OfertaPickerProps) {
  const [busca, setBusca] = useState("");
  const [ofertaSelecionada, setOfertaSelecionada] = useState<Oferta | null>(null);
  const [step, setStep] = useState<"buscar" | "confirmar">("buscar");
  const [form, setForm] = useState({ horario_inicio: "", horario_fim: "", dias_semana: [] as number[], horas_semanais: "" });

  const { data: ofertas = [], isLoading } = useQuery({
    queryKey: ["ofertas-picker", busca],
    queryFn: () => ofertasApi.listar({ busca: busca || undefined, limit: 50 }),
    staleTime: 30_000,
  });

  const criarEvento = useMutation({
    mutationFn: () =>
      planejamentoApi.fromOferta(ofertaSelecionada!.id, {
        horario_inicio: form.horario_inicio || undefined,
        horario_fim: form.horario_fim || undefined,
        dias_semana: form.dias_semana.length > 0 ? form.dias_semana : undefined,
        horas_semanais: form.horas_semanais ? Number(form.horas_semanais) : undefined,
      }),
    onSuccess: (res) => {
      if (res.criado) {
        toast.success("Evento criado e vinculado à oferta.");
      } else {
        toast.info("Este evento SENAI já foi adicionado ao planejamento.");
      }
      onEventoCriado(res.evento);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao criar evento"),
  });

  function selecionarOferta(o: Oferta) {
    setOfertaSelecionada(o);
    const diasParsed = o.dias_semana_texto ? parsearDiasSemana(o.dias_semana_texto) : [];
    setForm({
      horario_inicio: o.hora_inicio ? o.hora_inicio.slice(0, 5) : "",
      horario_fim: o.hora_termino ? o.hora_termino.slice(0, 5) : "",
      dias_semana: diasParsed,
      horas_semanais: "",
    });
    setStep("confirmar");
  }

  function toggleDia(d: number) {
    setForm((prev) => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(d)
        ? prev.dias_semana.filter((x) => x !== d)
        : [...prev.dias_semana, d].sort(),
    }));
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">

          {/* Header */}
          <div className="px-5 py-4 border-b shrink-0 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">
                {step === "buscar" ? "Selecionar Evento SENAI" : "Confirmar dados do evento"}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === "buscar"
                  ? "Escolha um evento da lista de ofertas para gerar o planejamento"
                  : ofertaSelecionada?.codigo_evento + " – " + ofertaSelecionada?.nome_curso}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Step 1: Buscar oferta */}
          {step === "buscar" && (
            <>
              <div className="px-5 pt-4 pb-2 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    autoFocus
                    className="input w-full pl-9 text-sm"
                    placeholder="Buscar por código, nome do curso ou área..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-4">
                {isLoading ? (
                  <div className="flex items-center justify-center py-10 text-gray-400">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
                  </div>
                ) : (ofertas as Oferta[]).length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-10">Nenhuma oferta encontrada.</p>
                ) : (
                  <div className="space-y-1.5 mt-1">
                    {(ofertas as Oferta[]).map((o) => (
                      <button
                        key={o.id}
                        onClick={() => selecionarOferta(o)}
                        className="w-full text-left border rounded-lg px-3 py-2.5 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                            {o.codigo_evento}
                          </span>
                          <p className="font-medium text-sm text-gray-900 truncate">{o.nome_curso}</p>
                        </div>
                        <div className="flex gap-3 mt-1 text-[11px] text-gray-400">
                          {o.area && <span>{o.area}</span>}
                          {o.carga_horaria > 0 && <span>{o.carga_horaria}h</span>}
                          {o.turno && <span>{o.turno}</span>}
                          {o.data_inicio && <span>{formatDate(o.data_inicio)}</span>}
                          {o.status && <span className="ml-auto">{o.status}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step 2: Confirmar / complementar dados */}
          {step === "confirmar" && ofertaSelecionada && (
            <>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {/* Resumo da oferta */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 space-y-1">
                  <p><span className="font-semibold">Curso:</span> {ofertaSelecionada.nome_curso}</p>
                  {ofertaSelecionada.area && <p><span className="font-semibold">Área:</span> {ofertaSelecionada.area}</p>}
                  <p><span className="font-semibold">Carga horária:</span> {ofertaSelecionada.carga_horaria}h</p>
                  {ofertaSelecionada.data_inicio && (
                    <p><span className="font-semibold">Período:</span> {formatDate(ofertaSelecionada.data_inicio)}
                      {ofertaSelecionada.data_termino ? ` – ${formatDate(ofertaSelecionada.data_termino)}` : ""}
                    </p>
                  )}
                  {ofertaSelecionada.dias_semana_texto && (
                    <p><span className="font-semibold">Dias (texto):</span> {ofertaSelecionada.dias_semana_texto}</p>
                  )}
                </div>

                {/* Horário */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Horário início *</label>
                    <input type="time" className="input w-full text-sm"
                      value={form.horario_inicio}
                      onChange={(e) => setForm({ ...form, horario_inicio: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Horário fim *</label>
                    <input type="time" className="input w-full text-sm"
                      value={form.horario_fim}
                      onChange={(e) => setForm({ ...form, horario_fim: e.target.value })} />
                  </div>
                </div>

                {/* Dias da semana */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    Dias da semana
                    {form.dias_semana.length > 0 && ofertaSelecionada.dias_semana_texto && (
                      <span className="ml-1 font-normal text-green-600">
                        — detectados automaticamente de "{ofertaSelecionada.dias_semana_texto}"
                      </span>
                    )}
                    {form.dias_semana.length === 0 && !ofertaSelecionada.dias_semana_texto && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DIAS_LABELS.map((d, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDia(i)}
                        className={cn(
                          "px-3 py-1.5 text-xs rounded-md font-medium border transition-colors",
                          form.dias_semana.includes(i)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-200 hover:border-blue-400"
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {form.dias_semana.length > 0
                      ? "Clique para ajustar os dias se necessário."
                      : ofertaSelecionada.dias_semana_texto
                        ? `Texto original: "${ofertaSelecionada.dias_semana_texto}" — não foi possível detectar os dias. Selecione acima.`
                        : "Nenhum dia cadastrado na oferta. Selecione acima."}
                  </p>
                </div>

                {/* Horas semanais */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Horas semanais
                    <span className="text-gray-400 font-normal ml-1">(calculado automaticamente se em branco)</span>
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    className="input w-32 text-sm"
                    placeholder="Ex: 4"
                    value={form.horas_semanais}
                    onChange={(e) => setForm({ ...form, horas_semanais: e.target.value })}
                  />
                </div>
              </div>

              <div className="border-t px-5 py-3 shrink-0 flex justify-between">
                <button onClick={() => setStep("buscar")} className="btn-secondary text-sm">← Voltar</button>
                <button
                  onClick={() => criarEvento.mutate()}
                  disabled={criarEvento.isPending || !form.horario_inicio || !form.horario_fim}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                >
                  {criarEvento.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Adicionar ao Planejamento
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </>
  );
}

// ── UC Row with per-UC candidatos ─────────────────────────────────────────────

function UCRowWithCandidatos({
  uc, idx, total, eventoId, onMover, onSetPreferido, onSetNaoAgendar,
}: {
  uc: UCItem; idx: number; total: number; eventoId: number;
  onMover: (idx: number, dir: "up" | "down") => void;
  onSetPreferido: (ucId: number, profId: number | undefined) => void;
  onSetNaoAgendar: (ucId: number, valor: boolean) => void;
}) {
  const { data: candidatos = [], isLoading } = useQuery({
    queryKey: ["candidatos", eventoId, uc.id],
    queryFn: () => planejamentoApi.candidatos(eventoId, uc.id),
    staleTime: 120_000,
  });

  const isEad = uc.tipo === "EaD" || uc.tipo === "ead" || uc.tipo?.toLowerCase() === "ead";
  const naoAgendar = uc.nao_agendar ?? false;

  return (
    <div className={cn(
      "border rounded-lg p-3 flex gap-3 transition-colors",
      naoAgendar ? "bg-blue-50 border-blue-200 opacity-75" : "bg-white"
    )}>
      <div className="flex flex-col gap-0.5 shrink-0 mt-1">
        <button onClick={() => onMover(idx, "up")} disabled={idx === 0}
          className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30">
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => onMover(idx, "down")} disabled={idx === total - 1}
          className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-30">
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-xs font-mono text-gray-400 w-5 text-right shrink-0 mt-1">{idx + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn("text-sm font-medium truncate", naoAgendar ? "text-gray-400 line-through" : "text-gray-900")}>
            {uc.nome}
          </p>
          {isEad && (
            <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase tracking-wide">
              EaD
            </span>
          )}
        </div>
        <div className="flex gap-2 text-[10px] text-gray-400 mt-0.5">
          <span>{uc.carga_horaria}h</span>
          {uc.modulo_etapa && <span>· {uc.modulo_etapa}</span>}
          <span className="text-gray-300">#{uc.codigo_uc}</span>
        </div>
        {/* Toggle "Não agendar" — disponível para EaD mas pode ser usado em qualquer UC */}
        <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer w-fit group">
          <input
            type="checkbox"
            checked={naoAgendar}
            onChange={(e) => onSetNaoAgendar(uc.id, e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3 w-3"
          />
          <span className={cn(
            "text-[10px] select-none",
            naoAgendar ? "text-blue-700 font-medium" : "text-gray-400 group-hover:text-gray-600"
          )}>
            {naoAgendar ? "EaD paralelo — sem agendamento" : "Não agendar (EaD paralelo)"}
          </span>
        </label>
      </div>
      <div className="shrink-0 w-44">
        {naoAgendar ? (
          <div className="flex items-center justify-center h-full text-[10px] text-blue-500 text-center py-2">
            Sem alocação de professor
          </div>
        ) : (
          <>
            <select
              className="input w-full text-xs py-1.5"
              value={uc.professor_preferido_id ?? ""}
              onChange={(e) => onSetPreferido(uc.id, e.target.value ? +e.target.value : undefined)}
              disabled={isLoading}
            >
              <option value="">Auto (sistema escolhe)</option>
              {(candidatos as any[]).map((c: any) => (
                <option key={c.professor_id} value={c.professor_id}>
                  {c.nome}{c.nivel_competencia ? ` ★${c.nivel_competencia}` : ""}
                </option>
              ))}
            </select>
            {isLoading && <p className="text-[10px] text-gray-400 mt-0.5">Buscando aptos...</p>}
            {!isLoading && (candidatos as any[]).length === 0 && (
              <p className="text-[10px] text-amber-600 mt-0.5">Nenhum apto cadastrado</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EventosPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [eventoSelecionado, setEventoSelecionado] = useState<Evento | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<"cronograma" | "ucs" | "regencia">("cronograma");
  const [aulaEditando, setAulaEditando] = useState<AulaRow | null>(null);
  const [gerarAberto, setGerarAberto] = useState(false);
  const [ofertaPickerAberto, setOfertaPickerAberto] = useState(false);
  const [ucsOrdenadas, setUcsOrdenadas] = useState<UCItem[]>([]);
  const [moduloSelecionado, setModuloSelecionado] = useState<string | null>(null);
  const [moduloDataInicio, setModuloDataInicio] = useState<string>("");
  const [ucFormAberto, setUcFormAberto] = useState(false);
  const [ucForm, setUcForm] = useState({ nome: "", carga_horaria: "" });
  const [limparAberto, setLimparAberto] = useState(false);

  // ── Calendário state ────────────────────────────────────────────────────────
  const _hoje = new Date();
  const [mesCal, setMesCal] = useState(_hoje.getMonth() + 1);
  const [anoCal, setAnoCal] = useState(_hoje.getFullYear());
  const [diaSel, setDiaSel] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ["eventos", statusFiltro],
    queryFn: () => eventosApi.listar(statusFiltro ? { status: statusFiltro } : undefined),
  });

  const { data: cronograma = [], isLoading: loadingCronograma } = useQuery({
    queryKey: ["cronograma", eventoSelecionado?.id],
    queryFn: () => planejamentoApi.cronograma({ evento_id: eventoSelecionado!.id, limit: 1000 }),
    enabled: !!eventoSelecionado && (abaAtiva === "cronograma" || limparAberto),
  });

  const {
    data: rawModulos = [],
    isSuccess: modulosOk,
    isError: modulosErr,
  } = useQuery({
    queryKey: ["evento-modulos", eventoSelecionado?.id],
    queryFn: () => planejamentoApi.modulos(eventoSelecionado!.id),
    enabled: !!eventoSelecionado && abaAtiva === "ucs",
    staleTime: 60_000,
    retry: 0,  // falha rápida — não deixa o spinner girando
  });
  const modList = rawModulos as string[];
  // Resolvido = sucesso OU erro (qualquer resposta, mesmo negativa)
  const modulosResolvido = modulosOk || modulosErr;

  const { isLoading: loadingUcs } = useQuery({
    queryKey: ["evento-ucs", eventoSelecionado?.id, moduloSelecionado],
    queryFn: async () => {
      const lista: UCItem[] = await planejamentoApi.ucs(
        eventoSelecionado!.id,
        moduloSelecionado ?? undefined
      );
      setUcsOrdenadas(lista);
      return lista;
    },
    // Dispara quando: módulo selecionado, OU confirmado que não há módulos
    enabled: !!eventoSelecionado && abaAtiva === "ucs" && (
      moduloSelecionado !== null ||
      (modulosResolvido && modList.length === 0)
    ),
  });

  const { data: regencias = [], isLoading: loadingRegencia } = useQuery({
    queryKey: ["regencia-projetada", eventoSelecionado?.id],
    queryFn: () => planejamentoApi.regenciaProjetada({
      evento_id: eventoSelecionado?.id,
      data_inicio: eventoSelecionado?.data_inicio,
      data_fim: eventoSelecionado?.data_fim,
    }),
    enabled: abaAtiva === "regencia",
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const adicionarUcAvulsa = useMutation({
    mutationFn: (dados: { nome: string; carga_horaria: number }) =>
      planejamentoApi.criarUcAvulsa(eventoSelecionado!.id, dados),
    onSuccess: (uc: any) => {
      const novaUc: UCItem = {
        id: uc.id,
        codigo_uc: uc.codigo_uc,
        nome: uc.nome,
        carga_horaria: uc.carga_horaria,
        modulo_etapa: uc.modulo_etapa ?? null,
        sequencia: null,
        tipo: "Presencial",
      };
      setUcsOrdenadas((prev) => [...prev, novaUc]);
      setUcForm({ nome: "", carga_horaria: "" });
      setUcFormAberto(false);
      toast.success(uc.criada ? "UC criada e adicionada." : "UC já existia — adicionada à lista.");
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao criar UC"),
  });

  const importarHistorico = useMutation({
    mutationFn: (file: File) => planejamentoApi.importarHistorico(file),
    onSuccess: (res: any) => {
      const total = (res.inseridas ?? 0) + (res.atualizadas ?? 0);
      if (total > 0) {
        toast.success(
          `Importação concluída: ${res.inseridas} novas + ${res.atualizadas} atualizadas` +
          (res.ignoradas > 0 ? ` (${res.ignoradas} ignoradas)` : "")
        );
      } else {
        const semData = res.ignoradas_sem_data > 0 ? `${res.ignoradas_sem_data} sem data` : "";
        const semHora = res.ignoradas_sem_horario > 0 ? `${res.ignoradas_sem_horario} sem horário` : "";
        const motivos = [semData, semHora].filter(Boolean).join(", ");
        toast.warning(
          `Nenhuma aula importada. ${res.ignoradas} linha(s) ignoradas${motivos ? `: ${motivos}` : ""}.`,
          { duration: 10000 }
        );
        if (res.colunas_encontradas?.length) {
          toast.info(`Colunas detectadas: ${res.colunas_encontradas.slice(0, 8).join(", ")}`, { duration: 12000 });
        }
      }
      if (res.erros?.length) {
        res.erros.slice(0, 3).forEach((e: string) => toast.error(e, { duration: 10000 }));
      }
      qc.invalidateQueries({ queryKey: ["cronograma"] });
      qc.invalidateQueries({ queryKey: ["cronograma-global"] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao importar"),
  });

  const apagarPlanejamentoMut = useMutation({
    mutationFn: ({ ucId }: { ucId?: number }) =>
      planejamentoApi.apagarPlanejamento(eventoSelecionado!.id, ucId),
    onSuccess: (res: any) => {
      toast.success(`${res.removidas} aula(s) removida(s) com sucesso.`);
      setLimparAberto(false);
      qc.invalidateQueries({ queryKey: ["cronograma", eventoSelecionado?.id] });
      qc.invalidateQueries({ queryKey: ["regencia-projetada", eventoSelecionado?.id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao remover aulas"),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importarHistorico.mutate(file);
    e.target.value = "";
  }

  function moverUc(idx: number, direcao: "up" | "down") {
    setUcsOrdenadas((prev) => {
      const arr = [...prev];
      const troca = direcao === "up" ? idx - 1 : idx + 1;
      if (troca < 0 || troca >= arr.length) return prev;
      [arr[idx], arr[troca]] = [arr[troca], arr[idx]];
      return arr;
    });
  }

  function setPreferidoUc(ucId: number, professorId: number | undefined) {
    setUcsOrdenadas((prev) =>
      prev.map((u) => (u.id === ucId ? { ...u, professor_preferido_id: professorId } : u))
    );
  }

  function setNaoAgendarUc(ucId: number, valor: boolean) {
    setUcsOrdenadas((prev) =>
      prev.map((u) => (u.id === ucId ? { ...u, nao_agendar: valor } : u))
    );
  }

  function handleEventoCriado(ev: Evento) {
    qc.invalidateQueries({ queryKey: ["eventos"] });
    setOfertaPickerAberto(false);
    setEventoSelecionado(ev);
    setAbaAtiva("ucs");
  }

  const ucsDoCronograma = useMemo(() => {
    const visto = new Map<number, string>();
    for (const a of cronograma as AulaRow[]) {
      if (a.unidade_curricular_id && a.uc_nome && !visto.has(a.unidade_curricular_id)) {
        visto.set(a.unidade_curricular_id, a.uc_nome);
      }
    }
    return Array.from(visto.entries()).map(([id, nome]) => ({ id, nome }));
  }, [cronograma]);

  function handleApagarTudo() {
    if (!window.confirm(`Remover TODAS as aulas do planejamento de "${eventoSelecionado?.nome_turma}"?\n\nEsta ação não pode ser desfeita.`)) return;
    apagarPlanejamentoMut.mutate({});
  }

  function handleApagarUc(ucId: number, ucNome: string) {
    if (!window.confirm(`Remover as aulas de "${ucNome}" do evento "${eventoSelecionado?.nome_turma}"?\n\nEsta ação não pode ser desfeita.`)) return;
    apagarPlanejamentoMut.mutate({ ucId });
  }

  const filtrados = (eventos as Evento[]).filter(
    (e) =>
      e.nome_turma.toLowerCase().includes(search.toLowerCase()) ||
      e.disciplina.toLowerCase().includes(search.toLowerCase())
  );

  const ucsParaPlanejar: UCParaPlanejar[] = ucsOrdenadas.map((u, i) => ({
    uc_id: u.id,
    uc_nome: u.nome,
    carga_horaria: u.carga_horaria,
    ordem: i + 1,
    professor_preferido_id: u.professor_preferido_id,
    // Apenas a 1ª UC recebe data_inicio — as demais encadeiam automaticamente
    data_inicio: i === 0 && moduloDataInicio ? moduloDataInicio : undefined,
    nao_agendar: u.nao_agendar ?? false,
  }));

  const abas = [
    { id: "cronograma", label: "Cronograma" },
    { id: "ucs",        label: "UCs & Professores" },
    { id: "regencia",   label: "Regência" },
  ] as const;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full">
        <PageHeader title="Planejamento" description="Cronogramas e alocação de professores">
          <div className="flex gap-2 flex-wrap">
            <LimparBdButton
              tipo="aulas"
              label="Limpar Aulas"
              onLimpou={() => qc.invalidateQueries({ queryKey: ["cronograma"] })}
            />
            <LimparBdButton
              tipo="planejamento"
              label="Limpar Planejamento"
              onLimpou={() => {
                qc.invalidateQueries({ queryKey: ["cronograma"] });
                qc.invalidateQueries({ queryKey: ["eventos"] });
                setEventoSelecionado(null);
              }}
            />
            <button
              onClick={downloadModeloHistorico}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              <Download className="h-4 w-4" />
              Baixar Modelo
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importarHistorico.isPending}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              {importarHistorico.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Upload className="h-4 w-4" />}
              Importar Histórico
            </button>
            <button onClick={() => setOfertaPickerAberto(true)} className="btn-primary flex items-center gap-1.5">
              <Plus className="h-4 w-4" />
              Adicionar Oferta SENAI
            </button>
          </div>
        </PageHeader>

        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />

        <div className="flex flex-1 min-h-0 gap-4 mt-4">
          {/* ── Left: Event List ─────────────────────────────────────────── */}
          <div className="w-80 shrink-0 flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                className="input w-full pl-9 text-sm"
                placeholder="Buscar turma..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="input w-full text-sm"
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
            >
              <option value="">Todos os status</option>
              {["Planejado", "Ativo", "Concluído", "Cancelado"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {isLoading ? (
                <div className="text-center py-8 text-gray-400 text-sm">Carregando...</div>
              ) : filtrados.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Nenhuma turma encontrada.
                  <button
                    onClick={() => setOfertaPickerAberto(true)}
                    className="block mx-auto mt-3 text-blue-600 text-xs underline"
                  >
                    Adicionar evento SENAI
                  </button>
                </div>
              ) : (
                filtrados.map((ev) => (
                  <EventoCard
                    key={ev.id}
                    ev={ev}
                    selecionado={eventoSelecionado?.id === ev.id}
                    onClick={() => {
                      setEventoSelecionado(ev);
                      setAbaAtiva("cronograma");
                      setUcsOrdenadas([]);
                      setModuloSelecionado(null);
                      setModuloDataInicio("");
                      setDiaSel(null);
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Right: Detail Panel ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col card overflow-hidden">
            {!eventoSelecionado ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
                <p className="text-sm">Selecione uma turma para visualizar o planejamento.</p>
                <button
                  onClick={() => setOfertaPickerAberto(true)}
                  className="btn-primary flex items-center gap-1.5 text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar Oferta SENAI
                </button>
              </div>
            ) : (
              <>
                {/* Panel header */}
                <div className="px-5 py-3 border-b shrink-0 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{eventoSelecionado.nome_turma}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {eventoSelecionado.disciplina} · {formatDate(eventoSelecionado.data_inicio)} –{" "}
                      {formatDate(eventoSelecionado.data_fim)}
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setLimparAberto(!limparAberto)}
                      disabled={apagarPlanejamentoMut.isPending}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium border border-red-200 hover:border-red-300 rounded px-2 py-1 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      {apagarPlanejamentoMut.isPending
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Trash2 className="h-3 w-3" />}
                      Limpar
                    </button>
                    {limparAberto && (
                      <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-20 min-w-[240px] py-1">
                        <button
                          onClick={handleApagarTudo}
                          className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 font-medium"
                        >
                          Apagar todo o planejamento
                        </button>
                        {ucsDoCronograma.length > 0 && (
                          <>
                            <div className="border-t my-1" />
                            <p className="px-4 py-1.5 text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                              Apagar por UC:
                            </p>
                            {ucsDoCronograma.map((uc) => (
                              <button
                                key={uc.id}
                                onClick={() => handleApagarUc(uc.id, uc.nome)}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 truncate"
                              >
                                {uc.nome}
                              </button>
                            ))}
                          </>
                        )}
                        <div className="border-t mt-1 pt-1">
                          <button
                            onClick={() => setLimparAberto(false)}
                            className="w-full text-left px-4 py-2 text-xs text-gray-400 hover:text-gray-600"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div className="border-b px-5 flex gap-4 shrink-0">
                  {abas.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAbaAtiva(a.id)}
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

                {/* Tab content */}
                <div className="flex-1 min-h-0 overflow-y-auto">

                  {/* ── Tab: Cronograma ── */}
                  {abaAtiva === "cronograma" && (
                    <CalendarioMes
                      mes={mesCal}
                      ano={anoCal}
                      aulas={cronograma as AulaRow[]}
                      loading={loadingCronograma}
                      diaSelecionado={diaSel}
                      onDiaClick={setDiaSel}
                      onMes={setMesCal}
                      onAno={setAnoCal}
                      onAulaClick={setAulaEditando}
                      eventos={filtrados}
                      eventoAtualId={eventoSelecionado?.id}
                      onEventoChange={(ev) => {
                        if (ev) {
                          setEventoSelecionado(ev);
                          setUcsOrdenadas([]);
                          setModuloSelecionado(null);
                          setModuloDataInicio("");
                        }
                        setDiaSel(null);
                      }}
                    />
                  )}

                  {/* ── Tab: UCs & Professores ── */}
                  {abaAtiva === "ucs" && (
                    <div className="p-5 space-y-4">
                      {/* Aguardando query de módulos (sucesso ou erro) */}
                      {!modulosResolvido ? (
                        <div className="flex items-center justify-center py-16 text-gray-400">
                          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando...
                        </div>
                      ) : (
                        <>
                          {/* ── Seletor de Módulo/Etapa ── */}
                          {modList.length > 0 && (
                            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                              <label className="text-sm font-medium text-blue-800 shrink-0 whitespace-nowrap">
                                Módulo / Etapa:
                              </label>
                              <select
                                className="input flex-1 text-sm"
                                value={moduloSelecionado ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value || null;
                                  if (val !== moduloSelecionado) {
                                    setUcsOrdenadas([]);
                                    setModuloDataInicio("");
                                  }
                                  setModuloSelecionado(val);
                                }}
                              >
                                <option value="">— Selecione o módulo para planejar —</option>
                                {modList.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Aviso para selecionar módulo */}
                          {modList.length > 0 && !moduloSelecionado && (
                            <p className="text-sm text-center text-gray-400 py-8">
                              Selecione o módulo acima para ver as UCs disponíveis.
                            </p>
                          )}

                          {/* ── Conteúdo de UCs (só mostra com módulo selecionado ou sem módulos) ── */}
                          {(modList.length === 0 || moduloSelecionado !== null) && (
                            loadingUcs ? (
                              <div className="flex items-center justify-center py-16 text-gray-400">
                                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando UCs...
                              </div>
                            ) : (
                              <>
                                {/* Data de início do módulo */}
                                <div className="flex flex-wrap items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                  <label className="text-sm font-medium text-amber-900 shrink-0 whitespace-nowrap">
                                    Início do {moduloSelecionado ? `módulo "${moduloSelecionado}"` : "planejamento"}:
                                  </label>
                                  <input
                                    type="date"
                                    className="input text-sm py-1 px-2"
                                    value={moduloDataInicio}
                                    onChange={(e) => setModuloDataInicio(e.target.value)}
                                    title="Data de início do módulo. As UCs serão encadeadas sequencialmente a partir desta data, respeitando o calendário acadêmico."
                                  />
                                  {moduloDataInicio && (
                                    <button
                                      type="button"
                                      onClick={() => setModuloDataInicio("")}
                                      className="text-xs text-amber-700 hover:text-red-600"
                                    >✕ Limpar</button>
                                  )}
                                  <span className="text-xs text-amber-700 ml-auto">
                                    As UCs serão encadeadas automaticamente a partir desta data
                                  </span>
                                </div>

                                {/* Cabeçalho com botão Gerar */}
                                <div className="flex justify-between items-center">
                                  <p className="text-xs text-gray-500">
                                    {ucsOrdenadas.length > 0
                                      ? `${ucsOrdenadas.length} UC(s)${moduloSelecionado ? ` do módulo ${moduloSelecionado}` : ""} — reordene e defina professores antes de gerar.`
                                      : "Adicione as unidades curriculares para gerar o planejamento."}
                                  </p>
                                  <button
                                    onClick={() => setGerarAberto(true)}
                                    disabled={ucsOrdenadas.length === 0}
                                    className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                    Gerar Planejamento
                                  </button>
                                </div>

                                {/* Lista de UCs */}
                                {ucsOrdenadas.length === 0 ? (
                                  <div className="border border-dashed rounded-lg p-6 text-center text-gray-400 text-sm">
                                    <p>Nenhuma UC cadastrada{moduloSelecionado ? ` para o módulo "${moduloSelecionado}"` : " para este curso"}.</p>
                                    {!eventoSelecionado.curso_id && (
                                      <p className="text-xs mt-1">O evento não possui curso vinculado.</p>
                                    )}
                                    {eventoSelecionado.curso_id && (
                                      <button
                                        onClick={() => {
                                          setUcForm({
                                            nome: eventoSelecionado.disciplina,
                                            carga_horaria: String((eventoSelecionado as any).carga_horaria_total ?? ""),
                                          });
                                          setUcFormAberto(true);
                                        }}
                                        className="mt-3 text-blue-600 text-xs underline"
                                      >
                                        Usar o curso como UC única
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {ucsOrdenadas.map((uc, idx) => (
                                      <UCRowWithCandidatos
                                        key={uc.id}
                                        uc={uc}
                                        idx={idx}
                                        total={ucsOrdenadas.length}
                                        eventoId={eventoSelecionado.id}
                                        onMover={moverUc}
                                        onSetPreferido={setPreferidoUc}
                                        onSetNaoAgendar={setNaoAgendarUc}
                                      />
                                    ))}
                                  </div>
                                )}

                                {/* Botão adicionar UC */}
                                {!ucFormAberto ? (
                                  <button
                                    onClick={() => { setUcForm({ nome: "", carga_horaria: "" }); setUcFormAberto(true); }}
                                    className="w-full border border-dashed rounded-lg py-2 text-xs text-gray-400 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    <Plus className="h-3.5 w-3.5" /> Adicionar UC manualmente
                                  </button>
                                ) : (
                                  <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                                    <p className="text-xs font-medium text-gray-700">Nova Unidade Curricular</p>
                                    <input
                                      className="input w-full text-sm"
                                      placeholder="Nome da UC"
                                      value={ucForm.nome}
                                      onChange={(e) => setUcForm({ ...ucForm, nome: e.target.value })}
                                      autoFocus
                                    />
                                    <div className="flex gap-2 items-center">
                                      <input
                                        type="number"
                                        className="input w-28 text-sm"
                                        placeholder="Carga (h)"
                                        value={ucForm.carga_horaria}
                                        onChange={(e) => setUcForm({ ...ucForm, carga_horaria: e.target.value })}
                                      />
                                      <span className="text-xs text-gray-400">horas</span>
                                      <div className="flex-1" />
                                      <button onClick={() => setUcFormAberto(false)} className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
                                      <button
                                        onClick={() => adicionarUcAvulsa.mutate({ nome: ucForm.nome, carga_horaria: Number(ucForm.carga_horaria) })}
                                        disabled={!ucForm.nome || !ucForm.carga_horaria || adicionarUcAvulsa.isPending}
                                        className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1"
                                      >
                                        {adicionarUcAvulsa.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Adicionar
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            )
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* ── Tab: Regência ── */}
                  {abaAtiva === "regencia" && (
                    <div className="p-5">
                      {loadingRegencia ? (
                        <div className="flex items-center justify-center py-16 text-gray-400">
                          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Calculando...
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-gray-500 mb-3">
                            Projeção de regência dos professores com base nas aulas agendadas e a meta de 70%.
                          </p>
                          <div className="space-y-2">
                            {(regencias as any[]).map((r) => <RegenciaCard key={r.professor_id} r={r} />)}
                            {(regencias as any[]).length === 0 && (
                              <p className="text-center py-12 text-gray-400 text-sm">Nenhum professor ativo encontrado.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Drawers & Modals ─────────────────────────────────────────────────── */}

      <AulaEditDrawer
        aula={aulaEditando}
        eventoId={eventoSelecionado?.id}
        onClose={() => setAulaEditando(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["cronograma", eventoSelecionado?.id] })}
      />

      {gerarAberto && eventoSelecionado && (
        <PlanejamentoModal
          eventoId={eventoSelecionado.id}
          nomeEvento={eventoSelecionado.nome_turma}
          ucs={ucsParaPlanejar}
          onClose={() => setGerarAberto(false)}
          onConfirmado={() => {
            qc.invalidateQueries({ queryKey: ["cronograma", eventoSelecionado.id] });
            qc.invalidateQueries({ queryKey: ["regencia-projetada", eventoSelecionado.id] });
            setAbaAtiva("cronograma");
          }}
        />
      )}

      {ofertaPickerAberto && (
        <OfertaPickerModal
          onClose={() => setOfertaPickerAberto(false)}
          onEventoCriado={handleEventoCriado}
        />
      )}
    </>
  );
}
