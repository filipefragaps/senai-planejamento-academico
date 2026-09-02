"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { planejamentoApi, professoresApi } from "@/lib/api";
import { X, Loader2, Plus, AlertCircle, CalendarPlus, CalendarRange, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  eventoId: number;
  data: string; // YYYY-MM-DD
  horarioInicio?: string | null; // "HH:MM" do evento
  horarioFim?: string | null;    // "HH:MM" do evento
  onClose: () => void;
  onSaved: () => void;
}

export function AulaManualModal({ eventoId, data, horarioInicio, horarioFim, onClose, onSaved }: Props) {
  const [ucId, setUcId] = useState<number | "">("");
  const [professorId, setProfessorId] = useState<number | "">("");
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ aulas_criadas: number; uc_nome: string } | null>(null);
  const [horaIni, setHoraIni] = useState<string>(horarioInicio ?? "");
  const [horaFim, setHoraFim] = useState<string>(horarioFim ?? "");

  const { data: pendentes = [], isLoading: loadingUCs } = useQuery({

    queryKey: ["pendentes", eventoId],
    queryFn: () => planejamentoApi.pendentes(eventoId),
  });

  const { data: professores = [] } = useQuery({
    queryKey: ["professores-ativos"],
    queryFn: () => professoresApi.listar({ ativo: true }),
    staleTime: 300_000,
  });

  const todasUCs = pendentes as any[];
  const ucSelecionadaPreview = ucId !== "" ? todasUCs.find((u: any) => u.uc_id === ucId) : null;

  // Cálculo reativo: quantidade de aulas com base no horário informado
  function parseHHMM(t: string): number | null {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1]) * 60 + parseInt(m[2]);
  }
  const minIni = parseHHMM(horaIni);
  const minFim = parseHHMM(horaFim);
  const horas_por_aula = minIni !== null && minFim !== null && minFim > minIni
    ? (minFim - minIni) / 60
    : null;
  const cargaHoraria = ucSelecionadaPreview?.carga_horaria ?? null;
  const qtdCalculada = horas_por_aula && cargaHoraria
    ? Math.ceil(cargaHoraria / horas_por_aula)
    : null;

  // Adiciona UMA aula manual
  const mutationUma = useMutation({
    mutationFn: () =>
      planejamentoApi.adicionarAulaManual(eventoId, {
        uc_id: ucId as number,
        data,
        professor_id: professorId || null,
      }),
    onSuccess: () => onSaved(),
    onError: (err: any) =>
      setErro(err?.response?.data?.detail ?? "Erro ao adicionar aula"),
  });

  // Agenda TODAS as pendentes da UC a partir desta data
  const mutationTodas = useMutation({
    mutationFn: () =>
      planejamentoApi.agendarUCPendente(eventoId, {
        uc_id: ucId as number,
        data_inicio: data,
        professor_id: professorId || null,
        quantidade: qtdCalculada ?? undefined,
      }),
    onSuccess: (res: any) => {
      if (res.aulas_criadas === 0) {
        setErro(res.aviso ?? "Nenhuma aula criada");
      } else {
        setResultado({ aulas_criadas: res.aulas_criadas, uc_nome: res.uc_nome });
      }
    },
    onError: (err: any) =>
      setErro(err?.response?.data?.detail ?? "Erro ao agendar aulas"),
  });

  const dataFmt = new Date(data + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const todas = pendentes as any[];
  const comPendencia = [...todas]
    .filter((u) => u.aulas_faltando > 0)
    .sort((a, b) => b.aulas_faltando - a.aulas_faltando);
  const completas = todas.filter((u) => u.aulas_faltando <= 0);
  const ucSelecionada = ucSelecionadaPreview;
  const isPending = mutationUma.isPending || mutationTodas.isPending;

  // Tela de sucesso após agendar todas
  if (resultado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          <div className="bg-green-600 px-5 py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-white shrink-0" />
            <div>
              <p className="text-white font-bold text-sm">Aulas agendadas!</p>
              <p className="text-green-100 text-xs">{resultado.uc_nome}</p>
            </div>
          </div>
          <div className="p-5 text-center">
            <p className="text-3xl font-bold text-green-700 mb-1">{resultado.aulas_criadas}</p>
            <p className="text-gray-600 text-sm">
              aula{resultado.aulas_criadas !== 1 ? "s" : ""} agendada{resultado.aulas_criadas !== 1 ? "s" : ""} a partir de{" "}
              <strong>{new Date(data + "T12:00:00").toLocaleDateString("pt-BR")}</strong>
            </p>
            <p className="text-xs text-gray-400 mt-2">Respeitando os dias da semana do evento.</p>
          </div>
          <div className="px-5 py-4 bg-gray-50 border-t flex justify-end">
            <button
              onClick={onSaved}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <CalendarPlus className="h-4 w-4 text-blue-200" />
              <p className="text-blue-200 text-xs font-semibold uppercase tracking-wide">
                Adicionar Aula
              </p>
            </div>
            <h2 className="text-white font-bold text-base capitalize">{dataFmt}</h2>
            <p className="text-blue-200/80 text-xs mt-0.5">
              Aula inserida manualmente — vale mesmo em feriados.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-blue-200 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors mt-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* UC */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Unidade Curricular
            </label>
            {loadingUCs ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando UCs...
              </div>
            ) : (
              <select
                className="input w-full text-sm"
                value={ucId}
                onChange={(e) => { setUcId(e.target.value ? +e.target.value : ""); setErro(null); }}
              >
                <option value="">Selecione uma UC...</option>

                {comPendencia.length > 0 && (
                  <optgroup label={`Com aulas pendentes (${comPendencia.length})`}>
                    {comPendencia.map((u: any) => (
                      <option key={u.uc_id} value={u.uc_id}>
                        {u.uc_nome}
                        {u.etapa ? ` [${u.etapa}]` : ""} — falta {u.aulas_faltando} aula{u.aulas_faltando !== 1 ? "s" : ""}
                      </option>
                    ))}
                  </optgroup>
                )}

                {completas.length > 0 && (
                  <optgroup label="Completas / aula extra">
                    {completas.map((u: any) => (
                      <option key={u.uc_id} value={u.uc_id}>
                        {u.uc_nome}{u.etapa ? ` [${u.etapa}]` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}

            {/* Resumo da UC selecionada */}
            {ucSelecionada && (
              <p className="mt-1.5 text-xs text-gray-500">
                {ucSelecionada.aulas_agendadas} de {ucSelecionada.aulas_necessarias} aula(s) agendadas
                {ucSelecionada.aulas_faltando > 0
                  ? ` · falta ${ucSelecionada.aulas_faltando}`
                  : " · completa"}
              </p>
            )}
          </div>

          {/* Professor */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Professor{" "}
              <span className="font-normal text-gray-400 normal-case">(opcional)</span>
            </label>
            <select
              className="input w-full text-sm"
              value={professorId}
              onChange={(e) => setProfessorId(e.target.value ? +e.target.value : "")}
            >
              <option value="">Sem professor definido</option>
              {(professores as any[]).map((p: any) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>

          {/* Banner agendar todas — só aparece quando há pendências */}
          {ucSelecionada && ucSelecionada.aulas_faltando > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <CalendarRange className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-indigo-800">
                    Agendar aulas pendentes a partir desta data
                  </p>
                  <p className="text-[11px] text-indigo-600 mt-0.5 leading-snug">
                    UC de <strong>{ucSelecionada.carga_horaria}h</strong>. Confirme o horário da aula para calcular a quantidade automaticamente.
                  </p>
                </div>
              </div>

              {/* Horário da aula */}
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-indigo-700 uppercase tracking-wide mb-1">
                    Início
                  </label>
                  <input
                    type="time"
                    value={horaIni}
                    onChange={(e) => setHoraIni(e.target.value)}
                    className="w-full rounded-lg border border-indigo-300 bg-white px-2 py-1.5 text-sm font-medium text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-indigo-700 uppercase tracking-wide mb-1">
                    Fim
                  </label>
                  <input
                    type="time"
                    value={horaFim}
                    onChange={(e) => setHoraFim(e.target.value)}
                    className="w-full rounded-lg border border-indigo-300 bg-white px-2 py-1.5 text-sm font-medium text-indigo-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div className="pt-4 text-center min-w-[60px]">
                  {qtdCalculada !== null ? (
                    <div>
                      <p className="text-2xl font-bold text-indigo-700 leading-none">{qtdCalculada}</p>
                      <p className="text-[10px] text-indigo-500 mt-0.5">aulas</p>
                    </div>
                  ) : (
                    <p className="text-xs text-indigo-400">—</p>
                  )}
                </div>
              </div>

              {horas_por_aula !== null && (
                <p className="text-[10px] text-indigo-500">
                  {horas_por_aula.toFixed(1)}h por aula · {ucSelecionada.carga_horaria}h total → {qtdCalculada} aula{qtdCalculada !== 1 ? "s" : ""}
                </p>
              )}

              <button
                onClick={() => { setErro(null); mutationTodas.mutate(); }}
                disabled={isPending || qtdCalculada === null}
                className={cn(
                  "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors",
                  isPending || qtdCalculada === null
                    ? "bg-indigo-100 text-indigo-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                )}
              >
                {mutationTodas.isPending ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Agendando...</>
                ) : (
                  <><CalendarRange className="h-3.5 w-3.5" />
                    {qtdCalculada !== null
                      ? `Agendar ${qtdCalculada} aula${qtdCalculada !== 1 ? "s" : ""} a partir desta data`
                      : "Informe o horário para continuar"}
                  </>
                )}
              </button>
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {erro}
            </div>
          )}
        </div>

        {/* Footer — adicionar só UMA */}
        <div className="px-5 py-4 bg-gray-50 border-t flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400 leading-snug">
            Ou adicione apenas <strong>esta data</strong> como aula avulsa:
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => { setErro(null); mutationUma.mutate(); }}
              disabled={!ucId || isPending}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                !ucId || isPending
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              )}
            >
              {mutationUma.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adicionando...</>
              ) : (
                <><Plus className="h-3.5 w-3.5" /> Só esta data</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
