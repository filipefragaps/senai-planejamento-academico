"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { relatoriosApi, professoresApi, eventosApi, downloadBlob } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Users, BookOpen, Database, ShoppingBag, History } from "lucide-react";

export default function RelatoriosPage() {
  const [loadingReg, setLoadingReg] = useState(false);
  const [loadingProf, setLoadingProf] = useState(false);
  const [loadingTurma, setLoadingTurma] = useState(false);
  const [loadingDados, setLoadingDados] = useState(false);
  const [loadingOfertas, setLoadingOfertas] = useState(false);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [selectedProf, setSelectedProf] = useState("");
  const [selectedTurma, setSelectedTurma] = useState("");
  const [selectedEventoHist, setSelectedEventoHist] = useState("");
  const [dateIni, setDateIni] = useState("");
  const [dateFim, setDateFim] = useState("");

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
