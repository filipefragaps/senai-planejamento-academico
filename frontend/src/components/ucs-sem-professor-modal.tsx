"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { planejamentoApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Loader2, UserSearch, AlertTriangle, CheckCircle2, Search, Clock } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Candidato {
  professor_id: number;
  nome: string;
  tipo: string;
  foto: string | null;
  disponivel: boolean;
  choques: number;
  horas_periodo: number;
  carga_pct: number | null;
  carga_pct_depois: number | null;
}

interface UcSemProfessor {
  evento_id: number;
  evento_nome: string;
  uc_id: number;
  uc_nome: string;
  num_aulas: number;
  horas: number;
  data_inicio: string;
  data_fim: string;
  candidatos: Candidato[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function badgeTipo(tipo: string) {
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

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

// ── Componente principal ───────────────────────────────────────────────────────

export function UcsSemProfessorModal({ onClose, onAtribuido }: { onClose: () => void; onAtribuido?: () => void }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [soSemCandidato, setSoSemCandidato] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["ucs-sem-professor"],
    queryFn: planejamentoApi.ucsSemProfessor,
  });
  const ucs: UcSemProfessor[] = data?.ucs ?? [];

  const atribuir = useMutation({
    mutationFn: (v: { uc: UcSemProfessor; c: Candidato }) =>
      planejamentoApi.atribuirUcSemProfessor(v.uc.evento_id, v.uc.uc_id, v.c.professor_id),
    onSuccess: (r, v) => {
      toast.success(`${v.c.nome} atribuído(a) a ${v.uc.uc_nome} — ${r.aulas_atualizadas} aula(s).`);
      setAberta(null);
      qc.invalidateQueries({ queryKey: ["ucs-sem-professor"] });
      onAtribuido?.();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? "Erro ao atribuir professor."),
  });

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return ucs.filter((u) =>
      (!soSemCandidato || u.candidatos.length === 0) &&
      (!termo || `${u.evento_nome} ${u.uc_nome}`.toLowerCase().includes(termo))
    );
  }, [ucs, busca, soSemCandidato]);
  const semCandidato = ucs.filter((u) => u.candidatos.length === 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center">
              <UserSearch className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">UCs sem Professor</h2>
              <p className="text-xs text-gray-500">
                Aulas futuras sem professor e quem tem a UC cadastrada na aba Professor
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filtros */}
        {!isLoading && ucs.length > 0 && (
          <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar evento ou UC..."
                className="input pl-8 py-1.5 text-sm w-full"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={soSemCandidato} onChange={(e) => setSoSemCandidato(e.target.checked)}
                className="w-3.5 h-3.5 accent-teal-600" />
              Só sem candidato ({semCandidato})
            </label>
            <span className="text-xs text-gray-500">{filtradas.length} de {ucs.length} UC(s)</span>
          </div>
        )}

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {isLoading && (
            <div className="p-12 flex flex-col items-center gap-3 text-center">
              <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
              <p className="text-sm text-gray-600">Buscando UCs sem professor...</p>
            </div>
          )}
          {isError && <p className="text-sm text-red-500 text-center py-6">Erro ao carregar as UCs.</p>}
          {!isLoading && !isError && ucs.length === 0 && (
            <div className="p-10 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-medium text-gray-800">Todas as aulas futuras têm professor.</p>
            </div>
          )}

          {filtradas.map((u) => {
            const k = `${u.evento_id}_${u.uc_id}`;
            const expandida = aberta === k;
            const melhor = u.candidatos[0];
            return (
              <div key={k} className={cn("rounded-lg border", expandida ? "border-teal-300" : "border-gray-200")}>
                <button
                  onClick={() => setAberta(expandida ? null : k)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-gray-50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-400 truncate">{u.evento_nome}</div>
                    <div className="font-medium text-sm text-gray-800 truncate">{u.uc_nome}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {u.num_aulas} aulas · {u.horas}h · {formatDate(u.data_inicio)} a {formatDate(u.data_fim)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {u.candidatos.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                        <AlertTriangle className="w-3 h-3" /> Nenhum professor com a UC
                      </span>
                    ) : (
                      <>
                        <div className="text-xs text-teal-700 font-medium">
                          {u.candidatos.length} candidato{u.candidatos.length !== 1 ? "s" : ""}
                        </div>
                        <div className="text-[11px] text-gray-500 max-w-[180px] truncate">Melhor: {melhor.nome}</div>
                      </>
                    )}
                  </div>
                </button>

                {expandida && (
                  <div className="border-t px-3 py-2 flex flex-col gap-1.5 bg-gray-50/60">
                    {u.candidatos.length === 0 ? (
                      <p className="text-xs text-gray-500 py-2">
                        Nenhum professor ativo tem esta UC cadastrada. Cadastre a UC na aba Professor de quem pode ministrá-la.
                      </p>
                    ) : (
                      u.candidatos.map((c) => (
                        <div key={c.professor_id} className="flex items-center gap-3 rounded-lg bg-white border border-gray-200 px-3 py-2">
                          {c.foto ? (
                            <img src={c.foto} alt={c.nome} className="w-9 h-9 rounded-lg object-cover object-top shrink-0 border border-gray-200" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-primary">{iniciais(c.nome)}</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-gray-800 truncate">{c.nome}</span>
                              {badgeTipo(c.tipo)}
                            </div>
                            <div className="flex flex-wrap gap-x-3 text-[11px] mt-0.5">
                              {c.choques > 0 ? (
                                <span className="text-red-600">Choque em {c.choques} aula(s)</span>
                              ) : (
                                <span className="text-emerald-600">Sem choque de horário</span>
                              )}
                              {!c.disponivel && <span className="text-amber-600">Fora da disponibilidade cadastrada</span>}
                              {c.carga_pct !== null && (
                                <span className="text-gray-500 inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Carga no período {c.carga_pct.toFixed(0)}% → {c.carga_pct_depois?.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => atribuir.mutate({ uc: u, c })}
                            disabled={atribuir.isPending}
                            className={cn(
                              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50",
                              c.choques > 0
                                ? "border border-gray-300 text-gray-600 hover:bg-gray-100"
                                : "bg-teal-600 text-white hover:bg-teal-700"
                            )}
                            title={c.choques > 0 ? "Atribuir mesmo com choque de horário" : "Atribuir este professor"}
                          >
                            {atribuir.isPending && atribuir.variables?.c.professor_id === c.professor_id &&
                              atribuir.variables?.uc.uc_id === u.uc_id ? "..." : "Atribuir"}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg border hover:bg-gray-100">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
