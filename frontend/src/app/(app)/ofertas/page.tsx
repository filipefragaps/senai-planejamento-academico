"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ofertasApi } from "@/lib/api";
import { LimparBdButton } from "@/components/limpar-bd-button";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  Upload, Search, X, Loader2, RefreshCw,
  CalendarDays, TrendingUp, Download, Trash2,
} from "lucide-react";
import { downloadModeloOfertas } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { OfertaDrawer, type Oferta } from "@/components/oferta-drawer";
import { NovaOfertaModal } from "@/components/nova-oferta-modal";

// ── Execução badge ────────────────────────────────────────────────────────────
function ExecucaoBadge({ matriculados, minimo }: { matriculados: number; minimo: number }) {
  if (minimo <= 0) return <span className="text-gray-500 text-xs">{matriculados}</span>;
  const pct = (matriculados / minimo) * 100;
  const cls = pct >= 100 ? "text-green-700 bg-green-50 border-green-300"
    : pct >= 75  ? "text-yellow-700 bg-yellow-50 border-yellow-300"
    : pct >= 50  ? "text-orange-700 bg-orange-50 border-orange-300"
    : "text-red-700 bg-red-50 border-red-300";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border", cls)}>
      {matriculados}/{minimo}
    </span>
  );
}

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

// ── Card de estatística ───────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={cn("p-2.5 rounded-lg shrink-0", color)}>
        <TrendingUp className="h-4 w-4" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs font-medium text-gray-600">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────
