"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cursosApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  Plus, Search, ChevronRight, X, BookOpen, Layers,
  Pencil, Trash2, ArrowUp, ArrowDown, Check, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constantes ────────────────────────────────────────────────────────────────

const TIPOS_CURSO = [
  "Habilitação Técnica",
  "FIC",
  "Qualificação Profissional",
  "Aperfeiçoamento",
  "Especialização Técnica",
  "Pós-Técnico",
];

const MODULOS_PADRAO = [
  "Básico",
  "Específico I",
  "Específico II",
  "Específico III",
  "Específico IV",
];

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
    const m = uc.modulo_etapa || "Etapa Única";
    if (!map[m]) map[m] = [];
    map[m].push(uc);
  }
  return Object.entries(map).sort(([a], [b]) => sortModulo(a, b));
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Curso {
  id: number; nome: string; codigo: string; tipo: string;
  carga_horaria_total: number; modalidade: string; area: string | null;
  descricao: string | null; ativo: boolean;
}

interface UC {
  id: number; curso_id: number; codigo_uc: string; nome: string;
  tipo: string; modulo_etapa: string | null; sequencia: number | null;
  carga_horaria: number;
}

const FORM_VAZIO_CURSO = {
  nome: "", codigo: "", tipo: "Habilitação Técnica",
  carga_horaria_total: 200, modalidade: "Presencial", area: "",
};

const FORM_VAZIO_UC = {
  nome: "", codigo_uc: "", tipo: "Presencial",
  modulo_etapa: "", novoModulo: "", carga_horaria: 0,
};

// ── Componente principal ──────────────────────────────────────────────────────

