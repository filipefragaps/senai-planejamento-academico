"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ofertasApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Pencil, Save, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────────────────────
export interface Oferta {
  id: number;
  codigo_evento: string;
  semestre: number;
  nome_curso: string;
  modalidade: string;
  area: string | null;
  pasta: string | null;
  turno: string | null;
  dias_semana_texto: string | null;
  cidade: string | null;
  carga_horaria: number;
  hora_inicio: string | null;
  hora_termino: string | null;
  data_inicio: string | null;
  data_termino: string | null;
  status: string;
  vagas: number;
  min_para_inicio: number;
  parcelas_boleto: number | null;
  valor_individual: number | null;
  parcela_com_desconto: number | null;
  total_por_aluno: number | null;
  hora_aula: number | null;
  alunos_matriculados: number;
  previsao_inicio: string | null;
  execucao: string | null;
  status_cronograma: string | null;
}

type FormData = Partial<Omit<Oferta, "id" | "codigo_evento">>;

// ── Constantes ────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  "INICIOU",
  "EM MATRÍCULA",
  "CANCELADO",
  "PLANEJADO",
  "NÃO DEFINIDO",
];

const STATUS_CONFIG: Record<string, string> = {
  "INICIOU":      "bg-green-100 text-green-800",
  "EM MATRÍCULA": "bg-yellow-100 text-yellow-800",
  "CANCELADO":    "bg-red-100 text-red-700",
  "PLANEJADO":    "bg-blue-100 text-blue-700",
  "NÃO DEFINIDO": "bg-gray-100 text-gray-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function moeda(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  // ISO date: "YYYY-MM-DD" → "DD/MM/YYYY"
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return d;
}

// ── Sub-componentes ───────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1.5 mb-3">
      {children}
    </h4>
  );
}

function TextInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="input w-full text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function NumberInput({
  value, onChange, step = 1,
}: { value: number | null | undefined; onChange: (v: number | null) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      className="input w-full text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value)}
    />
  );
}

// ── Drawer principal ──────────────────────────────────────────────────────────
interface OfertaDrawerProps {
  oferta: Oferta | null;
  onClose: () => void;
}

