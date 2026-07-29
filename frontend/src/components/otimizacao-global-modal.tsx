"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { planejamentoApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Loader2, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle2, ChevronRight, Users, ArrowRight, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Remanejamento {
  evento_id: number;
  evento_nome: string;
  uc_id: number;
  uc_nome: string;
  num_aulas: number;
  horas: number;
  prof_atual_id: number | null;
  prof_atual_nome: string;
  prof_atual_tipo: string | null;
  prof_novo_id: number;
  prof_novo_nome: string;
  prof_novo_tipo: string;
}

interface ImpactoProfessor {
  professor_id: number;
  nome: string;
  tipo: string;
  pct_antes: number;
  pct_depois: number;
  horas_antes: number;
  horas_depois: number;
  meta_pct: number;
}

interface SemCandidato {
  evento_id: number;
  evento_nome: string;
  uc_id: number;
  uc_nome: string;
  motivo: string;
}

interface ResultadoOtimizacao {
  status: "ok" | "sem_resultado";
  mensagem: string | null;
  remanejamentos: Remanejamento[];
  sem_candidatos: SemCandidato[];
  impacto_professores: ImpactoProfessor[];
  resumo: {
    total_ucs_livres: number;
    total_remanejamentos: number;
    mensalistas_na_meta_antes: number;
    mensalistas_na_meta_depois: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function badgeTipo(tipo: string | null) {
  if (!tipo) return null;
  const map: Record<string, string> = {
    Mensalista: "bg-blue-100 text-blue-700",
    Horista: "bg-amber-100 text-amber-700",
  };
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", map[tipo] ?? "bg-gray-100 text-gray-600")}>
      {tipo}
    </span>
  );
}

function BarraRegencia({ pct, meta = 70, label }: { pct: number; meta?: number; label: string }) {
  const clamped = Math.min(pct, 110);
  const cor = pct >= meta ? (pct > 90 ? "bg-amber-400" : "bg-emerald-500") : pct >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 text-right text-gray-500 shrink-0">{label}</span>
      <div className="relative flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", cor)} style={{ width: `${Math.min(clamped, 100)}%` }} />
        {/* Linha de meta */}
        <div
          className="absolute top-0 bottom-0 w-px bg-gray-400"
          style={{ left: `${meta}%` }}
        />
      </div>
      <span className={cn("w-10 font-medium", pct >= meta ? "text-emerald-600" : "text-red-500")}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

interface OtimizacaoGlobalModalProps {
  onClose: () => void;
  onConfirmado?: () => void;
}