export default function OfertasPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selectedOferta, setSelectedOferta] = useState<Oferta | null>(null);
  const [novoEventoAberto, setNovoEventoAberto] = useState(false);
  const [semestre, setSemestre] = useState<number | undefined>(undefined);
  const [filtroModalidade, setFiltroModalidade] = useState("");
  const [filtroArea, setFiltroArea] = useState("");
  const [filtroTurno, setFiltroTurno] = useState("");
  const [busca, setBusca] = useState("");

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ["ofertas-stats", semestre],
    queryFn: () => ofertasApi.stats(semestre),
  });

  const { data: ofertas = [], isLoading, refetch } = useQuery({
    queryKey: ["ofertas", semestre, filtroModalidade, filtroArea, filtroTurno, busca],
    queryFn: () =>
      ofertasApi.listar({
        semestre,
        modalidade: filtroModalidade || undefined,
        area: filtroArea || undefined,
        turno: filtroTurno || undefined,
        busca: busca || undefined,
        limit: 500,
      }),
  });

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const deletar = useMutation({
    mutationFn: (id: number) => ofertasApi.deletar(id),
    onSuccess: () => {
      toast.success("Evento excluído com sucesso.");
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      qc.invalidateQueries({ queryKey: ["ofertas-stats"] });
      setConfirmDelete(null);
    },
    onError: () => toast.error("Erro ao excluir evento."),
  });

  // ── Import mutation ───────────────────────────────────────────────────────
  const importar = useMutation({
    mutationFn: (file: File) => ofertasApi.importar(file),
    onSuccess: (data) => {
      toast.success(data.mensagem);
      qc.invalidateQueries({ queryKey: ["ofertas"] });
      qc.invalidateQueries({ queryKey: ["ofertas-stats"] });
    },
    onError: (err: any) => {
      const raw = err?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : err?.message || "Erro ao importar";
      toast.error(msg);
    },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) importar.mutate(file);
    e.target.value = "";
  }

  function limparFiltros() {
    setSemestre(undefined);
    setFiltroModalidade("");
    setFiltroArea("");
    setFiltroTurno("");
    setBusca("");
  }

  const temFiltro = !!semestre || !!filtroModalidade || !!filtroArea || !!filtroTurno || !!busca;

  const iniciou   = stats?.por_status?.["INICIOU"] ?? 0;
  const emMatr    = stats?.por_status?.["EM MATRÍCULA"] ?? 0;
  const cancelado = stats?.por_status?.["CANCELADO"] ?? 0;

  return (
    <>
    <div className="flex flex-col gap-5 h-full">

      {/* Header */}
      <PageHeader title="Eventos SENAI" description="Ofertas de cursos importadas das planilhas de semestre">
        <div className="flex items-center gap-2">
          <LimparBdButton tipo="ofertas" label="Limpar Ofertas" onLimpou={() => refetch()} />
          <button
            onClick={() => refetch()}
            className="p-2 rounded-md border text-gray-500 hover:bg-gray-50"
            title="Atualizar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setNovoEventoAberto(true)}
            className="btn-secondary flex items-center gap-2"
          >
            + Novo Evento
          </button>
          <button
            onClick={downloadModeloOfertas}
            className="btn-secondary flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Baixar Modelo
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importar.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {importar.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Upload className="h-4 w-4" />}
            Importar Planilha
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </PageHeader>

      {/* Cards de estatísticas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        <StatCard
          label="Total de eventos"
          value={stats?.total ?? 0}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label="Iniciou"
          value={iniciou}
          sub={`${stats?.total ? Math.round((iniciou / stats.total) * 100) : 0}% do total`}
          color="bg-green-100 text-green-700"
        />
        <StatCard
          label="Em Matrícula"
          value={emMatr}
          color="bg-yellow-100 text-yellow-700"
        />
        <StatCard
          label="Cancelados"
          value={cancelado}
          color="bg-red-100 text-red-700"
        />
      </div>

      {/* Barra de filtros */}
      <div className="card p-4 shrink-0">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Busca */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Buscar curso ou código do evento..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {/* Semestre */}
          <select
            className="input w-36"
            value={semestre ?? ""}
            onChange={(e) => setSemestre(e.target.value ? +e.target.value : undefined)}
          >
            <option value="">Ambos os semestres</option>
            <option value="1">1º Semestre</option>
            <option value="2">2º Semestre</option>
          </select>

          {/* Modalidade */}
          <select className="input w-48" value={filtroModalidade} onChange={(e) => setFiltroModalidade(e.target.value)}>
            <option value="">Todas modalidades</option>
            {(stats?.modalidades ?? []).map((m: string) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Área */}
          <select className="input w-44" value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}>
            <option value="">Todas as áreas</option>
            {(stats?.areas ?? []).map((a: string) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          {/* Turno */}
          <select className="input w-36" value={filtroTurno} onChange={(e) => setFiltroTurno(e.target.value)}>
            <option value="">Todos os turnos</option>
            {(stats?.turnos ?? []).map((t: string) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          {/* Limpar */}
          {temFiltro && (
            <button onClick={limparFiltros} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
              <X className="h-4 w-4" /> Limpar
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 mt-2">
          {isLoading ? "Carregando..." : `${ofertas.length} evento(s) encontrado(s)`}
        </p>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="text-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              Carregando eventos...
            </div>
          ) : ofertas.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium text-gray-500">Nenhum evento encontrado.</p>
              {!stats?.total && (
                <p className="text-sm mt-1">
                  Clique em <strong>Importar Planilha</strong> para carregar os eventos do Excel.
                </p>
              )}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Evento</th>
                  <th className="px-3 py-3 text-left font-semibold">Curso</th>
                  <th className="px-3 py-3 text-left font-semibold">Modalidade</th>
                  <th className="px-3 py-3 text-left font-semibold">Área</th>
                  <th className="px-3 py-3 text-left font-semibold">Turno</th>
                  <th className="px-3 py-3 text-left font-semibold">Dias</th>
                  <th className="px-3 py-3 text-left font-semibold">Horário</th>
                  <th className="px-3 py-3 text-left font-semibold">CH</th>
                  <th className="px-3 py-3 text-left font-semibold">Início</th>
                  <th className="px-3 py-3 text-left font-semibold">Término</th>
                  <th className="px-3 py-3 text-center font-semibold">Vagas</th>
                  <th className="px-3 py-3 text-center font-semibold">Execução</th>
                  <th className="px-3 py-3 text-right font-semibold">Total Aluno</th>
                  <th className="px-3 py-3 text-left font-semibold">Coordenador</th>
                  <th className="px-3 py-3 text-left font-semibold">Prev. Início</th>
                  <th className="px-3 py-3 text-left font-semibold">Crono</th>
                  <th className="px-3 py-3 text-center font-semibold">Sem.</th>
                  <th className="px-3 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ofertas.map((o: any) => (
                  <tr
                    key={o.id}
                    className="group hover:bg-blue-50 transition-colors cursor-pointer"
                    onClick={() => setSelectedOferta(o)}
                  >
                    <td className="px-3 py-2.5 font-mono text-gray-500 whitespace-nowrap">{o.codigo_evento}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[260px]">
                      <p className="truncate" title={o.nome_curso}>{o.nome_curso}</p>
                      {o.pasta && <p className="text-gray-400 font-mono text-[10px]">{o.pasta}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{o.modalidade}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{o.area ?? "—"}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {o.turno && (
                        <span className="badge bg-indigo-50 text-indigo-700">{o.turno}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[140px]">
                      <span className="truncate block" title={o.dias_semana_texto}>{o.dias_semana_texto ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {o.hora_inicio && o.hora_termino ? `${o.hora_inicio} – ${o.hora_termino}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-center">{o.carga_horaria > 0 ? `${o.carga_horaria}h` : "—"}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(o.data_inicio)}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(o.data_termino)}</td>
                    <td className="px-3 py-2.5 text-center text-gray-700">{o.vagas}</td>
                    <td className="px-3 py-2.5 text-center">
                      <ExecucaoBadge matriculados={o.alunos_matriculados} minimo={o.min_para_inicio} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap">{moeda(o.total_por_aluno)}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[160px]">
                      <span className="truncate block text-xs" title={o.coordenador}>{o.coordenador || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(o.previsao_inicio)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {o.status_cronograma
                        ? <span className="badge bg-slate-100 text-slate-700">{o.status_cronograma}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={cn(
                        "text-xs font-bold px-1.5 py-0.5 rounded",
                        o.semestre === 1 ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {o.semestre}°
                      </span>
                    </td>
                    <td
                      className="px-2 py-2.5 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {confirmDelete === o.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deletar.mutate(o.id)}
                            disabled={deletar.isPending}
                            className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-2 py-0.5 rounded"
                          >
                            {deletar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Excluir"}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 px-1"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(o.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all"
                          title="Excluir evento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Rodapé com totais */}
        {ofertas.length > 0 && (
          <div className="border-t px-4 py-2.5 bg-gray-50 flex items-center gap-6 text-xs text-gray-500 shrink-0">
            <span><strong className="text-gray-700">{ofertas.length}</strong> eventos</span>
            <span>
              Vagas: <strong className="text-gray-700">
                {ofertas.reduce((s: number, o: any) => s + (o.vagas || 0), 0)}
              </strong>
            </span>
            <span>
              Matriculados: <strong className="text-gray-700">
                {ofertas.reduce((s: number, o: any) => s + (o.alunos_matriculados || 0), 0)}
              </strong>
            </span>
          </div>
        )}
      </div>
    </div>

    <OfertaDrawer oferta={selectedOferta} onClose={() => setSelectedOferta(null)} />
    <NovaOfertaModal open={novoEventoAberto} onClose={() => setNovoEventoAberto(false)} />
    </>
  );
}
