"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmSenhaModal } from "@/components/confirm-senha-modal";

type Tipo = "aulas" | "planejamento" | "ofertas" | "importacao" | "tudo";

const DESCRICOES: Record<Tipo, string> = {
  aulas:        "todas as aulas do cronograma",
  planejamento: "todas as aulas e eventos de planejamento",
  ofertas:      "todas as ofertas SENAI importadas",
  importacao:   "cursos, professores, UCs, atuações e disponibilidades",
  tudo:         "TODOS os dados do banco",
};

const INVALIDA_QUERIES: Record<Tipo, string[]> = {
  aulas:        ["cronograma", "aulas"],
  planejamento: ["cronograma", "aulas", "eventos"],
  ofertas:      ["ofertas"],
  importacao:   ["cursos", "professores", "professores-ativos"],
  tudo:         ["cronograma", "aulas", "eventos", "ofertas", "cursos", "professores", "professores-ativos", "dashboard"],
};

interface Props {
  tipo: Tipo;
  label?: string;
  className?: string;
  onLimpou?: () => void;
}

export function LimparBdButton({ tipo, label, className, onLimpou }: Props) {
  const qc = useQueryClient();
  const [modalAberto, setModalAberto] = useState(false);

  const limpar = useMutation({
    mutationFn: () => adminApi.limpar(tipo),
    onSuccess: (res: any) => {
      toast.success(`Limpeza concluída — ${res.total} registro(s) removido(s).`);
      INVALIDA_QUERIES[tipo].forEach((q) => qc.invalidateQueries({ queryKey: [q] }));
      onLimpou?.();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao limpar banco de dados");
    },
  });

  const me = getCurrentUser();
  if (me?.perfil !== "admin") return null;

  return (
    <>
      <button
        onClick={() => setModalAberto(true)}
        disabled={limpar.isPending}
        className={cn(
          "flex items-center gap-1.5 text-sm text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors disabled:opacity-50",
          className
        )}
      >
        {limpar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {label ?? "Limpar BD"}
      </button>

      {modalAberto && (
        <ConfirmSenhaModal
          titulo={`Limpar ${DESCRICOES[tipo]}?`}
          descricao="Todos os registros serão permanentemente removidos do banco de dados."
          onConfirm={() => { setModalAberto(false); limpar.mutate(); }}
          onCancel={() => setModalAberto(false)}
        />
      )}
    </>
  );
}
