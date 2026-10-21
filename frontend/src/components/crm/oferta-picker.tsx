"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ofertasApi } from "@/lib/api";
import { Search, X } from "lucide-react";

interface Props {
  value: number | null;
  label: string | null;
  onChange: (id: number | null, label: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Busca de oferta de curso por código do evento ou nome do curso. */
export function OfertaPicker({ value, label, onChange, disabled, placeholder = "Buscar curso ou código do evento..." }: Props) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const { data: ofertas = [], isFetching } = useQuery({
    queryKey: ["crm-ofertas-busca", termo],
    queryFn: () => ofertasApi.listar({ busca: termo, limit: 20 }),
    enabled: aberto && termo.length >= 2,
    staleTime: 60_000,
  });

  if (value && !aberto) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm bg-white">
        <span className="flex-1 truncate" title={label ?? ""}>{label ?? `Oferta #${value}`}</span>
        {!disabled && (
          <>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAberto(true)}>Trocar</button>
            <button type="button" className="text-gray-400 hover:text-red-500" title="Remover curso" onClick={() => onChange(null, null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
      <input
        className="input pl-8"
        placeholder={placeholder}
        value={busca}
        disabled={disabled}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onChange={(e) => setBusca(e.target.value)}
      />
      {aberto && termo.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-white shadow-lg text-sm">
          {isFetching && <p className="px-3 py-2 text-gray-400">Buscando...</p>}
          {!isFetching && (ofertas as any[]).length === 0 && <p className="px-3 py-2 text-gray-400">Nenhuma oferta encontrada</p>}
          {(ofertas as any[]).map((o: any) => {
            const lbl = `${o.codigo_evento} – ${o.nome_curso}`;
            return (
              <button
                key={o.id}
                type="button"
                className="block w-full text-left px-3 py-2 hover:bg-gray-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(o.id, lbl); setBusca(""); setAberto(false); }}
              >
                <span className="font-mono text-xs text-gray-500 mr-1">{o.codigo_evento}</span>
                {o.nome_curso}
                {o.turno && <span className="ml-1 text-xs text-gray-400">· {o.turno}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
