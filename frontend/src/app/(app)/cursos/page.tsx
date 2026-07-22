"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cursosApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { Plus, Search, ChevronRight, X, BookOpen, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const MODULO_ORDER: Record<string, number> = {
  "básico": 0, "basico": 0,
  "específico i": 1, "especifico i": 1,
  "específico ii": 2, "especifico ii": 2,
  "específico iii": 3, "especifico iii": 3,
  "específico iv": 4, "especifico iv": 4,
};

function sortModulo(a: string, b: string) {
  const ka = MODULO_ORDER[a?.toLowerCase()] ?? 99;
  const kb = MODULO_ORDER[b?.toLowerCase()] ?? 99;
  return ka !== kb ? ka - kb : a.localeCompare(b);
}

function groupByModulo(ucs: any[]) {
  const map: Record<string, any[]> = {};
  for (const uc of ucs) {
    const m = uc.modulo_etapa || "Sem módulo";
    if (!map[m]) map[m] = [];
    map[m].push(uc);
  }
  return Object.entries(map).sort(([a], [b]) => sortModulo(a, b));
}

export default function CursosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 20;
  const [form, setForm] = useState({
    nome: "", codigo: "", carga_horaria_total: 200, modalidade: "Presencial", area: "",
  });

  const { data: cursos = [], isLoading } = useQuery({
    queryKey: ["cursos"],
    queryFn: () => cursosApi.listar(),
  });

  const { data: ucs = [], isLoading: loadingUcs } = useQuery({
    queryKey: ["ucs", selected?.id],
    queryFn: () => cursosApi.ucs(selected!.id),
    enabled: !!selected,
  });

  const criar = useMutation({
    mutationFn: (data: any) => cursosApi.criar(data),
    onSuccess: () => {
      toast.success("Curso cadastrado!");
      qc.invalidateQueries({ queryKey: ["cursos"] });
      setShowForm(false);
      setForm({ nome: "", codigo: "", carga_horaria_total: 200, modalidade: "Presencial", area: "" });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao cadastrar"),
  });

  const filtered = cursos.filter((c: any) =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.codigo.toLowerCase().includes(search.toLowerCase())
  );
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const grupos = groupByModulo(ucs);
  const totalPresencial = ucs.filter((u: any) => u.tipo?.toLowerCase() === "presencial").reduce((s: number, u: any) => s + (u.carga_horaria || 0), 0);
  const totalEad = ucs.filter((u: any) => u.tipo?.toLowerCase() === "ead").reduce((s: number, u: any) => s + (u.carga_horaria || 0), 0);

  return (
    <div className="flex gap-6 h-full">
      {/* Lista de cursos */}
      <div className={cn("flex-1 min-w-0 transition-all", selected ? "max-w-[55%]" : "")}>
        <PageHeader title="Cursos" description="Catálogo de cursos do SENAI">
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Novo Curso
          </button>
        </PageHeader>

        {showForm && (
          <div className="card p-5 mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">Novo Curso</h3>
            <form onSubmit={(e) => { e.preventDefault(); criar.mutate(form); }} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
                <input className="input w-full" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Código (PASTA) *</label>
                <input className="input w-full" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required placeholder="Ex: 18144" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Carga Horária Total (h)</label>
                <input type="number" className="input w-full" value={form.carga_horaria_total} onChange={(e) => setForm({ ...form, carga_horaria_total: +e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Modalidade</label>
                <select className="input w-full" value={form.modalidade} onChange={(e) => setForm({ ...form, modalidade: e.target.value })}>
                  <option>Presencial</option><option>EAD</option><option>Híbrido</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Área</label>
                <input className="input w-full" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </div>
              <div className="flex items-end gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
                <button type="submit" disabled={criar.isPending} className="btn-primary">{criar.isPending ? "Salvando..." : "Salvar"}</button>
              </div>
            </form>
          </div>
        )}

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="input pl-9 max-w-sm" placeholder="Buscar curso..." value={search} onChange={(e) => { setSearch(e.target.value); setPagina(1); }} />
        </div>

        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Carregando...</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Código</th>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">CH Total</th>
                  <th className="px-4 py-3 text-left">Modalidade</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginados.map((c: any) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}
                    className={cn(
                      "cursor-pointer transition-colors",
                      selected?.id === c.id
                        ? "bg-blue-50 border-l-2 border-primary"
                        : "hover:bg-gray-50"
                    )}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.codigo}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                    <td className="px-4 py-3 text-gray-600">{c.carga_horaria_total}h</td>
                    <td className="px-4 py-3">
                      <span className="badge bg-blue-50 text-blue-700">{c.modalidade}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("badge", c.ativo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                        {c.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className={cn("h-4 w-4 text-gray-400 transition-transform", selected?.id === c.id && "rotate-90 text-primary")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="text-center py-10 text-gray-400">Nenhum curso encontrado.</div>}
          </div>
        )}

        {/* Paginação */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{filtered.length} curso(s) · página {paginaAtual} de {totalPaginas}</span>
            <div className="flex gap-1">
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={paginaAtual === 1}
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">←</button>
              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPaginas || Math.abs(p - paginaAtual) <= 1)
                .reduce<(number | "…")[]>((acc, p, i, arr) => {
                  if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p); return acc;
                }, [])
                .map((p, i) => p === "…"
                  ? <span key={`e${i}`} className="px-2 py-1.5">…</span>
                  : <button key={p} onClick={() => setPagina(p as number)}
                      className={cn("px-3 py-1.5 rounded border transition-colors",
                        paginaAtual === p ? "bg-[#003B8E] text-white border-[#003B8E]" : "border-gray-200 hover:bg-gray-50")}>
                      {p}
                    </button>
                )}
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">→</button>
            </div>
          </div>
        )}
      </div>

      {/* Painel de detalhe — Estrutura Curricular */}
      {selected && (
        <div className="w-[45%] shrink-0">
          <div className="card h-full flex flex-col">
            {/* Cabeçalho do painel */}
            <div className="flex items-start justify-between p-5 border-b">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-xs font-mono text-gray-400">{selected.codigo}</span>
                </div>
                <h3 className="font-semibold text-gray-900 text-sm leading-tight">{selected.nome}</h3>
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  <span>Total: <strong className="text-gray-800">{selected.carga_horaria_total}h</strong></span>
                  {totalPresencial > 0 && <span>Presencial: <strong className="text-blue-700">{totalPresencial}h</strong></span>}
                  {totalEad > 0 && <span>EaD: <strong className="text-purple-700">{totalEad}h</strong></span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-gray-100 shrink-0">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingUcs ? (
                <div className="text-center py-8 text-gray-400 text-sm">Carregando estrutura curricular...</div>
              ) : ucs.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  Nenhuma UC importada para este curso.
                </div>
              ) : (
                grupos.map(([modulo, items]) => (
                  <div key={modulo}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-primary uppercase tracking-wide">{modulo}</span>
                      <div className="flex-1 h-px bg-blue-100" />
                      <span className="text-xs text-gray-400">
                        {items.reduce((s, u) => s + (u.carga_horaria || 0), 0)}h
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map((uc: any) => (
                        <div key={uc.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 group">
                          <span className="text-xs font-mono text-gray-400 w-14 shrink-0 pt-0.5">{uc.codigo_uc}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 leading-tight">{uc.nome}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={cn(
                              "text-xs px-1.5 py-0.5 rounded font-medium",
                              uc.tipo?.toLowerCase() === "ead"
                                ? "bg-purple-50 text-purple-600"
                                : "bg-blue-50 text-blue-600"
                            )}>
                              {uc.tipo}
                            </span>
                            <span className="text-xs text-gray-400 w-8 text-right">{uc.carga_horaria}h</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