export default function CursosPage() {
  const qc = useQueryClient();

  // Listagem
  const [search, setSearch] = useState("");
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 20;

  // Seleção e painel
  const [selected, setSelected] = useState<Curso | null>(null);

  // Formulário de novo curso
  const [showForm, setShowForm] = useState(false);
  const [formCurso, setFormCurso] = useState(FORM_VAZIO_CURSO);

  // Edição inline do curso selecionado
  const [editandoCurso, setEditandoCurso] = useState(false);
  const [formEdicaoCurso, setFormEdicaoCurso] = useState<Partial<Curso>>({});

  // UC em edição
  const [ucEditId, setUcEditId] = useState<number | "new" | null>(null);
  const [ucModuloNovo, setUcModuloNovo] = useState<string | null>(null); // módulo alvo para "nova UC"
  const [formUc, setFormUc] = useState(FORM_VAZIO_UC);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: cursos = [], isLoading } = useQuery<Curso[]>({
    queryKey: ["cursos"],
    queryFn: () => cursosApi.listar(),
  });

  const { data: ucs = [], isLoading: loadingUcs } = useQuery<UC[]>({
    queryKey: ["ucs", selected?.id],
    queryFn: () => cursosApi.ucs(selected!.id),
    enabled: !!selected,
  });

  const grupos = useMemo(() => groupByModulo(ucs), [ucs]);
  const modulosExistentes = useMemo(
    () => Array.from(new Set(ucs.map((u) => u.modulo_etapa || "Etapa Única"))).sort(sortModulo),
    [ucs]
  );

  const totalPresencial = ucs.filter((u) => u.tipo?.toLowerCase() === "presencial").reduce((s, u) => s + (u.carga_horaria || 0), 0);
  const totalEad = ucs.filter((u) => u.tipo?.toLowerCase() === "ead").reduce((s, u) => s + (u.carga_horaria || 0), 0);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const criarCurso = useMutation({
    mutationFn: (data: any) => cursosApi.criar(data),
    onSuccess: (novo) => {
      toast.success("Curso cadastrado!");
      qc.invalidateQueries({ queryKey: ["cursos"] });
      setShowForm(false);
      setFormCurso(FORM_VAZIO_CURSO);
      setSelected(novo);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao cadastrar"),
  });

  const atualizarCurso = useMutation({
    mutationFn: (data: any) => cursosApi.atualizar(selected!.id, data),
    onSuccess: (atualizado) => {
      toast.success("Curso atualizado!");
      qc.invalidateQueries({ queryKey: ["cursos"] });
      setSelected(atualizado);
      setEditandoCurso(false);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao atualizar"),
  });

  const criarUc = useMutation({
    mutationFn: (data: any) => cursosApi.criarUc(selected!.id, data),
    onSuccess: () => {
      toast.success("UC adicionada!");
      qc.invalidateQueries({ queryKey: ["ucs", selected!.id] });
      setUcEditId(null);
      setUcModuloNovo(null);
      setFormUc(FORM_VAZIO_UC);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao criar UC"),
  });

  const atualizarUc = useMutation({
    mutationFn: ({ ucId, data }: { ucId: number; data: any }) =>
      cursosApi.atualizarUc(selected!.id, ucId, data),
    onSuccess: () => {
      toast.success("UC atualizada!");
      qc.invalidateQueries({ queryKey: ["ucs", selected!.id] });
      setUcEditId(null);
      setFormUc(FORM_VAZIO_UC);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao atualizar UC"),
  });

  const deletarUc = useMutation({
    mutationFn: (ucId: number) => cursosApi.deletarUc(selected!.id, ucId),
    onSuccess: () => {
      toast.success("UC removida.");
      qc.invalidateQueries({ queryKey: ["ucs", selected!.id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao remover UC"),
  });

  const reordenarUcs = useMutation({
    mutationFn: (items: { id: number; sequencia: number; modulo_etapa?: string | null }[]) =>
      cursosApi.reordenarUcs(selected!.id, items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ucs", selected!.id] }),
    onError: () => toast.error("Erro ao reordenar"),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const filtered = (cursos as Curso[]).filter((c) =>
    c.nome.toLowerCase().includes(search.toLowerCase()) ||
    c.codigo.toLowerCase().includes(search.toLowerCase())
  );
  const totalPaginas = Math.max(1, Math.ceil(filtered.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const paginados = filtered.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  function selecionarCurso(c: Curso) {
    if (selected?.id === c.id) { setSelected(null); return; }
    setSelected(c);
    setEditandoCurso(false);
    setUcEditId(null);
    setUcModuloNovo(null);
  }

  function iniciarEdicaoCurso() {
    setFormEdicaoCurso({
      nome: selected!.nome,
      tipo: selected!.tipo,
      carga_horaria_total: selected!.carga_horaria_total,
      modalidade: selected!.modalidade,
      area: selected!.area ?? "",
      descricao: selected!.descricao ?? "",
      ativo: selected!.ativo,
    });
    setEditandoCurso(true);
  }

  function moverUcNoModulo(uc: UC, dir: "up" | "down", listaModulo: UC[]) {
    const idx = listaModulo.findIndex((u) => u.id === uc.id);
    const troca = dir === "up" ? idx - 1 : idx + 1;
    if (troca < 0 || troca >= listaModulo.length) return;

    const itens = listaModulo.map((u, i) => ({ id: u.id, sequencia: i + 1, modulo_etapa: u.modulo_etapa }));
    // Swap sequencias
    const tmp = itens[idx].sequencia;
    itens[idx].sequencia = itens[troca].sequencia;
    itens[troca].sequencia = tmp;
    reordenarUcs.mutate(itens);
  }

  function moverUcParaModulo(uc: UC, novoModulo: string) {
    const destino = novoModulo === "Etapa Única" ? null : novoModulo;
    // Conta UCs já no módulo destino para posicionar no final
    const noModulo = ucs.filter((u) => (u.modulo_etapa || "Etapa Única") === novoModulo);
    atualizarUc.mutate({
      ucId: uc.id,
      data: { modulo_etapa: destino, sequencia: noModulo.length + 1 },
    });
  }

  function abrirFormUc(modulo: string) {
    setUcModuloNovo(modulo);
    setUcEditId("new");
    setFormUc({ ...FORM_VAZIO_UC, modulo_etapa: modulo === "Etapa Única" ? "" : modulo });
  }

  function abrirEdicaoUc(uc: UC) {
    setUcEditId(uc.id);
    setUcModuloNovo(null);
    setFormUc({
      nome: uc.nome,
      codigo_uc: uc.codigo_uc,
      tipo: uc.tipo,
      modulo_etapa: uc.modulo_etapa || "",
      novoModulo: "",
      carga_horaria: uc.carga_horaria,
    });
  }

  function submitUc() {
    const moduloFinal = formUc.novoModulo.trim() || formUc.modulo_etapa.trim() || null;
    const payload = {
      nome: formUc.nome,
      codigo_uc: formUc.codigo_uc,
      tipo: formUc.tipo,
      modulo_etapa: moduloFinal,
      carga_horaria: formUc.carga_horaria,
    };
    if (ucEditId === "new") {
      criarUc.mutate(payload);
    } else if (typeof ucEditId === "number") {
      atualizarUc.mutate({ ucId: ucEditId, data: payload });
    }
  }

  const ucPending = criarUc.isPending || atualizarUc.isPending;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-6 h-full">

      {/* ── Lista de cursos ────────────────────────────────────────────────── */}
      <div className={cn("flex-1 min-w-0 flex flex-col transition-all", selected ? "max-w-[50%]" : "")}>
        <PageHeader title="Cursos" description="Catálogo de cursos do SENAI">
          <button onClick={() => { setShowForm(!showForm); setSelected(null); }} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Novo Curso
          </button>
        </PageHeader>

        {/* Formulário de novo curso */}
        {showForm && (
          <div className="card p-5 mb-5">
            <h3 className="font-semibold text-gray-800 mb-4">Novo Curso</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                criarCurso.mutate({
                  ...formCurso,
                  area: formCurso.area || null,
                });
              }}
              className="grid grid-cols-2 gap-4"
            >
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nome do Curso *</label>
                <input className="input w-full" value={formCurso.nome}
                  onChange={(e) => setFormCurso({ ...formCurso, nome: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pasta (Código) *</label>
                <input className="input w-full font-mono" value={formCurso.codigo} placeholder="Ex: 18144"
                  onChange={(e) => setFormCurso({ ...formCurso, codigo: e.target.value })} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo *</label>
                <select className="input w-full" value={formCurso.tipo}
                  onChange={(e) => setFormCurso({ ...formCurso, tipo: e.target.value })}>
                  {TIPOS_CURSO.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Carga Horária Total (h)</label>
                <input type="number" min={1} className="input w-full" value={formCurso.carga_horaria_total}
                  onChange={(e) => setFormCurso({ ...formCurso, carga_horaria_total: +e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Modalidade</label>
                <select className="input w-full" value={formCurso.modalidade}
                  onChange={(e) => setFormCurso({ ...formCurso, modalidade: e.target.value })}>
                  <option>Presencial</option><option>EAD</option><option>Híbrido</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Área</label>
                <input className="input w-full" value={formCurso.area} placeholder="Ex: Informação e Comunicação"
                  onChange={(e) => setFormCurso({ ...formCurso, area: e.target.value })} />
              </div>
              <div className="col-span-2 flex justify-end gap-3">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancelar</button>
                <button type="submit" disabled={criarCurso.isPending} className="btn-primary">
                  {criarCurso.isPending ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Busca */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input className="input pl-9 max-w-sm" placeholder="Buscar curso..."
            value={search} onChange={(e) => { setSearch(e.target.value); setPagina(1); }} />
        </div>

        {/* Tabela */}
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">Carregando...</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Pasta</th>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">CH</th>
                  <th className="px-4 py-3 text-left">Modalidade</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginados.map((c) => (
                  <tr key={c.id} onClick={() => selecionarCurso(c)}
                    className={cn("cursor-pointer transition-colors",
                      selected?.id === c.id ? "bg-blue-50 border-l-2 border-primary" : "hover:bg-gray-50")}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{c.codigo}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.nome}</td>
                    <td className="px-4 py-3">
                      <span className="badge bg-indigo-50 text-indigo-700 text-[10px]">{c.tipo}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.carga_horaria_total}h</td>
                    <td className="px-4 py-3">
                      <span className="badge bg-blue-50 text-blue-700">{c.modalidade}</span>
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className={cn("h-4 w-4 text-gray-400 transition-transform",
                        selected?.id === c.id && "rotate-90 text-primary")} />
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
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">←</button>
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
                    </button>)}
              <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={paginaAtual === totalPaginas}
                className="px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">→</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Painel de detalhe ─────────────────────────────────────────────────── */}
      {selected && (
        <div className="w-[50%] shrink-0">
          <div className="card h-full flex flex-col">

            {/* Cabeçalho */}
            <div className="p-5 border-b shrink-0">
              {editandoCurso ? (
                /* Formulário de edição do curso */
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Editar Curso</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">Nome</label>
                      <input className="input w-full text-sm" value={formEdicaoCurso.nome ?? ""}
                        onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, nome: e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                      <select className="input w-full text-sm" value={formEdicaoCurso.tipo ?? ""}
                        onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, tipo: e.target.value })}>
                        {TIPOS_CURSO.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Carga Horária (h)</label>
                      <input type="number" min={1} className="input w-full text-sm"
                        value={formEdicaoCurso.carga_horaria_total ?? 0}
                        onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, carga_horaria_total: +e.target.value })} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Modalidade</label>
                      <select className="input w-full text-sm" value={formEdicaoCurso.modalidade ?? ""}
                        onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, modalidade: e.target.value })}>
                        <option>Presencial</option><option>EAD</option><option>Híbrido</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Área</label>
                      <input className="input w-full text-sm" value={formEdicaoCurso.area ?? ""}
                        onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, area: e.target.value })} />
                    </div>
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formEdicaoCurso.ativo ?? true}
                          onChange={(e) => setFormEdicaoCurso({ ...formEdicaoCurso, ativo: e.target.checked })}
                          className="rounded border-gray-300 text-blue-600 h-4 w-4" />
                        <span className="text-sm text-gray-700">Curso ativo</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditandoCurso(false)} className="btn-secondary text-sm py-1.5 px-3">
                      Cancelar
                    </button>
                    <button
                      onClick={() => atualizarCurso.mutate(formEdicaoCurso)}
                      disabled={atualizarCurso.isPending}
                      className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1"
                    >
                      {atualizarCurso.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Salvar
                    </button>
                  </div>
                </div>
              ) : (
                /* Visualização do curso */
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <BookOpen className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-xs font-mono text-gray-400">{selected.codigo}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                        {selected.tipo}
                      </span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                        selected.ativo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                        {selected.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <h3 className="font-semibold text-gray-900 text-sm leading-tight">{selected.nome}</h3>
                    <div className="flex gap-3 mt-2 text-xs text-gray-500 flex-wrap">
                      <span>Total: <strong className="text-gray-800">{selected.carga_horaria_total}h</strong></span>
                      {totalPresencial > 0 && <span>Presencial: <strong className="text-blue-700">{totalPresencial}h</strong></span>}
                      {totalEad > 0 && <span>EaD: <strong className="text-purple-700">{totalEad}h</strong></span>}
                      <span className="badge bg-blue-50 text-blue-700">{selected.modalidade}</span>
                      {selected.area && <span className="text-gray-400">{selected.area}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={iniciarEdicaoCurso}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700" title="Editar curso">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setSelected(null)}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Estrutura Curricular */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Estrutura Curricular</p>
                <button
                  onClick={() => abrirFormUc("Etapa Única")}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar UC
                </button>
              </div>

              {loadingUcs ? (
                <div className="text-center py-8 text-gray-400 text-sm flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                </div>
              ) : ucs.length === 0 && ucEditId !== "new" ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Nenhuma UC cadastrada para este curso.</p>
                  <button onClick={() => abrirFormUc("Etapa Única")}
                    className="mt-3 text-blue-600 text-xs underline">
                    Adicionar primeira UC
                  </button>
                </div>
              ) : (
                <>
                  {grupos.map(([modulo, items]) => (
                    <ModuloSection
                      key={modulo}
                      modulo={modulo}
                      items={items}
                      modulosExistentes={modulosExistentes}
                      ucEditId={ucEditId}
                      formUc={formUc}
                      setFormUc={setFormUc}
                      ucPending={ucPending}
                      onAbrirEdicao={abrirEdicaoUc}
                      onSalvarUc={submitUc}
                      onCancelarUc={() => { setUcEditId(null); setUcModuloNovo(null); setFormUc(FORM_VAZIO_UC); }}
                      onDeletar={(ucId) => { if (confirm("Remover esta UC?")) deletarUc.mutate(ucId); }}
                      onMoverNaLista={(uc, dir) => moverUcNoModulo(uc, dir, items)}
                      onMoverParaModulo={moverUcParaModulo}
                      onAdicionarUc={() => abrirFormUc(modulo)}
                    />
                  ))}

                  {/* Formulário de nova UC sem módulo selecionado ainda (quando lista vazia) */}
                  {ucEditId === "new" && ucModuloNovo && !grupos.find(([m]) => m === ucModuloNovo) && (
                    <UCFormInline
                      modulosExistentes={modulosExistentes}
                      formUc={formUc}
                      setFormUc={setFormUc}
                      ucPending={ucPending}
                      onSalvar={submitUc}
                      onCancelar={() => { setUcEditId(null); setUcModuloNovo(null); setFormUc(FORM_VAZIO_UC); }}
                    />
                  )}

                  {/* Botão para adicionar novo módulo */}
                  <button
                    onClick={() => {
                      const nome = prompt("Nome do novo módulo:");
                      if (nome?.trim()) abrirFormUc(nome.trim());
                    }}
                    className="w-full border border-dashed rounded-lg py-2 text-xs text-gray-400 hover:text-blue-600 hover:border-blue-400 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar novo módulo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

interface UC { id: number; curso_id: number; codigo_uc: string; nome: string; tipo: string; modulo_etapa: string | null; sequencia: number | null; carga_horaria: number; }

function ModuloSection({
  modulo, items, modulosExistentes, ucEditId, formUc, setFormUc, ucPending,
  onAbrirEdicao, onSalvarUc, onCancelarUc, onDeletar, onMoverNaLista, onMoverParaModulo, onAdicionarUc,
}: {
  modulo: string; items: UC[]; modulosExistentes: string[];
  ucEditId: number | "new" | null; formUc: any; setFormUc: any; ucPending: boolean;
  onAbrirEdicao: (uc: UC) => void;
  onSalvarUc: () => void; onCancelarUc: () => void;
  onDeletar: (id: number) => void;
  onMoverNaLista: (uc: UC, dir: "up" | "down") => void;
  onMoverParaModulo: (uc: UC, modulo: string) => void;
  onAdicionarUc: () => void;
}) {
  const totalCH = items.reduce((s, u) => s + (u.carga_horaria || 0), 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-primary uppercase tracking-wide">{modulo}</span>
        <div className="flex-1 h-px bg-blue-100" />
        <span className="text-xs text-gray-400">{totalCH}h</span>
        <button onClick={onAdicionarUc}
          className="ml-1 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5">
          <Plus className="h-3 w-3" /> UC
        </button>
      </div>
      <div className="space-y-1">
        {items.map((uc, idx) => (
          <div key={uc.id}>
            {ucEditId === uc.id ? (
              <UCFormInline
                modulosExistentes={modulosExistentes}
                formUc={formUc}
                setFormUc={setFormUc}
                ucPending={ucPending}
                onSalvar={onSalvarUc}
                onCancelar={onCancelarUc}
              />
            ) : (
              <UCRow
                uc={uc}
                idx={idx}
                total={items.length}
                modulosExistentes={modulosExistentes}
                moduloAtual={modulo}
                onEditar={() => onAbrirEdicao(uc)}
                onDeletar={() => onDeletar(uc.id)}
                onMover={(dir) => onMoverNaLista(uc, dir)}
                onMoverParaModulo={(m) => onMoverParaModulo(uc, m)}
              />
            )}
          </div>
        ))}

        {/* Formulário de nova UC dentro deste módulo */}
        {ucEditId === "new" && formUc.modulo_etapa === (modulo === "Etapa Única" ? "" : modulo) && (
          <UCFormInline
            modulosExistentes={modulosExistentes}
            formUc={formUc}
            setFormUc={setFormUc}
            ucPending={ucPending}
            onSalvar={onSalvarUc}
            onCancelar={onCancelarUc}
          />
        )}
      </div>
    </div>
  );
}

function UCRow({ uc, idx, total, modulosExistentes, moduloAtual, onEditar, onDeletar, onMover, onMoverParaModulo }: {
  uc: UC; idx: number; total: number; modulosExistentes: string[]; moduloAtual: string;
  onEditar: () => void; onDeletar: () => void;
  onMover: (dir: "up" | "down") => void;
  onMoverParaModulo: (m: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group">
      {/* Setas de ordem */}
      <div className="flex flex-col shrink-0">
        <button onClick={() => onMover("up")} disabled={idx === 0}
          className="p-0.5 text-gray-200 hover:text-gray-500 disabled:opacity-0 group-hover:text-gray-300">
          <ArrowUp className="h-3 w-3" />
        </button>
        <button onClick={() => onMover("down")} disabled={idx === total - 1}
          className="p-0.5 text-gray-200 hover:text-gray-500 disabled:opacity-0 group-hover:text-gray-300">
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>
      <span className="text-xs font-mono text-gray-400 w-14 shrink-0">{uc.codigo_uc}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 leading-tight truncate">{uc.nome}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Mover para outro módulo */}
        {modulosExistentes.length > 1 && (
          <select
            className="input text-[10px] py-0.5 px-1.5 h-6"
            value=""
            onChange={(e) => { if (e.target.value) onMoverParaModulo(e.target.value); }}
            title="Mover para módulo"
          >
            <option value="">↕ Módulo</option>
            {modulosExistentes.filter((m) => m !== moduloAtual).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        <button onClick={onEditar} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-blue-600" title="Editar">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDeletar} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title="Remover">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
          uc.tipo?.toLowerCase() === "ead" ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600")}>
          {uc.tipo}
        </span>
        <span className="text-xs text-gray-400 w-8 text-right tabular-nums">{uc.carga_horaria}h</span>
      </div>
    </div>
  );
}

function UCFormInline({ modulosExistentes, formUc, setFormUc, ucPending, onSalvar, onCancelar }: {
  modulosExistentes: string[]; formUc: any; setFormUc: any; ucPending: boolean;
  onSalvar: () => void; onCancelar: () => void;
}) {
  const moduloDisplay = formUc.modulo_etapa || "Etapa Única";

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/50 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-[10px] text-gray-500 mb-0.5">Nome da UC *</label>
          <input className="input w-full text-sm py-1.5" placeholder="Nome da disciplina"
            value={formUc.nome}
            onChange={(e) => setFormUc({ ...formUc, nome: e.target.value })}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Código UC</label>
          <input className="input w-full text-sm py-1.5 font-mono" placeholder="Auto"
            value={formUc.codigo_uc}
            onChange={(e) => setFormUc({ ...formUc, codigo_uc: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Carga Horária (h)</label>
          <input type="number" min={0} className="input w-full text-sm py-1.5"
            value={formUc.carga_horaria}
            onChange={(e) => setFormUc({ ...formUc, carga_horaria: +e.target.value })}
          />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Tipo</label>
          <select className="input w-full text-sm py-1.5" value={formUc.tipo}
            onChange={(e) => setFormUc({ ...formUc, tipo: e.target.value })}>
            <option value="Presencial">Presencial</option>
            <option value="EaD">EaD</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-0.5">Módulo / Etapa</label>
          <select className="input w-full text-sm py-1.5"
            value={formUc.novoModulo || formUc.modulo_etapa || ""}
            onChange={(e) => {
              const val = e.target.value;
              if (val === "__novo__") {
                setFormUc({ ...formUc, modulo_etapa: "", novoModulo: "" });
              } else {
                setFormUc({ ...formUc, modulo_etapa: val, novoModulo: "" });
              }
            }}
          >
            <option value="">Etapa Única (sem módulo)</option>
            {[...new Set([...MODULOS_PADRAO, ...modulosExistentes.filter((m) => m !== "Etapa Única")])]
              .map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__novo__">+ Digitar novo módulo...</option>
          </select>
          {(formUc.novoModulo !== undefined && formUc.modulo_etapa === "" && formUc.novoModulo === "") && (
            <input className="input w-full text-sm py-1 mt-1" placeholder="Nome do novo módulo"
              autoFocus
              onChange={(e) => setFormUc({ ...formUc, novoModulo: e.target.value, modulo_etapa: e.target.value })}
            />
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancelar} className="btn-secondary text-xs py-1.5 px-3">Cancelar</button>
        <button onClick={onSalvar} disabled={ucPending || !formUc.nome}
          className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1 disabled:opacity-50">
          {ucPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Salvar UC
        </button>
      </div>
    </div>
  );
}
