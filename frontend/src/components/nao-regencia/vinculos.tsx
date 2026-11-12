"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { NrOpcoes, erroApi, horas, lerNumero, mesAtual, nrApi } from "@/lib/nao-regencia";
import { Avatar, Campo, Modal } from "./ui";

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  ["nr-projeto", "nr-projetos", "nr-dashboard", "nr-vinculos", "nr-visao"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Período padrão da consulta de disponibilidade: o mês atual, dentro da vigência do projeto. */
function periodoPadrao(projeto?: any) {
  const m = mesAtual();
  if (projeto?.data_inicio && projeto.data_inicio > m.fim) {
    const d = new Date(projeto.data_inicio + "T12:00:00");
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { ini: projeto.data_inicio, fim: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-${String(fim.getDate()).padStart(2, "0")}` };
  }
  return m;
}

/** Tabela de saldo antes/depois para decidir a alocação. */
export function PainelDisponibilidade({ professorIds, horasPor, excluirVinculoId, projeto }: {
  professorIds: number[]; horasPor: Record<number, number>; excluirVinculoId?: number; projeto?: any;
}) {
  const [per, setPer] = useState(() => periodoPadrao(projeto));
  const ids = professorIds.filter(Boolean);
  const { data, isFetching } = useQuery({
    queryKey: ["nr-disp", ids.join(","), JSON.stringify(horasPor), per.ini, per.fim, excluirVinculoId],
    queryFn: () => nrApi.disponibilidade(ids, per.ini, per.fim, horasPor, excluirVinculoId),
    enabled: ids.length > 0 && !!per.ini && !!per.fim,
  });
  if (!ids.length) return null;
  return (
    <div className="rounded-md border bg-gray-50 p-3">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <p className="mr-auto text-sm font-semibold text-gray-800">Disponibilidade antes de aprovar</p>
        <Campo label="De"><input type="date" className="input h-8 w-auto py-0 text-xs" value={per.ini} onChange={(e) => setPer({ ...per, ini: e.target.value })} /></Campo>
        <Campo label="Até"><input type="date" className="input h-8 w-auto py-0 text-xs" value={per.fim} onChange={(e) => setPer({ ...per, fim: e.target.value })} /></Campo>
        {isFetching && <Loader2 className="mb-2 h-4 w-4 animate-spin text-gray-400" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="py-1 pr-2">Professor</th>
              <th className="px-2 py-1 text-right">Disponível</th>
              <th className="px-2 py-1 text-right">Regência</th>
              <th className="px-2 py-1 text-right">Não regência</th>
              <th className="px-2 py-1 text-right">Outras</th>
              <th className="px-2 py-1 text-right">Saldo atual</th>
              <th className="px-2 py-1 text-right">Esta alocação*</th>
              <th className="py-1 pl-2 text-right">Saldo depois</th>
            </tr>
          </thead>
          <tbody>
            {(data?.professores ?? []).map((p: any) => {
              const depois = p.saldo_depois;
              return (
                <tr key={p.professor_id} className="border-t">
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1.5"><Avatar nome={p.nome} foto={p.foto} tamanho="h-5 w-5" />{p.nome}</div>
                    {p.dias_afastado > 0 && <p className="text-[10px] text-amber-700">{p.dias_afastado} dia(s) de afastamento</p>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{horas(p.disponivel)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{horas(p.regencia_prevista)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {horas(p.nr_prevista)}{p.nr_proposta > 0 && <span className="text-amber-700"> +{horas(p.nr_proposta)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{horas(p.outras_alocacoes)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{horas(p.saldo_antes)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{horas(p.horas_novas)}</td>
                  <td className={cn("py-1.5 pl-2 text-right font-semibold tabular-nums", depois < 0 ? "text-red-700" : "text-green-700")}>
                    {horas(depois)}{depois < 0 && " · sobrecarga"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-500">
        * Carga semanal informada aplicada a todos os dias de trabalho do período consultado (calendário institucional, sem os dias de
        afastamento). Ao salvar, vale também a vigência do vínculo. Propostas aparecem em âmbar e não entram no saldo atual.
      </p>
    </div>
  );
}

type Linha = { professor_id: number | ""; horas: string; papel: string; responsabilidades: string; contribuicao: string; data_inicio: string; data_fim: string; justificativa: string; gestor_id: number | "" };

/** Vincular vários professores ao projeto numa só tela. */
export function NovosVinculosModal({ projeto, opcoes, onClose }: { projeto: any; opcoes: NrOpcoes; onClose: () => void }) {
  const qc = useQueryClient();
  const nova = (): Linha => ({ professor_id: "", horas: "", papel: "", responsabilidades: "", contribuicao: "", data_inicio: projeto.data_inicio ?? "", data_fim: projeto.continuo ? "" : projeto.data_fim_prevista ?? "", justificativa: "", gestor_id: "" });
  const [linhas, setLinhas] = useState<Linha[]>([nova()]);
  const setL = (i: number, k: keyof Linha, v: any) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const jaNoProjeto = new Set((projeto.vinculos ?? []).filter((v: any) => ["proposta", "aprovada"].includes(v.situacao)).map((v: any) => v.professor_id));
  const ids = linhas.map((l) => l.professor_id).filter(Boolean) as number[];
  const horasPor = useMemo(() => Object.fromEntries(linhas.filter((l) => l.professor_id).map((l) => [l.professor_id, lerNumero(l.horas) ?? 0])), [linhas]);

  const salvar = useMutation({
    mutationFn: () => nrApi.criarVinculos(projeto.id, linhas.filter((l) => l.professor_id).map((l) => ({
      professor_id: l.professor_id, horas_semanais: lerNumero(l.horas), papel: l.papel || null,
      responsabilidades: l.responsabilidades || null, contribuicao: l.contribuicao || null,
      data_inicio: l.data_inicio || null, data_fim: l.data_fim || null, justificativa: l.justificativa || null,
      gestor_id: l.gestor_id || null,
    }))),
    onSuccess: (r) => { toast.success(`${r.criados.length} vínculo(s) proposto(s). Aprove para compor a carga oficial.`); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });

  return (
    <Modal titulo="Vincular professores" subtitulo={`${projeto.codigo} · ${projeto.nome} — os vínculos nascem como propostas`}
           onClose={onClose} largura="max-w-5xl"
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-primary gap-1.5" disabled={!ids.length || salvar.isPending} onClick={() => salvar.mutate()}>
               {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Propor {ids.length || ""} vínculo(s)
             </button>
           </>}>
      <div className="space-y-3">
        {linhas.map((l, i) => (
          <div key={i} className="rounded-md border p-3">
            <div className="grid gap-2 md:grid-cols-12">
              <Campo label="Professor" obrigatorio className="md:col-span-4">
                <select className="input" value={l.professor_id} onChange={(e) => setL(i, "professor_id", e.target.value ? +e.target.value : "")}>
                  <option value="">Selecione…</option>
                  {opcoes.professores.filter((p) => p.ativo).map((p) => (
                    <option key={p.id} value={p.id} disabled={jaNoProjeto.has(p.id) || (ids.includes(p.id) && l.professor_id !== p.id)}>
                      {p.nome} ({p.tipo}, {p.horas_semanais}h/sem){jaNoProjeto.has(p.id) ? " — já no projeto" : ""}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="h/semana" obrigatorio className="md:col-span-2">
                <input className="input" inputMode="decimal" value={l.horas} onChange={(e) => setL(i, "horas", e.target.value)} placeholder="Ex.: 4" />
              </Campo>
              <Campo label="Papel" className="md:col-span-3">
                <input className="input" value={l.papel} onChange={(e) => setL(i, "papel", e.target.value)} placeholder="Ex.: Pesquisador" />
              </Campo>
              <Campo label="Gestor da aprovação" className="md:col-span-3">
                <select className="input" value={l.gestor_id} onChange={(e) => setL(i, "gestor_id", e.target.value ? +e.target.value : "")}>
                  <option value="">Gestão (padrão)</option>
                  {opcoes.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </Campo>
              <Campo label="Início" className="md:col-span-2"><input type="date" className="input" value={l.data_inicio} onChange={(e) => setL(i, "data_inicio", e.target.value)} /></Campo>
              <Campo label="Término" className="md:col-span-2"><input type="date" className="input" value={l.data_fim} onChange={(e) => setL(i, "data_fim", e.target.value)} /></Campo>
              <Campo label="Entregas / responsabilidades" className="md:col-span-4">
                <input className="input" value={l.responsabilidades} onChange={(e) => setL(i, "responsabilidades", e.target.value)} placeholder="O que fica sob responsabilidade dele" />
              </Campo>
              <Campo label="Justificativa da alocação" className="md:col-span-4">
                <input className="input" value={l.justificativa} onChange={(e) => setL(i, "justificativa", e.target.value)} />
              </Campo>
              <Campo label="Descrição da contribuição" className="md:col-span-11">
                <input className="input" value={l.contribuicao} onChange={(e) => setL(i, "contribuicao", e.target.value)} />
              </Campo>
              <div className="flex items-end justify-end md:col-span-1">
                {linhas.length > 1 && (
                  <button className="mb-2 text-gray-400 hover:text-red-600" title="Remover" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        <button className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" onClick={() => setLinhas([...linhas, nova()])}>
          <Plus className="h-4 w-4" /> Adicionar outro professor
        </button>
        <PainelDisponibilidade professorIds={ids} horasPor={horasPor} projeto={projeto} />
      </div>
    </Modal>
  );
}

/** Editar vínculo: carga, vigência, faixas de carga por período e responsabilidades. */
export function EditarVinculoModal({ vinculo, projeto, opcoes, onClose }: { vinculo: any; projeto: any; opcoes: NrOpcoes; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    horas: String(vinculo.horas_semanais).replace(".", ","), papel: vinculo.papel ?? "", responsabilidades: vinculo.responsabilidades ?? "",
    contribuicao: vinculo.contribuicao ?? "", data_inicio: vinculo.data_inicio ?? "", data_fim: vinculo.data_fim ?? "",
    gestor_id: vinculo.gestor_id ?? "", justificativa: vinculo.justificativa ?? "",
  });
  const [periodos, setPeriodos] = useState<{ data_inicio: string; data_fim: string; horas: string }[]>(
    (vinculo.periodos ?? []).map((p: any) => ({ data_inicio: p.data_inicio, data_fim: p.data_fim ?? "", horas: String(p.horas_semanais).replace(".", ",") })),
  );
  const [justAlt, setJustAlt] = useState("");
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  const salvar = useMutation({
    mutationFn: () => nrApi.editarVinculo(vinculo.id, {
      horas_semanais: lerNumero(f.horas), papel: f.papel || null, responsabilidades: f.responsabilidades || null,
      contribuicao: f.contribuicao || null, data_inicio: f.data_inicio || null, data_fim: f.data_fim || null,
      gestor_id: f.gestor_id || null, justificativa: f.justificativa || null,
      periodos: periodos.filter((p) => p.data_inicio).map((p) => ({ data_inicio: p.data_inicio, data_fim: p.data_fim || null, horas_semanais: lerNumero(p.horas) ?? 0 })),
      justificativa_alteracao: justAlt || null,
    }),
    onSuccess: () => { toast.success("Vínculo atualizado"); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });

  return (
    <Modal titulo={`Vínculo de ${vinculo.professor_nome}`} subtitulo={`${projeto.codigo} · ${projeto.nome}`} onClose={onClose} largura="max-w-3xl"
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-primary gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
               {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
             </button>
           </>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Campo label="Carga semanal padrão (h)" obrigatorio><input className="input" inputMode="decimal" value={f.horas} onChange={(e) => set("horas", e.target.value)} /></Campo>
        <Campo label="Início"><input type="date" className="input" value={f.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} /></Campo>
        <Campo label="Término"><input type="date" className="input" value={f.data_fim} onChange={(e) => set("data_fim", e.target.value)} /></Campo>
        <Campo label="Papel"><input className="input" value={f.papel} onChange={(e) => set("papel", e.target.value)} /></Campo>
        <Campo label="Gestor da aprovação" className="md:col-span-2">
          <select className="input" value={f.gestor_id} onChange={(e) => set("gestor_id", e.target.value ? +e.target.value : "")}>
            <option value="">Gestão (padrão)</option>
            {opcoes.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Entregas / responsabilidades" className="md:col-span-3"><input className="input" value={f.responsabilidades} onChange={(e) => set("responsabilidades", e.target.value)} /></Campo>
        <Campo label="Descrição da contribuição" className="md:col-span-3"><input className="input" value={f.contribuicao} onChange={(e) => set("contribuicao", e.target.value)} /></Campo>
        <Campo label="Justificativa da alocação" className="md:col-span-3"><input className="input" value={f.justificativa} onChange={(e) => set("justificativa", e.target.value)} /></Campo>
      </div>
      <div className="mt-4 space-y-2 border-t pt-4">
        <p className="text-sm font-semibold text-gray-800">Distribuição por período</p>
        <p className="text-xs text-gray-500">Use quando a carga mudar ao longo do projeto. Fora das faixas, vale a carga semanal padrão.</p>
        {periodos.map((p, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Campo label="De"><input type="date" className="input h-8 py-0 text-xs" value={p.data_inicio} onChange={(e) => setPeriodos(periodos.map((x, j) => (j === i ? { ...x, data_inicio: e.target.value } : x)))} /></Campo>
            <Campo label="Até (vazio = até o fim)"><input type="date" className="input h-8 py-0 text-xs" value={p.data_fim} onChange={(e) => setPeriodos(periodos.map((x, j) => (j === i ? { ...x, data_fim: e.target.value } : x)))} /></Campo>
            <Campo label="h/semana"><input className="input h-8 w-24 py-0 text-xs" inputMode="decimal" value={p.horas} onChange={(e) => setPeriodos(periodos.map((x, j) => (j === i ? { ...x, horas: e.target.value } : x)))} /></Campo>
            <button className="mb-2 text-gray-400 hover:text-red-600" onClick={() => setPeriodos(periodos.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setPeriodos([...periodos, { data_inicio: "", data_fim: "", horas: "" }])}>
          <Plus className="h-3.5 w-3.5" /> Adicionar faixa
        </button>
      </div>
      <Campo label={vinculo.situacao === "aprovada" ? "Justificativa da alteração (obrigatória se mudar a carga)" : "Justificativa da alteração"} className="mt-4">
        <input className="input" value={justAlt} onChange={(e) => setJustAlt(e.target.value)} />
      </Campo>
    </Modal>
  );
}

/** Aprovar (com a disponibilidade à vista) ou encerrar/cancelar um vínculo. */
export function DecisaoVinculoModal({ vinculo, projeto, acao, onClose }: { vinculo: any; projeto?: any; acao: "aprovar" | "encerrar"; onClose: () => void }) {
  const qc = useQueryClient();
  const [just, setJust] = useState("");
  const [dataFim, setDataFim] = useState("");
  const salvar = useMutation({
    mutationFn: () => acao === "aprovar" ? nrApi.aprovarVinculo(vinculo.id, just || undefined) : nrApi.encerrarVinculo(vinculo.id, just, dataFim || undefined),
    onSuccess: () => { toast.success(acao === "aprovar" ? "Alocação aprovada" : "Vínculo encerrado"); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <Modal titulo={acao === "aprovar" ? "Aprovar alocação" : vinculo.situacao === "proposta" ? "Cancelar proposta" : "Encerrar participação"}
           subtitulo={`${vinculo.professor_nome} · ${vinculo.horas_semanais}h/sem · ${vinculo.projeto_nome ?? projeto?.nome ?? ""}`}
           onClose={onClose} largura="max-w-4xl"
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Voltar</button>
             <button className={cn("gap-1.5", acao === "aprovar" ? "btn-primary" : "btn-primary bg-red-600 hover:bg-red-700")}
                     disabled={salvar.isPending || (acao === "encerrar" && !just.trim())} onClick={() => salvar.mutate()}>
               {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
               {acao === "aprovar" ? "Aprovar" : "Confirmar"}
             </button>
           </>}>
      <div className="space-y-3">
        {acao === "aprovar" && (
          <PainelDisponibilidade professorIds={[vinculo.professor_id]} horasPor={{ [vinculo.professor_id]: vinculo.horas_semanais }} projeto={projeto ?? { data_inicio: vinculo.data_inicio }} />
        )}
        {acao === "encerrar" && vinculo.situacao === "aprovada" && (
          <Campo label="Encerrar em" dica="Vazio = hoje. As horas deixam de contar após esta data.">
            <input type="date" className="input w-auto" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </Campo>
        )}
        <Campo label="Justificativa" obrigatorio={acao === "encerrar"}>
          <textarea className="input h-auto min-h-[64px] py-2" value={just} onChange={(e) => setJust(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}
