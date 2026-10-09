"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { contratoVirtualApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { FileSignature, Check, Ban, ChevronDown, ChevronUp, User, Calendar, Loader2 } from "lucide-react";
import { toast } from "sonner";

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_CLS: Record<string, string> = {
  pendente:  "bg-amber-50 text-amber-700 border-amber-200",
  aprovado:  "bg-green-50 text-green-700 border-green-200",
  rejeitado: "bg-red-50 text-red-600 border-red-200",
};

export default function ContratosVirtuaisPage() {
  const qc = useQueryClient();
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [filtroStatus, setFiltroStatus] = useState<"pendente" | "todos">("pendente");

  const { data: pendentes = [], isLoading, isError } = useQuery({
    queryKey: ["contratos-virtuais-pendentes"],
    queryFn: () => contratoVirtualApi.pendentes(),
    refetchInterval: 30_000,
  });

  const aprovarMutation = useMutation({
    mutationFn: ({ professorId, cvId, acao }: { professorId: number; cvId: number; acao: "aprovar" | "rejeitar" }) =>
      contratoVirtualApi.aprovar(professorId, cvId, acao),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contratos-virtuais-pendentes"] });
      qc.invalidateQueries({ queryKey: ["contratos-virtuais"] });
      toast.success(vars.acao === "aprovar" ? "Contrato aprovado!" : "Contrato rejeitado.");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao processar"),
  });

  function toggleExpand(id: number) {
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const lista = (pendentes as any[]).filter(cv =>
    filtroStatus === "todos" ? true : cv.status === filtroStatus
  );

  const totalPendente = (pendentes as any[]).filter(cv => cv.status === "pendente").length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Contratos Virtuais"
        description="Aprovação de registros de docentes sem contrato formal ou com diferença de horas."
      />

      {/* Filtro */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setFiltroStatus("pendente")}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
            filtroStatus === "pendente"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-white text-gray-600 border-gray-200 hover:border-amber-200"
          )}
        >
          Pendentes
          {totalPendente > 0 && (
            <span className="ml-1.5 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full font-semibold">
              {totalPendente}
            </span>
          )}
        </button>
        <button
          onClick={() => setFiltroStatus("todos")}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
            filtroStatus === "todos"
              ? "bg-primary text-white border-primary"
              : "bg-white text-gray-600 border-gray-200 hover:border-primary"
          )}
        >
          Todos
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
        </div>
      ) : isError ? (
        <div className="card py-12 text-center text-red-500">
          Erro ao carregar contratos virtuais. Verifique sua conexão.
        </div>
      ) : lista.length === 0 ? (
        <div className="card py-16 text-center text-gray-400">
          <FileSignature className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">
            {filtroStatus === "pendente" ? "Nenhum contrato aguardando aprovação." : "Nenhum contrato cadastrado."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map((cv: any) => {
            const aberto = expandidos.has(cv.id);
            return (
              <div key={cv.id} className="card overflow-hidden">
                {/* Cabeçalho */}
                <div
                  className="flex items-start justify-between gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleExpand(cv.id)}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 text-sm truncate">{cv.professor_nome}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{cv.modalidade}</p>
                      {cv.evento_nome && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">Evento: {cv.evento_nome}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", STATUS_CLS[cv.status] ?? "bg-gray-50 text-gray-600 border-gray-200")}>
                      {cv.status}
                    </span>
                    {aberto ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                  </div>
                </div>

                {/* Detalhes expandidos */}
                {aberto && (
                  <div className="border-t border-gray-100 p-4 bg-gray-50/50 space-y-4">
                    {/* Dados pessoais */}
                    <div>
                      <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wide mb-2">Dados Pessoais</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                        <div>
                          <span className="text-gray-400">Nome completo: </span>
                          <span className="text-gray-700 font-medium">{cv.nome_completo}</span>
                        </div>
                        {cv.cpf && (
                          <div>
                            <span className="text-gray-400">CPF: </span>
                            <span className="text-gray-700 font-medium font-mono">{cv.cpf}</span>
                          </div>
                        )}
                        {cv.conta_corrente && (
                          <div>
                            <span className="text-gray-400">Conta corrente: </span>
                            <span className="text-gray-700 font-medium">{cv.conta_corrente}</span>
                          </div>
                        )}
                        {cv.email && (
                          <div>
                            <span className="text-gray-400">E-mail: </span>
                            <span className="text-gray-700 font-medium">{cv.email}</span>
                          </div>
                        )}
                        {cv.telefone && (
                          <div>
                            <span className="text-gray-400">Telefone: </span>
                            <span className="text-gray-700 font-medium">{cv.telefone}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* UCs */}
                    {cv.ucs && cv.ucs.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wide mb-2">Unidades Curriculares</p>
                        <div className="flex flex-wrap gap-1.5">
                          {cv.ucs.map((u: any) => (
                            <span key={u.uc_id} className="bg-blue-50 text-blue-700 text-[11px] px-2 py-0.5 rounded border border-blue-100">
                              {u.uc_nome}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Justificativa */}
                    <div>
                      <p className="text-[10px] uppercase font-semibold text-gray-400 tracking-wide mb-1">Justificativa</p>
                      <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{cv.justificativa}</p>
                    </div>

                    {/* Rodapé: data de criação + ações */}
                    <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-1 text-[11px] text-gray-400">
                        <Calendar className="h-3 w-3" />
                        <span>Enviado em {fmtDateTime(cv.criado_em)}</span>
                      </div>

                      {cv.status !== "pendente" ? (
                        <p className="text-[11px] text-gray-400">
                          {cv.status === "aprovado" ? "Aprovado" : "Rejeitado"} por {cv.aprovado_por}
                          {cv.aprovado_em ? ` em ${fmtDateTime(cv.aprovado_em)}` : ""}
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => aprovarMutation.mutate({ professorId: cv.professor_id, cvId: cv.id, acao: "rejeitar" })}
                            disabled={aprovarMutation.isPending}
                            className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                          >
                            <Ban className="h-3.5 w-3.5" /> Rejeitar
                          </button>
                          <button
                            onClick={() => aprovarMutation.mutate({ professorId: cv.professor_id, cvId: cv.id, acao: "aprovar" })}
                            disabled={aprovarMutation.isPending}
                            className="flex items-center gap-1.5 text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" /> Aprovar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