export function OfertaDrawer({ oferta, onClose }: OfertaDrawerProps) {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormData>({});

  useEffect(() => {
    if (oferta) {
      setForm(ofertaToForm(oferta));
      setEditMode(false);
    }
  }, [oferta?.id]);

  const salvar = useMutation({
    mutationFn: () => ofertasApi.atualizar(oferta!.id, form as Record<string, unknown>),
    onSuccess: (updated) => {
      toast.success("Evento atualizado.");
      qc.setQueryData(
        ["ofertas"],
        (old: Oferta[] | undefined) =>
          old ? old.map((o) => (o.id === updated.id ? updated : o)) : old,
      );
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      setEditMode(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    },
  });

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (!oferta) return null;

  const open = !!oferta;

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          "fixed inset-0 bg-black/30 z-40 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[520px] max-w-full bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b shrink-0">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs text-gray-400 mb-0.5">{oferta.codigo_evento}</p>
            <h2 className="font-semibold text-gray-900 leading-snug text-sm line-clamp-2">
              {editMode ? (
                <TextInput value={form.nome_curso ?? ""} onChange={(v) => set("nome_curso", v)} />
              ) : (
                oferta.nome_curso
              )}
            </h2>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={cn("badge text-xs font-medium", STATUS_CONFIG[oferta.status] ?? "bg-gray-100 text-gray-600")}>
                {oferta.status}
              </span>
              <span className={cn(
                "text-xs font-bold px-1.5 py-0.5 rounded",
                oferta.semestre === 1 ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700",
              )}>
                {oferta.semestre}° Semestre
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Identificação */}
          <section>
            <SectionTitle>Identificação</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Código do evento">
                <span className="font-mono">{oferta.codigo_evento}</span>
              </Field>
              <Field label="Pasta / Código Curso">
                {editMode
                  ? <TextInput value={form.pasta ?? ""} onChange={(v) => set("pasta", v)} />
                  : <span>{oferta.pasta || "—"}</span>}
              </Field>
              <Field label="Modalidade">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.modalidade ?? ""} onChange={(e) => set("modalidade", e.target.value)}>
                      <option value="">Selecione</option>
                      <option>QUALIFICAÇÃO PROFISSIONAL</option>
                      <option>HABILITAÇÃO TÉCNICA</option>
                      <option>FIC</option>
                    </select>
                  )
                  : <span>{oferta.modalidade || "—"}</span>}
              </Field>
              <Field label="Área">
                {editMode
                  ? <TextInput value={form.area ?? ""} onChange={(v) => set("area", v)} />
                  : <span>{oferta.area || "—"}</span>}
              </Field>
            </div>
          </section>

          {/* Turma */}
          <section>
            <SectionTitle>Turma</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Turno">
                {editMode
                  ? <TextInput value={form.turno ?? ""} onChange={(v) => set("turno", v)} />
                  : <span>{oferta.turno || "—"}</span>}
              </Field>
              <Field label="Cidade">
                {editMode
                  ? <TextInput value={form.cidade ?? ""} onChange={(v) => set("cidade", v)} />
                  : <span>{oferta.cidade || "—"}</span>}
              </Field>
              <Field label="Dias da semana">
                {editMode
                  ? <TextInput value={form.dias_semana_texto ?? ""} onChange={(v) => set("dias_semana_texto", v)} />
                  : <span>{oferta.dias_semana_texto || "—"}</span>}
              </Field>
              <Field label="Carga horária (h)">
                {editMode
                  ? <NumberInput value={form.carga_horaria} onChange={(v) => set("carga_horaria", v ?? 0)} />
                  : <span>{oferta.carga_horaria > 0 ? `${oferta.carga_horaria}h` : "—"}</span>}
              </Field>
              <Field label="Hora início">
                {editMode
                  ? <input type="time" className="input w-full text-sm" value={form.hora_inicio ?? ""} onChange={(e) => set("hora_inicio", e.target.value || null)} />
                  : <span>{oferta.hora_inicio || "—"}</span>}
              </Field>
              <Field label="Hora término">
                {editMode
                  ? <input type="time" className="input w-full text-sm" value={form.hora_termino ?? ""} onChange={(e) => set("hora_termino", e.target.value || null)} />
                  : <span>{oferta.hora_termino || "—"}</span>}
              </Field>
            </div>
          </section>

          {/* Período & Status */}
          <section>
            <SectionTitle>Período &amp; Status</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Data de início">
                {editMode
                  ? <input type="date" className="input w-full text-sm" value={form.data_inicio ?? ""} onChange={(e) => set("data_inicio", e.target.value || null)} />
                  : <span>{fmtDate(oferta.data_inicio)}</span>}
              </Field>
              <Field label="Data de término">
                {editMode
                  ? <input type="date" className="input w-full text-sm" value={form.data_termino ?? ""} onChange={(e) => set("data_termino", e.target.value || null)} />
                  : <span>{fmtDate(oferta.data_termino)}</span>}
              </Field>
              <Field label="Status">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.status ?? ""} onChange={(e) => set("status", e.target.value)}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )
                  : (
                    <span className={cn("badge text-xs font-medium", STATUS_CONFIG[oferta.status] ?? "bg-gray-100 text-gray-600")}>
                      {oferta.status}
                    </span>
                  )}
              </Field>
              <Field label="Semestre">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.semestre ?? oferta.semestre} onChange={(e) => set("semestre", +e.target.value)}>
                      <option value={1}>1° Semestre</option>
                      <option value={2}>2° Semestre</option>
                    </select>
                  )
                  : <span>{oferta.semestre}° Semestre</span>}
              </Field>
            </div>
          </section>

          {/* Matrícula */}
          <section>
            <SectionTitle>Matrícula</SectionTitle>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Vagas">
                {editMode
                  ? <NumberInput value={form.vagas} onChange={(v) => set("vagas", v ?? 0)} />
                  : <span>{oferta.vagas}</span>}
              </Field>
              <Field label="Mínimo p/ início">
                {editMode
                  ? <NumberInput value={form.min_para_inicio} onChange={(v) => set("min_para_inicio", v ?? 0)} />
                  : <span>{oferta.min_para_inicio || "—"}</span>}
              </Field>
              <Field label="Matriculados">
                {editMode
                  ? <NumberInput value={form.alunos_matriculados} onChange={(v) => set("alunos_matriculados", v ?? 0)} />
                  : (
                    <span className={cn("font-semibold",
                      oferta.alunos_matriculados >= oferta.min_para_inicio ? "text-green-600" : "text-amber-600"
                    )}>
                      {oferta.alunos_matriculados}
                      {oferta.min_para_inicio > 0 && (
                        <span className="text-gray-400 font-normal">/{oferta.min_para_inicio}</span>
                      )}
                    </span>
                  )}
              </Field>
            </div>
          </section>

          {/* Financeiro */}
          <section>
            <SectionTitle>Financeiro</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Valor individual">
                {editMode
                  ? <NumberInput value={form.valor_individual} step={0.01} onChange={(v) => set("valor_individual", v)} />
                  : <span>{moeda(oferta.valor_individual)}</span>}
              </Field>
              <Field label="Parcela c/ desconto">
                {editMode
                  ? <NumberInput value={form.parcela_com_desconto} step={0.01} onChange={(v) => set("parcela_com_desconto", v)} />
                  : <span>{moeda(oferta.parcela_com_desconto)}</span>}
              </Field>
              <Field label="Total por aluno">
                {editMode
                  ? <NumberInput value={form.total_por_aluno} step={0.01} onChange={(v) => set("total_por_aluno", v)} />
                  : <span>{moeda(oferta.total_por_aluno)}</span>}
              </Field>
              <Field label="Parcelas boleto">
                {editMode
                  ? <NumberInput value={form.parcelas_boleto} onChange={(v) => set("parcelas_boleto", v)} />
                  : <span>{oferta.parcelas_boleto ?? "—"}</span>}
              </Field>
              <Field label="Hora aula">
                {editMode
                  ? <NumberInput value={form.hora_aula} onChange={(v) => set("hora_aula", v)} />
                  : <span>{oferta.hora_aula ? `${oferta.hora_aula}h` : "—"}</span>}
              </Field>
            </div>
          </section>

          {/* Cronograma */}
          <section>
            <SectionTitle>Cronograma</SectionTitle>
            <div className="grid grid-cols-1 gap-y-3">
              <Field label="Previsão de início">
                {editMode
                  ? <TextInput value={form.previsao_inicio ?? ""} onChange={(v) => set("previsao_inicio", v || null)} />
                  : <span>{fmtDate(oferta.previsao_inicio)}</span>}
              </Field>
              <Field label="Execução">
                {editMode
                  ? <TextInput value={form.execucao ?? ""} onChange={(v) => set("execucao", v || null)} />
                  : <span>{fmtDate(oferta.execucao)}</span>}
              </Field>
              <Field label="Status do cronograma">
                {editMode
                  ? <TextInput value={form.status_cronograma ?? ""} onChange={(v) => set("status_cronograma", v || null)} />
                  : <span>{oferta.status_cronograma || "—"}</span>}
              </Field>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 shrink-0 flex justify-end gap-2">
          {editMode ? (
            <>
              <button
                onClick={() => { setForm(ofertaToForm(oferta)); setEditMode(false); }}
                className="btn-secondary flex items-center gap-1.5"
                disabled={salvar.isPending}
              >
                <XCircle className="h-4 w-4" /> Cancelar
              </button>
              <button
                onClick={() => salvar.mutate()}
                disabled={salvar.isPending}
                className="btn-primary flex items-center gap-1.5"
              >
                {salvar.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Save className="h-4 w-4" />}
                Salvar alterações
              </button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)} className="btn-primary flex items-center gap-1.5">
              <Pencil className="h-4 w-4" /> Editar
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Converte Oferta → FormData (datas/horas como string para os inputs) ────────
function ofertaToForm(o: Oferta): FormData {
  return {
    nome_curso: o.nome_curso,
    modalidade: o.modalidade,
    area: o.area,
    pasta: o.pasta,
    turno: o.turno,
    dias_semana_texto: o.dias_semana_texto,
    cidade: o.cidade,
    carga_horaria: o.carga_horaria,
    hora_inicio: o.hora_inicio,
    hora_termino: o.hora_termino,
    data_inicio: o.data_inicio,
    data_termino: o.data_termino,
    status: o.status,
    vagas: o.vagas,
    min_para_inicio: o.min_para_inicio,
    parcelas_boleto: o.parcelas_boleto,
    valor_individual: o.valor_individual,
    parcela_com_desconto: o.parcela_com_desconto,
    total_por_aluno: o.total_por_aluno,
    hora_aula: o.hora_aula,
    alunos_matriculados: o.alunos_matriculados,
    previsao_inicio: o.previsao_inicio,
    execucao: o.execucao,
    status_cronograma: o.status_cronograma,
    semestre: o.semestre,
  };
}
