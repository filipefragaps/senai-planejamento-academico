"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { professoresApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { RegenciaBar } from "@/components/regencia-bar";
import { ProfessorDrawer } from "@/components/professor-drawer";
import {
  Plus, Search, X, Pencil, ChevronRight, Clock, BookOpen, User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DIAS_ABREV = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DIAS_COR: Record<number, string> = {
  0: "bg-blue-100 text-blue-700",
  1: "bg-indigo-100 text-indigo-700",
  2: "bg-violet-100 text-violet-700",
  3: "bg-purple-100 text-purple-700",
  4: "bg-fuchsia-100 text-fuchsia-700",
  5: "bg-orange-100 text-orange-700",
  6: "bg-rose-100 text-rose-700",
};

const MODALIDADE_STYLES: Record<string, string> = {
  "habilitação técnica":                             "bg-blue-50 text-blue-700",
  "qualificação profissional":                       "bg-amber-50 text-amber-700",
  "habilitação técnica e qualificação profissional": "bg-indigo-50 text-indigo-700",
};

function ModalidadeTag({ modalidade }: { modalidade: string }) {
  const style = MODALIDADE_STYLES[modalidade.toLowerCase()] || "bg-gray-100 text-gray-600";
  return (
    <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium shrink-0", style)}>
      {modalidade}
    </span>
  );
}

function groupByDia(disp: any[]) {
  const map: Record<number, any[]> = {};
  for (const d of disp) {
    if (!map[d.dia_semana]) map[d.dia_semana] = [];
    map[d.dia_semana].push(d);
  }
  return Object.entries(map)
    .sort(([a], [b]) => +a - +b)
    .map(([dia, items]) => ({ dia: +dia, items }));
}

export default function ProfessoresPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [drawer, setDrawer] = useState<null | "new" | any>(null);
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 15;

  const { data: professores = [], isLoading } = useQuery({
    queryKey: ["professores"],
    queryFn: () => professoresApi.listar(),
  });

  const { data: regencias = [] } = useQuery({
    queryKey: ["regencias"],
    queryFn: () => professoresApi.regencias(),
  });

  const { data: detalhes, isLoading: loadingDetalhes } = useQuery({
    queryKey: ["professor-detalhes", selected?.id],
    queryFn: () => professoresApi.detalhes(selected!.id),
    enabled: !!selected,
  });

  const regMap: Record<number, any> = {};
  regencias.forEach((r: any) => { regMap[r.professor_id] = r; });

  const filtered = professores.filter((p: any) =>
    p.nome.toLowerCase().includes(search.toLowerCase()) ||
    (p.especialidades || "").toLowerCase().includes(search.toLowerCase())
  );
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const gruposDia = groupByDia(detalhes?.disponibilidades || []);

  function handleDrawerSaved(prof: any) {
    qc.invalidateQueries({ queryKey: ["professores"] });
    qc.invalidateQueries({ queryKey: ["professor-detalhes", prof?.id] });
    if (drawer !== "new") {
      // update selected so panel shows fresh name/tipo
      setSelected((prev: any) => (prev ? { ...prev, ...prof } : prev));
    }
    setDrawer(null);
  }

  return (
    <div className="flex gap-6 h-full">
      {/* ─── Lista ─── */}
      <div className={cn("flex-1 min-w-0 transition-all", selected ? "max-w-[52%]" : "")}>
        <PageHeader title="Professores" description="Gestão de professores e regência docente">
          <button
            onClick={() => setDrawer("new")}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> Novo Professor
          </button>
        </PageHeader>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input pl-9 max-w-sm w-full"
            placeholder="Buscar professor ou especialidade..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPagina(1); }}
          />
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Carregando...</div>
        ) : (
          <div className="space-y-2">
            {paginados.map((p: any) => {
              const reg = regMap[p.id];
              const isSelected = selected?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelected(isSelected ? null : p)}
                  className={cn(
                    "card p-4 cursor-pointer transition-all",
                    isSelected ? "border-primary border-l-4 bg-blue-50/50" : "hover:shadow-sm"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{p.nome}</span>
                        <span className={cn(
                          "badge text-xs",
                          p.tipo === "Mensalista" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                        )}>
                          {p.tipo}
                        </span>
                        {p.especialidades && (
                          <span className="text-xs text-gray-400 truncate">{p.especialidades}</span>
                        )}
                      </div>
                      {reg && (
                        <div className="mt-2 max-w-xs">
                          <RegenciaBar percentual={reg.percentual_regencia} meta={reg.meta_regencia} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <span className="text-xs text-gray-400">{p.horas_contratadas}h/sem</span>
                      <ChevronRight className={cn(
                        "h-4 w-4 text-gray-300 transition-transform",
                        isSelected && "rotate-90 text-primary"
                      )} />
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-gray-400">Nenhum professor encontrado.</div>
            )}
          </div>
        )}

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{filtered.length} professor(es) · página {paginaAtual} de {totalPaginas}</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaAtual === 1}
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ←
              </button>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPaginas || Math.abs(p - paginaAtual) <= 1)
                .reduce<(number | "…")[]>((acc, p, i, arr) => {
                  if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === "…" ? (
                    <span key={`e${i}`} className="px-2 py-1.5">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPagina(p as number)}
                      className={cn(
                        "px-3 py-1.5 rounded border transition-colors",
                        paginaAtual === p
                          ? "bg-[#003B8E] text-white border-[#003B8E]"
                          : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaAtual === totalPaginas}
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Painel de detalhe (leitura) ─── */}
      {selected && (
        <div className="w-[48%] shrink-0">
          <div className="card flex flex-col h-full max-h-[calc(100vh-120px)]">

            {/* Cabeçalho */}
            <div className="p-5 border-b">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <User className="h-4 w-4 text-primary shrink-0" />
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
                    {selected.nome}
                  </h3>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => setDrawer(detalhes || selected)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary"
                    title="Editar professor"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="p-1.5 rounded hover:bg-gray-100 text-gray-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "badge text-xs",
                  selected.tipo === "Mensalista" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                )}>
                  {selected.tipo}
                </span>
                <span className="text-xs text-gray-500">
                  {selected.horas_contratadas}h contratadas/semana
                </span>
              </div>
              {selected.especialidades && (
                <p className="text-xs text-gray-400 mt-1">{selected.especialidades}</p>
              )}
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto">
              {loadingDetalhes ? (
                <div className="text-center py-8 text-gray-400 text-sm">Carregando...</div>
              ) : (
                <>
                  {/* Disponibilidade */}
                  <div className="p-4 border-b">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Disponibilidade
                      </span>
                    </div>
                    {gruposDia.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        Nenhuma disponibilidade cadastrada.{" "}
                        <button onClick={() => setDrawer(detalhes || selected)} className="text-primary underline">
                          Adicionar
                        </button>
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {gruposDia.map(({ dia, items }) => (
                          <div key={dia} className="flex items-start gap-3">
                            <span className={cn(
                              "text-xs font-bold px-2 py-0.5 rounded w-9 text-center shrink-0",
                              DIAS_COR[dia] || "bg-gray-100 text-gray-600"
                            )}>
                              {DIAS_ABREV[dia]}
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {items.map((d: any) => (
                                <span
                                  key={d.id}
                                  className={cn(
                                    "text-xs px-2 py-0.5 rounded-full border",
                                    d.tipo === "Disponível"
                                      ? "bg-green-50 text-green-700 border-green-200"
                                      : "bg-red-50 text-red-600 border-red-200 line-through"
                                  )}
                                >
                                  {d.horario_inicio} – {d.horario_fim}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* UCs por curso */}
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Unidades Curriculares que pode ministrar
                      </span>
                    </div>
                    {(!detalhes?.atuacoes_por_curso || detalhes.atuacoes_por_curso.length === 0) ? (
                      <p className="text-xs text-gray-400 italic">
                        Nenhuma atuação cadastrada.{" "}
                        <button onClick={() => setDrawer(detalhes || selected)} className="text-primary underline">
                          Adicionar
                        </button>
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {detalhes.atuacoes_por_curso.map((grupo: any) => (
                          <div key={grupo.curso_id ?? "sem-curso"}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-bold text-primary">{grupo.curso_nome}</span>
                              {grupo.curso_codigo && (
                                <span className="text-xs font-mono text-gray-400">({grupo.curso_codigo})</span>
                              )}
                            </div>
                            <div className="space-y-1.5 pl-2 border-l-2 border-blue-100">
                              {grupo.atuacoes.map((at: any) => (
                                <div key={at.id} className="flex items-start gap-2">
                                  <p className="text-xs text-gray-700 leading-tight flex-1">{at.nome}</p>
                                  {at.modalidade && (
                                    <ModalidadeTag modalidade={at.modalidade} />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer de criação / edição ─── */}
      {drawer !== null && (
        <ProfessorDrawer
          professor={drawer === "new" ? null : drawer}
          onClose={() => setDrawer(null)}
          onSaved={handleDrawerSaved}
        />
      )}
    </div>
  );
}
