"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { relatoriosApi, professoresApi, eventosApi, pagamentosApi, contratosApi, downloadBlob } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Users, BookOpen, Database, ShoppingBag, History, Receipt, ListChecks, CreditCard, CheckCircle2, RotateCcw, X, AlertCircle } from "lucide-react";

const TIPOS_CONTRATO_PAG = ["PJ", "RPA", "Inclusão em Folha"];

const TIPOS_CONTRATO = ["Inclusão em Folha", "RPA", "PJ"] as const;

export default function RelatoriosPage() {
  const qc = useQueryClient();
  const [perfil, setPerfil] = useState("");
  useEffect(() => {
    const me = getCurrentUser();
    if (me?.perfil) setPerfil(me.perfil);
  }, []);
  const isAdmin = perfil === "admin";
  const podeEncaminhar = ["admin", "coordenador", "analista"].includes(perfil);

  const [loadingReg, setLoadingReg] = useState(false);
  const [loadingProf, setLoadingProf] = useState(false);
  const [loadingTurma, setLoadingTurma] = useState(false);
  const [loadingDados, setLoadingDados] = useState(false);
  const [loadingOfertas, setLoadingOfertas] = useState(false);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [loadingContrato, setLoadingContrato] = useState(false);
  const [selectedProf, setSelectedProf] = useState("");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [selectedEventoHist, setSelectedEventoHist] = useState("");
  const [dateIni, setDateIni] = useState("");
  const [dateFim, setDateFim] = useState("");
  // Novo: relatório por tipo de contrato
  const [tiposContrato, setTiposContrato] = useState<string[]>([]);
  const [selectedProfContrato, setSelectedProfContrato] = useState("");
  const [dateIniContrato, setDateIniContrato] = useState("");
  const [dateFimContrato, setDateFimContrato] = useState("");

  const [selectedEventoUC, setSelectedEventoUC] = useState("");
  const [loadingUCExcel, setLoadingUCExcel] = useState(false);

  const { data: ucsEvento, isLoading: loadingUCs } = useQuery({
    queryKey: ["ucs-evento", selectedEventoUC],
    queryFn: () => relatoriosApi.ucsEvento(+selectedEventoUC),
    enabled: !!selectedEventoUC,
    staleTime: 60_000,
  });

  const { data: professores = [] } = useQuery({
    queryKey: ["professores-ativos"],
    queryFn: () => professoresApi.listar({ ativo: true }),
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ["eventos-ativos"],
    queryFn: () => eventosApi.listar(),
  });

  async function baixarRegencia() {
    setLoadingReg(true);
    try {
      const res = await relatoriosApi.regencia();
      downloadBlob(res.data, "regencia_docente.xlsx");
      toast.success("Relatório de regência exportado!");
    } catch {
      toast.error("Erro ao exportar relatório");
    } finally {
      setLoadingReg(false);
    }
  }

  async function baixarCronogramaProfessor() {
    if (!selectedProf || !dateIni || !dateFim) {
      toast.error("Selecione professor e período");
      return;
    }
    setLoadingProf(true);
    try {
      const res = await relatoriosApi.cronogramaProfessor(+selectedProf, dateIni, dateFim);
      const prof = professores.find((p: any) => p.id === +selectedProf);
      downloadBlob(res.data, `cronograma_${prof?.nome || selectedProf}.xlsx`);
      toast.success("Cronograma exportado!");
    } catch {
      toast.error("Erro ao exportar cronograma");
    } finally {
      setLoadingProf(false);
    }
  }

  async function baixarCronogramaTurma() {
    if (!selectedTurma) {
      toast.error("Selecione uma turma");
      return;
    }
    setLoadingTurma(true);
    try {
      const res = await relatoriosApi.cronogramaTurma(+selectedTurma);
      const ev = eventos.find((e: any) => e.id === +selectedTurma);
      downloadBlob(res.data, `cronograma_${ev?.nome_turma || selectedTurma}.xlsx`);
      toast.success("Cronograma da turma exportado!");
    } catch {
      toast.error("Erro ao exportar cronograma");
    } finally {
      setLoadingTurma(false);
    }
  }

  async function baixarDadosMestres() {
    setLoadingDados(true);
    try {
      const res = await relatoriosApi.dadosMestres();
      downloadBlob(res.data, "dados_mestres.xlsx");
      toast.success("Dados mestres exportados!");
    } catch {
      toast.error("Erro ao exportar dados mestres");
    } finally {
      setLoadingDados(false);
    }
  }

  async function baixarOfertas() {
    setLoadingOfertas(true);
    try {
      const res = await relatoriosApi.ofertas();
      downloadBlob(res.data, "ofertas_senai.xlsx");
      toast.success("Ofertas exportadas!");
    } catch {
      toast.error("Erro ao exportar ofertas");
    } finally {
      setLoadingOfertas(false);
    }
  }

  const professoresFiltradosTipo = (professores as any[]).filter(
    (p) => tiposContrato.length === 0 || tiposContrato.includes(p.tipo)
  );

  function toggleTipoContrato(tipo: string) {
    setTiposContrato((prev) =>
      prev.includes(tipo) ? prev.filter((t) => t !== tipo) : [...prev, tipo]
    );
    setSelectedProfContrato("");
  }

  async function baixarCronogramaContrato() {
    if (!selectedProfContrato || !dateIniContrato || !dateFimContrato) {
      toast.error("Selecione professor e período");
      return;
    }
    setLoadingContrato(true);
    try {
      const res = await relatoriosApi.cronogramaContrato(+selectedProfContrato, dateIniContrato, dateFimContrato);
      const prof = (professores as any[]).find((p) => p.id === +selectedProfContrato);
      downloadBlob(res.data, `cronograma_contrato_${prof?.nome || selectedProfContrato}.xlsx`);
      toast.success("Relatório exportado!");
    } catch {
      toast.error("Erro ao exportar relatório");
    } finally {
      setLoadingContrato(false);
    }
  }

  async function baixarUCsExcel() {
    if (!selectedEventoUC) return;
    setLoadingUCExcel(true);
    try {
      const res = await relatoriosApi.ucsEventoExcel(+selectedEventoUC);
      const ev = (eventos as any[]).find((e) => e.id === +selectedEventoUC);
      downloadBlob(res.data, `ucs_${ev?.nome_turma || selectedEventoUC}.xlsx`);
      toast.success("Relatório exportado!");
    } catch {
      toast.error("Erro ao exportar relatório");
    } finally {
      setLoadingUCExcel(false);
    }
  }

  // ── Controle de Pagamento ──────────────────────────────────────────────────
  const [profPag, setProfPag] = useState("");
  const [dateIniPag, setDateIniPag] = useState("");
  const [dateFimPag, setDateFimPag] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("pendente");
  const [aulasSel, setAulasSel] = useState<Set<number>>(new Set());
  const [contratoIdSel, setContratoIdSel] = useState("");
  const [encaminhadosSel, setEncaminhadosSel] = useState<Set<number>>(new Set());
  const [modalReverter, setModalReverter] = useState<{ open: boolean; pagamentoId: number | null; obs: string }>({ open: false, pagamentoId: null, obs: "" });
  const [loadingExcelPag, setLoadingExcelPag] = useState(false);
  const [abaConfirmar, setAbaConfirmar] = useState<"encaminhado" | "pago">("encaminhado");

  const professoresPag = (professores as any[]).filter(p => TIPOS_CONTRATO_PAG.includes(p.tipo));

  const { data: aulasPag = [], isLoading: loadingAulasPag } = useQuery({
    queryKey: ["pagamentos-aulas", profPag, dateIniPag, dateFimPag, statusFiltro],
    queryFn: () => pagamentosApi.aulas({
      ...(profPag && { professor_id: +profPag }),
      ...(dateIniPag && { data_inicio: dateIniPag }),
      ...(dateFimPag && { data_fim: dateFimPag }),
      ...(statusFiltro !== "todos" && { status: statusFiltro }),
    }),
    staleTime: 30_000,
  });

  const { data: contratosPag = [] } = useQuery({
    queryKey: ["contratos-pag", profPag],
    queryFn: () => contratosApi.listar(+profPag),
    enabled: !!profPag,
    staleTime: 30_000,
  });

  const { data: encaminhados = [], isLoading: loadingEnc } = useQuery({
    queryKey: ["pagamentos-encaminhados"],
    queryFn: () => pagamentosApi.encaminhados(),
    staleTime: 30_000,
  });

  const { data: aulasPagas = [], isLoading: loadingPagos } = useQuery({
    queryKey: ["pagamentos-pagos"],
    queryFn: () => pagamentosApi.aulas({ status: "pago" }),
    staleTime: 30_000,
  });

  const contratoSelecionado = (contratosPag as any[]).find(c => c.id === +contratoIdSel);

  const encaminharMutation = useMutation({
    mutationFn: () => pagamentosApi.encaminhar({ aula_ids: [...aulasSel], contrato_id: +contratoIdSel }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["pagamentos-aulas"] });
      qc.invalidateQueries({ queryKey: ["contratos-pag"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-encaminhados"] });
      setAulasSel(new Set());
      setContratoIdSel("");
      setStatusFiltro("encaminhado"); // mostra as aulas recém-encaminhadas
      toast.success(`${data.encaminhados} aula(s) encaminhada(s) para pagamento!`);
      if (data.ja_processadas?.length > 0)
        toast.warning(`${data.ja_processadas.length} aula(s) já tinham pagamento ativo e foram ignoradas.`);
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao encaminhar"),
  });

  const confirmarMutation = useMutation({
    mutationFn: (ids: number[]) => pagamentosApi.confirmar(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-encaminhados"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-aulas"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-pagos"] });
      setEncaminhadosSel(new Set());
      toast.success("Pagamento(s) confirmado(s)!");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao confirmar"),
  });

  const reverterMutation = useMutation({
    mutationFn: ({ id, obs }: { id: number; obs: string }) => pagamentosApi.reverter(id, obs || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pagamentos-encaminhados"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-aulas"] });
      qc.invalidateQueries({ queryKey: ["pagamentos-pagos"] });
      setModalReverter({ open: false, pagamentoId: null, obs: "" });
      toast.success("Pagamento revertido!");
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || "Erro ao reverter"),
  });

  function toggleAula(id: number) {
    setAulasSel(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleTodosAulas() {
    const pendentes = (aulasPag as any[]).filter(a => a.status_pagamento === "pendente").map((a: any) => a.id);
    if (pendentes.every(id => aulasSel.has(id))) {
      setAulasSel(new Set());
    } else {
      setAulasSel(new Set(pendentes));
    }
  }

  function toggleEncaminhado(id: number) {
    setEncaminhadosSel(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleTodosEncaminhados() {
    const ids = (encaminhados as any[]).map((e: any) => e.id);
    if (ids.every(id => encaminhadosSel.has(id))) {
      setEncaminhadosSel(new Set());
    } else {
      setEncaminhadosSel(new Set(ids));
    }
  }

  async function baixarExcelPagamentos() {
    setLoadingExcelPag(true);
    try {
      const res = await pagamentosApi.relatorioExcel({
        ...(profPag && { professor_id: +profPag }),
        ...(dateIniPag && { data_inicio: dateIniPag }),
        ...(dateFimPag && { data_fim: dateFimPag }),
      });
      downloadBlob(res.data, "controle_pagamentos.xlsx");
      toast.success("Relatório exportado!");
    } catch {
      toast.error("Erro ao exportar relatório de pagamentos");
    } finally {
      setLoadingExcelPag(false);
    }
  }

  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function baixarHistorico() {
    setLoadingHistorico(true);
    try {
      const eventoId = selectedEventoHist ? +selectedEventoHist : undefined;
      const res = await relatoriosApi.historico(eventoId ? { evento_id: eventoId } : undefined);
      const ev = eventos.find((e: any) => e.id === eventoId);
      downloadBlob(res.data, `historico_${ev?.nome_turma || "completo"}.xlsx`);
      toast.success("Histórico exportado!");
    } catch {
      toast.error("Erro ao exportar histórico");
    } finally {
      setLoadingHistorico(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Relatórios" description="Exporte dados em Excel para análise e reaproveitamento" />

      {/* ── Relatórios analíticos ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Relatórios analíticos
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Regência geral */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Regência Docente</h3>
                <p className="text-xs text-gray-400">Todos os professores</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Exporta planilha com regência de todos os professores, incluindo horas contratadas,
              ministradas, percentual e status.
            </p>
            <button
              onClick={baixarRegencia}
              disabled={loadingReg}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingReg ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Cronograma por professor */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Cronograma por Professor</h3>
                <p className="text-xs text-gray-400">Aulas no período selecionado</p>
              </div>
            </div>
            <div className="space-y-3 mb-4">
              <select className="input w-full" value={selectedProf}
                onChange={(e) => setSelectedProf(e.target.value)}>
                <option value="">Selecionar professor</option>
                {professores.map((p: any) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Início</label>
                  <input type="date" className="input w-full" value={dateIni}
                    onChange={(e) => setDateIni(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Fim</label>
                  <input type="date" className="input w-full" value={dateFim}
                    onChange={(e) => setDateFim(e.target.value)} />
                </div>
              </div>
            </div>
            <button
              onClick={baixarCronogramaProfessor}
              disabled={loadingProf}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingProf ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Cronograma por turma */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <BookOpen className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Cronograma por Turma</h3>
                <p className="text-xs text-gray-400">Todas as aulas da turma</p>
              </div>
            </div>
            <div className="mb-4">
              <select className="input w-full" value={selectedTurma}
                onChange={(e) => setSelectedTurma(e.target.value)}>
                <option value="">Selecionar turma</option>
                {eventos.map((e: any) => <option key={e.id} value={e.id}>{e.nome_turma}</option>)}
              </select>
            </div>
            <button
              onClick={baixarCronogramaTurma}
              disabled={loadingTurma}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingTurma ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Cronograma por tipo de contrato */}
          <div className="card p-6 lg:col-span-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-rose-100 rounded-lg">
                <Receipt className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Cronograma por Tipo de Contrato</h3>
                <p className="text-xs text-gray-400">Inclusão em Folha, RPA e PJ — com valor total</p>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              {/* Tipo de contrato */}
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">Tipo de contrato</p>
                <div className="flex flex-wrap gap-3">
                  {TIPOS_CONTRATO.map((tipo) => (
                    <label key={tipo} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={tiposContrato.includes(tipo)}
                        onChange={() => toggleTipoContrato(tipo)}
                        className="rounded border-gray-300"
                      />
                      {tipo}
                    </label>
                  ))}
                </div>
              </div>
              {/* Professor filtrado */}
              <div>
                <label className="block text-xs text-gray-500 mb-1 font-medium">Professor</label>
                <select
                  className="input w-full"
                  value={selectedProfContrato}
                  onChange={(e) => setSelectedProfContrato(e.target.value)}
                  disabled={professoresFiltradosTipo.length === 0}
                >
                  <option value="">
                    {tiposContrato.length === 0
                      ? "Selecione o tipo primeiro"
                      : professoresFiltradosTipo.length === 0
                      ? "Nenhum professor encontrado"
                      : "Selecionar professor"}
                  </option>
                  {professoresFiltradosTipo.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} ({p.tipo})
                    </option>
                  ))}
                </select>
              </div>
              {/* Período */}
              <div>
                <p className="text-xs text-gray-500 mb-1 font-medium">Período</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Início</label>
                    <input
                      type="date"
                      className="input w-full"
                      value={dateIniContrato}
                      onChange={(e) => setDateIniContrato(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Fim</label>
                    <input
                      type="date"
                      className="input w-full"
                      value={dateFimContrato}
                      onChange={(e) => setDateFimContrato(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={baixarCronogramaContrato}
              disabled={loadingContrato || !selectedProfContrato || !dateIniContrato || !dateFimContrato}
              className="btn-primary flex items-center justify-center gap-2 px-6"
            >
              <Download className="h-4 w-4" />
              {loadingContrato ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>
        </div>
      </section>

      {/* ── UCs por Evento ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Planejamento por UC
        </h2>
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <ListChecks className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">UCs por Evento</h3>
              <p className="text-xs text-gray-400">CH prevista vs CH planejada por Unidade Curricular</p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 mb-5">
            <div className="flex-1 min-w-48">
              <label className="block text-xs text-gray-500 mb-1 font-medium">Evento / Turma</label>
              <select
                className="input w-full"
                value={selectedEventoUC}
                onChange={(e) => setSelectedEventoUC(e.target.value)}
              >
                <option value="">Selecionar evento</option>
                {(eventos as any[]).map((e) => (
                  <option key={e.id} value={e.id}>{e.nome_turma} — {e.disciplina}</option>
                ))}
              </select>
            </div>
            {selectedEventoUC && (
              <button
                onClick={baixarUCsExcel}
                disabled={loadingUCExcel || loadingUCs}
                className="btn-primary flex items-center gap-2 px-4"
              >
                <Download className="h-4 w-4" />
                {loadingUCExcel ? "Exportando..." : "Exportar Excel"}
              </button>
            )}
          </div>

          {/* Tabela de UCs */}
          {loadingUCs && <p className="text-sm text-gray-400 py-4">Carregando UCs...</p>}

          {ucsEvento && !loadingUCs && (() => {
            const dados = ucsEvento as any;
            const ucs: any[] = dados.ucs ?? [];

            if (!dados.curso_id && ucs.length === 0) {
              return (
                <p className="text-sm text-amber-600 bg-amber-50 rounded-lg p-3">
                  Este evento não está vinculado a nenhuma pasta/curso com UCs cadastradas.
                </p>
              );
            }

            const chPrev = ucs.reduce((s: number, u: any) => s + (u.carga_horaria ?? 0), 0);
            const chPlan = ucs.reduce((s: number, u: any) => s + u.ch_planejada, 0);
            const planejadas = ucs.filter((u: any) => u.status === "Planejada").length;
            const naoPlan = ucs.filter((u: any) => u.status === "Não planejada").length;

            return (
              <div>
                {/* Resumo */}
                <div className="flex flex-wrap gap-4 mb-4">
                  <div className="rounded-lg bg-gray-50 border px-4 py-2 text-center">
                    <p className="text-xs text-gray-500">Total UCs</p>
                    <p className="text-lg font-bold text-gray-800">{dados.total_ucs}</p>
                  </div>
                  <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-center">
                    <p className="text-xs text-green-600">Planejadas</p>
                    <p className="text-lg font-bold text-green-700">{planejadas}</p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-center">
                    <p className="text-xs text-red-600">Não planejadas</p>
                    <p className="text-lg font-bold text-red-700">{naoPlan}</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-center">
                    <p className="text-xs text-blue-600">CH Prevista</p>
                    <p className="text-lg font-bold text-blue-700">{chPrev}h</p>
                  </div>
                  <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-2 text-center">
                    <p className="text-xs text-indigo-600">CH Planejada</p>
                    <p className="text-lg font-bold text-indigo-700">{chPlan.toFixed(1)}h</p>
                  </div>
                </div>

                {/* Tabela */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
                        <th className="text-left px-3 py-2 border-b">Módulo/Etapa</th>
                        <th className="text-left px-3 py-2 border-b">Código</th>
                        <th className="text-left px-3 py-2 border-b">Nome da UC</th>
                        <th className="text-right px-3 py-2 border-b">CH Prevista</th>
                        <th className="text-right px-3 py-2 border-b">CH Planejada</th>
                        <th className="text-right px-3 py-2 border-b">Saldo</th>
                        <th className="text-center px-3 py-2 border-b">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ucs.map((uc: any, idx: number) => (
                        <tr key={uc.uc_id ?? `nome-${idx}`} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          <td className="px-3 py-2 border-b text-gray-500 text-xs">{uc.modulo_etapa || "—"}</td>
                          <td className="px-3 py-2 border-b text-gray-500 font-mono text-xs">{uc.codigo_uc || "—"}</td>
                          <td className="px-3 py-2 border-b font-medium text-gray-800">{uc.nome}</td>
                          <td className="px-3 py-2 border-b text-right text-gray-600">
                            {uc.carga_horaria != null ? `${uc.carga_horaria}h` : "—"}
                          </td>
                          <td className="px-3 py-2 border-b text-right font-semibold text-gray-800">
                            {uc.ch_planejada > 0 ? `${uc.ch_planejada}h` : "—"}
                          </td>
                          <td className={`px-3 py-2 border-b text-right text-xs font-medium ${uc.saldo != null ? (uc.saldo >= 0 ? "text-green-600" : "text-red-600") : "text-gray-400"}`}>
                            {uc.saldo != null ? `${uc.saldo > 0 ? "+" : ""}${uc.saldo}h` : "—"}
                          </td>
                          <td className="px-3 py-2 border-b text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              uc.status === "Planejada" ? "bg-green-100 text-green-700"
                              : uc.status === "Não planejada" ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>
                              {uc.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-bold">
                        <td colSpan={3} className="px-3 py-2 border-t text-gray-700">Total</td>
                        <td className="px-3 py-2 border-t text-right">{chPrev}h</td>
                        <td className="px-3 py-2 border-t text-right">{chPlan.toFixed(1)}h</td>
                        <td className={`px-3 py-2 border-t text-right text-xs font-bold ${chPlan - chPrev >= 0 ? "text-green-600" : "text-red-600"}`}>
                          {(chPlan - chPrev) > 0 ? "+" : ""}{(chPlan - chPrev).toFixed(1)}h
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* ── Exportação no formato de importação ───────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Exportar no formato de importação
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Exporte os dados atuais do sistema usando exatamente as mesmas colunas e abas das planilhas de importação —
          útil para backup, revisão ou reaproveitamento em outro período.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Dados Mestres */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-violet-100 rounded-lg">
                <Database className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Dados Mestres</h3>
                <p className="text-xs text-gray-400">Formato idêntico ao da importação</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Gera planilha com 4 abas: <span className="font-medium">PROFESSORES</span>,{" "}
              <span className="font-medium">ATUAÇÃO</span>,{" "}
              <span className="font-medium">DISPONIBILIDADE DETALHADA</span> e{" "}
              <span className="font-medium">CALENDÁRIO ACADÊMICO</span>.
            </p>
            <button
              onClick={baixarDadosMestres}
              disabled={loadingDados}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingDados ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Ofertas SENAI */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <ShoppingBag className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Ofertas SENAI</h3>
                <p className="text-xs text-gray-400">Formato idêntico ao da importação</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Gera planilha com abas <span className="font-medium">1° SEMESTRE</span> e{" "}
              <span className="font-medium">2° SEMESTRE</span> com todos os campos de oferta de curso.
            </p>
            <button
              onClick={baixarOfertas}
              disabled={loadingOfertas}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingOfertas ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Histórico de Aulas */}
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-teal-100 rounded-lg">
                <History className="h-5 w-5 text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Histórico de Aulas</h3>
                <p className="text-xs text-gray-400">Formato idêntico ao da importação</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Exporta todas as aulas com as 17 colunas do histórico. Filtre por turma para exportar
              apenas um evento específico.
            </p>
            <div className="mb-4">
              <select
                className="input w-full"
                value={selectedEventoHist}
                onChange={(e) => setSelectedEventoHist(e.target.value)}
              >
                <option value="">Todos os eventos</option>
                {eventos.map((e: any) => <option key={e.id} value={e.id}>{e.nome_turma}</option>)}
              </select>
            </div>
            <button
              onClick={baixarHistorico}
              disabled={loadingHistorico}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingHistorico ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

        </div>
      </section>

      {/* ── Controle de Pagamento ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Controle de Pagamento
        </h2>

        {/* ── Encaminhar aulas ── */}
        <div className="card p-6 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-blue-100 rounded-lg">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">Encaminhar Aulas para Pagamento</h3>
              <p className="text-xs text-gray-400">Selecione aulas PJ / RPA / Inclusão em Folha e vincule ao contrato</p>
            </div>
          </div>

          {/* Filtros */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Professor</label>
              <select
                className="input w-full"
                value={profPag}
                onChange={e => { setProfPag(e.target.value); setAulasSel(new Set()); setContratoIdSel(""); }}
              >
                <option value="">Todos</option>
                {professoresPag.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.nome} ({p.tipo})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Status</label>
              <select className="input w-full" value={statusFiltro} onChange={e => setStatusFiltro(e.target.value)}>
                <option value="pendente">Pendente</option>
                <option value="encaminhado">Encaminhado</option>
                <option value="pago">Pago</option>
                <option value="todos">Todos</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Data início</label>
              <input type="date" className="input w-full" value={dateIniPag} onChange={e => setDateIniPag(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Data fim</label>
              <input type="date" className="input w-full" value={dateFimPag} onChange={e => setDateFimPag(e.target.value)} />
            </div>
          </div>

          {/* Tabela de aulas */}
          {loadingAulasPag ? (
            <p className="text-sm text-gray-400 py-4">Carregando aulas...</p>
          ) : (aulasPag as any[]).length === 0 ? (
            <p className="text-sm text-gray-400 py-4 italic">Nenhuma aula encontrada para os filtros selecionados.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                    {podeEncaminhar && (
                      <th className="px-3 py-2 border-b w-8">
                        <input
                          type="checkbox"
                          onChange={toggleTodosAulas}
                          checked={(aulasPag as any[]).filter(a => a.status_pagamento === "pendente").length > 0
                            && (aulasPag as any[]).filter(a => a.status_pagamento === "pendente").every(a => aulasSel.has(a.id))}
                          className="rounded"
                        />
                      </th>
                    )}
                    <th className="px-3 py-2 border-b text-left">Data</th>
                    <th className="px-3 py-2 border-b text-left">Professor</th>
                    <th className="px-3 py-2 border-b text-left">Evento / Turma</th>
                    <th className="px-3 py-2 border-b text-left">UC / Disciplina</th>
                    <th className="px-3 py-2 border-b text-center">Horário</th>
                    <th className="px-3 py-2 border-b text-right">Horas</th>
                    <th className="px-3 py-2 border-b text-center">Status</th>
                    <th className="px-3 py-2 border-b text-left">Contrato</th>
                  </tr>
                </thead>
                <tbody>
                  {(aulasPag as any[]).map((a: any, idx: number) => {
                    const isPendente = a.status_pagamento === "pendente";
                    return (
                      <tr
                        key={a.id}
                        className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                        onClick={() => podeEncaminhar && isPendente && toggleAula(a.id)}
                      >
                        {podeEncaminhar && (
                          <td className="px-3 py-2 border-b">
                            {isPendente && (
                              <input
                                type="checkbox"
                                checked={aulasSel.has(a.id)}
                                onChange={() => toggleAula(a.id)}
                                onClick={e => e.stopPropagation()}
                                className="rounded"
                              />
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 border-b whitespace-nowrap font-mono text-gray-600">
                          {a.data?.replace(/(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1")}
                        </td>
                        <td className="px-3 py-2 border-b max-w-[120px] truncate">
                          <span className="font-medium text-gray-800">{a.professor_nome}</span>
                          <span className="ml-1 text-[10px] text-gray-400">({a.professor_tipo})</span>
                        </td>
                        <td className="px-3 py-2 border-b max-w-[130px] truncate text-gray-600">
                          {a.evento_nome}
                        </td>
                        <td className="px-3 py-2 border-b max-w-[130px] truncate text-gray-600">
                          {a.uc_nome}
                        </td>
                        <td className="px-3 py-2 border-b text-center text-gray-500 whitespace-nowrap">
                          {a.horario_inicio}–{a.horario_fim}
                        </td>
                        <td className="px-3 py-2 border-b text-right font-semibold text-gray-700 tabular-nums">
                          {a.horas}h
                        </td>
                        <td className="px-3 py-2 border-b text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            a.status_pagamento === "pago"
                              ? "bg-green-100 text-green-700"
                              : a.status_pagamento === "encaminhado"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {a.status_pagamento === "pago" ? "Pago"
                              : a.status_pagamento === "encaminhado" ? "Encaminhado"
                              : "Pendente"}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-b text-gray-400 text-[10px]">
                          {a.contrato_numero || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ação: vincular contrato e encaminhar */}
          {podeEncaminhar && aulasSel.size > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm font-medium text-blue-800 mb-3">
                {aulasSel.size} aula(s) selecionada(s) — vincule a um contrato e encaminhe
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-48">
                  <label className="block text-xs text-blue-600 mb-1 font-medium">
                    Contrato {!profPag && <span className="text-amber-600">(filtre por professor primeiro)</span>}
                  </label>
                  <select
                    className="input w-full"
                    value={contratoIdSel}
                    onChange={e => setContratoIdSel(e.target.value)}
                    disabled={!profPag}
                  >
                    <option value="">Selecionar contrato</option>
                    {(contratosPag as any[]).filter(c => c.ativo).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.numero_contrato} — {fmt(c.valor_hora)}/h — saldo: {c.saldo_horas}h
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => encaminharMutation.mutate()}
                  disabled={!contratoIdSel || encaminharMutation.isPending}
                  className="btn-primary flex items-center gap-2 whitespace-nowrap"
                >
                  <CreditCard className="h-4 w-4" />
                  {encaminharMutation.isPending ? "Encaminhando..." : "Encaminhar para Pagamento"}
                </button>
              </div>

              {/* Barra de progresso do contrato selecionado */}
              {contratoSelecionado && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-blue-700 mb-1">
                    <span>Utilização do contrato: {contratoSelecionado.horas_utilizadas}h / {contratoSelecionado.total_horas_previstas}h</span>
                    <span className="font-semibold">{contratoSelecionado.percentual_utilizado}%</span>
                  </div>
                  <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${contratoSelecionado.percentual_utilizado >= 90 ? "bg-red-500" : contratoSelecionado.percentual_utilizado >= 70 ? "bg-amber-400" : "bg-blue-500"}`}
                      style={{ width: `${Math.min(100, contratoSelecionado.percentual_utilizado)}%` }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-1">
                    Saldo disponível: <strong>{contratoSelecionado.saldo_horas}h ({fmt(contratoSelecionado.saldo_financeiro)})</strong>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Confirmar / Reverter (admin) + Excel ── */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">
                  {isAdmin ? "Confirmar Pagamentos" : "Pagamentos Encaminhados"}
                </h3>
                <p className="text-xs text-gray-400">
                  {isAdmin
                    ? "Aulas encaminhadas aguardando sua confirmação"
                    : "Acompanhe o status dos encaminhamentos realizados"}
                </p>
              </div>
            </div>
            <button
              onClick={baixarExcelPagamentos}
              disabled={loadingExcelPag}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              {loadingExcelPag ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>

          {/* Abas */}
          <div className="flex gap-1 mb-4 border-b border-gray-200">
            <button
              onClick={() => setAbaConfirmar("encaminhado")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                abaConfirmar === "encaminhado"
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Encaminhados
              {(encaminhados as any[]).length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-700 font-semibold">
                  {(encaminhados as any[]).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setAbaConfirmar("pago")}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                abaConfirmar === "pago"
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Confirmados / Pagos
              {(aulasPagas as any[]).length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700 font-semibold">
                  {(aulasPagas as any[]).length}
                </span>
              )}
            </button>
          </div>

          {/* ── Aba Encaminhados ── */}
          {abaConfirmar === "encaminhado" && (
            loadingEnc ? (
              <p className="text-sm text-gray-400 py-2">Carregando...</p>
            ) : (encaminhados as any[]).length === 0 ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                <AlertCircle className="h-4 w-4" />
                Nenhum pagamento aguardando confirmação.
              </div>
            ) : (
              <>
                {isAdmin && encaminhadosSel.size > 0 && (
                  <div className="flex items-center gap-3 mb-3 bg-green-50 border border-green-200 rounded-lg p-3">
                    <span className="text-sm text-green-700 flex-1">
                      {encaminhadosSel.size} pagamento(s) selecionado(s) — total:{" "}
                      <strong>{fmt((encaminhados as any[]).filter(e => encaminhadosSel.has(e.id)).reduce((s, e: any) => s + e.valor, 0))}</strong>
                    </span>
                    <button
                      onClick={() => confirmarMutation.mutate([...encaminhadosSel])}
                      disabled={confirmarMutation.isPending}
                      className="btn-primary flex items-center gap-1.5 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {confirmarMutation.isPending ? "Confirmando..." : "Confirmar Pagamento"}
                    </button>
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                        {isAdmin && (
                          <th className="px-3 py-2 border-b w-8">
                            <input
                              type="checkbox"
                              onChange={toggleTodosEncaminhados}
                              checked={(encaminhados as any[]).length > 0 && (encaminhados as any[]).every((e: any) => encaminhadosSel.has(e.id))}
                              className="rounded"
                            />
                          </th>
                        )}
                        <th className="px-3 py-2 border-b text-left">Data Aula</th>
                        <th className="px-3 py-2 border-b text-left">Professor</th>
                        <th className="px-3 py-2 border-b text-left">Evento</th>
                        <th className="px-3 py-2 border-b text-left">Contrato</th>
                        <th className="px-3 py-2 border-b text-right">Horas</th>
                        <th className="px-3 py-2 border-b text-right">Valor</th>
                        <th className="px-3 py-2 border-b text-left">Encaminhado por</th>
                        {isAdmin && <th className="px-3 py-2 border-b text-center">Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(encaminhados as any[]).map((enc: any, idx: number) => (
                        <tr key={enc.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                          {isAdmin && (
                            <td className="px-3 py-2 border-b">
                              <input
                                type="checkbox"
                                checked={encaminhadosSel.has(enc.id)}
                                onChange={() => toggleEncaminhado(enc.id)}
                                className="rounded"
                              />
                            </td>
                          )}
                          <td className="px-3 py-2 border-b font-mono text-gray-600 whitespace-nowrap">
                            {enc.aula_data?.replace(/(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1")}
                          </td>
                          <td className="px-3 py-2 border-b font-medium text-gray-800 max-w-[120px] truncate">
                            {enc.professor_nome}
                          </td>
                          <td className="px-3 py-2 border-b text-gray-600 max-w-[120px] truncate">
                            {enc.evento_nome}
                          </td>
                          <td className="px-3 py-2 border-b text-gray-500 font-mono">
                            {enc.contrato_numero || "—"}
                          </td>
                          <td className="px-3 py-2 border-b text-right font-semibold tabular-nums">
                            {enc.horas}h
                          </td>
                          <td className="px-3 py-2 border-b text-right font-semibold text-amber-700 tabular-nums">
                            {fmt(enc.valor)}
                          </td>
                          <td className="px-3 py-2 border-b text-gray-400">
                            {enc.encaminhado_por}
                          </td>
                          {isAdmin && (
                            <td className="px-3 py-2 border-b text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => confirmarMutation.mutate([enc.id])}
                                  disabled={confirmarMutation.isPending}
                                  className="p-1 rounded hover:bg-green-100 text-green-600"
                                  title="Confirmar pagamento"
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setModalReverter({ open: true, pagamentoId: enc.id, obs: "" })}
                                  className="p-1 rounded hover:bg-red-100 text-red-500"
                                  title="Reverter encaminhamento"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-bold">
                        <td colSpan={isAdmin ? 6 : 5} className="px-3 py-2 border-t text-gray-700">Total</td>
                        <td className="px-3 py-2 border-t text-right text-amber-700 tabular-nums">
                          {fmt((encaminhados as any[]).reduce((s, e: any) => s + e.valor, 0))}
                        </td>
                        <td colSpan={isAdmin ? 2 : 1} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )
          )}

          {/* ── Aba Confirmados / Pagos ── */}
          {abaConfirmar === "pago" && (
            loadingPagos ? (
              <p className="text-sm text-gray-400 py-2">Carregando...</p>
            ) : (aulasPagas as any[]).length === 0 ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
                <AlertCircle className="h-4 w-4" />
                Nenhum pagamento confirmado encontrado.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                      <th className="px-3 py-2 border-b text-left">Data Aula</th>
                      <th className="px-3 py-2 border-b text-left">Professor</th>
                      <th className="px-3 py-2 border-b text-left">Evento</th>
                      <th className="px-3 py-2 border-b text-left">Contrato</th>
                      <th className="px-3 py-2 border-b text-right">Horas</th>
                      <th className="px-3 py-2 border-b text-right">Valor</th>
                      {isAdmin && <th className="px-3 py-2 border-b text-center">Reverter</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(aulasPagas as any[]).map((a: any, idx: number) => (
                      <tr key={a.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-3 py-2 border-b font-mono text-gray-600 whitespace-nowrap">
                          {a.data?.replace(/(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1")}
                        </td>
                        <td className="px-3 py-2 border-b font-medium text-gray-800 max-w-[120px] truncate">
                          {a.professor_nome}
                          <span className="ml-1 text-[10px] text-gray-400">({a.professor_tipo})</span>
                        </td>
                        <td className="px-3 py-2 border-b text-gray-600 max-w-[130px] truncate">
                          {a.evento_nome}
                        </td>
                        <td className="px-3 py-2 border-b text-gray-500 font-mono">
                          {a.contrato_numero || "—"}
                        </td>
                        <td className="px-3 py-2 border-b text-right font-semibold tabular-nums">
                          {a.horas}h
                        </td>
                        <td className="px-3 py-2 border-b text-right font-semibold text-green-700 tabular-nums">
                          {a.valor_pagamento != null ? fmt(a.valor_pagamento) : "—"}
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-2 border-b text-center">
                            <button
                              onClick={() => setModalReverter({ open: true, pagamentoId: a.pagamento_id, obs: "" })}
                              className="p-1 rounded hover:bg-red-100 text-red-500"
                              title="Reverter pagamento confirmado"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={isAdmin ? 5 : 4} className="px-3 py-2 border-t text-gray-700">Total</td>
                      <td className="px-3 py-2 border-t text-right text-green-700 tabular-nums">
                        {fmt((aulasPagas as any[]).reduce((s, a: any) => s + (a.valor_pagamento || 0), 0))}
                      </td>
                      {isAdmin && <td />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          )}
        </div>
      </section>

      {/* Modal reverter */}
      {modalReverter.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Reverter Pagamento</h3>
              <button onClick={() => setModalReverter({ open: false, pagamentoId: null, obs: "" })}>
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Esta ação irá reverter o encaminhamento. O pagamento voltará ao status{" "}
              <strong>Revertido</strong> e a aula ficará disponível para novo encaminhamento.
            </p>
            <textarea
              className="input w-full resize-none"
              rows={3}
              placeholder="Motivo da reversão (opcional)"
              value={modalReverter.obs}
              onChange={e => setModalReverter(m => ({ ...m, obs: e.target.value }))}
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setModalReverter({ open: false, pagamentoId: null, obs: "" })}
                className="btn-secondary"
              >
                Cancelar
              </button>
              <button
                onClick={() => reverterMutation.mutate({ id: modalReverter.pagamentoId!, obs: modalReverter.obs })}
                disabled={reverterMutation.isPending}
                className="btn-primary !bg-red-600 hover:!bg-red-700"
              >
                {reverterMutation.isPending ? "Revertendo..." : "Reverter"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
