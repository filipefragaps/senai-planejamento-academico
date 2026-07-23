"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { professoresApi, cursosApi } from "@/lib/api";
import { toast } from "sonner";
import {
  X, Plus, Trash2, Save, BookOpen, Clock, User, Loader2, Check, Grid3X3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const DIAS_GRID = [0, 1, 2, 3, 4, 5]; // Seg–Sáb

const TURNOS = [
  { label: "Manhã",  inicio: "07:00", fim: "12:00" },
  { label: "Tarde",  inicio: "13:00", fim: "17:30" },
  { label: "Noite",  inicio: "18:30", fim: "22:00" },
];

type GradeKey = `${number}-${number}`; // "dia-turno"

const DIAS_COR: Record<number, string> = {
  0: "bg-blue-100 text-blue-700",
  1: "bg-indigo-100 text-indigo-700",
  2: "bg-violet-100 text-violet-700",
  3: "bg-purple-100 text-purple-700",
  4: "bg-fuchsia-100 text-fuchsia-700",
  5: "bg-orange-100 text-orange-700",
  6: "bg-rose-100 text-rose-700",
};

interface Props {
  professor: any | null; // null = modo criação
  onClose: () => void;
  onSaved: (prof: any) => void;
}

const BLANK_BASIC = {
  nome: "", email: "", telefone: "", tipo: "Mensalista",
  horas_contratadas: 40, valor_hora: "", especialidades: "", titulacao: "", ativo: true,
};

const BLANK_DISP = { dia_semana: 0, horario_inicio: "18:30", horario_fim: "22:00", tipo: "Disponível" };

export function ProfessorDrawer({ professor, onClose, onSaved }: Props) {
  const isEdit = !!professor;
  const qc = useQueryClient();

  // ── dados básicos ────────────────────────────────────────────────
  const [basic, setBasic] = useState<any>(
    isEdit
      ? {
          nome: professor.nome || "",
          email: professor.email || "",
          telefone: professor.telefone || "",
          tipo: professor.tipo || "Mensalista",
          horas_contratadas: professor.horas_contratadas || 40,
          valor_hora: professor.valor_hora || "",
          especialidades: professor.especialidades || "",
          titulacao: professor.titulacao || "",
          ativo: professor.ativo ?? true,
        }
      : { ...BLANK_BASIC }
  );

  // ── disponibilidade ──────────────────────────────────────────────
  const [newDisp, setNewDisp] = useState({ ...BLANK_DISP });
  const [showAddDisp, setShowAddDisp] = useState(false);
  const [pendingDisps, setPendingDisps] = useState<any[]>([]); // create mode only

  // ── grade semanal ────────────────────────────────────────────────
  const [modoGrade, setModoGrade] = useState(true); // true=grade, false=lista+form

  // ── UCs ──────────────────────────────────────────────────────────
  const [showAddUC, setShowAddUC] = useState(false);
  const [selectedCursoId, setSelectedCursoId] = useState<number | "">("");
  const [checkedUCs, setCheckedUCs] = useState<string[]>([]);
  const [novaModalidade, setNovaModalidade] = useState("Habilitação Técnica");
  const [pendingUCs, setPendingUCs] = useState<any[]>([]); // create mode: {disciplina, curso_id, curso_nome, modalidade}
  const [editandoModalidade, setEditandoModalidade] = useState<number | null>(null); // atuacao id sendo editado

  // ── queries ──────────────────────────────────────────────────────
  const { data: detalhes, isLoading: loadingDetalhes } = useQuery({
    queryKey: ["professor-detalhes", professor?.id],
    queryFn: () => professoresApi.detalhes(professor!.id),
    enabled: isEdit,
  });

  const { data: cursos = [] } = useQuery({
    queryKey: ["cursos"],
    queryFn: () => cursosApi.listar(),
  });

  const { data: ucsDisponiveis = [], isLoading: loadingUCs } = useQuery({
    queryKey: ["ucs", selectedCursoId],
    queryFn: () => cursosApi.ucs(selectedCursoId as number),
    enabled: !!selectedCursoId,
  });

  // ── mutations: dados básicos ─────────────────────────────────────
  const criarProf = useMutation({
    mutationFn: (data: any) => professoresApi.criar(data),
  });

  const atualizarProf = useMutation({
    mutationFn: (data: any) => professoresApi.atualizar(professor!.id, data),
    onSuccess: (updated) => {
      toast.success("Dados básicos atualizados!");
      qc.invalidateQueries({ queryKey: ["professores"] });
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      onSaved(updated);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao atualizar"),
  });

  // ── mutations: disponibilidade ───────────────────────────────────
  const addDisp = useMutation({
    mutationFn: (d: typeof BLANK_DISP) =>
      professoresApi.adicionarDisponibilidade(professor!.id, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      setShowAddDisp(false);
      setNewDisp({ ...BLANK_DISP });
      toast.success("Horário adicionado!");
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao adicionar horário"),
  });

  const delDisp = useMutation({
    mutationFn: (dispId: number) =>
      professoresApi.removerDisponibilidade(professor!.id, dispId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      toast.success("Horário removido!");
    },
    onError: () => toast.error("Erro ao remover horário"),
  });

  const bulkDisp = useMutation({
    mutationFn: (slots: { dia_semana: number; horario_inicio: string; horario_fim: string; tipo: string }[]) =>
      professoresApi.disponibilidadeBulk(professor!.id, slots),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      toast.success("Grade de disponibilidade salva!");
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao salvar grade"),
  });

  // ── mutations: atuações ──────────────────────────────────────────
  const addAtuacao = useMutation({
    mutationFn: ({ disciplina, cursoId, modalidade }: { disciplina: string; cursoId?: number; modalidade: string }) =>
      professoresApi.adicionarAtuacao(professor!.id, disciplina, cursoId, modalidade),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao adicionar UC"),
  });

  const delAtuacao = useMutation({
    mutationFn: (atId: number) =>
      professoresApi.removerAtuacao(professor!.id, atId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      toast.success("UC removida!");
    },
    onError: () => toast.error("Erro ao remover UC"),
  });

  const updModalidade = useMutation({
    mutationFn: ({ atId, modalidade }: { atId: number; modalidade: string }) =>
      professoresApi.atualizarModalidade(professor!.id, atId, modalidade),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["professor-detalhes", professor?.id] });
      setEditandoModalidade(null);
      toast.success("Modalidade atualizada!");
    },
    onError: () => toast.error("Erro ao atualizar modalidade"),
  });

  // ── helpers ───────────────────────────────────────────────────────
  function toggleUC(nome: string) {
    setCheckedUCs((prev) =>
      prev.includes(nome) ? prev.filter((n) => n !== nome) : [...prev, nome]
    );
  }

  async function handleAddUCsEdit() {
    if (!checkedUCs.length) return;
    const cursoId = selectedCursoId ? +selectedCursoId : undefined;
    await Promise.all(
      checkedUCs.map((nome) => addAtuacao.mutateAsync({ disciplina: nome, cursoId, modalidade: novaModalidade }))
    );
    toast.success(`${checkedUCs.length} UC(s) adicionada(s)!`);
    setCheckedUCs([]);
    setSelectedCursoId("");
    setNovaModalidade("Presencial");
    setShowAddUC(false);
  }

  function handleAddUCsPending() {
    if (!checkedUCs.length) return;
    const cursoId = selectedCursoId ? +selectedCursoId : undefined;
    const cursoNome = cursos.find((c: any) => c.id === cursoId)?.nome || "Sem curso";
    const toAdd = checkedUCs.map((nome) => ({ disciplina: nome, cursoId, cursoNome, modalidade: novaModalidade }));
    setPendingUCs((prev) => [...prev, ...toAdd]);
    setCheckedUCs([]);
    setSelectedCursoId("");
    setNovaModalidade("Presencial");
    setShowAddUC(false);
  }

  function handleAddDispPending() {
    setPendingDisps((prev) => [...prev, { ...newDisp, _key: Date.now() }]);
    setNewDisp({ ...BLANK_DISP });
    setShowAddDisp(false);
  }

  // ── submit criação ─────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload = {
        ...basic,
        // valor_hora vazio ("") deve virar null — Pydantic rejeita string vazia para float
        valor_hora: basic.valor_hora !== "" ? Number(basic.valor_hora) : null,
      };
      const prof = await criarProf.mutateAsync(payload);
      // adiciona pendingDisps
      await Promise.all(
        pendingDisps.map((d) =>
          professoresApi.adicionarDisponibilidade(prof.id, d)
        )
      );
      // adiciona pendingUCs
      await Promise.all(
        pendingUCs.map((u) =>
          professoresApi.adicionarAtuacao(prof.id, u.disciplina, u.cursoId, u.modalidade || "Presencial")
        )
      );
      toast.success("Professor cadastrado com sucesso!");
      qc.invalidateQueries({ queryKey: ["professores"] });
      onSaved(prof);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: any) => d.msg || d.message || "campo inválido").join("; ")
          : "Erro ao cadastrar professor";
      toast.error(msg);
    }
  }

  const disponibilidades: any[] = isEdit ? (detalhes?.disponibilidades || []) : [];
  const atuacoesPorCurso: any[] = isEdit ? (detalhes?.atuacoes_por_curso || []) : [];

  // Grade: set de chaves "dia-turnoIdx" ativas
  const [gradeAtiva, setGradeAtiva] = useState<Set<GradeKey>>(() => new Set());

  // Sincroniza grade quando disponibilidades carregam
  useEffect(() => {
    const ativas = new Set<GradeKey>();
    for (const d of disponibilidades) {
      TURNOS.forEach((t, ti) => {
        if (d.horario_inicio <= t.inicio && d.horario_fim >= t.fim) {
          ativas.add(`${d.dia_semana}-${ti}` as GradeKey);
        }
      });
    }
    setGradeAtiva(ativas);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disponibilidades.length]);

  function toggleGrade(dia: number, turnoIdx: number) {
    const key = `${dia}-${turnoIdx}` as GradeKey;
    setGradeAtiva((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function salvarGrade() {
    const slots: { dia_semana: number; horario_inicio: string; horario_fim: string; tipo: string }[] = [];
    for (const key of gradeAtiva) {
      const [dia, ti] = key.split("-").map(Number);
      const t = TURNOS[ti];
      if (t) slots.push({ dia_semana: dia, horario_inicio: t.inicio, horario_fim: t.fim, tipo: "Disponível" });
    }
    bulkDisp.mutate(slots);
  }

  // Agrupa pendingDisps por dia (create mode)
  const gruposPending = pendingDisps.reduce((acc: Record<number, any[]>, d) => {
    if (!acc[d.dia_semana]) acc[d.dia_semana] = [];
    acc[d.dia_semana].push(d);
    return acc;
  }, {});

  // Agrupa pendingUCs por curso (create mode)
  const pendingUCsByCurso = pendingUCs.reduce((acc: Record<string, any[]>, u) => {
    const key = u.cursoNome;
    if (!acc[key]) acc[key] = [];
    acc[key].push(u);
    return acc;
  }, {});

  const isBusy = criarProf.isPending || atualizarProf.isPending;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">
                {isEdit ? "Editar Professor" : "Novo Professor"}
              </h2>
              {isEdit && (
                <p className="text-xs text-gray-500 mt-0.5">{professor.nome}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Conteúdo rolável ── */}
        <div className="flex-1 overflow-y-auto">
          <form id="prof-form" onSubmit={isEdit ? undefined : handleCreate}>

            {/* ═══════════ DADOS BÁSICOS ═══════════ */}
            <section className="p-6 border-b">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                  Dados Básicos
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nome *</label>
                  <input
                    className="input w-full"
                    required
                    value={basic.nome}
                    onChange={(e) => setBasic({ ...basic, nome: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                  <input
                    type="email"
                    className="input w-full"
                    value={basic.email}
                    onChange={(e) => setBasic({ ...basic, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Telefone</label>
                  <input
                    className="input w-full"
                    value={basic.telefone}
                    onChange={(e) => setBasic({ ...basic, telefone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Tipo *</label>
                  <select
                    className="input w-full"
                    value={basic.tipo}
                    onChange={(e) => setBasic({ ...basic, tipo: e.target.value })}
                  >
                    <option>Mensalista</option>
                    <option>Horista</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Horas contratadas / semana</label>
                  <input
                    type="number"
                    className="input w-full"
                    value={basic.horas_contratadas}
                    onChange={(e) => setBasic({ ...basic, horas_contratadas: +e.target.value })}
                  />
                </div>
                {basic.tipo === "Horista" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Valor por hora (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input w-full"
                      value={basic.valor_hora}
                      onChange={(e) => setBasic({ ...basic, valor_hora: e.target.value })}
                    />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Especialidades / Área</label>
                  <input
                    className="input w-full"
                    placeholder="Ex: Elétrica, Automação, Mecânica"
                    value={basic.especialidades}
                    onChange={(e) => setBasic({ ...basic, especialidades: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Titulação</label>
                  <input
                    className="input w-full"
                    placeholder="Ex: Especialista, Mestre, Doutor"
                    value={basic.titulacao}
                    onChange={(e) => setBasic({ ...basic, titulacao: e.target.value })}
                  />
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={basic.ativo}
                      onChange={(e) => setBasic({ ...basic, ativo: e.target.checked })}
                    />
                    <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-primary transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                  </label>
                  <span className="text-sm text-gray-600">Ativo</span>
                </div>
              </div>

              {isEdit && (
                <button
                  type="button"
                  onClick={() => atualizarProf.mutate({
                    ...basic,
                    valor_hora: basic.valor_hora !== "" ? Number(basic.valor_hora) : null,
                  })}
                  disabled={atualizarProf.isPending}
                  className="btn-primary mt-4 flex items-center gap-2 text-sm"
                >
                  {atualizarProf.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Salvar dados básicos
                </button>
              )}
            </section>

            {/* ═══════════ DISPONIBILIDADE ═══════════ */}
            <section className="p-6 border-b">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    Disponibilidade
                  </h3>
                </div>
                {/* Toggle grade / lista (só edit) */}
                {isEdit && (
                  <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setModoGrade(true)}
                      className={cn("flex items-center gap-1 px-2.5 py-1.5 transition-colors",
                        modoGrade ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50")}
                    >
                      <Grid3X3 className="h-3.5 w-3.5" /> Grade
                    </button>
                    <button
                      type="button"
                      onClick={() => setModoGrade(false)}
                      className={cn("flex items-center gap-1 px-2.5 py-1.5 border-l border-gray-200 transition-colors",
                        !modoGrade ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50")}
                    >
                      <Plus className="h-3.5 w-3.5" /> Avançado
                    </button>
                  </div>
                )}
              </div>

              {/* ── GRADE SEMANAL ── */}
              {(isEdit ? modoGrade : true) && (
                <div>
                  {isEdit && loadingDetalhes ? (
                    <div className="text-center py-4 text-gray-400 text-xs">Carregando...</div>
                  ) : (
                    <>
                      {/* Grid */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr>
                              <th className="w-16 py-1.5 text-left text-gray-400 font-medium">Turno</th>
                              {DIAS_GRID.map((d) => (
                                <th key={d} className={cn(
                                  "py-1.5 text-center font-semibold rounded-sm",
                                  DIAS_COR[d]?.replace("bg-", "text-").replace("-100", "-700") || "text-gray-600"
                                )}>
                                  {DIAS[d].slice(0, 3)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {TURNOS.map((turno, ti) => (
                              <tr key={ti}>
                                <td className="py-1.5 pr-2">
                                  <div className="font-semibold text-gray-700">{turno.label}</div>
                                  <div className="text-[10px] text-gray-400">{turno.inicio}–{turno.fim}</div>
                                </td>
                                {DIAS_GRID.map((dia) => {
                                  const key = `${dia}-${ti}` as GradeKey;
                                  const ativo = gradeAtiva.has(key);
                                  return (
                                    <td key={dia} className="py-1 px-1 text-center">
                                      <button
                                        type="button"
                                        onClick={() => toggleGrade(dia, ti)}
                                        className={cn(
                                          "w-full rounded-md py-2 transition-all border text-[11px] font-medium",
                                          ativo
                                            ? "bg-green-500 border-green-500 text-white shadow-sm"
                                            : "bg-gray-50 border-gray-200 text-gray-300 hover:border-green-300 hover:text-green-500 hover:bg-green-50"
                                        )}
                                        title={ativo ? "Clique para remover" : "Clique para marcar como disponível"}
                                      >
                                        {ativo ? "✓" : "—"}
                                      </button>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Botão salvar (edit) / adicionar à lista (create) */}
                      {isEdit ? (
                        <button
                          type="button"
                          onClick={salvarGrade}
                          disabled={bulkDisp.isPending}
                          className="mt-4 btn-primary text-xs flex items-center gap-1.5"
                        >
                          {bulkDisp.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Salvar grade
                        </button>
                      ) : (
                        <p className="text-xs text-gray-400 mt-3 italic">
                          A grade será salva ao criar o professor.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── MODO AVANÇADO (só edit) ── */}
              {isEdit && !modoGrade && (
                <div>
                  {!showAddDisp && (
                    <button
                      type="button"
                      onClick={() => setShowAddDisp(true)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium mb-4"
                    >
                      <Plus className="h-3.5 w-3.5" /> Adicionar horário personalizado
                    </button>
                  )}

                  {showAddDisp && (
                    <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-100">
                      <p className="text-xs font-semibold text-blue-700 mb-3">Novo horário</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Dia da semana</label>
                          <select
                            className="input w-full"
                            value={newDisp.dia_semana}
                            onChange={(e) => setNewDisp({ ...newDisp, dia_semana: +e.target.value })}
                          >
                            {DIAS.map((d, i) => (
                              <option key={i} value={i}>{d}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Início</label>
                          <input type="time" className="input w-full" value={newDisp.horario_inicio}
                            onChange={(e) => setNewDisp({ ...newDisp, horario_inicio: e.target.value })} />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Fim</label>
                          <input type="time" className="input w-full" value={newDisp.horario_fim}
                            onChange={(e) => setNewDisp({ ...newDisp, horario_fim: e.target.value })} />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
                          <select className="input w-full" value={newDisp.tipo}
                            onChange={(e) => setNewDisp({ ...newDisp, tipo: e.target.value })}>
                            <option value="Disponível">Disponível</option>
                            <option value="Indisponível">Indisponível</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button type="button" onClick={() => addDisp.mutate(newDisp)} disabled={addDisp.isPending}
                          className="btn-primary text-xs flex items-center gap-1.5">
                          {addDisp.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                          Salvar horário
                        </button>
                        <button type="button" onClick={() => { setShowAddDisp(false); setNewDisp({ ...BLANK_DISP }); }}
                          className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-50">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {loadingDetalhes ? (
                    <div className="text-center py-4 text-gray-400 text-xs">Carregando...</div>
                  ) : disponibilidades.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Nenhum horário personalizado cadastrado.</p>
                  ) : (
                    <DispList disponibilidades={disponibilidades} onDelete={(id) => delDisp.mutate(id)} deleting={delDisp.isPending} />
                  )}
                </div>
              )}

              {/* Lista pendente (create mode) */}
              {!isEdit && pendingDisps.length > 0 && (
                <div className="space-y-2 mt-3">
                  {Object.entries(gruposPending)
                    .sort(([a], [b]) => +a - +b)
                    .map(([dia, items]) => (
                      <div key={dia} className="flex items-start gap-3">
                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded min-w-[2.5rem] text-center shrink-0", DIAS_COR[+dia] || "bg-gray-100 text-gray-600")}>
                          {DIAS[+dia]?.slice(0, 3)}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(items as any[]).map((d) => (
                            <div key={d._key} className="flex items-center gap-1">
                              <span className={cn("text-xs px-2 py-0.5 rounded-full border",
                                d.tipo === "Disponível" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200")}>
                                {d.horario_inicio} – {d.horario_fim}
                              </span>
                              <button type="button" onClick={() => setPendingDisps((prev) => prev.filter((x) => x._key !== d._key))} className="text-gray-300 hover:text-red-500">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </section>

            {/* ═══════════ UNIDADES CURRICULARES ═══════════ */}
            <section className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                    Unidades Curriculares que pode ministrar
                  </h3>
                </div>
                {!showAddUC && (
                  <button
                    type="button"
                    onClick={() => setShowAddUC(true)}
                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar UCs
                  </button>
                )}
              </div>

              {/* Formulário para adicionar UCs */}
              {showAddUC && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4 border border-blue-100">
                  <p className="text-xs font-semibold text-blue-700 mb-3">Selecionar UCs</p>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Modalidade de atuação</label>
                      <select
                        className="input w-full text-xs"
                        value={novaModalidade}
                        onChange={(e) => setNovaModalidade(e.target.value)}
                      >
                        {MODALIDADE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Curso (PASTA)</label>
                      <select
                        className="input w-full"
                        value={selectedCursoId}
                        onChange={(e) => {
                          setSelectedCursoId(e.target.value ? +e.target.value : "");
                          setCheckedUCs([]);
                        }}
                      >
                        <option value="">Selecione um curso...</option>
                        {cursos.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.nome} ({c.codigo})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedCursoId && (
                    loadingUCs ? (
                      <div className="text-xs text-gray-400 py-2">Carregando UCs...</div>
                    ) : ucsDisponiveis.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Nenhuma UC cadastrada neste curso.</p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto border rounded-md bg-white divide-y">
                        {ucsDisponiveis.map((uc: any) => (
                          <label key={uc.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checkedUCs.includes(uc.nome)}
                              onChange={() => toggleUC(uc.nome)}
                              className="rounded text-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-800 leading-tight">{uc.nome}</p>
                              <p className="text-xs text-gray-400">{uc.codigo_uc} · {uc.modulo_etapa} · {uc.carga_horaria}h</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )
                  )}

                  {checkedUCs.length > 0 && (
                    <p className="text-xs text-primary mt-2 font-medium">{checkedUCs.length} UC(s) selecionada(s)</p>
                  )}

                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={isEdit ? handleAddUCsEdit : handleAddUCsPending}
                      disabled={!checkedUCs.length || addAtuacao.isPending}
                      className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {addAtuacao.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      {isEdit ? "Adicionar selecionadas" : "Adicionar à lista"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddUC(false); setCheckedUCs([]); setSelectedCursoId(""); setNovaModalidade("Presencial"); }}
                      className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de atuações (edit mode) */}
              {isEdit && (
                loadingDetalhes ? (
                  <div className="text-center py-4 text-gray-400 text-xs">Carregando...</div>
                ) : atuacoesPorCurso.length === 0 && !showAddUC ? (
                  <p className="text-xs text-gray-400 italic">Nenhuma UC cadastrada. Clique em "Adicionar UCs" para começar.</p>
                ) : (
                  <div className="space-y-4">
                    {atuacoesPorCurso.map((grupo: any) => (
                      <div key={grupo.curso_id ?? "sem-curso"}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-primary leading-tight">{grupo.curso_nome}</span>
                          {grupo.curso_codigo && (
                            <span className="text-xs font-mono text-gray-400">({grupo.curso_codigo})</span>
                          )}
                        </div>
                        <div className="space-y-1.5 pl-3 border-l-2 border-blue-100">
                          {grupo.atuacoes.map((at: any) => (
                            <div key={at.id} className="flex items-start justify-between group gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700 leading-snug">{at.nome}</p>
                                {/* Modalidade — clique para editar */}
                                {editandoModalidade === at.id ? (
                                  <div className="flex items-center gap-1 mt-1">
                                    <select
                                      className="text-xs border rounded px-1.5 py-0.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                                      defaultValue={at.modalidade || "Habilitação Técnica"}
                                      autoFocus
                                      onChange={(e) => updModalidade.mutate({ atId: at.id, modalidade: e.target.value })}
                                      onBlur={() => setEditandoModalidade(null)}
                                    >
                                      {MODALIDADE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setEditandoModalidade(at.id)}
                                    className="mt-0.5 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                                    title="Clique para alterar modalidade"
                                  >
                                    <ModalidadeBadge modalidade={at.modalidade} />
                                  </button>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => delAtuacao.mutate(at.id)}
                                disabled={delAtuacao.isPending}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity shrink-0 mt-0.5"
                                title="Remover UC"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Lista pendente (create mode) */}
              {!isEdit && (
                pendingUCs.length === 0 && !showAddUC ? (
                  <p className="text-xs text-gray-400 italic">Nenhuma UC adicionada ainda.</p>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(pendingUCsByCurso).map(([cursoNome, ucs]) => (
                      <div key={cursoNome}>
                        <p className="text-xs font-bold text-primary mb-1.5">{cursoNome}</p>
                        <div className="space-y-1.5 pl-3 border-l-2 border-blue-100">
                          {(ucs as any[]).map((u, i) => (
                            <div key={i} className="flex items-start justify-between group gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-700">{u.disciplina}</p>
                                <ModalidadeBadge modalidade={u.modalidade} />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingUCs((prev) =>
                                    prev.filter((x) => !(x.disciplina === u.disciplina && x.cursoNome === cursoNome))
                                  )
                                }
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-opacity shrink-0 mt-0.5"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>
          </form>
        </div>

        {/* ── Footer (create mode) ── */}
        {!isEdit && (
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {pendingDisps.length} horário(s) · {pendingUCs.length} UC(s)
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-100">
                Cancelar
              </button>
              <button
                form="prof-form"
                type="submit"
                disabled={isBusy || !basic.nome}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Criar Professor
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-componente: badge de modalidade ──────────────────────────
export const MODALIDADE_OPTIONS = [
  "Habilitação Técnica",
  "Qualificação Profissional",
  "Habilitação Técnica e Qualificação Profissional",
];

const MODALIDADE_STYLES: Record<string, string> = {
  "habilitação técnica":                              "bg-blue-50 text-blue-700",
  "qualificação profissional":                        "bg-amber-50 text-amber-700",
  "habilitação técnica e qualificação profissional":  "bg-indigo-50 text-indigo-700",
};

function ModalidadeBadge({ modalidade }: { modalidade?: string | null }) {
  const label = modalidade || "Habilitação Técnica";
  const style = MODALIDADE_STYLES[label.toLowerCase()] || "bg-gray-100 text-gray-600";
  return (
    <span className={cn("inline-block text-xs px-1.5 py-0.5 rounded font-medium mt-0.5", style)}>
      {label}
    </span>
  );
}

// ── Sub-componente: lista de disponibilidades ─────────────────────
function DispList({ disponibilidades, onDelete, deleting }: {
  disponibilidades: any[];
  onDelete: (id: number) => void;
  deleting: boolean;
}) {
  const byDia: Record<number, any[]> = {};
  for (const d of disponibilidades) {
    if (!byDia[d.dia_semana]) byDia[d.dia_semana] = [];
    byDia[d.dia_semana].push(d);
  }

  return (
    <div className="space-y-2">
      {Object.entries(byDia)
        .sort(([a], [b]) => +a - +b)
        .map(([dia, items]) => (
          <div key={dia} className="flex items-start gap-3">
            <span className={cn("text-xs font-bold px-2 py-0.5 rounded min-w-[2.5rem] text-center shrink-0 mt-0.5", DIAS_COR[+dia] || "bg-gray-100 text-gray-600")}>
              {DIAS[+dia]?.slice(0, 3)}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(items as any[]).map((d) => (
                <div key={d.id} className="flex items-center gap-1 group">
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full border",
                    d.tipo === "Disponível"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-red-50 text-red-600 border-red-200 line-through"
                  )}>
                    {d.horario_inicio} – {d.horario_fim}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDelete(d.id)}
                    disabled={deleting}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
                    title="Remover"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
