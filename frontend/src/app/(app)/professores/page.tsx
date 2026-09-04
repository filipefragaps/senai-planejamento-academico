"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { professoresApi, contratosApi, eventosApi, type ContratoEventoRef } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { RegenciaBar } from "@/components/regencia-bar";
import { ProfessorDrawer } from "@/components/professor-drawer";
import { toast } from "sonner";
import {
  Plus, Search, X, Pencil, ChevronRight, Clock, BookOpen, User, Briefcase,
  LayoutGrid, List, ChevronLeft, Zap, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getInitials(nome: string) {
  return nome.trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const TIPOS_CONTRATO_PROF = ["PJ", "RPA", "Inclusão em Folha"];
const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const CONTRATO_FORM_VAZIO = {
  numero_contrato: "", valor_hora: "", total_horas_previstas: "",
  descricao: "", ativo: true,
  eventos: [] as ContratoEventoRef[],
};

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

const TIPOS_QUADRO_PROF = new Set(["Mensalista", "Horista", "Inclusão em Folha"]);

const FILTROS_TIPO = [
  { key: "todos",              label: "Todos",             grupo: "base" },
  { key: "quadro",             label: "Quadro",            grupo: "quadro" },
  { key: "Mensalista",         label: "Mensalista",        grupo: "quadro" },
  { key: "Horista",            label: "Horista",           grupo: "quadro" },
  { key: "Inclusão em Folha",  label: "Inclusão em Folha", grupo: "quadro" },
  { key: "extraquadro",        label: "Extraquadro",       grupo: "extra" },
  { key: "PJ",                 label: "PJ",                grupo: "extra" },
  { key: "RPA",                label: "RPA",               grupo: "extra" },
] as const;

// ── GradeProfessores ──────────────────────────────────────────────────────────

const TURNOS_PROF = ["Manhã", "Tarde", "Noite"] as const;
const TURNO_STYLE_PROF: Record<string, { bg: string; text: string; dot: string }> = {
  "Manhã":  { bg: "bg-amber-50",   text: "text-amber-800",  dot: "bg-amber-400"  },
  "Tarde":  { bg: "bg-sky-50",     text: "text-sky-800",    dot: "bg-sky-400"    },
  "Noite":  { bg: "bg-indigo-50",  text: "text-indigo-800", dot: "bg-indigo-400" },
};
function _wkMon(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d); m.setDate(d.getDate() + diff); return m;
}
function _addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function _iso(d: Date): string { return d.toISOString().slice(0, 10); }

function GradeProfessores() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => _wkMon(today));
  const weekEnd = _addDays(weekStart, 5);
  const dias = Array.from({ length: 6 }, (_, i) => _addDays(weekStart, i));
  const diaNomes = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const { data, isLoading } = useQuery({
    queryKey: ["professores-ocupacao", _iso(weekStart)],
    queryFn: () => professoresApi.ocupacao({ data_inicio: _iso(weekStart), data_fim: _iso(weekEnd) }),
    staleTime: 60_000,
  });

  const professoresLista: any[] = data?.professores ?? [];
  const ocupacoes: any[] = data?.ocupacoes ?? [];

  const idx = useMemo(() => {
    const m = new Map<number, Map<string, Map<string, any[]>>>();
    for (const o of ocupacoes) {
      if (!m.has(o.professor_id)) m.set(o.professor_id, new Map());
      const byDate = m.get(o.professor_id)!;
      if (!byDate.has(o.data)) byDate.set(o.data, new Map());
      const byTurno = byDate.get(o.data)!;
      const t = o.turno ?? "Manhã";
      if (!byTurno.has(t)) byTurno.set(t, []);
      byTurno.get(t)!.push(o);
    }
    return m;
  }, [ocupacoes]);

  const navLabel = `${weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${weekEnd.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;

  function ProfCell({ profId, iso }: { profId: number; iso: string }) {
    const byTurno = idx.get(profId)?.get(iso);
    return (
      <td className="border border-gray-200 p-0 align-top min-w-[130px]">
        <div className="divide-y divide-gray-100">
          {TURNOS_PROF.map((turno) => {
            const aulas = byTurno?.get(turno) ?? [];
            const s = TURNO_STYLE_PROF[turno];
            const choque = aulas.length > 1;
            if (aulas.length === 0) {
              return (
                <div key={turno} className="px-1.5 py-1 flex items-center gap-1 h-[34px]">
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 opacity-20", s.dot)} />
                  <span className="text-[10px] text-gray-200">{turno[0]}</span>
                </div>
              );
            }
            return (
              <div key={turno} className={cn("px-1.5 py-1 min-h-[34px]", choque ? "bg-red-50 border-l-2 border-red-400" : s.bg)}>
                <div className="flex items-center gap-1 mb-0.5">
                  {choque
                    ? <Zap className="w-2.5 h-2.5 text-red-500 shrink-0" />
                    : <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />}
                  <span className={cn("text-[9px] font-bold uppercase tracking-wide", choque ? "text-red-600" : s.text)}>
                    {choque ? `CHOQUE (${aulas.length})` : turno}
                  </span>
                </div>
                {aulas.map((a: any, i: number) => (
                  <div key={i} className={cn("mb-1 last:mb-0 pl-1", choque && i > 0 && "mt-1 pt-1 border-t border-red-200")}>
                    <p className={cn("text-[10px] font-semibold leading-snug break-words", choque ? "text-red-700" : s.text)}>
                      {a.evento_nome ?? "—"}
                    </p>
                    {a.uc_nome && (
                      <p className="text-[9px] text-gray-500 leading-snug break-words">{a.uc_nome}</p>
                    )}
                    {a.sala && (
                      <p className={cn("text-[9px]", choque ? "text-red-400" : "text-gray-400")}>{a.sala}</p>
                    )}
                    {a.horario_inicio && (
                      <p className={cn("text-[9px]", choque ? "text-red-400 font-semibold" : "text-gray-400")}>
                        {a.horario_inicio}{a.horario_fim ? `–${a.horario_fim}` : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </td>
    );
  }

  const choqueCount = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const o of ocupacoes) {
      const k = `${o.professor_id}|${o.data}|${o.turno}`;
      acc[k] = (acc[k] ?? 0) + 1;
    }
    return Object.values(acc).filter((v) => v > 1).length;
  }, [ocupacoes]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-1">
          <button onClick={() => setWeekStart(_addDays(weekStart, -7))} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[200px] text-center px-1">{navLabel}</span>
          <button onClick={() => setWeekStart(_addDays(weekStart, 7))} className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </button>
        </div>
        <button onClick={() => setWeekStart(_wkMon(today))} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors">
          Semana atual
        </button>
        <div className="ml-auto flex items-center gap-3">
          {TURNOS_PROF.map((t) => (
            <span key={t} className="flex items-center gap-1 text-xs text-gray-500">
              <span className={cn("w-2.5 h-2.5 rounded-full", TURNO_STYLE_PROF[t].dot)} />{t}
            </span>
          ))}
          <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
            <Zap className="w-3 h-3" /> Choque
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin mr-3" /><span>Carregando...</span>
        </div>
      ) : professoresLista.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center gap-4 text-gray-400">
          <User className="h-12 w-12 opacity-30" />
          <p className="font-medium text-gray-500">Nenhum professor com aulas nesta semana.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide sticky left-0 bg-gray-50 z-10 border-r border-gray-200 min-w-[180px]">
                    Professor
                  </th>
                  {dias.map((d, i) => {
                    const isToday = _iso(d) === _iso(today);
                    return (
                      <th key={i} className={cn("px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap min-w-[130px]", isToday ? "bg-blue-50 text-blue-700" : "text-gray-500")}>
                        <div>{diaNomes[i]}</div>
                        <div className={cn("font-bold text-sm", isToday ? "text-blue-700" : "text-gray-800")}>
                          {d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {professoresLista.map((prof: any, ri: number) => (
                  <tr key={prof.id} className={cn("border-b last:border-0", ri % 2 === 0 ? "bg-white" : "bg-gray-50/30")}>
                    <td className={cn("px-3 py-2 sticky left-0 z-10 border-r border-gray-200", ri % 2 === 0 ? "bg-white" : "bg-gray-50/30")}>
                      <p className="text-xs font-semibold text-gray-800 leading-snug">{prof.nome}</p>
                    </td>
                    {dias.map((d) => <ProfCell key={_iso(d)} profId={prof.id} iso={_iso(d)} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400 flex items-center gap-4">
            <span>{professoresLista.length} professor(es) com aulas · {ocupacoes.length} aula(s) no período</span>
            {choqueCount > 0 && (
              <span className="flex items-center gap-1 text-red-500 font-semibold">
                <Zap className="h-3 w-3" /> {choqueCount} choque(s) de docente
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ProfessoresPage() {
  const qc = useQueryClient();
  const [aba, setAba] = useState<"lista" | "grade">("lista");
  const [search, setSearch] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [selected, setSelected] = useState<any | null>(null);
  const [drawer, setDrawer] = useState<null | "new" | any>(null);
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 15;

  const { data: professores = [], isLoading } = useQuery({
    queryKey: ["professores"],
    queryFn: () => professoresApi.listar(),
  });

  // Usa o mês atual como período — igual à aba de Regência
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const inicioMes = `${mesAtual}-01`;
  const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const fimMes = `${mesAtual}-${String(ultimoDia).padStart(2, "0")}`;

  const { data: regencias = [] } = useQuery({
    queryKey: ["regencias", inicioMes, fimMes],
    queryFn: () => professoresApi.regencias({ data_inicio: inicioMes, data_fim: fimMes }),
  });

  const { data: detalhes, isLoading: loadingDetalhes } = useQuery({
    queryKey: ["professor-detalhes", selected?.id],
    queryFn: () => professoresApi.detalhes(selected!.id),
    enabled: !!selected,
  });

  const [contratoModal, setContratoModal] = useState<{ open: boolean; contrato: any | null }>({ open: false, contrato: null });
  const [contratoForm, setContratoForm] = useState(CONTRATO_FORM_VAZIO);
  const [buscaEvento, setBuscaEvento] = useState("");
  const [dropdownEventoAberto, setDropdownEventoAberto] = useState(false);

  const { data: contratos = [], isLoading: loadingContratos } = useQuery({
    queryKey: ["contratos", selected?.id],
    queryFn: () => contratosApi.listar(selected!.id),
    enabled: !!selected && TIPOS_CONTRATO_PROF.includes(selected.tipo),
    staleTime: 30_000,
  });

  const { data: todosEventos = [] } = useQuery({
    queryKey: ["eventos-para-contrato"],
    queryFn: () => eventosApi.listar(),
    enabled: contratoModal.open,
    staleTime: 120_000,
  });

  const salvarContratoMutation = useMutation({
    mutationFn: (form: typeof CONTRATO_FORM_VAZIO) => {
      const payload = {
        numero_contrato: form.numero_contrato,
        valor_hora: +form.valor_hora,
        total_horas_previstas: +form.total_horas_previstas,
        descricao: form.descricao || undefined,
        eventos: form.eventos,
        ativo: form.ativo,
      };
      return contratoModal.contrato
        ? contratosApi.atualizar(selected!.id, contratoModal.contrato.id, payload)
        : contratosApi.criar(selected!.id, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos", selected?.id] });
      setContratoModal({ open: false, contrato: null });
      setContratoForm(CONTRATO_FORM_VAZIO);
      toast.success(contratoModal.contrato ? "Contrato atualizado!" : "Contrato criado!");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao salvar contrato"),
  });

  function abrirNovoContrato() {
    setContratoForm(CONTRATO_FORM_VAZIO);
    setBuscaEvento("");
    setContratoModal({ open: true, contrato: null });
  }

  function abrirEditarContrato(c: any) {
    setContratoForm({
      numero_contrato: c.numero_contrato,
      valor_hora: String(c.valor_hora),
      total_horas_previstas: String(c.total_horas_previstas),
      descricao: c.descricao || "",
      ativo: c.ativo,
      eventos: c.eventos || [],
    });
    setBuscaEvento("");
    setContratoModal({ open: true, contrato: c });
  }

  function salvarContrato() {
    if (!contratoForm.numero_contrato || !contratoForm.valor_hora || !contratoForm.total_horas_previstas) {
      toast.error("Preencha número do contrato, valor da hora e total de horas");
      return;
    }
    salvarContratoMutation.mutate(contratoForm);
  }

  const regMap: Record<number, any> = {};
  regencias.forEach((r: any) => { regMap[r.professor_id] = r; });

  const filtered = professores
    .filter((p: any) => {
      const matchSearch =
        p.nome.toLowerCase().includes(search.toLowerCase()) ||
        (p.especialidades || "").toLowerCase().includes(search.toLowerCase());
      if (!matchSearch) return false;
      if (filtroTipo === "todos") return true;
      if (filtroTipo === "quadro") return TIPOS_QUADRO_PROF.has(p.tipo);
      if (filtroTipo === "extraquadro") return !TIPOS_QUADRO_PROF.has(p.tipo);
      return p.tipo === filtroTipo;
    })
    .sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));
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
    <div className="space-y-0">
      <PageHeader title="Professores" description="Gestão de professores, regência docente e grade semanal">
        <button onClick={() => setDrawer("new")} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Novo Professor
        </button>
      </PageHeader>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        <button
          onClick={() => setAba("lista")}
          className={cn("flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            aba === "lista" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700")}
        >
          <List className="h-4 w-4" /> Lista
        </button>
        <button
          onClick={() => setAba("grade")}
          className={cn("flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            aba === "grade" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700")}
        >
          <LayoutGrid className="h-4 w-4" /> Grade de Docentes
        </button>
      </div>

      {aba === "grade" && <GradeProfessores />}

      {aba === "lista" && <div className="flex gap-6 h-full">
      {/* ─── Lista ─── */}
      <div className={cn("flex-1 min-w-0 transition-all", selected ? "max-w-[52%]" : "")}>
        <div className="hidden">{/* PageHeader moved above */}</div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input pl-9 max-w-sm w-full"
            placeholder="Buscar professor ou especialidade..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPagina(1); }}
          />
        </div>

        {/* Filtro por tipo de vínculo */}
        <div className="flex items-center gap-1 flex-wrap mb-4">
          {FILTROS_TIPO.map(({ key, label, grupo }) => {
            const ativo = filtroTipo === key;
            return (
              <button
                key={key}
                onClick={() => { setFiltroTipo(key); setPagina(1); }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-all border",
                  ativo
                    ? grupo === "extra"
                      ? "bg-amber-500 text-white border-amber-500"
                      : "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
                  key === "extraquadro" || key === "quadro" ? "font-semibold" : "",
                  (key === "extraquadro" || key === "PJ" || key === "RPA") && filtroTipo !== key
                    ? "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"
                    : "",
                  (key === "quadro" || key === "Mensalista" || key === "Horista" || key === "Inclusão em Folha") && filtroTipo !== key
                    ? "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                    : "",
                  key === "todos" && !ativo ? "border-gray-200 text-gray-600 bg-white hover:bg-gray-50" : "",
                )}
              >
                {label}
                {!ativo && key !== "todos" && (
                  <span className="ml-1 text-[10px] font-normal opacity-60">
                    {professores.filter((p: any) => {
                      if (key === "quadro") return TIPOS_QUADRO_PROF.has(p.tipo);
                      if (key === "extraquadro") return !TIPOS_QUADRO_PROF.has(p.tipo);
                      return p.tipo === key;
                    }).length}
                  </span>
                )}
              </button>
            );
          })}
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
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    {p.foto ? (
                      <img src={p.foto} alt={p.nome} className="w-9 h-9 rounded-full object-cover shrink-0 border border-gray-200" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/10">
                        <span className="text-xs font-bold text-primary select-none">{getInitials(p.nome)}</span>
                      </div>
                    )}
                    {/* Info + ações */}
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-900 text-sm">{p.nome}</span>
                          <span className={cn(
                            "badge text-xs",
                            p.tipo === "Mensalista" ? "bg-blue-100 text-blue-700" :
                            p.tipo === "Horista"    ? "bg-purple-100 text-purple-700" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {p.tipo}
                            {["PJ","RPA"].includes(p.tipo) && (
                              <span className="ml-1 text-[9px] font-normal opacity-70">extraquadro</span>
                            )}
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
                <div className="flex items-center gap-3 min-w-0">
                  {/* Avatar no painel de detalhe */}
                  {selected.foto ? (
                    <img src={selected.foto} alt={selected.nome} className="w-10 h-10 rounded-full object-cover shrink-0 border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/10">
                      <span className="text-sm font-bold text-primary select-none">{getInitials(selected.nome)}</span>
                    </div>
                  )}
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
                    {selected.nome}
                  </h3>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  {TIPOS_CONTRATO_PROF.includes(selected.tipo) && (
                    <button
                      onClick={abrirNovoContrato}
                      className="p-1.5 rounded hover:bg-amber-100 text-amber-500 hover:text-amber-700"
                      title="Adicionar contrato"
                    >
                      <Briefcase className="h-3.5 w-3.5" />
                    </button>
                  )}
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
                  selected.tipo === "Mensalista" ? "bg-blue-100 text-blue-700" :
                  selected.tipo === "Horista"    ? "bg-purple-100 text-purple-700" :
                  "bg-amber-100 text-amber-700"
                )}>
                  {selected.tipo}
                  {["PJ","RPA"].includes(selected.tipo) && (
                    <span className="ml-1 text-[9px] font-normal opacity-70">extraquadro</span>
                  )}
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
                  <div className="p-4 border-b">
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

                  {/* Contratos */}
                  {TIPOS_CONTRATO_PROF.includes(selected.tipo) && (
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-primary" />
                          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                            Contratos
                          </span>
                        </div>
                        <button
                          onClick={abrirNovoContrato}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          + Novo
                        </button>
                      </div>

                      {loadingContratos ? (
                        <p className="text-xs text-gray-400">Carregando...</p>
                      ) : contratos.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">
                          Nenhum contrato cadastrado.{" "}
                          <button onClick={abrirNovoContrato} className="text-primary underline">
                            Adicionar
                          </button>
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {contratos.map((c: any) => {
                            const pct = Math.min(100, c.percentual_utilizado);
                            const cor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-green-500";
                            return (
                              <div
                                key={c.id}
                                className={cn(
                                  "rounded-lg border p-3 text-xs",
                                  c.ativo ? "border-gray-200" : "border-dashed border-gray-200 opacity-60"
                                )}
                              >
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-semibold text-gray-800 truncate max-w-[140px]">
                                      {c.numero_contrato}
                                    </span>
                                    {!c.ativo && (
                                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                                        inativo
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => abrirEditarContrato(c)}
                                    className="text-gray-400 hover:text-primary"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </div>

                                {/* Barra de progresso */}
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={cn("h-full rounded-full transition-all", cor)}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className={cn(
                                    "text-[10px] font-semibold tabular-nums",
                                    pct >= 90 ? "text-red-600" : pct >= 70 ? "text-amber-600" : "text-green-600"
                                  )}>
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>

                                {/* Stats */}
                                <div className="grid grid-cols-3 gap-x-3 text-[10px] text-gray-500">
                                  <div>
                                    <span className="block text-gray-400">Valor/h</span>
                                    <span className="font-medium text-gray-700">{fmt(c.valor_hora)}</span>
                                  </div>
                                  <div>
                                    <span className="block text-gray-400">Horas prev.</span>
                                    <span className="font-medium text-gray-700">
                                      {c.total_horas_previstas}h
                                    </span>
                                  </div>
                                  <div>
                                    <span className="block text-gray-400">Saldo</span>
                                    <span className={cn(
                                      "font-medium",
                                      c.saldo_horas < 0 ? "text-red-600" : "text-gray-700"
                                    )}>
                                      {c.saldo_horas}h
                                    </span>
                                  </div>
                                  <div className="col-span-2 mt-1">
                                    <span className="block text-gray-400">Pago / Encaminhado</span>
                                    <span className="font-medium text-gray-700">
                                      {fmt(c.valor_pago)} / {fmt(c.valor_encaminhado)}
                                    </span>
                                  </div>
                                  <div className="mt-1">
                                    <span className="block text-gray-400">Saldo R$</span>
                                    <span className={cn(
                                      "font-medium",
                                      c.saldo_financeiro < 0 ? "text-red-600" : "text-green-700"
                                    )}>
                                      {fmt(c.saldo_financeiro)}
                                    </span>
                                  </div>
                                </div>

                                {/* Eventos vinculados */}
                                {c.eventos && c.eventos.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-gray-100">
                                    <p className="text-[10px] text-gray-400 mb-1">Eventos</p>
                                    <div className="flex flex-col gap-1">
                                      {c.eventos.map((ev: any) => (
                                        <div key={ev.id} className="flex items-center gap-1.5 text-[10px]">
                                          <span className="font-mono font-semibold text-indigo-600">#{ev.id}</span>
                                          <span className="text-gray-600 truncate">{ev.nome_turma}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Descrição */}
                                {c.descricao && (
                                  <div className="mt-2 pt-2 border-t border-gray-100">
                                    <p className="text-[10px] text-gray-400 mb-0.5">Observações</p>
                                    <p className="text-[10px] text-gray-600 leading-relaxed whitespace-pre-line">{c.descricao}</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal de contrato ─── */}
      {contratoModal.open && (() => {
        const q = buscaEvento.toLowerCase().trim();
        const jaVinculados = new Set(contratoForm.eventos.map(e => e.id));
        const sugestoes = q
          ? (todosEventos as any[])
              .filter(e => !jaVinculados.has(e.id))
              .filter(e =>
                String(e.id).includes(q) ||
                e.nome_turma.toLowerCase().includes(q) ||
                (e.nome_curso || "").toLowerCase().includes(q)
              )
              .slice(0, 8)
          : [];

        function adicionarEvento(ev: any) {
          const nomeCurso = ev.nome_curso || ev.nome_turma.split(" - ")[0];
          setContratoForm(f => ({
            ...f,
            eventos: [...f.eventos, { id: ev.id, nome_turma: ev.nome_turma, nome_curso: nomeCurso }],
          }));
          setBuscaEvento("");
          setDropdownEventoAberto(false);
        }

        function removerEvento(id: number) {
          setContratoForm(f => ({ ...f, eventos: f.eventos.filter(e => e.id !== id) }));
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDropdownEventoAberto(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-semibold text-gray-900">
                  {contratoModal.contrato ? "Editar Contrato" : "Novo Contrato"}
                </h3>
                <button onClick={() => setContratoModal({ open: false, contrato: null })} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Número do contrato */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Número do Contrato <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="input w-full"
                    placeholder="Ex: CTR-2024-001"
                    value={contratoForm.numero_contrato}
                    onChange={e => setContratoForm(f => ({ ...f, numero_contrato: e.target.value }))}
                  />
                </div>

                {/* Valor + Horas */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Valor por Hora (R$) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number" step="0.01" min="0" className="input w-full" placeholder="0,00"
                      value={contratoForm.valor_hora}
                      onChange={e => setContratoForm(f => ({ ...f, valor_hora: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Total de Horas <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number" step="0.5" min="0" className="input w-full" placeholder="0"
                      value={contratoForm.total_horas_previstas}
                      onChange={e => setContratoForm(f => ({ ...f, total_horas_previstas: e.target.value }))}
                    />
                  </div>
                </div>

                {contratoForm.valor_hora && contratoForm.total_horas_previstas && (
                  <p className="text-xs text-gray-500 bg-blue-50 rounded-lg p-2">
                    Valor total estimado:{" "}
                    <strong className="text-blue-700">
                      {fmt(+contratoForm.valor_hora * +contratoForm.total_horas_previstas)}
                    </strong>
                  </p>
                )}

                {/* Eventos vinculados */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Eventos / Turmas vinculados
                  </label>

                  {/* Chips dos eventos já adicionados */}
                  {contratoForm.eventos.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-2">
                      {contratoForm.eventos.map(ev => (
                        <div key={ev.id} className="flex items-start gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-2.5 py-1.5 text-xs">
                          <div className="flex-1 min-w-0">
                            <span className="font-mono font-semibold text-indigo-700 mr-1.5">#{ev.id}</span>
                            <span className="text-gray-700 truncate">{ev.nome_turma}</span>
                            {ev.nome_curso && ev.nome_curso !== ev.nome_turma && (
                              <span className="block text-indigo-500 mt-0.5 truncate">{ev.nome_curso}</span>
                            )}
                          </div>
                          <button onClick={() => removerEvento(ev.id)} className="text-indigo-400 hover:text-red-500 shrink-0 mt-0.5">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Busca de evento */}
                  <div className="relative">
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input
                          type="text"
                          className="input w-full pl-8 text-sm"
                          placeholder="Buscar por ID, nome da turma ou curso..."
                          value={buscaEvento}
                          onChange={e => { setBuscaEvento(e.target.value); setDropdownEventoAberto(true); }}
                          onFocus={() => setDropdownEventoAberto(true)}
                        />
                      </div>
                    </div>

                    {/* Dropdown de sugestões */}
                    {dropdownEventoAberto && sugestoes.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                        {sugestoes.map((ev: any) => {
                          const curso = ev.nome_curso || ev.nome_turma.split(" - ")[0];
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => adicionarEvento(ev)}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-0"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-semibold text-indigo-600 shrink-0">#{ev.id}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-gray-800 truncate">{ev.nome_turma}</p>
                                  {curso && curso !== ev.nome_turma && (
                                    <p className="text-[10px] text-gray-500 truncate">{curso}</p>
                                  )}
                                </div>
                                <span className={cn("ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded",
                                  ev.status === "Ativo" ? "bg-green-100 text-green-700" :
                                  ev.status === "Planejado" ? "bg-blue-100 text-blue-700" :
                                  "bg-gray-100 text-gray-500"
                                )}>{ev.status}</span>
                              </div>
                            </button>
                          );
                        })}
                        {q && sugestoes.length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-2 italic">Nenhum evento encontrado. O número será registrado manualmente.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Descrição */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Descrição / Observação
                  </label>
                  <textarea
                    className="input w-full resize-none"
                    rows={3}
                    placeholder="Observações sobre este contrato..."
                    value={contratoForm.descricao}
                    onChange={e => setContratoForm(f => ({ ...f, descricao: e.target.value }))}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox" id="contrato-ativo"
                    checked={contratoForm.ativo}
                    onChange={e => setContratoForm(f => ({ ...f, ativo: e.target.checked }))}
                    className="rounded"
                  />
                  <label htmlFor="contrato-ativo" className="text-sm text-gray-700">Contrato ativo</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setContratoModal({ open: false, contrato: null })} className="btn-secondary">Cancelar</button>
                <button onClick={salvarContrato} disabled={salvarContratoMutation.isPending} className="btn-primary">
                  {salvarContratoMutation.isPending ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Drawer de criação / edição ─── */}
      {drawer !== null && (
        <ProfessorDrawer
          professor={drawer === "new" ? null : drawer}
          onClose={() => setDrawer(null)}
          onSaved={handleDrawerSaved}
          onDeleted={() => setDrawer(null)}
        />
      )}
      </div>}
    </div>
  );
}
