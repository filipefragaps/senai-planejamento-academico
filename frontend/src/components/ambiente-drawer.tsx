"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ambientesApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Pencil, Trash2, Save, FlaskConical, BookOpen, Layers,
  DoorOpen, Users, Tag, Loader2, AlertTriangle,
} from "lucide-react";
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

type Tipo = "Sala Teórica" | "Laboratório" | "Híbrido";

// ── Constants ──────────────────────────────────────────────────────────────────

const TIPOS = ["Sala Teórica", "Laboratório", "Híbrido"] as const;

const TIPO_STYLE: Record<Tipo, { bg: string; text: string; border: string; icon: typeof BookOpen }> = {
  "Sala Teórica": { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200",   icon: BookOpen     },
  "Laboratório":  { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200",  icon: FlaskConical },
  "Híbrido":      { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", icon: Layers       },
};

const TAGS_SUGERIDAS = [
  "Automação", "Elétrica", "Informática", "Mecânica", "Refrigeração",
  "Soldagem", "Eletrônica", "Robótica", "Redes", "Desenho Técnico",
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function TipoBadge({ tipo }: { tipo: Tipo }) {
  const s = TIPO_STYLE[tipo] ?? TIPO_STYLE["Sala Teórica"];
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border", s.bg, s.text, s.border)}>
      <Icon className="h-3.5 w-3.5" />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

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
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none">
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

// ── Drawer ─────────────────────────────────────────────────────────────────────

export function AmbienteDrawer({
  ambiente,
  onClose,
  onSaved,
  onDeleted,
}: {
  ambiente: Ambiente;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();

  const [editMode, setEditMode] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState({
    bloco: ambiente.bloco ?? "",
    nome: ambiente.nome,
    sigla: ambiente.sigla ?? "",
    capacidade: String(ambiente.capacidade ?? ""),
    tipo: ambiente.tipo as Tipo,
    tags: [...(ambiente.tags ?? [])],
    tagInput: "",
    observacoes: ambiente.observacoes ?? "",
    ativo: ambiente.ativo,
  });

  // Reset form when switching back to view
  useEffect(() => {
    if (!editMode) {
      setForm({
        bloco: ambiente.bloco ?? "",
        nome: ambiente.nome,
        sigla: ambiente.sigla ?? "",
        capacidade: String(ambiente.capacidade ?? ""),
        tipo: ambiente.tipo as Tipo,
        tags: [...(ambiente.tags ?? [])],
        tagInput: "",
        observacoes: ambiente.observacoes ?? "",
        ativo: ambiente.ativo,
      });
    }
  }, [editMode, ambiente]);

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
      return ambientesApi.atualizar(ambiente.id, payload);
    },
    onSuccess: () => {
      toast.success("Ambiente atualizado.");
      qc.invalidateQueries({ queryKey: ["ambientes"] });
      onSaved();
      setEditMode(false);
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
  const s = TIPO_STYLE[ambiente.tipo] ?? TIPO_STYLE["Sala Teórica"];

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] max-w-full bg-white shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* Header */}
        <div className={cn("px-5 py-4 border-b shrink-0", s.bg)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={cn("p-2 rounded-lg border shrink-0", s.bg, s.border)}>
                <s.icon className={cn("h-5 w-5", s.text)} />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 leading-tight truncate">{ambiente.nome}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {ambiente.bloco && (
                    <span className="font-mono text-xs bg-white/70 border border-gray-200 px-2 py-0.5 rounded text-gray-700">{ambiente.bloco}</span>
                  )}
                  {ambiente.sigla && (
                    <span className={cn("font-mono text-xs font-semibold px-2 py-0.5 rounded border bg-white/80", s.text, s.border)}>{ambiente.sigla}</span>
                  )}
                  {!ambiente.ativo && (
                    <span className="text-[10px] bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-medium">Inativo</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-black/10 text-gray-500 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!editMode ? (
            /* ── VIEW MODE ── */
            <div className="space-y-5">
              {/* Identificação */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Identificação</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Tipo">
                    <TipoBadge tipo={ambiente.tipo} />
                  </Field>
                  <Field label="Capacidade">
                    {ambiente.capacidade != null ? (
                      <span className="flex items-center gap-1.5 text-gray-700">
                        <Users className="h-4 w-4 text-gray-400" />
                        {ambiente.capacidade} vagas
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs italic">Não informado</span>
                    )}
                  </Field>
                  <Field label="Bloco">
                    {ambiente.bloco
                      ? <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{ambiente.bloco}</span>
                      : <span className="text-gray-400 text-xs italic">—</span>}
                  </Field>
                  <Field label="Sigla">
                    {ambiente.sigla
                      ? <span className={cn("font-mono text-xs font-semibold px-2 py-0.5 rounded border", s.text, s.border, s.bg)}>{ambiente.sigla}</span>
                      : <span className="text-gray-400 text-xs italic">—</span>}
                  </Field>
                </div>
              </div>

              {/* Tags */}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Tags / Área de uso</p>
                {ambiente.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {ambiente.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-0.5 rounded-full border border-gray-200">
                        <Tag className="h-3 w-3 text-gray-400" />
                        {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">Nenhuma tag cadastrada.</p>
                )}
              </div>

              {/* Observações */}
              {ambiente.observacoes && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Observações</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 border border-gray-100 leading-relaxed">
                    {ambiente.observacoes}
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* ── EDIT MODE ── */
            <div className="space-y-4">
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
                    list="drawer-tags-sugeridas"
                  />
                  <datalist id="drawer-tags-sugeridas">
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
                    +
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
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 shrink-0 bg-gray-50">
          {!editMode ? (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowDelete(true)}
                className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Remover
              </button>
              <button
                onClick={() => setEditMode(true)}
                className="btn-primary flex items-center gap-1.5"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditMode(false)}
                className="btn-secondary"
                disabled={salvar.isPending}
              >
                Cancelar
              </button>
              <button
                onClick={() => salvar.mutate()}
                disabled={!canSave || salvar.isPending}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
              >
                {salvar.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                Salvar
              </button>
            </div>
          )}
        </div>
      </div>

      {showDelete && (
        <ConfirmDeleteModal
          ambiente={ambiente}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { onDeleted(); onClose(); }}
        />
      )}
    </>
  );
}
