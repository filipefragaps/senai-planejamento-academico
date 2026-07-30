"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ofertasApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Pencil, Save, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constantes ────────────────────────────────────────────────────────────────
const MODALIDADES = [
  "21 - QUALIFICAÇÃO PROFISSIONAL BÁSICA - FORM. INICIAL E CONTINUADA",
  "3 - INICIAÇÃO PROFISSIONAL - FORM. INICIAL E CONTINUADA",
  "31 - HABILITAÇÃO TÉCNICA - EDUC. PROF. TÉCNICA",
  "33 - HABILITAÇÃO TÉCNICA A DISTÂNCIA - EDUC. PROF. TÉCNICA",
  "41 - GRADUAÇÃO TECNOLÓGICA - EDUCAÇÃO SUPERIOR",
  "51 - APERFEIÇOAMENTO PROFISSIONAL - FORM. INICIAL E CONTINUADA",
  "53 - APERFEIÇOAMENTO PROFISSIONAL - EDU. PROF. TEC",
  "54 - APERFEIÇOAMENTO PROFISSIONAL - AÇÕES MÓVEIS",
  "81 - GRADUAÇÃO - BACHARELADO (SUPERIOR)",
  "91 - PÓS-GRADUAÇÃO LATO SENSU ESPECIALIZAÇÃO",
];

const AREAS = [
  "Mecânica", "Elétrica", "Automação", "SEPE", "Solda",
  "Vestuário", "Marcenaria", "Administrativo", "Aviação",
];

const TURNOS = ["Matutino", "Vespertino", "Noturno"];

const DIAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];

const COORDENADORES = [
  "VIRGILIO CAPARELLI FONSECA",
  "TIAGO ALVES BARROS ROSA",
  "MARCOS MESSIAS DA CRUZ",
  "HÉLIA MARIA DE FARIA",
  "WELLIGTON MARIANO DOS PASSOS",
  "WANDERSON RAINER HILÁRIO DE ARAÚJO",
  "WILLIAM CARLOS DE ANDRADE",
];

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
  desconto_percentual: number | null;
  parcela_com_desconto: number | null;
  total_por_aluno: number | null;
  hora_aula: number | null;
  alunos_matriculados: number;
  coordenador: string | null;
  previsao_inicio: string | null;
  execucao: string | null;
  status_cronograma: string | null;
}

type FormData = Partial<Omit<Oferta, "id" | "codigo_evento">>;

