"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventosApi, aulasApi, iaApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "sonner";
import { formatDate, formatTime, DIAS_SEMANA } from "@/lib/utils";
import { RefreshCw, Brain, History, Calendar, Edit2 } from "lucide-react";
import Link from "next/link";

export default function EventoDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [selectedAula, setSelectedAula] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showEdit, setShowEdit] = useState(false);
  const [iaResponse, setIaResponse] = useState("");
  const [loadingIA, setLoadingIA] = useState(false);

  const { data: evento, isLoading } = useQuery({
    queryKey: ["evento", id],
    queryFn: () => eventosApi.obter(+id!),
  });

  const alterarAula = useMutation({
    mutationFn: (data: any) => aulasApi.alterar(selectedAula.id, data),
    onSuccess: (res) => {
      toast.success(`Aula alterada. ${res.aulas_replanejadas?.length || 0} aulas replanejadas automaticamente.`);
      if (res.conflitos_detectados?.length > 0) {
        toast.warning(`${res.conflitos_detectados.length} conflito(s) detectado(s). Verifique o histórico.`);
      }
      qc.invalidateQueries({ queryKey: ["evento", id] });
      setShowEdit(false);
      setSelectedAula(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || "Erro ao alterar aula"),
  });

  const gerarAulas = useMutation({
    mutationFn: () => eventosApi.gerarAulas(+id!, true),
    onSuccess: (res) => {
      toast.success(`${res.aulas_geradas} aulas geradas. ${res.total_conflitos} conflitos.`);
      qc.invalidateQueries({ queryKey: ["evento", id] });
    },
  });

  async function handleAnaliseIA() {
    setLoadingIA(true);
    try {
      const res = await iaApi.analisar(`Analise a turma ${evento?.nome_turma} (${evento?.disciplina}) e forneça sugestões específicas para este cronograma.`);
      setIaResponse(res.analise);
    } catch {
      toast.error("Erro ao consultar IA. Verifique a configuração da API.");
    } finally {
      setLoadingIA(false);
    }
  }

  function openEdit(aula: any) {
    setSelectedAula(aula);
    setEditForm({
      professor_id: aula.professor_id || "",
      sala: aula.sala || "",
      status: aula.status,
      observacoes: aula.observacoes || "",
      motivo: "",
    });
    setShowEdit(true);
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400">Carregando...</div>;
  if (!evento) return <div className="text-center py-12 text-red-500">Evento não encontrado</div>;

  const aulas = evento.aulas || [];
  const realizadas = aulas.filter((a: any) => a.status === "Realizada").length;
  const progresso = aulas.length > 0 ? (realizadas / aulas.length) * 100 : 0;

  return (
    <div>
      <PageHeader title={evento.nome_turma} description={evento.disciplina}>
        <Link href="/eventos" className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">
          ← Voltar
        </Link>
        <button onClick={() => gerarAulas.mutate()} disabled={gerarAulas.isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm border rounded-md hover:bg-gray-50">
          <RefreshCw className="h-4 w-4" />
          Regerar Aulas
        </button>
        <button onClick={handleAnaliseIA} disabled={loadingIA}
          className="btn-primary flex items-center gap-2">
          <Brain className="h-4 w-4" />
          {loadingIA ? "Analisando..." : "Análise IA"}
        </button>
      </PageHeader>

      {/* Info cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{aulas.length}</p>
          <p className="text-xs text-gray-500">Total de aulas</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{realizadas}</p>
          <p className="text-xs text-gray-500">Realizadas</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-blue-600">{progresso.toFixed(0)}%</p>
          <p className="text-xs text-gray-500">Progresso</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-700">{evento.carga_horaria_total}h</p>
          <p className="text-xs text-gray-500">Carga Total</p>
        </div>
      </div>

      {/* Detalhes */}
      <div className="card p-5 mb-6 grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-400">Período</p>
          <p className="font-medium">{formatDate(evento.data_inicio)} – {formatDate(evento.data_fim)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Horário</p>
          <p className="font-medium">{formatTime(evento.horario_inicio)} – {formatTime(evento.horario_fim)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Dias</p>
          <p className="font-medium">{evento.dias_semana?.map((d: number) => DIAS_SEMANA[d]).join(", ")}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Sala</p>
          <p className="font-medium">{evento.sala || "-"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Modalidade</p>
          <p className="font-medium">{evento.modalidade}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Status</p>
          <StatusBadge status={evento.status} />
        </div>
      </div>

      {/* IA Response */}
      {iaResponse && (
        <div className="card p-5 mb-6 bg-indigo-50 border-indigo-200">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-indigo-600" />
            <h3 className="font-semibold text-indigo-800">Análise com IA</h3>
          </div>
          <div className="text-sm text-indigo-700 whitespace-pre-wrap">{iaResponse}</div>
        </div>
      )}

      {/* Modal edição aula */}
      {showEdit && selectedAula && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="font-semibold text-gray-900 mb-4">
              Alterar Aula — {formatDate(selectedAula.data)}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select className="input w-full" value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {["Agendada", "Realizada", "Cancelada", "Substituída", "Remarcada"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sala</label>
                <input className="input w-full" value={editForm.sala}
                  onChange={(e) => setEditForm({ ...editForm, sala: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Observações</label>
                <textarea className="input w-full h-16" value={editForm.observacoes}
                  onChange={(e) => setEditForm({ ...editForm, observacoes: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Motivo da alteração</label>
                <input className="input w-full" value={editForm.motivo}
                  onChange={(e) => setEditForm({ ...editForm, motivo: e.target.value })}
                  placeholder="Opcional: justificativa para o log" />
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" defaultChecked id="replaneja" />
                <label htmlFor="replaneja">Replaneja aulas futuras automaticamente</label>
              </div>
            </div>
            <div className="flex gap-3 mt-5 justify-end">
              <button onClick={() => { setShowEdit(false); setSelectedAula(null); }}
                className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">Cancelar</button>
              <button
                onClick={() => alterarAula.mutate({
                  aula_id: selectedAula.id,
                  alteracoes: editForm,
                  replaneja_futuras: true,
                  motivo: editForm.motivo,
                })}
                disabled={alterarAula.isPending}
                className="btn-primary"
              >
                {alterarAula.isPending ? "Salvando..." : "Salvar e Replaneja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lista de aulas */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Aulas ({aulas.length})</h3>
          <Link href={`/historico?evento_id=${id}`} className="text-xs text-primary hover:underline flex items-center gap-1">
            <History className="h-3 w-3" /> Ver histórico
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Data</th>
                <th className="px-4 py-2 text-left">Horário</th>
                <th className="px-4 py-2 text-left">Sala</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Alt.</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {aulas.map((aula: any, i: number) => (
                <tr key={aula.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2 font-medium">{formatDate(aula.data)}</td>
                  <td className="px-4 py-2">{formatTime(aula.horario_inicio)}–{formatTime(aula.horario_fim)}</td>
                  <td className="px-4 py-2">{aula.sala || "-"}</td>
                  <td className="px-4 py-2"><StatusBadge status={aula.status} /></td>
                  <td className="px-4 py-2"><span className="text-xs text-gray-500">{aula.tipo}</span></td>
                  <td className="px-4 py-2">
                    {aula.alterada_manualmente && (
                      <span className="badge bg-purple-100 text-purple-700">Manual</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button onClick={() => openEdit(aula)}
                      className="p-1 text-gray-400 hover:text-primary">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
