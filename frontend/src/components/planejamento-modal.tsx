"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { planejamentoApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Loader2, CheckCircle, AlertTriangle, BarChart2, ChevronDown, ChevronRight,
  Check
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

interface ResultadoGerado {
  evento_id: number;
  alocacoes: AlocacaoResult[];
  regencia_projetada: {
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
  conflitos: { descricao?: string; uc_nome?: string; motivo?: string }[];
  alertas_regencia: string[];
  total_aulas: number;
  horas_planejadas: number;
  analise: Analise;
}

interface Props {
  eventoId: number;
  nomeEvento: string;
  ucs: UCParaPlanejar[];
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

// ── Main Component ─────────────────────────────────────────────────────────────

type Etapa = "idle" | "gerando" | "resultado";

export function PlanejamentoModal({ eventoId, nomeEvento, ucs, onClose, onConfirmado }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("idle");
  const [resultado, setResultado] = useState<ResultadoGerado | null>(null);
  const [substituirFuturas, setSubstituirFuturas] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<"alocacoes" | "regencia" | "analise">("alocacoes");

  const gerar = useMutation({
    mutationFn: () => {
      const ucsOrdenadas = ucs.map((u) => ({
        uc_id: u.uc_id,
        ordem: u.ordem,
        professor_preferido_id: u.professor_preferido_id,
        data_inicio: u.data_inicio,
        nao_agendar: u.nao_agendar ?? false,
      }));
      return planejamentoApi.gerar(eventoId, ucsOrdenadas);
    },
    onMutate: () => setEtapa("gerando"),
    onSuccess: (data) => {
      setResultado(data);
      setEtapa("resultado");
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
      toast.success(`${res.aulas_criadas ?? 0} aulas criadas com sucesso.`);
      onConfirmado?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao confirmar");
    },
  });

  const abas = [
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
                <div className="bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
                  <p className="font-medium mb-1">O que será gerado</p>
                  <ul className="list-disc list-inside space-y-1 text-xs text-blue-700">
                    <li>Alocação de professores para cada UC seguindo a sequência pedagógica</li>
                    <li>Prioridade para professores com menor regência atual (meta 70%)</li>
                    <li>Seleção aleatória entre professores com desempenho equivalente</li>
                    <li>Verificação de disponibilidade e conflitos de agenda</li>
                    <li>Análise automática com alertas e sugestões de melhoria</li>
                  </ul>
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
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <div className="text-center">
                  <p className="font-medium text-gray-800">Gerando planejamento...</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Analisando disponibilidades, regência e aptidão dos professores
                  </p>
                </div>
              </div>
            )}

            {/* ── RESULTADO ── */}
            {etapa === "resultado" && resultado && (
              <div className="flex flex-col">
                {/* Stats bar */}
                <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-6 text-sm shrink-0">
                  <div>
                    <span className="text-gray-500">Aulas:</span>{" "}
                    <span className="font-semibold text-gray-900">{resultado.total_aulas}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Horas:</span>{" "}
                    <span className="font-semibold text-gray-900">{resultado.horas_planejadas.toFixed(1)}h</span>
                  </div>
                  {resultado.analise?.avaliacao_geral && (
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded border",
                      AVALIACAO_CLS[resultado.analise.avaliacao_geral] ?? "text-gray-700 bg-gray-50 border-gray-200"
                    )}>
                      {resultado.analise.avaliacao_geral}
                    </span>
                  )}
                  {resultado.conflitos.length > 0 && (
                    <div className="flex items-center gap-1 text-red-600">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span className="font-medium">{resultado.conflitos.length} conflito(s)</span>
                    </div>
                  )}
                </div>

                {/* Tabs */}
                <div className="border-b px-6 flex gap-4 shrink-0">
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

                <div className="p-6 space-y-3">
                  {/* Aba Alocações */}
                  {abaAtiva === "alocacoes" && (
                    <>
                      {resultado.alocacoes.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-8">Nenhuma alocação gerada.</p>
                      ) : (
                        resultado.alocacoes.map((a) => <AlocacaoCard key={a.uc_id} a={a} />)
                      )}
                      {resultado.conflitos.length > 0 && (
                        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-red-700 mb-1.5">Conflitos detectados</p>
                          {resultado.conflitos.map((c, i) => (
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
                      {resultado.alertas_regencia.length > 0 && (
                        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-3">
                          {resultado.alertas_regencia.map((a, i) => (
                            <p key={i} className="text-xs text-amber-700">⚠ {a}</p>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        {resultado.regencia_projetada
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
                        {resultado.regencia_projetada.filter((r: any) => (r.horas_planejadas ?? 0) > 0).length === 0 && (
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={substituirFuturas}
                  onChange={(e) => setSubstituirFuturas(e.target.checked)}
                />
                <span className="text-xs text-gray-600">Substituir aulas futuras não travadas</span>
              </label>
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
                  className="btn-primary flex items-center gap-1.5"
                >
                  <BarChart2 className="h-4 w-4" />
                  Gerar
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
                    disabled={confirmar.isPending}
                    className="btn-primary flex items-center gap-1.5"
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
