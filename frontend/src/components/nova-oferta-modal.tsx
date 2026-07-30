"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ofertasApi, cursosApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Save, Loader2, Search, Lock } from "lucide-react";
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
  "MECÂNICA", "ELÉTRICA", "AUTOMAÇÃO", "SEPE", "SOLDA",
  "VESTUÁRIO", "MARCENARIA", "GESTÃO", "AVIAÇÃO",
  "DESIGN", "MANUFATURA ADITIVA", "SISTEMAS DE ENERGIA", "ENERGIA GTD",
];

const TURNOS = ["MATUTINO", "VESPERTINO", "NOTURNO", "INTEGRAL"];

const DIAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];

const COORDENADORES = [
  "VIRGILIO CAPARELLI FONSECA",
  "TIAGO ALVES BARROS ROSA",
  "MARCOS MESSIAS DA CRUZ",
  "HÉLIA MARIA DE FARIA",
  "WELLIGTON MARIANO DOS PASSOS",
  "WANDERSON RAINER HILÁRIO DE ARAÚJO",
  "WILLIAM CARLOS DE ANDRADE",
  "LEANDRA PEREIRA DA SILVA",
];

const STATUS_TURMA = ["EM MATRÍCULA", "CANCELADO", "TURMA INICIADA", "ADIADA"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
      {children}
    </p>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 border-b pb-1.5 mb-3 mt-1">
      {children}
    </h4>
  );
}

function CalcField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="input w-full bg-gray-50 text-gray-700 font-medium text-sm">
        {value || <span className="text-gray-400">—</span>}
      </div>
    </div>
  );
}