export function OtimizacaoGlobalModal({ onClose, onConfirmado }: OtimizacaoGlobalModalProps) {
  const [resultado, setResultado] = useState<ResultadoOtimizacao | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [incluirRpaPj, setIncluirRpaPj] = useState(false);
  const [aba, setAba] = useState<"remanejamentos" | "impacto" | "semCandidatos">("remanejamentos");

  // Chave única por remanejamento
  const remKey = (r: Remanejamento) => `${r.evento_id}_${r.uc_id}`;

  const analisarMutation = useMutation({
    mutationFn: () => planejamentoApi.otimizarGlobal(incluirRpaPj),
    onSuccess: (data: ResultadoOtimizacao) => {
      setResultado(data);
      // Pré-seleciona todos os remanejamentos
      setSelecionados(new Set(data.remanejamentos.map(remKey)));
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail ?? "Erro desconhecido";
      toast.error(`Erro ao analisar: ${detail}`);
    },
  });

  const confirmarMutation = useMutation({
    mutationFn: () => {
      const aprovados = resultado!.remanejamentos.filter((r) => selecionados.has(remKey(r)));
      return planejamentoApi.confirmarOtimizacaoGlobal(aprovados);
    },
    onSuccess: (data) => {
      toast.success(
        `${data.remanejamentos_aplicados} remanejamento(s) aplicado(s) — ${data.aulas_atualizadas} aula(s) atualizadas.`
      );
      onConfirmado?.();
      onClose();
    },
    onError: () => toast.error("Erro ao confirmar remanejamentos."),
  });

  const toggleTodos = () => {
    if (!resultado) return;
    if (selecionados.size === resultado.remanejamentos.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(resultado.remanejamentos.map(remKey)));
    }
  };

  const toggleItem = (r: Remanejamento) => {
    const k = remKey(r);
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const isLoading = analisarMutation.isPending;
  const isConfirming = confirmarMutation.isPending;
  const semResultado = resultado?.status === "sem_resultado";
  const temResultado = resultado?.status === "ok";
  const totalSelecionados = selecionados.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">Otimizar Regência Global</h2>
              <p className="text-xs text-gray-500">
                Reatribui professores em UCs não iniciadas para maximizar a meta de 70%
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto">

          {/* Painel inicial (antes de analisar) */}
          {!resultado && !isLoading && (
            <div className="p-8 flex flex-col items-center gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center">
                <TrendingUp className="w-8 h-8 text-indigo-500" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-800 mb-1">
                  Análise cruzada de regência
                </h3>
                <p className="text-sm text-gray-500 max-w-md">
                  O sistema analisa todos os eventos ativos e busca a combinação de professores
                  que maximiza o número de Mensalistas atingindo a meta de 70%.
                  Apenas UCs que ainda não tiveram nenhuma aula realizada são candidatas.
                </p>
              </div>

              {/* Opção incluir RPA/PJ */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600 border rounded-lg px-4 py-2.5 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={incluirRpaPj}
                  onChange={(e) => setIncluirRpaPj(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-600"
                />
                Incluir professores RPA/PJ como candidatos
                <span className="text-xs text-gray-400">(apenas se não houver Mensalista ou Horista disponível)</span>
              </label>

              <button
                onClick={() => analisarMutation.mutate()}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                Analisar Agora
              </button>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="p-12 flex flex-col items-center gap-4 text-center">
              <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
              <p className="text-sm font-medium text-gray-700">Analisando disponibilidades e regência...</p>
              <p className="text-xs text-gray-400">Isso pode levar alguns segundos</p>
            </div>
          )}

          {/* Sem resultado */}
          {semResultado && (
            <div className="p-10 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <div>
                <p className="font-medium text-gray-800">Nenhum remanejamento necessário</p>
                <p className="text-sm text-gray-500 mt-1">{resultado!.mensagem}</p>
              </div>
            </div>
          )}

          {/* Resultado */}
          {temResultado && (
            <div className="flex flex-col">

              {/* Resumo */}
              <div className="px-6 py-4 bg-gray-50 border-b grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-800">{resultado!.resumo.total_ucs_livres}</div>
                  <div className="text-xs text-gray-500 mt-0.5">UCs analisadas</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-600">{resultado!.resumo.total_remanejamentos}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Remanejamentos sugeridos</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-500">{resultado!.resumo.mensalistas_na_meta_antes}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Na meta antes</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-600">{resultado!.resumo.mensalistas_na_meta_depois}</div>
                  <div className="text-xs text-gray-500 mt-0.5">Na meta depois</div>
                </div>
              </div>

              {/* Abas */}
              <div className="flex border-b px-6">
                {[
                  { id: "remanejamentos", label: `Remanejamentos (${resultado!.remanejamentos.length})` },
                  { id: "impacto", label: `Impacto (${resultado!.impacto_professores.length})` },
                  { id: "semCandidatos", label: `Sem candidatos (${resultado!.sem_candidatos.length})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setAba(tab.id as typeof aba)}
                    className={cn(
                      "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                      aba === tab.id
                        ? "border-indigo-600 text-indigo-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Aba: Remanejamentos */}
              {aba === "remanejamentos" && (
                <div className="p-4 flex flex-col gap-2">
                  {resultado!.remanejamentos.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">
                      Nenhum remanejamento identificado — a distribuição atual já é ótima.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1 px-1">
                        <span className="text-xs text-gray-500">
                          {totalSelecionados} de {resultado!.remanejamentos.length} selecionados
                        </span>
                        <button
                          onClick={toggleTodos}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          {selecionados.size === resultado!.remanejamentos.length ? "Desmarcar todos" : "Selecionar todos"}
                        </button>
                      </div>
                      {resultado!.remanejamentos.map((r) => {
                        const k = remKey(r);
                        const sel = selecionados.has(k);
                        return (
                          <div
                            key={k}
                            onClick={() => toggleItem(r)}
                            className={cn(
                              "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                              sel ? "border-indigo-300 bg-indigo-50" : "border-gray-200 hover:border-gray-300"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={sel}
                              readOnly
                              className="mt-0.5 w-4 h-4 rounded accent-indigo-600 pointer-events-none"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-gray-400 truncate">{r.evento_nome}</div>
                              <div className="font-medium text-sm text-gray-800 truncate">{r.uc_nome}</div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {r.num_aulas} aulas · {r.horas}h
                              </div>
                            </div>
                            {/* Professor atual → novo */}
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-right">
                                <div className="text-xs text-gray-400">Atual</div>
                                <div className="text-xs font-medium text-gray-600 max-w-[120px] truncate">{r.prof_atual_nome}</div>
                                <div className="mt-0.5">{badgeTipo(r.prof_atual_tipo)}</div>
                              </div>
                              <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                              <div className="text-left">
                                <div className="text-xs text-gray-400">Novo</div>
                                <div className="text-xs font-medium text-indigo-700 max-w-[120px] truncate">{r.prof_novo_nome}</div>
                                <div className="mt-0.5">{badgeTipo(r.prof_novo_tipo)}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {/* Aba: Impacto */}
              {aba === "impacto" && (
                <div className="p-4 flex flex-col gap-3">
                  {resultado!.impacto_professores.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">
                      Nenhum professor Mensalista com impacto significativo.
                    </p>
                  ) : (
                    resultado!.impacto_professores.map((imp) => {
                      const melhora = imp.pct_depois > imp.pct_antes;
                      return (
                        <div key={imp.professor_id} className="border rounded-lg p-3 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">{imp.nome}</span>
                              {badgeTipo(imp.tipo)}
                            </div>
                            <div className="flex items-center gap-1 text-xs">
                              {melhora ? (
                                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                              )}
                              <span className={melhora ? "text-emerald-600" : "text-red-500"}>
                                {melhora ? "+" : ""}{(imp.pct_depois - imp.pct_antes).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                          <BarraRegencia pct={imp.pct_antes} label="Antes" />
                          <BarraRegencia pct={imp.pct_depois} label="Depois" />
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Aba: Sem candidatos */}
              {aba === "semCandidatos" && (
                <div className="p-4 flex flex-col gap-2">
                  {resultado!.sem_candidatos.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">
                      Todas as UCs têm pelo menos um candidato disponível.
                    </p>
                  ) : (
                    resultado!.sem_candidatos.map((sc, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <div>
                          <div className="text-xs text-gray-500">{sc.evento_nome}</div>
                          <div className="text-sm font-medium text-gray-700">{sc.uc_nome}</div>
                          <div className="text-xs text-amber-700 mt-0.5">{sc.motivo}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <div className="flex items-center gap-3">
            {/* Reanalisar com outra configuração */}
            {resultado && !isLoading && (
              <button
                onClick={() => { setResultado(null); setSelecionados(new Set()); }}
                className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
              >
                Reanalisar
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg border hover:bg-gray-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            {temResultado && totalSelecionados > 0 && (
              <button
                onClick={() => confirmarMutation.mutate()}
                disabled={isConfirming}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirmar {totalSelecionados} remanejamento{totalSelecionados !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
