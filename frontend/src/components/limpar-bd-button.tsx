"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [confirmando, setConfirmando] = useState(false);

  const limpar = useMutation({
    mutationFn: () => adminApi.limpar(tipo),
    onSuccess: (res: any) => {
      toast.success(`Limpeza concluída — ${res.total} registro(s) removido(s).`);
      INVALIDA_QUERIES[tipo].forEach((q) => qc.invalidateQueries({ queryKey: [q] }));
      setConfirmando(false);
      onLimpou?.();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao limpar banco de dados");
      setConfirmando(false);
    },
  });

  const me = getCurrentUser();
  if (me?.perfil !== "admin") return null;

  if (confirmando) {
    return (
      <div className="flex items-center gap-2 border border-red-200 bg-red-50 rounded-lg px-3 py-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        <span className="text-xs text-red-700">
          Apagar {DESCRICOES[tipo]}?
        </span>
        <button
          onClick={() => limpar.mutate()}
          disabled={limpar.isPending}
          className="ml-1 text-xs font-semibold text-red-700 hover:text-red-900 flex items-center gap-1"
        >
          {limpar.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Confirmar
        </button>
        <button
          onClick={() => setConfirmando(false)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      className={cn(
        "flex items-center gap-1.5 text-sm text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors",
        className
      )}
    >
      <Trash2 className="h-4 w-4" />
      {label ?? "Limpar BD"}
    </button>
  );
}
