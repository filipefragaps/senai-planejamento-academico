"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ambientesApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  Plus, Search, X, Trash2, Upload, Download, FlaskConical,
  BookOpen, Layers, DoorOpen, Filter, ChevronDown, Loader2, Tag,
  AlertTriangle, Users, LayoutGrid, List, ChevronLeft, ChevronRight,
  Zap,
} from "lucide-react";
import { AmbienteDrawer } from "@/components/ambiente-drawer";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ambiente {
  id: number;
  bloco: string | null;
  nome: string;
  sigla: string | null;
  capacidade: number | null;
  tipo: "Sala Teórica" | "Laboratório" | "Híbrido";
  tags: string[];
  observacoes: string | null;
  ativo: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIPOS = ["Sala Teórica", "Laboratório", "Híbrido"] as const;
type Tipo = typeof TIPOS[number];

const TIPO_STYLE: Record<Tipo, { bg: string; text: string; border: string; icon: typeof BookOpen }> = {
  "Sala Teórica": { bg: "bg-blue-50",   text: "text-blue-700",  border: "border-blue-200", icon: BookOpen    },
  "Laboratório":  { bg: "bg-green-50",  text: "text-green-700", border: "border-green-200", icon: FlaskConical },
  "Híbrido":      { bg: "bg-violet-50", text: "text-violet-700",border: "border-violet-200", icon: Layers     },
};

const TAGS_SUGERIDAS = [
  "Automação", "Elétrica", "Informática", "Mecânica", "Refrigeração",
  "Soldagem", "Eletrônica", "Robótica", "Redes", "Desenho Técnico",
];

const FORM_INICIAL = {
  bloco: "", nome: "", sigla: "", capacidade: "", tipo: "Sala Teórica" as Tipo,
  tags: [] as string[], tagInput: "", observacoes: "", ativo: true,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TipoBadge({ tipo }: { tipo: Tipo }) {
  const s = TIPO_STYLE[tipo] ?? TIPO_STYLE["Sala Teórica"];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border", s.bg, s.text, s.border)}>
      <Icon className="h-3 w-3" />
      {tipo}
    </span>
  );
}

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-[11px] px-2 py-0.5 rounded-full border border-gray-200">
      {tag}
      {onRemove && (
        <button type="button" onClick={onRemove} className="hover:text-red-500 ml-0.5">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ── Modal Form ────────────────────────────────────────────────────────────────

function AmbienteModal({
  inicial, onClose, onSaved,
}: {
  inicial: Ambiente | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() =>
    inicial
      ? {
          bloco: inicial.bloco ?? "",
          nome: inicial.nome,
          sigla: inicial.sigla ?? "",
          capacidade: String(inicial.capacidade ?? ""),
          tipo: inicial.tipo as Tipo,
          tags: [...(inicial.tags ?? [])],
          tagInput: "",
          observacoes: inicial.observacoes ?? "",
          ativo: inicial.ativo,
        }
      : { ...FORM_INICIAL }
  );

  const salvar = useMutation({
    mutationFn: () => {
      const payload = {
        bloco: form.bloco.trim() || null,
        nome: form.nome.trim(),
        sigla: form.sigla.trim() || null,
        capacidade: form.capacidade ? parseInt(form.capacidade) : null,
        tipo: form.tipo,
        tags: form.tags,
        observacoes: form.observacoes.trim() || null,
        ativo: form.ativo,
      };
      return inicial
        ? ambientesApi.atualizar(inicial.id, payload)
        : ambientesApi.criar(payload);
    },
    onSuccess: () => {
      toast.success(inicial ? "Ambiente atualizado." : "Ambiente criado.");
      onSaved();
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao salvar."),
  });

  function addTag(tag: string) {
    const t = tag.trim();
    if (t && !form.tags.includes(t)) {
      setForm((f) => ({ ...f, tags: [...f.tags, t], tagInput: "" }));
    } else {
      setForm((f) => ({ ...f, tagInput: "" }));
    }
  }

  function removeTag(tag: string) {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  }

  const canSave = form.nome.trim().length > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg pointer-events-auto flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <DoorOpen className="h-5 w-5 text-blue-600" />
              {inicial ? "Editar Ambiente" : "Novo Ambiente"}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 p-6 space-y-4">
            {/* Bloco + Nome */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bloco</label>
                <input
                  className="input w-full text-sm uppercase"
                  placeholder="Ex: BLOCO A"
                  value={form.bloco}
                  onChange={(e) => setForm((f) => ({ ...f, bloco: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Nome / Identificação <span className="text-red-500">*</span>
                </label>
                <input
                  className="input w-full text-sm uppercase"
                  placeholder="Ex: LAB. AUTOMAÇÃO 01"
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value.toUpperCase() }))}
                />
              </div>
            </div>

            {/* Sigla + Tipo + Capacidade */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sigla</label>
                <input
                  className="input w-full text-sm uppercase font-mono"
                  placeholder="Ex: BLA-101"
                  value={form.sigla}
                  onChange={(e) => setForm((f) => ({ ...f, sigla: e.target.value.toUpperCase() }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                <select
                  className="input w-full text-sm"
                  value={form.tipo}
                  onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as Tipo }))}
                >
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Capacidade (vagas)</label>
                <input
                  className="input w-full text-sm"
                  type="number"
                  min={0}
                  placeholder="Ex: 30"
                  value={form.capacidade}
                  onChange={(e) => setForm((f) => ({ ...f, capacidade: e.target.value }))}
                />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tags / Área de uso</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.tags.map((t) => (
                  <TagChip key={t} tag={t} onRemove={() => removeTag(t)} />
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder="Digitar ou selecionar tag..."
                  value={form.tagInput}
                  onChange={(e) => setForm((f) => ({ ...f, tagInput: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(form.tagInput); } }}
                  list="tags-sugeridas"
                />
                <datalist id="tags-sugeridas">
                  {TAGS_SUGERIDAS.filter((t) => !form.tags.includes(t)).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={() => addTag(form.tagInput)}
                  disabled={!form.tagInput.trim()}
                  className="btn-secondary text-sm px-3 disabled:opacity-40"
                >
                  Adicionar
                </button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {TAGS_SUGERIDAS.filter((t) => !form.tags.includes(t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTag(t)}
                    className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Observações */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
              <textarea
                className="input w-full text-sm resize-none"
                rows={3}
                placeholder="Informações adicionais: equipamentos, restrições de uso, responsável..."
                value={form.observacoes}
                onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
              />
            </div>

            {/* Ativo */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                className="h-4 w-4"
              />
              <span className="text-sm text-gray-700">Ambiente ativo</span>
            </label>
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 flex justify-end gap-2 shrink-0">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => salvar.mutate()}
              disabled={!canSave || salvar.isPending}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
            >
              {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────

function ConfirmDeleteModal({
  ambiente, onClose, onDeleted,
}: {
  ambiente: Ambiente;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useMutation({
    mutationFn: () => ambientesApi.deletar(ambiente.id),
    onSuccess: () => { toast.success("Ambiente removido."); onDeleted(); onClose(); },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao remover."),
  });
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm pointer-events-auto p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900">Remover ambiente?</p>
              <p className="text-sm text-gray-500 mt-1">
                <span className="font-medium">{ambiente.nome}</span>
                {ambiente.bloco ? ` (${ambiente.bloco})` : ""}
                {" "}será removido permanentemente.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-1.5"
            >
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Delete Lote ────────────────────────────────────────────────────────────────

function ConfirmDeleteLoteModal({
  filtros, total, onClose, onDeleted,
}: {
  filtros: { bloco?: string; tipo?: string };
  total: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useMutation({
    mutationFn: () => ambientesApi.deletarTodos({ ...filtros, confirmar: true }),
    onSuccess: (res: any) => {
      toast.success(`${res.removidos} ambiente(s) removido(s).`);
      onDeleted();
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao remover."),
  });
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm pointer-events-auto p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-gray-900">Remover em lote?</p>
              <p className="text-sm text-gray-500 mt-1">
                {total} ambiente(s) {filtros.bloco ? `do bloco "${filtros.bloco}"` : ""}
                {filtros.tipo ? ` do tipo "${filtros.tipo}"` : ""}
                {" "}serão removidos permanentemente.
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-1.5"
            >
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Remover {total}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

// ── GradeOcupacao ─────────────────────────────────────────────────────────────

const TURNOS = ["Manhã", "Tarde", "Noite"] as const;
type Turno = typeof TURNOS[number];

const TURNO_STYLE: Record<Turno, { bg: string; text: string; dot: string }> = {
  "Manhã":  { bg: "bg-amber-100",  text: "text-amber-800",  dot: "bg-amber-400"  },
  "Tarde":  { bg: "bg-sky-100",    text: "text-sky-800",    dot: "bg-sky-400"    },
  "Noite":  { bg: "bg-indigo-100", text: "text-indigo-800", dot: "bg-indigo-400" },
};

function weekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isoDate(d: Date): string {
  // usa data local, não UTC, para evitar desvio de fuso horário
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function GradeOcupacao() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => weekMonday(today));
  const [filtroBloco, setFiltroBloco] = useState<string>("");

  const weekEnd = addDays(weekStart, 5); // Mon→Sat
  const dias = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i));

  const { data, isLoading } = useQuery({
    queryKey: ["ambientes-ocupacao", isoDate(weekStart), filtroBloco],
    queryFn: () => ambientesApi.ocupacao({
      data_inicio: isoDate(weekStart),
      data_fim: isoDate(weekEnd),
      bloco: filtroBloco || undefined,
    }),
    staleTime: 60_000,
  });

  const ambientes: any[] = data?.ambientes ?? [];
  const blocos: string[] = data?.blocos ?? [];
  const ocupacoes: any[] = data?.ocupacoes ?? [];
  const extras: string[] = data?.extras ?? [];
  const debugRawSalas: string[] = data?.debug_raw_salas ?? [];
  const debugTotalAulas: number = data?.debug_total_aulas ?? 0;

  // Índice: ambiente-nome (uppercase) → data → turno → lista de ocupações
  const idx = useMemo(() => {
    const m = new Map<string, Map<string, Map<string, any[]>>>();
    for (const o of ocupacoes) {
      const key = (o.ambiente ?? "").toUpperCase();
      if (!m.has(key)) m.set(key, new Map());
      const byDate = m.get(key)!;
      if (!byDate.has(o.data)) byDate.set(o.data, new Map());
      const byTurno = byDate.get(o.data)!;
      const t = o.turno ?? "Manhã";
      if (!byTurno.has(t)) byTurno.set(t, []);
      byTurno.get(t)!.push(o);
    }
    return m;
  }, [ocupacoes]);

  const diaNomes = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const navLabel = `${weekStart.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${weekEnd.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}`;

  function OcupCell({ nomeAmb, iso }: { nomeAmb: string; iso: string }) {
    const byTurno = idx.get(nomeAmb.toUpperCase())?.get(iso);
    return (
      <td className="border border-gray-200 p-0 align-top min-w-[120px]">
        <div className="divide-y divide-gray-100">
          {TURNOS.map((turno) => {
            const aulas = byTurno?.get(turno) ?? [];
            const s = TURNO_STYLE[turno];
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
              <div
                key={turno}
                className={cn(
                  "px-1.5 py-1 min-h-[34px]",
                  choque ? "bg-red-50 border-l-2 border-red-400" : s.bg
                )}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  {choque ? (
                    <Zap className="w-2.5 h-2.5 text-red-500 shrink-0" />
                  ) : (
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
                  )}
                  <span className={cn(
                    "text-[9px] font-bold uppercase tracking-wide",
                    choque ? "text-red-600" : s.text
                  )}>
                    {choque ? `CHOQUE (${aulas.length})` : turno}
                  </span>
                </div>
                {aulas.map((a: any, i: number) => (
                  <div
                    key={i}
                    className={cn(
                      "mb-1 last:mb-0 pl-1",
                      choque && i > 0 && "mt-1 pt-1 border-t border-red-200"
                    )}
                  >
                    <p
                      className={cn("text-[10px] font-semibold leading-snug break-words", choque ? "text-red-700" : s.text)}
                    >
                      {a.evento_nome ?? "—"}
                    </p>
                    {a.uc_nome && (
                      <p className="text-[9px] text-gray-500 leading-snug break-words">
                        {a.uc_nome}
                      </p>
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

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Navegação de semana */}
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-1">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[200px] text-center px-1">{navLabel}</span>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => setWeekStart(weekMonday(today))}
          className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
        >
          Semana atual
        </button>

        {/* Filtro por bloco */}
        <select
          className="input text-sm py-2 min-w-[140px]"
          value={filtroBloco}
          onChange={(e) => setFiltroBloco(e.target.value)}
        >
          <option value="">Todos os blocos</option>
          {blocos.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>

        {/* Legenda */}
        <div className="ml-auto flex items-center gap-3">
          {TURNOS.map((t) => {
            const s = TURNO_STYLE[t];
            return (
              <span key={t} className="flex items-center gap-1 text-xs text-gray-500">
                <span className={cn("w-2.5 h-2.5 rounded-full", s.dot)} />
                {t}
              </span>
            );
          })}
          <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
            <Zap className="w-3 h-3" /> Choque
          </span>
        </div>
      </div>

      {/* Grade */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin mr-3" />
          <span>Carregando ocupação...</span>
        </div>
      ) : ambientes.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center gap-4 text-gray-400">
          <DoorOpen className="h-12 w-12 opacity-30" />
          <p className="font-medium text-gray-500">Nenhum ambiente cadastrado.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap sticky left-0 bg-gray-50 z-10 border-r border-gray-200">
                    Ambiente
                  </th>
                  {dias.map((d, i) => {
                    const isToday = isoDate(d) === isoDate(today);
                    return (
                      <th
                        key={i}
                        className={cn(
                          "px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide whitespace-nowrap min-w-[110px]",
                          isToday ? "bg-blue-50 text-blue-700" : "text-gray-500"
                        )}
                      >
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
                {ambientes.map((amb: any, ri: number) => (
                  <tr key={amb.id} className={cn("border-b last:border-0", ri % 2 === 0 ? "bg-white" : "bg-gray-50/30")}>
                    <td className={cn("px-3 py-2 sticky left-0 z-10 border-r border-gray-200 min-w-[160px]", ri % 2 === 0 ? "bg-white" : "bg-gray-50/30")}>
                      <div className="flex flex-col gap-0.5">
                        {amb.bloco && (
                          <span className="font-mono text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded self-start">{amb.bloco}</span>
                        )}
                        <p className="text-xs font-semibold text-gray-800 leading-snug">{amb.sigla ?? amb.nome}</p>
                        {amb.sigla && <p className="text-[10px] text-gray-400 leading-tight truncate max-w-[140px]" title={amb.nome}>{amb.nome}</p>}
                        {amb.capacidade != null && (
                          <span className="flex items-center gap-0.5 text-[10px] text-gray-400">
                            <Users className="h-2.5 w-2.5" />{amb.capacidade}
                          </span>
                        )}
                      </div>
                    </td>
                    {dias.map((d) => (
                      <OcupCell key={isoDate(d)} nomeAmb={amb.nome} iso={isoDate(d)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400 flex items-center gap-4 flex-wrap">
            <span>{ambientes.length} ambiente(s) · {ocupacoes.length} aula(s) no período</span>
            {(() => {
              const choques = ocupacoes.reduce((acc: Record<string, number>, o: any) => {
                const k = `${o.ambiente}|${o.data}|${o.turno}`;
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {});
              const total = Object.values(choques).filter((v) => (v as number) > 1).length;
              return total > 0 ? (
                <span className="flex items-center gap-1 text-red-500 font-semibold">
                  <Zap className="h-3 w-3" /> {total} choque(s) de sala
                </span>
              ) : null;
            })()}
            {extras.length > 0 && (
              <span
                className="text-amber-600 cursor-help"
                title={`Valores brutos encontrados no banco:\n${debugRawSalas.join("\n")}`}
              >
                ⚠ {extras.length} sala(s) sem correspondência cadastrada: {extras.slice(0, 5).join(", ")}{extras.length > 5 ? "…" : ""}
                {debugRawSalas.length > 0 && (
                  <span className="text-[10px] text-amber-500 ml-1">
                    (raw: {debugRawSalas.slice(0, 3).join("; ")}{debugRawSalas.length > 3 ? "…" : ""})
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AmbientesPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [aba, setAba] = useState<"lista" | "grade">("lista");

  // Filtros
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroBloco, setFiltroBloco] = useState<string>("");
  const [filtroTag, setFiltroTag] = useState<string>("");
  const [filtroAtivo, setFiltroAtivo] = useState<boolean | undefined>(true);

  // UI state
  const [modalAberto, setModalAberto] = useState<"novo" | null>(null);
  const [drawerAberto, setDrawerAberto] = useState<Ambiente | null>(null);
  const [confirmarDelete, setConfirmarDelete] = useState<Ambiente | null>(null);
  const [confirmarDeleteLote, setConfirmarDeleteLote] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const { data: ambientes = [], isLoading } = useQuery<Ambiente[]>({
    queryKey: ["ambientes"],
    queryFn: () => ambientesApi.listar(),
    staleTime: 30_000,
  });

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["ambientes"] });
  }

  // Filtros locais (client-side para resposta imediata)
  const lista = useMemo(() => {
    let r = [...ambientes];
    if (filtroAtivo !== undefined) r = r.filter((a) => a.ativo === filtroAtivo);
    if (filtroTipo !== "todos") r = r.filter((a) => a.tipo === filtroTipo);
    if (filtroBloco) r = r.filter((a) => a.bloco?.toLowerCase().includes(filtroBloco.toLowerCase()));
    if (filtroTag) r = r.filter((a) => a.tags.some((t) => t.toLowerCase().includes(filtroTag.toLowerCase())));
    if (busca) {
      const q = busca.toLowerCase();
      r = r.filter((a) =>
        a.nome.toLowerCase().includes(q) ||
        (a.bloco ?? "").toLowerCase().includes(q) ||
        (a.sigla ?? "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [ambientes, filtroAtivo, filtroTipo, filtroBloco, filtroTag, busca]);

  // Blocos únicos para sugestão
  const blocos = useMemo(() =>
    [...new Set(ambientes.map((a) => a.bloco).filter(Boolean) as string[])].sort(),
    [ambientes]
  );

  // Tags únicas para sugestão
  const tagsUnicas = useMemo(() =>
    [...new Set(ambientes.flatMap((a) => a.tags))].sort(),
    [ambientes]
  );

  // Resumo por tipo
  const resumo = useMemo(() => {
    const c: Record<string, number> = { "Sala Teórica": 0, "Laboratório": 0, "Híbrido": 0 };
    for (const a of ambientes.filter((x) => x.ativo)) {
      c[a.tipo] = (c[a.tipo] ?? 0) + 1;
    }
    return c;
  }, [ambientes]);

  // Import
  const importar = useMutation({
    mutationFn: (file: File) => ambientesApi.importar(file),
    onSuccess: (res: any) => {
      toast.success(`Importação concluída: ${res.inseridos} inseridos, ${res.atualizados} atualizados.`);
      if (res.erros?.length) res.erros.slice(0, 3).forEach((e: string) => toast.error(e));
      invalidar();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao importar."),
  });

  async function baixarTemplate() {
    try {
      const res = await ambientesApi.template();
      downloadBlob(res.data as Blob, "modelo_ambientes.xlsx");
    } catch {
      toast.error("Erro ao baixar template.");
    }
  }

  const temFiltrosAtivos = filtroTipo !== "todos" || filtroBloco || filtroTag;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salas e Laboratórios"
        description="Cadastro de ambientes de aprendizagem: salas teóricas, laboratórios e espaços híbridos"
      >
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={baixarTemplate}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-colors"
          >
            <Download className="h-4 w-4" /> Modelo Excel
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importar.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors disabled:opacity-50"
          >
            {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Importar Planilha
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importar.mutate(f); e.target.value = ""; }}
          />
          <button
            onClick={() => setModalAberto("novo")}
            className="btn-primary flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Novo Ambiente
          </button>
        </div>
      </PageHeader>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setAba("lista")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            aba === "lista"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <List className="h-4 w-4" /> Lista
        </button>
        <button
          onClick={() => setAba("grade")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            aba === "grade"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          )}
        >
          <LayoutGrid className="h-4 w-4" /> Grade de Ocupação
        </button>
      </div>

      {aba === "grade" && <GradeOcupacao />}

      {aba === "lista" && <>

      {/* Cards resumo */}
      <div className="grid grid-cols-3 gap-4">
        {TIPOS.map((tipo) => {
          const s = TIPO_STYLE[tipo];
          const Icon = s.icon;
          return (
            <button
              key={tipo}
              onClick={() => setFiltroTipo(filtroTipo === tipo ? "todos" : tipo)}
              className={cn(
                "card p-4 text-left flex items-center gap-3 transition-all hover:shadow-md",
                filtroTipo === tipo ? cn(s.bg, "border-2", s.border) : "hover:border-gray-300"
              )}
            >
              <div className={cn("p-2 rounded-lg", s.bg)}>
                <Icon className={cn("h-5 w-5", s.text)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{resumo[tipo] ?? 0}</p>
                <p className="text-xs text-gray-500">{tipo}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Barra de busca e filtros */}
      <div className="card px-4 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Buscar por nome ou bloco..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {busca && (
              <button onClick={() => setBusca("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltrosAbertos(!filtrosAbertos)}
            className={cn(
              "flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors",
              (filtrosAbertos || temFiltrosAtivos)
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            )}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {temFiltrosAtivos && <span className="ml-1 bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">!</span>}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", filtrosAbertos && "rotate-180")} />
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filtroAtivo === true}
              onChange={(e) => setFiltroAtivo(e.target.checked ? true : undefined)}
            />
            Apenas ativos
          </label>
          {lista.length > 0 && (
            <button
              onClick={() => setConfirmarDeleteLote(true)}
              className="ml-auto flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remover filtrados ({lista.length})
            </button>
          )}
        </div>

        {/* Filtros expandidos */}
        {filtrosAbertos && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Bloco</label>
              <input
                className="input w-full text-sm"
                placeholder="Filtrar por bloco..."
                value={filtroBloco}
                onChange={(e) => setFiltroBloco(e.target.value)}
                list="blocos-lista"
              />
              <datalist id="blocos-lista">
                {blocos.map((b) => <option key={b} value={b} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tipo</label>
              <select
                className="input w-full text-sm"
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
              >
                <option value="todos">Todos os tipos</option>
                {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tag / Área</label>
              <input
                className="input w-full text-sm"
                placeholder="Filtrar por tag..."
                value={filtroTag}
                onChange={(e) => setFiltroTag(e.target.value)}
                list="tags-lista"
              />
              <datalist id="tags-lista">
                {tagsUnicas.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
            {temFiltrosAtivos && (
              <div className="sm:col-span-3 flex justify-end">
                <button
                  onClick={() => { setFiltroTipo("todos"); setFiltroBloco(""); setFiltroTag(""); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  ✕ Limpar filtros
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin mr-3" />
          <span>Carregando ambientes...</span>
        </div>
      ) : lista.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center gap-4 text-gray-400">
          <DoorOpen className="h-12 w-12 opacity-30" />
          <div>
            <p className="font-medium text-gray-500">Nenhum ambiente encontrado.</p>
            <p className="text-sm mt-1">
              {ambientes.length === 0
                ? "Clique em \"Novo Ambiente\" ou importe uma planilha para começar."
                : "Tente ajustar os filtros."}
            </p>
          </div>
          {ambientes.length === 0 && (
            <button onClick={() => { setModalAberto("novo"); }} className="btn-primary flex items-center gap-1.5">
              <Plus className="h-4 w-4" /> Novo Ambiente
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {["Bloco", "Sigla", "Nome / Identificação", "Tipo", "Capacidade", "Tags", "Observações", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((a, i) => (
                  <tr
                    key={a.id}
                    onClick={() => setDrawerAberto(a)}
                    className={cn(
                      "border-b last:border-0 transition-colors hover:bg-blue-50/60 cursor-pointer",
                      !a.ativo && "opacity-50",
                      i % 2 === 0 ? "bg-white" : "bg-gray-50/40",
                      drawerAberto?.id === a.id && "bg-blue-50 border-l-2 border-l-blue-500"
                    )}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.bloco ? (
                        <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{a.bloco}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.sigla ? (
                        <span className="font-mono text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-700 px-2 py-0.5 rounded">{a.sigla}</span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{a.nome}</p>
                      {!a.ativo && <span className="text-[10px] text-gray-400 italic">Inativo</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <TipoBadge tipo={a.tipo as Tipo} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {a.capacidade != null ? (
                        <span className="flex items-center gap-1 text-gray-700">
                          <Users className="h-3.5 w-3.5 text-gray-400" />
                          {a.capacidade}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {a.tags.length > 0
                          ? a.tags.map((t) => <TagChip key={t} tag={t} />)
                          : <span className="text-gray-300 text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {a.observacoes ? (
                        <p className="text-xs text-gray-500 truncate" title={a.observacoes}>{a.observacoes}</p>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmarDelete(a); }}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-400">
            {lista.length} ambiente(s) exibido(s)
            {lista.length !== ambientes.length ? ` de ${ambientes.length} total` : ""}
          </div>
        </div>
      )}

      </>}

      {/* Drawer de detalhe/edição */}
      {drawerAberto && (
        <AmbienteDrawer
          ambiente={drawerAberto}
          onClose={() => setDrawerAberto(null)}
          onSaved={invalidar}
          onDeleted={() => { invalidar(); setDrawerAberto(null); }}
        />
      )}

      {/* Modal de criação */}
      {modalAberto === "novo" && (
        <AmbienteModal
          inicial={null}
          onClose={() => setModalAberto(null)}
          onSaved={invalidar}
        />
      )}

      {confirmarDelete && (
        <ConfirmDeleteModal
          ambiente={confirmarDelete}
          onClose={() => setConfirmarDelete(null)}
          onDeleted={invalidar}
        />
      )}

      {confirmarDeleteLote && (
        <ConfirmDeleteLoteModal
          filtros={{
            bloco: filtroBloco || undefined,
            tipo: filtroTipo !== "todos" ? filtroTipo : undefined,
          }}
          total={lista.length}
          onClose={() => setConfirmarDeleteLote(false)}
          onDeleted={invalidar}
        />
      )}
    </div>
  );
}
