"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ofertasApi, cursosApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Save, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constantes ────────────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  "NÃO DEFINIDO",
  "PLANEJADO",
  "EM MATRÍCULA",
  "INICIOU",
  "CANCELADO",
];

const MODALIDADE_OPTIONS = [
  "QUALIFICAÇÃO PROFISSIONAL",
  "HABILITAÇÃO TÉCNICA",
  "FIC",
];

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

// ── Tipo inicial do formulário ────────────────────────────────────────────────
function formInicial() {
  return {
    codigo_evento: "",
    pasta: "",
    curso_id: null as number | null,
    nome_curso: "",
    modalidade: "QUALIFICAÇÃO PROFISSIONAL",
    area: "",
    semestre: 1,
    turno: "",
    dias_semana_texto: "",
    cidade: "",
    carga_horaria: 0,
    hora_inicio: "",
    hora_termino: "",
    data_inicio: "",
    data_termino: "",
    status: "NÃO DEFINIDO",
    vagas: 0,
    min_para_inicio: 0,
    alunos_matriculados: 0,
    valor_individual: "" as string | number,
    parcela_com_desconto: "" as string | number,
    total_por_aluno: "" as string | number,
    parcelas_boleto: "" as string | number,
    hora_aula: "" as string | number,
    previsao_inicio: "",
    execucao: "",
    status_cronograma: "",
  };
}

type Form = ReturnType<typeof formInicial>;

// ── Componente principal ──────────────────────────────────────────────────────
interface NovaOfertaModalProps {
  open: boolean;
  onClose: () => void;
}