function fmtBRL(n: string | number): string {
  const v = parseFloat(String(n));
  if (!n || isNaN(v) || v === 0) return "";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Form inicial ──────────────────────────────────────────────────────────────
function formInicial() {
  return {
    codigo_evento: "",
    pasta: "",
    curso_id: null as number | null,
    nome_curso: "",
    modalidade: MODALIDADES[0],
    area: "",
    semestre: 1,
    turno: "",
    dias_selecionados: [] as string[],
    dias_semana_texto: "",
    cidade: "",
    carga_horaria: 0,
    hora_inicio: "",
    hora_termino: "",
    data_inicio: "",
    data_termino: "",
    vagas: 0,
    min_para_inicio: 0,
    alunos_matriculados: 0,
    valor_individual: "" as string | number,
    desconto_percentual: "" as string | number,
    parcela_com_desconto: "" as string | number,
    total_por_aluno: "" as string | number,
    parcelas_boleto: "" as string | number,
    hora_aula: "" as string | number,
    coordenador: "",
    status: "",
    previsao_inicio: "",
    execucao: "",
    status_cronograma: "",
  };
}

type Form = ReturnType<typeof formInicial>;

// ── Componente ────────────────────────────────────────────────────────────────
interface NovaOfertaModalProps {
  open: boolean;
  onClose: () => void;
}

export function NovaOfertaModal({ open, onClose }: NovaOfertaModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(formInicial());
  const [buscaPasta, setBuscaPasta] = useState("");

  const { data: cursos = [] } = useQuery({
    queryKey: ["cursos-lista"],
    queryFn: () => cursosApi.listar(true),
    enabled: open,
  });

  const cursosFiltrados = (cursos as any[]).filter((c: any) => {
    if (!buscaPasta) return true;
    const q = buscaPasta.toLowerCase();
    return c.codigo?.toLowerCase().includes(q) || c.nome?.toLowerCase().includes(q);
  });

  // Auto-cálculos financeiros: Regime de Crédito × CH = Total; Total / Parcelas = Valor da Parcela; Parcela × (1 - desc%) = Valor Líquido
  useEffect(() => {
    const rc = parseFloat(String(form.hora_aula)) || 0;       // Regime de Crédito (input)
    const ch = form.carga_horaria || 0;
    const nParc = parseInt(String(form.parcelas_boleto)) || 0;
    const desc = parseFloat(String(form.desconto_percentual)) || 0;

    const total = rc > 0 && ch > 0 ? rc * ch : 0;
    const valParc = total > 0 && nParc > 0 ? total / nParc : 0;
    const valLiq = valParc > 0 ? valParc * (1 - desc / 100) : 0;

    setForm((prev) => ({
      ...prev,
      total_por_aluno: total > 0 ? parseFloat(total.toFixed(2)) : "",
      valor_individual: valParc > 0 ? parseFloat(valParc.toFixed(2)) : "",
      parcela_com_desconto: valLiq > 0 ? parseFloat(valLiq.toFixed(2)) : "",
    }));
  }, [form.hora_aula, form.carga_horaria, form.parcelas_boleto, form.desconto_percentual]);

  function selecionarCurso(curso: any) {
    setForm((prev) => ({
      ...prev,
      pasta: curso.codigo,
      curso_id: curso.id,
      nome_curso: curso.nome,
      area: curso.area ?? prev.area,
      carga_horaria: curso.carga_horaria_total ?? 0,
    }));
    setBuscaPasta("");
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDia(dia: string) {
    setForm((prev) => {
      const next = prev.dias_selecionados.includes(dia)
        ? prev.dias_selecionados.filter((d) => d !== dia)
        : [...prev.dias_selecionados, dia];
      const sorted = DIAS.filter((d) => next.includes(d));
      return { ...prev, dias_selecionados: sorted, dias_semana_texto: sorted.join(", ") };
    });
  }

  function toF(v: string | number) {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
  }

  function toI(v: string | number) {
    if (v === "" || v == null) return null;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  }

  const criar = useMutation({
    mutationFn: () => {
      if (!form.codigo_evento.trim()) throw new Error("Código do evento é obrigatório");
      if (!form.nome_curso.trim()) throw new Error("Nome do curso é obrigatório");

      return ofertasApi.criar({
        codigo_evento: form.codigo_evento.trim(),
        pasta: form.pasta || null,
        curso_id: form.curso_id,
        nome_curso: form.nome_curso.trim(),
        modalidade: form.modalidade,
        area: form.area || null,
        semestre: form.semestre,
        turno: form.turno || null,
        dias_semana_texto: form.dias_semana_texto || null,
        cidade: form.cidade || null,
        carga_horaria: form.carga_horaria || 0,
        hora_inicio: form.hora_inicio || null,
        hora_termino: form.hora_termino || null,
        data_inicio: form.data_inicio || null,
        data_termino: form.data_termino || null,
        status: form.status || "NÃO DEFINIDO",
        vagas: form.vagas || 0,
        min_para_inicio: form.min_para_inicio || 0,
        alunos_matriculados: form.alunos_matriculados || 0,
        valor_individual: toF(form.valor_individual),
        desconto_percentual: toF(form.desconto_percentual),
        parcela_com_desconto: toF(form.parcela_com_desconto),
        total_por_aluno: toF(form.total_por_aluno),
        parcelas_boleto: toI(form.parcelas_boleto),
        hora_aula: toF(form.hora_aula),
        coordenador: form.coordenador || null,
        previsao_inicio: form.previsao_inicio || null,
        execucao: form.execucao || null,
        status_cronograma: form.status_cronograma || null,
      });
    },
    onSuccess: () => {
      toast.success("Evento criado com sucesso.");
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      qc.invalidateQueries({ queryKey: ["ofertas-stats"] });
      fechar();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || err?.message || "Erro ao criar evento");
    },
  });

  function fechar() {
    setForm(formInicial());
    setBuscaPasta("");
    onClose();
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={fechar} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
            <h2 className="font-semibold text-gray-900">Novo Evento SENAI</h2>
            <button onClick={fechar} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

            {/* Identificação */}
            <section>
              <SectionTitle>Identificação</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Código do evento" required>
                  <input
                    className="input w-full font-mono"
                    placeholder="Ex: 1234567"
                    value={form.codigo_evento}
                    onChange={(e) => set("codigo_evento", e.target.value)}
                  />
                </Field>
                <Field label="Semestre">
                  <select className="input w-full" value={form.semestre} onChange={(e) => set("semestre", +e.target.value)}>
                    <option value={1}>1° Semestre</option>
                    <option value={2}>2° Semestre</option>
                  </select>
                </Field>
              </div>

              {/* Seletor de pasta */}
              <div className="mt-4">
                <Field label="Pasta / Curso (selecione para preencher automaticamente)">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    <input
                      className="input w-full pl-9"
                      placeholder="Buscar por código ou nome do curso..."
                      value={buscaPasta}
                      onChange={(e) => setBuscaPasta(e.target.value)}
                    />
                  </div>
                  {buscaPasta.length >= 1 && cursosFiltrados.length > 0 && (
                    <div className="border rounded-lg mt-1 bg-white shadow-lg max-h-48 overflow-y-auto">
                      {cursosFiltrados.slice(0, 20).map((c: any) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-baseline gap-2 text-sm"
                          onClick={() => selecionarCurso(c)}
                        >
                          <span className="font-mono text-xs text-gray-400 shrink-0">{c.codigo}</span>
                          <span className="truncate text-gray-800">{c.nome}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {form.pasta && (
                    <div className="mt-2 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                      <span className="font-mono text-xs text-blue-500">{form.pasta}</span>
                      <span className="text-blue-800 truncate">{form.nome_curso}</span>
                      <button
                        type="button"
                        className="ml-auto text-blue-400 hover:text-blue-600"
                        onClick={() => { set("pasta", ""); set("curso_id", null); set("nome_curso", ""); set("area", ""); set("carga_horaria", 0); }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Nome do curso" required>
                  <input
                    className="input w-full"
                    placeholder="Nome do curso"
                    value={form.nome_curso}
                    onChange={(e) => set("nome_curso", e.target.value)}
                  />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Modalidade">
                  <select className="input w-full text-xs" value={form.modalidade} onChange={(e) => set("modalidade", e.target.value)}>
                    {MODALIDADES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="Área">
                  <select className="input w-full" value={form.area} onChange={(e) => set("area", e.target.value)}>
                    <option value="">Selecionar área...</option>
                    {AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </Field>
                <Field label="Coordenador">
                  <select className="input w-full" value={form.coordenador} onChange={(e) => set("coordenador", e.target.value)}>
                    <option value="">Selecionar coordenador...</option>
                    {COORDENADORES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Status da turma">
                  <div className="flex gap-2 flex-wrap">
                    {STATUS_TURMA.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => set("status", form.status === s ? "" : s)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors",
                          form.status === s
                            ? s === "TURMA INICIADA"
                              ? "bg-green-600 text-white border-green-600"
                              : s === "CANCELADO"
                              ? "bg-red-600 text-white border-red-600"
                              : s === "ADIADA"
                              ? "bg-purple-600 text-white border-purple-600"
                              : "bg-amber-500 text-white border-amber-500"
                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </section>

            {/* Turma */}
            <section>
              <SectionTitle>Turma</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Turno">
                  <select className="input w-full" value={form.turno} onChange={(e) => set("turno", e.target.value)}>
                    <option value="">Selecionar turno...</option>
                    {TURNOS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Cidade">
                  <input className="input w-full" placeholder="Cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Dias da semana">
                  <div className="flex gap-2 flex-wrap">
                    {DIAS.map((dia) => (
                      <button
                        key={dia}
                        type="button"
                        onClick={() => toggleDia(dia)}
                        className={cn(
                          "px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors",
                          form.dias_selecionados.includes(dia)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600"
                        )}
                      >
                        {dia}
                      </button>
                    ))}
                  </div>
                  {form.dias_semana_texto && (
                    <p className="text-[11px] text-gray-500 mt-1.5">{form.dias_semana_texto}</p>
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-4">
                <Field label={form.curso_id ? "CH (h) — vinculada ao curso" : "Carga horária (h)"}>
                  <div className="relative">
                    <input
                      type="number"
                      className={cn("input w-full", form.curso_id && "bg-gray-50 pr-8")}
                      value={form.carga_horaria || ""}
                      readOnly={!!form.curso_id}
                      onChange={(e) => { if (!form.curso_id) set("carga_horaria", e.target.value ? +e.target.value : 0); }}
                    />
                    {form.curso_id && (
                      <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    )}
                  </div>
                </Field>
                <Field label="Hora início">
                  <input type="time" className="input w-full" value={form.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} />
                </Field>
                <Field label="Hora término">
                  <input type="time" className="input w-full" value={form.hora_termino} onChange={(e) => set("hora_termino", e.target.value)} />
                </Field>
              </div>
            </section>

            {/* Período */}
            <section>
              <SectionTitle>Período</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Data de início">
                  <input type="date" className="input w-full" value={form.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} />
                </Field>
                <Field label="Data de término">
                  <input type="date" className="input w-full" value={form.data_termino} onChange={(e) => set("data_termino", e.target.value)} />
                </Field>
              </div>
            </section>

            {/* Matrícula */}
            <section>
              <SectionTitle>Matrícula</SectionTitle>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Vagas">
                  <input type="number" className="input w-full" value={form.vagas || ""} onChange={(e) => set("vagas", e.target.value ? +e.target.value : 0)} />
                </Field>
                <Field label="Mínimo p/ início">
                  <input type="number" className="input w-full" value={form.min_para_inicio || ""} onChange={(e) => set("min_para_inicio", e.target.value ? +e.target.value : 0)} />
                </Field>
                <Field label="Matriculados">
                  <input type="number" className="input w-full" value={form.alunos_matriculados || ""} onChange={(e) => set("alunos_matriculados", e.target.value ? +e.target.value : 0)} />
                </Field>
              </div>
            </section>

            {/* Financeiro */}
            <section>
              <SectionTitle>Financeiro</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Nº de parcelas">
                  <input
                    type="number"
                    min={1}
                    className="input w-full"
                    placeholder="Ex: 10"
                    value={form.parcelas_boleto}
                    onChange={(e) => set("parcelas_boleto", e.target.value)}
                  />
                </Field>
                <Field label="Regime de Crédito (R$/h)">
                  <input
                    type="number"
                    step="0.01"
                    className="input w-full"
                    placeholder="0,00"
                    value={form.hora_aula}
                    onChange={(e) => set("hora_aula", e.target.value)}
                  />
                </Field>
                <Field label="Desconto (%)">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    className="input w-full"
                    placeholder="0"
                    value={form.desconto_percentual}
                    onChange={(e) => set("desconto_percentual", e.target.value)}
                  />
                </Field>
                <CalcField label="Total do curso" value={fmtBRL(form.total_por_aluno)} />
                <CalcField label="Valor da parcela" value={fmtBRL(form.valor_individual)} />
                <CalcField label="Valor líquido (c/ desconto)" value={fmtBRL(form.parcela_com_desconto)} />
              </div>
            </section>

            {/* Cronograma */}
            <section>
              <SectionTitle>Cronograma</SectionTitle>
              <Field label="Previsão de início">
                <input className="input w-full" placeholder="Ex: Março/2025" value={form.previsao_inicio} onChange={(e) => set("previsao_inicio", e.target.value)} />
              </Field>
            </section>

          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 shrink-0 flex justify-end gap-2">
            <button onClick={fechar} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => criar.mutate()}
              disabled={criar.isPending}
              className="btn-primary flex items-center gap-1.5"
            >
              {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Criar Evento
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
