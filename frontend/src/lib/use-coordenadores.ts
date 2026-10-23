"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { professoresApi } from "@/lib/api";

export const COORDENADORES_KEY = ["coordenadores"];

/** Coordenadores de curso cadastrados em Professores (ativos e marcados como coordenador). */
export function useCoordenadores() {
  const { data = [], isLoading } = useQuery<{ id: number; nome: string; area: string | null }[]>({
    queryKey: COORDENADORES_KEY,
    queryFn: professoresApi.coordenadores,
    staleTime: 60_000,
  });
  return { coordenadores: data, nomes: data.map((c) => c.nome), isLoading };
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