export function NovaOfertaModal({ open, onClose }: NovaOfertaModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(formInicial());
  const [buscaPasta, setBuscaPasta] = useState("");

  // Carrega lista de cursos para o seletor de pasta
  const { data: cursos = [] } = useQuery({
    queryKey: ["cursos-lista"],
    queryFn: () => cursosApi.listar(true),
    enabled: open,
  });

  // Filtra cursos pelo campo de busca
  const cursosFiltrados = (cursos as any[]).filter((c: any) => {
    if (!buscaPasta) return true;
    const q = buscaPasta.toLowerCase();
    return c.codigo?.toLowerCase().includes(q) || c.nome?.toLowerCase().includes(q);
  });

  // Ao selecionar um curso pelo código, auto-preenche campos
  function selecionarCurso(curso: any) {
    setForm((prev) => ({
      ...prev,
      pasta: curso.codigo,
      curso_id: curso.id,
      nome_curso: curso.nome,
      area: curso.area ?? "",
      carga_horaria: curso.carga_horaria_total ?? 0,
    }));
    setBuscaPasta("");
  }

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toNullableFloat(v: string | number) {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v));
    return isNaN(n) ? null : n;
  }

  function toNullableInt(v: string | number) {
    if (v === "" || v == null) return null;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? null : n;
  }

  const criar = useMutation({
    mutationFn: () => {
      if (!form.codigo_evento.trim()) throw new Error("Código do evento é obrigatório");
      if (!form.nome_curso.trim()) throw new Error("Nome do curso é obrigatório");

      const dados: Record<string, unknown> = {
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
        status: form.status,
        vagas: form.vagas || 0,
        min_para_inicio: form.min_para_inicio || 0,
        alunos_matriculados: form.alunos_matriculados || 0,
        valor_individual: toNullableFloat(form.valor_individual),
        parcela_com_desconto: toNullableFloat(form.parcela_com_desconto),
        total_por_aluno: toNullableFloat(form.total_por_aluno),
        parcelas_boleto: toNullableInt(form.parcelas_boleto),
        hora_aula: toNullableInt(form.hora_aula),
        previsao_inicio: form.previsao_inicio || null,
        execucao: form.execucao || null,
        status_cronograma: form.status_cronograma || null,
      };
      return ofertasApi.criar(dados);
    },
    onSuccess: () => {
      toast.success("Evento criado com sucesso.");
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      qc.invalidateQueries({ queryKey: ["ofertas-stats"] });
      fechar();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.message || "Erro ao criar evento";
      toast.error(msg);
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
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={fechar} />

      {/* Modal */}
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
                  <select
                    className="input w-full"
                    value={form.semestre}
                    onChange={(e) => set("semestre", +e.target.value)}
                  >
                    <option value={1}>1° Semestre</option>
                    <option value={2}>2° Semestre</option>
                  </select>
                </Field>
              </div>

              {/* Seletor de pasta com busca */}
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

                  {/* Lista de sugestões */}
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

                  {/* Pasta selecionada */}
                  {form.pasta && (
                    <div className="mt-2 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                      <span className="font-mono text-xs text-blue-500">{form.pasta}</span>
                      <span className="text-blue-800 truncate">{form.nome_curso}</span>
                      <button
                        type="button"
                        className="ml-auto text-blue-400 hover:text-blue-600"
                        onClick={() => { set("pasta", ""); set("curso_id", null); set("nome_curso", ""); set("area", ""); set("carga_horaria", 0); }}
                        title="Remover seleção"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </Field>
              </div>

              {/* Nome do curso (editável mesmo após auto-preenchimento) */}
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

              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="Modalidade">
                  <select
                    className="input w-full"
                    value={form.modalidade}
                    onChange={(e) => set("modalidade", e.target.value)}
                  >
                    {MODALIDADE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Área">
                  <input
                    className="input w-full"
                    placeholder="Área do curso"
                    value={form.area}
                    onChange={(e) => set("area", e.target.value)}
                  />
                </Field>
              </div>
            </section>

            {/* Turma */}
            <section>
              <SectionTitle>Turma</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Turno">
                  <input className="input w-full" placeholder="Ex: NOTURNO" value={form.turno} onChange={(e) => set("turno", e.target.value)} />
                </Field>
                <Field label="Cidade">
                  <input className="input w-full" placeholder="Cidade" value={form.cidade} onChange={(e) => set("cidade", e.target.value)} />
                </Field>
                <Field label="Dias da semana">
                  <input className="input w-full" placeholder="Ex: SEG, QUA, SEX" value={form.dias_semana_texto} onChange={(e) => set("dias_semana_texto", e.target.value)} />
                </Field>
                <Field label="Carga horária (h)">
                  <input
                    type="number"
                    className="input w-full"
                    value={form.carga_horaria || ""}
                    onChange={(e) => set("carga_horaria", e.target.value ? +e.target.value : 0)}
                  />
                </Field>
                <Field label="Hora início">
                  <input type="time" className="input w-full" value={form.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} />
                </Field>
                <Field label="Hora término">
                  <input type="time" className="input w-full" value={form.hora_termino} onChange={(e) => set("hora_termino", e.target.value)} />
                </Field>
              </div>
            </section>

            {/* Período & Status */}
            <section>
              <SectionTitle>Período &amp; Status</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Data de início">
                  <input type="date" className="input w-full" value={form.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} />
                </Field>
                <Field label="Data de término">
                  <input type="date" className="input w-full" value={form.data_termino} onChange={(e) => set("data_termino", e.target.value)} />
                </Field>
                <Field label="Status">
                  <select className="input w-full" value={form.status} onChange={(e) => set("status", e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
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
                <Field label="Valor individual (R$)">
                  <input type="number" step="0.01" className="input w-full" value={form.valor_individual} onChange={(e) => set("valor_individual", e.target.value)} />
                </Field>
                <Field label="Parcela c/ desconto (R$)">
                  <input type="number" step="0.01" className="input w-full" value={form.parcela_com_desconto} onChange={(e) => set("parcela_com_desconto", e.target.value)} />
                </Field>
                <Field label="Total por aluno (R$)">
                  <input type="number" step="0.01" className="input w-full" value={form.total_por_aluno} onChange={(e) => set("total_por_aluno", e.target.value)} />
                </Field>
                <Field label="Parcelas boleto">
                  <input type="number" className="input w-full" value={form.parcelas_boleto} onChange={(e) => set("parcelas_boleto", e.target.value)} />
                </Field>
                <Field label="Hora aula">
                  <input type="number" className="input w-full" value={form.hora_aula} onChange={(e) => set("hora_aula", e.target.value)} />
                </Field>
              </div>
            </section>

            {/* Cronograma */}
            <section>
              <SectionTitle>Cronograma</SectionTitle>
              <div className="grid grid-cols-1 gap-4">
                <Field label="Previsão de início">
                  <input className="input w-full" placeholder="Ex: Março/2025" value={form.previsao_inicio} onChange={(e) => set("previsao_inicio", e.target.value)} />
                </Field>
                <Field label="Execução">
                  <input className="input w-full" value={form.execucao} onChange={(e) => set("execucao", e.target.value)} />
                </Field>
                <Field label="Status do cronograma">
                  <input className="input w-full" value={form.status_cronograma} onChange={(e) => set("status_cronograma", e.target.value)} />
                </Field>
              </div>
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
              {criar.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Save className="h-4 w-4" />}
              Criar Evento
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