// ── Helpers ───────────────────────────────────────────────────────────────────
function moeda(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
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

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="input w-full text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function NumberInput({ value, onChange, step = 1 }: { value: number | null | undefined; onChange: (v: number | null) => void; step?: number }) {
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

function CalcDisplay({ value }: { value: number | null | undefined }) {
  return (
    <div className="input w-full text-sm bg-gray-50 text-gray-700 font-medium">
      {value != null && value > 0 ? moeda(value) : <span className="text-gray-400">—</span>}
    </div>
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
  const [diasSelecionados, setDiasSelecionados] = useState<string[]>([]);

  useEffect(() => {
    if (oferta) {
      setForm(ofertaToForm(oferta));
      setEditMode(false);
      // Inicializa dias selecionados a partir do texto
      const diasTexto = oferta.dias_semana_texto ?? "";
      const parsed = diasTexto.split(/[,\s]+/).filter((d) => DIAS.includes(d));
      setDiasSelecionados(parsed);
    }
  }, [oferta?.id]);

  // Auto-cálculo financeiro quando editando
  useEffect(() => {
    if (!editMode) return;
    const vi = form.valor_individual ?? 0;
    const desc = form.desconto_percentual ?? 0;
    const nParc = form.parcelas_boleto ?? 0;
    const ch = form.carga_horaria ?? 0;

    const parcDesc = vi > 0 ? vi * (1 - desc / 100) : 0;
    const totalAluno = nParc > 0 && parcDesc > 0 ? nParc * parcDesc : 0;
    const haRegime = ch > 0 && totalAluno > 0 ? totalAluno / ch : 0;

    setForm((prev) => ({
      ...prev,
      parcela_com_desconto: parcDesc > 0 ? parseFloat(parcDesc.toFixed(2)) : null,
      total_por_aluno: totalAluno > 0 ? parseFloat(totalAluno.toFixed(2)) : null,
      hora_aula: haRegime > 0 ? parseFloat(haRegime.toFixed(4)) : null,
    }));
  }, [form.valor_individual, form.desconto_percentual, form.parcelas_boleto, form.carga_horaria, editMode]);

  const salvar = useMutation({
    mutationFn: () => ofertasApi.atualizar(oferta!.id, form as Record<string, unknown>),
    onSuccess: (updated) => {
      toast.success("Evento atualizado.");
      qc.setQueryData(
        ["ofertas"],
        (old: Oferta[] | undefined) => old ? old.map((o) => (o.id === updated.id ? updated : o)) : old,
      );
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      setEditMode(false);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao salvar"),
  });

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDia(dia: string) {
    const next = diasSelecionados.includes(dia)
      ? diasSelecionados.filter((d) => d !== dia)
      : [...diasSelecionados, dia];
    const sorted = DIAS.filter((d) => next.includes(d));
    setDiasSelecionados(sorted);
    set("dias_semana_texto", sorted.join(", ") || null);
  }

  if (!oferta) return null;

  const open = !!oferta;

  // Indicador de execução (matriculados vs mínimo)
  const pctExecucao = oferta.min_para_inicio > 0
    ? Math.min(100, (oferta.alunos_matriculados / oferta.min_para_inicio) * 100)
    : null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-black/30 z-40 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

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
              {editMode
                ? <TextInput value={form.nome_curso ?? ""} onChange={(v) => set("nome_curso", v)} />
                : oferta.nome_curso}
            </h2>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={cn(
                "text-xs font-bold px-1.5 py-0.5 rounded",
                oferta.semestre === 1 ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700",
              )}>
                {oferta.semestre}° Semestre
              </span>
              {oferta.coordenador && (
                <span className="text-xs text-gray-500 truncate">{oferta.coordenador}</span>
              )}
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
                    <select className="input w-full text-xs" value={form.modalidade ?? ""} onChange={(e) => set("modalidade", e.target.value)}>
                      {MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )
                  : <span className="text-xs">{oferta.modalidade || "—"}</span>}
              </Field>
              <Field label="Área">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.area ?? ""} onChange={(e) => set("area", e.target.value || null)}>
                      <option value="">Selecionar...</option>
                      {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  )
                  : <span>{oferta.area || "—"}</span>}
              </Field>
              <Field label="Coordenador">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.coordenador ?? ""} onChange={(e) => set("coordenador", e.target.value || null)}>
                      <option value="">Selecionar...</option>
                      {COORDENADORES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )
                  : <span>{oferta.coordenador || "—"}</span>}
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

          {/* Turma */}
          <section>
            <SectionTitle>Turma</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Turno">
                {editMode
                  ? (
                    <select className="input w-full text-sm" value={form.turno ?? ""} onChange={(e) => set("turno", e.target.value || null)}>
                      <option value="">Selecionar...</option>
                      {TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )
                  : <span>{oferta.turno || "—"}</span>}
              </Field>
              <Field label="Cidade">
                {editMode
                  ? <TextInput value={form.cidade ?? ""} onChange={(v) => set("cidade", v || null)} />
                  : <span>{oferta.cidade || "—"}</span>}
              </Field>
              <div className="col-span-2">
                <Field label="Dias da semana">
                  {editMode
                    ? (
                      <div className="flex gap-1.5 flex-wrap mt-0.5">
                        {DIAS.map((dia) => (
                          <button
                            key={dia}
                            type="button"
                            onClick={() => toggleDia(dia)}
                            className={cn(
                              "px-2.5 py-1 text-xs font-semibold rounded border transition-colors",
                              diasSelecionados.includes(dia)
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
                            )}
                          >
                            {dia}
                          </button>
                        ))}
                      </div>
                    )
                    : <span>{oferta.dias_semana_texto || "—"}</span>}
                </Field>
              </div>
              <Field label="Carga horária (h)">
                {editMode
                  ? <NumberInput value={form.carga_horaria} onChange={(v) => set("carga_horaria", v ?? 0)} />
                  : <span>{oferta.carga_horaria > 0 ? `${oferta.carga_horaria}h` : "—"}</span>}
              </Field>
              <Field label="Horário">
                {editMode
                  ? (
                    <div className="flex gap-2">
                      <input type="time" className="input flex-1 text-sm" value={form.hora_inicio ?? ""} onChange={(e) => set("hora_inicio", e.target.value || null)} />
                      <input type="time" className="input flex-1 text-sm" value={form.hora_termino ?? ""} onChange={(e) => set("hora_termino", e.target.value || null)} />
                    </div>
                  )
                  : <span>{oferta.hora_inicio && oferta.hora_termino ? `${oferta.hora_inicio} – ${oferta.hora_termino}` : "—"}</span>}
              </Field>
            </div>
          </section>

          {/* Período */}
          <section>
            <SectionTitle>Período</SectionTitle>
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
            </div>
          </section>

          {/* Matrícula / Execução */}
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
                      oferta.alunos_matriculados >= oferta.min_para_inicio && oferta.min_para_inicio > 0 ? "text-green-600" : "text-amber-600"
                    )}>
                      {oferta.alunos_matriculados}
                      {oferta.min_para_inicio > 0 && (
                        <span className="text-gray-400 font-normal">/{oferta.min_para_inicio}</span>
                      )}
                    </span>
                  )}
              </Field>
            </div>

            {/* Barra de execução */}
            {pctExecucao !== null && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Execução</span>
                  <span className={cn("font-semibold",
                    pctExecucao >= 100 ? "text-green-600"
                    : pctExecucao >= 75 ? "text-yellow-600"
                    : pctExecucao >= 50 ? "text-orange-600"
                    : "text-red-600"
                  )}>
                    {Math.round(pctExecucao)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all",
                      pctExecucao >= 100 ? "bg-green-500"
                      : pctExecucao >= 75 ? "bg-yellow-400"
                      : pctExecucao >= 50 ? "bg-orange-400"
                      : "bg-red-400"
                    )}
                    style={{ width: `${Math.min(100, pctExecucao)}%` }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Financeiro */}
          <section>
            <SectionTitle>Financeiro</SectionTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Número de parcelas">
                {editMode
                  ? <NumberInput value={form.parcelas_boleto} onChange={(v) => set("parcelas_boleto", v)} />
                  : <span>{oferta.parcelas_boleto ?? "—"}</span>}
              </Field>
              <Field label="Valor Individual">
                {editMode
                  ? <NumberInput value={form.valor_individual} step={0.01} onChange={(v) => set("valor_individual", v)} />
                  : <span>{moeda(oferta.valor_individual)}</span>}
              </Field>
              <Field label="Desconto (%)">
                {editMode
                  ? <NumberInput value={form.desconto_percentual} step={0.01} onChange={(v) => set("desconto_percentual", v)} />
                  : <span>{oferta.desconto_percentual != null ? `${oferta.desconto_percentual}%` : "—"}</span>}
              </Field>
              <Field label="Parcela c/ desconto">
                {editMode
                  ? <CalcDisplay value={form.parcela_com_desconto} />
                  : <span>{moeda(oferta.parcela_com_desconto)}</span>}
              </Field>
              <Field label="Total por aluno">
                {editMode
                  ? <CalcDisplay value={form.total_por_aluno} />
                  : <span>{moeda(oferta.total_por_aluno)}</span>}
              </Field>
              <Field label="Hora aula — Regime de Crédito">
                {editMode
                  ? <CalcDisplay value={form.hora_aula} />
                  : <span>{oferta.hora_aula != null ? `${moeda(oferta.hora_aula)}/h` : "—"}</span>}
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
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
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

// ── Converte Oferta → FormData ─────────────────────────────────────────────────
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
    desconto_percentual: o.desconto_percentual,
    parcela_com_desconto: o.parcela_com_desconto,
    total_por_aluno: o.total_por_aluno,
    hora_aula: o.hora_aula,
    alunos_matriculados: o.alunos_matriculados,
    coordenador: o.coordenador,
    previsao_inicio: o.previsao_inicio,
    execucao: o.execucao,
    status_cronograma: o.status_cronograma,
    semestre: o.semestre,
  };
}
