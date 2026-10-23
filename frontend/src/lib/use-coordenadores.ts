"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { professoresApi } from "@/lib/api";

export const COORDENADORES_KEY = ["coordenadores"];

export type Coordenador = { id: number | null; nome: string; area: string | null; cadastrado: boolean };

/**
 * Coordenadores para as listas de seleção: os cadastrados em Professores e, marcados como
 * não cadastrados, os nomes já usados nas ofertas (e da antiga lista fixa) — nenhum some.
 */
export function useCoordenadores() {
  const { data = [], isLoading } = useQuery<Coordenador[]>({
    queryKey: COORDENADORES_KEY,
    queryFn: professoresApi.coordenadores,
    staleTime: 60_000,
  });
  return {
    coordenadores: data,
    nomes: data.map((c) => c.nome),
    naoCadastrados: new Set(data.filter((c) => !c.cadastrado).map((c) => c.nome)),
    isLoading,
  };
}

/** Atualiza todas as listas que dependem dos coordenadores (seleções e filtros). */
export function useAtualizarListasCoordenadores() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: COORDENADORES_KEY });
    qc.invalidateQueries({ queryKey: ["ofertas-stats"] });
    qc.invalidateQueries({ queryKey: ["ofertas-stats-coordenadores"] });
  };
}
