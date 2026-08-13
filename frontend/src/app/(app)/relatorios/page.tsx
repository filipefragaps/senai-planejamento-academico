"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { relatoriosApi, professoresApi, eventosApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Users, BookOpen, Database, ShoppingBag, History, Receipt, ListChecks } from "lucide-react";

const TIPOS_CONTRATO = ["Inclusão em Folha", "RPA", "PJ"] as const;

export default function RelatoriosPage() {
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
                          <td className={`px-3 py-2 border-b text-right text-xs font-medium ${uc.saldo != null ? (uc.saldo > 0 ? "text-red-600" : uc.saldo < 0 ? "text-amber-600" : "text-green-600") : "text-gray-400"}`}>
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
                        <td className={`px-3 py-2 border-t text-right text-xs ${chPrev - chPlan > 0 ? "text-red-600" : "text-green-600"}`}>
                          {(chPrev - chPlan) >= 0 ? "+" : ""}{(chPrev - chPlan).toFixed(1)}h
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
    </div>
  );
}
