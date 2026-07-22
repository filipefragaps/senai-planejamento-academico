"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aulasApi, professoresApi, planejamentoApi, cursosApi } from "@/lib/api";
import { toast } from "sonner";
import { X, Save, Loader2, Lock, RefreshCw, UserCheck, Calendar, ChevronDown, ChevronRight, BookOpen } from "lucide-react";
import type { AulaRow } from "@/components/cronograma-table";

const STATUS_OPTIONS = ["Agendada", "Realizada", "Cancelada", "Substituída", "Remarcada"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      {children}
    </div>
  );
}

interface Props {
  aula: AulaRow | null;
  eventoId?: number;
  onClose: () => void;
  onSaved?: () => void;
}

export function AulaEditDrawer({ aula, eventoId, onClose, onSaved }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    professor_id: "" as string | number,
    ambiente: "",
    subturma: "",
    status: "Agendada",
    observacoes: "",
    motivo: "",
  });
  const [replanejáFuturas, setReplanejáFuturas] = useState(false);

  // Troca de componente curricular (UC)
  const [secaoTrocaUC, setSecaoTrocaUC] = useState(false);
  const [ucTroca, setUcTroca] = useState<string>("");
  const [profTroca, setProfTroca] = useState<string>("");

  // Remanejo
  const [secaoRemanejo, setSecaoRemanejo] = useState(false);
  const [tipoRemanejo, setTipoRemanejo] = useState<"substituicao" | "remarcacao">("substituicao");
  const [profSubstituto, setProfSubstituto] = useState<string>("");
  const [novaData, setNovaData] = useState<string>("");

  useEffect(() => {
    if (aula) {
      setForm({
        professor_id: aula.professor_id ?? "",
        ambiente: aula.ambiente ?? "",
        subturma: aula.subturma ?? "",
        status: aula.status,
        observacoes: aula.observacoes ?? "",
        motivo: "",
      });
    }
  }, [aula?.id]);

  // Datas disponíveis para remarcação
  const { data: datasDisponiveis } = useQuery({
    queryKey: ["datas-disponiveis", aula?.id],
    queryFn: () => planejamentoApi.datasDisponiveis(aula!.id),
    enabled: !!aula && secaoRemanejo && tipoRemanejo === "remarcacao",
  });

  const remanejo = useMutation({
    mutationFn: () => {
      if (!aula) throw new Error("Sem aula");
      if (tipoRemanejo === "substituicao") {
        if (!profSubstituto) throw new Error("Selecione um professor substituto");
        return planejamentoApi.remanejo(aula.id, { tipo: "substituicao", professor_id: Number(profSubstituto) });
      } else {
        if (!novaData) throw new Error("Selecione a nova data");
        return planejamentoApi.remanejo(aula.id, { tipo: "remarcacao", nova_data: novaData });
      }
    },
    onSuccess: (res) => {
      if (res.tipo === "substituicao") {
        toast.success(`Professor substituído: ${res.professor}`);
      } else {
        toast.success(`Aula remarcada para ${res.nova_data?.split("-").reverse().join("/")}. Cronograma atualizado.`);
      }
      qc.invalidateQueries({ queryKey: ["cronograma"] });
      qc.invalidateQueries({ queryKey: ["aulas"] });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro no remanejo");
    },
  });

  // UCs do evento para troca de componente
  const { data: ucsEvento = [] } = useQuery({
    queryKey: ["ucs-evento-troca", aula?.evento_id],
    queryFn: () => planejamentoApi.ucs(aula!.evento_id),
    enabled: !!aula && secaoTrocaUC,
  });

  const trocaUcMutation = useMutation({
    mutationFn: () => {
      if (!aula) throw new Error("Sem aula");
      if (!ucTroca) throw new Error("Selecione uma UC");
      const alteracoes: Record<string, unknown> = {
        unidade_curricular_id: Number(ucTroca),
      };
      if (profTroca) alteracoes.professor_id = Number(profTroca);
      return aulasApi.alterar(aula.id, {
        alteracoes,
        replaneja_futuras: false,
        motivo: "Troca pontual de componente curricular",
      });
    },
    onSuccess: () => {
      toast.success("Componente curricular trocado nesta aula.");
      qc.invalidateQueries({ queryKey: ["cronograma"] });
      qc.invalidateQueries({ queryKey: ["aulas"] });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao trocar componente");
    },
  });

  // Lista de professores candidatos para esta aula
  const { data: candidatos = [] } = useQuery({
    queryKey: ["candidatos-aula", aula?.evento_id, aula?.unidade_curricular_id],
    queryFn: () =>
      aula?.evento_id && aula?.unidade_curricular_id
        ? planejamentoApi.candidatos(aula.evento_id, aula.unidade_curricular_id)
        : Promise.resolve([]),
    enabled: !!aula,
  });

  // Lista geral de professores como fallback
  const { data: todosProfessores = [] } = useQuery({
    queryKey: ["professores-ativos"],
    queryFn: () => professoresApi.listar({ ativo: true }),
    enabled: !!aula,
  });

  const salvar = useMutation({
    mutationFn: () => {
      if (!aula) throw new Error("Nenhuma aula selecionada");
      const alteracoes: Record<string, unknown> = {};
      if (form.professor_id !== "") alteracoes.professor_id = Number(form.professor_id) || null;
      if (form.ambiente !== aula.ambiente) alteracoes.ambiente = form.ambiente || null;
      if (form.subturma !== (aula.subturma ?? "")) alteracoes.subturma = form.subturma || null;
      if (form.status !== aula.status) alteracoes.status = form.status;
      if (form.observacoes !== (aula.observacoes ?? "")) alteracoes.observacoes = form.observacoes || null;

      return aulasApi.alterar(aula.id, {
        alteracoes,
        replaneja_futuras: replanejáFuturas,
        motivo: form.motivo || "Alteração manual",
      });
    },
    onSuccess: (res) => {
      const total = res.aulas_replanejadas?.length ?? 0;
      toast.success(`Aula salva.${total > 0 ? ` ${total} aulas futuras replanejadas.` : ""}`);
      if (res.conflitos_detectados?.length > 0) {
        toast.warning(`${res.conflitos_detectados.length} conflito(s) detectado(s).`);
      }
      qc.invalidateQueries({ queryKey: ["cronograma"] });
      qc.invalidateQueries({ queryKey: ["aulas"] });
      onSaved?.();
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail || "Erro ao salvar");
    },
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (!aula) return null;

  const professoresDisponiveis =
    candidatos.length > 0
      ? candidatos
      : (todosProfessores as any[]).map((p: any) => ({
          professor_id: p.id,
          nome: p.nome,
          percentual_regencia: null,
        }));

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[440px] max-w-full bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="px-5 py-4 border-b shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-gray-900 text-sm">Editar Aula</h2>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500">
            {aula.alterada_manualmente && (
              <span className="flex items-center gap-1 text-amber-600">
                <Lock className="h-3 w-3" /> Travada
              </span>
            )}
            <span className="font-mono">{aula.data ? `${aula.data.split("-").reverse().join("/")}` : ""}</span>
            {aula.horario_inicio && <span>{aula.horario_inicio}{aula.horario_fim ? ` – ${aula.horario_fim}` : ""}</span>}
            {aula.turno && <span className="badge bg-indigo-50 text-indigo-700">{aula.turno}</span>}
          </div>
          {aula.uc_nome && (
            <p className="text-xs text-gray-700 mt-1 font-medium truncate">{aula.uc_nome}</p>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          <Field label="Professor">
            <select
              className="input w-full text-sm"
              value={form.professor_id}
              onChange={(e) => set("professor_id", e.target.value)}
            >
              <option value="">— Sem professor —</option>
              {(professoresDisponiveis as any[]).map((c: any) => (
                <option key={c.professor_id ?? c.id} value={c.professor_id ?? c.id}>
                  {c.nome}
                  {c.percentual_regencia != null ? ` (reg. ${c.percentual_regencia.toFixed(1)}%)` : ""}
                  {c.is_preferido ? " ★" : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Ambiente / Sala">
            <input
              className="input w-full text-sm"
              value={form.ambiente}
              onChange={(e) => set("ambiente", e.target.value)}
              placeholder="Ex: Lab Informática 1"
            />
          </Field>

          <Field label="Subturma">
            <input
              className="input w-full text-sm"
              value={form.subturma}
              onChange={(e) => set("subturma", e.target.value)}
              placeholder="Ex: A"
            />
          </Field>

          <Field label="Status">
            <select className="input w-full text-sm" value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>

          <Field label="Observações">
            <textarea
              className="input w-full text-sm resize-none"
              rows={3}
              value={form.observacoes}
              onChange={(e) => set("observacoes", e.target.value)}
            />
          </Field>

          <Field label="Motivo da alteração">
            <input
              className="input w-full text-sm"
              value={form.motivo}
              onChange={(e) => set("motivo", e.target.value)}
              placeholder="Descrição da razão da mudança"
            />
          </Field>

          {/* Replanejamento */}
          <div className="border rounded-lg p-3 bg-amber-50">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={replanejáFuturas}
                onChange={(e) => setReplanejáFuturas(e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium text-amber-800">Recalcular aulas futuras</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Propaga a troca de professor para todas as aulas futuras não travadas deste evento.
                </p>
              </div>
            </label>
          </div>

          {/* Trocar componente curricular */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
              onClick={() => setSecaoTrocaUC((v) => !v)}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <BookOpen className="h-4 w-4 text-gray-500" />
                Trocar componente curricular
              </span>
              {secaoTrocaUC ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </button>

            {secaoTrocaUC && (
              <div className="p-3 space-y-3 border-t">
                <p className="text-xs text-gray-500">
                  Troca a UC e/ou professor <strong>apenas nesta aula</strong>, sem afetar as demais. Útil para remanejamentos pontuais de conteúdo.
                </p>

                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-semibold">Nova UC / Componente</p>
                  <select
                    className="input w-full text-sm"
                    value={ucTroca}
                    onChange={(e) => { setUcTroca(e.target.value); setProfTroca(""); }}
                  >
                    <option value="">— Selecione —</option>
                    {(ucsEvento as any[]).map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.nome} {u.carga_horaria ? `(${u.carga_horaria}h)` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-semibold">Professor para esta aula</p>
                  <select
                    className="input w-full text-sm"
                    value={profTroca}
                    onChange={(e) => setProfTroca(e.target.value)}
                  >
                    <option value="">— Manter professor atual —</option>
                    {(todosProfessores as any[]).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.nome}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => trocaUcMutation.mutate()}
                  disabled={trocaUcMutation.isPending || !ucTroca}
                  className="w-full btn-primary flex items-center justify-center gap-1.5 py-1.5 text-sm"
                >
                  {trocaUcMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                  Confirmar Troca
                </button>
              </div>
            )}
          </div>

          {/* Remanejar */}
          <div className="border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
              onClick={() => setSecaoRemanejo((v) => !v)}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <RefreshCw className="h-4 w-4 text-gray-500" />
                Remanejar aula
              </span>
              {secaoRemanejo ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </button>

            {secaoRemanejo && (
              <div className="p-3 space-y-3 border-t">
                <p className="text-xs text-gray-500">
                  Remanejo independente da edição acima. Ao confirmar, será processado imediatamente.
                </p>

                {/* Tipo */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setTipoRemanejo("substituicao")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      tipoRemanejo === "substituicao"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Substituição
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoRemanejo("remarcacao")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      tipoRemanejo === "remarcacao"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Remarcação
                  </button>
                </div>

                {/* Substituição */}
                {tipoRemanejo === "substituicao" && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-semibold">Professor substituto</p>
                    <select
                      className="input w-full text-sm"
                      value={profSubstituto}
                      onChange={(e) => setProfSubstituto(e.target.value)}
                    >
                      <option value="">— Selecione —</option>
                      {(professoresDisponiveis as any[]).map((c: any) => (
                        <option key={c.professor_id ?? c.id} value={c.professor_id ?? c.id}>
                          {c.nome}
                          {c.percentual_regencia != null ? ` (reg. ${c.percentual_regencia.toFixed(1)}%)` : ""}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Apenas esta aula será afetada. O professor original permanece nas demais.
                    </p>
                  </div>
                )}

                {/* Remarcação */}
                {tipoRemanejo === "remarcacao" && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-semibold">Nova data</p>
                    {datasDisponiveis?.datas ? (
                      <select
                        className="input w-full text-sm"
                        value={novaData}
                        onChange={(e) => setNovaData(e.target.value)}
                      >
                        <option value="">— Selecione uma data —</option>
                        {(datasDisponiveis.datas as any[]).map((d: any) => (
                          <option key={d.data} value={d.data} disabled={d.conflito}>
                            {d.data.split("-").reverse().join("/")}
                            {d.conflito ? " (conflito)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="date"
                        className="input w-full text-sm"
                        value={novaData}
                        onChange={(e) => setNovaData(e.target.value)}
                        min={aula.data ?? undefined}
                      />
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">
                      Esta aula será marcada como Remarcada e criada na nova data. As aulas seguintes do evento serão ajustadas.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => remanejo.mutate()}
                  disabled={remanejo.isPending}
                  className="w-full btn-primary flex items-center justify-center gap-1.5 py-1.5 text-sm"
                >
                  {remanejo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Confirmar Remanejo
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 shrink-0 flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending}
            className="btn-primary flex items-center gap-1.5"
          >
            {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </div>
      </div>
    </>
  );
}
