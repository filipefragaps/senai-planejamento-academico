"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, ExternalLink, FileUp, History, Loader2, Pencil, Plus, Users, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NrOpcoes, PRIORIDADE_STYLE, SITUACAO_PROJETO_STYLE, SITUACAO_VINCULO_STYLE, dataBR, erroApi, horas, nrApi,
} from "@/lib/nao-regencia";
import { Avatar, BarraProgresso, LinkProfessor, Selo, Tabela, Vazio } from "@/components/nao-regencia/ui";
import { ProjetoForm } from "@/components/nao-regencia/projeto-form";
import { DecisaoVinculoModal, EditarVinculoModal, NovosVinculosModal } from "@/components/nao-regencia/vinculos";
import {
  AnexosLista, ApontamentoForm, EntregaForm, TabelaApontamentos, TabelaEntregas, ValidacaoHoras,
} from "@/components/nao-regencia/entregas-apontamentos";

const ACAO_LABEL: Record<string, string> = {
  criacao: "Criação", alteracao: "Alteração", situacao: "Situação", aprovacao: "Aprovação", devolucao: "Devolução",
  encerramento: "Encerramento", cancelamento: "Cancelamento", submissao: "Envio para validação", envio: "Envio",
  exclusao: "Exclusão", alteracao_carga: "Alteração de carga",
};
const ENTIDADE_LABEL: Record<string, string> = {
  projeto: "Projeto", vinculo: "Vínculo", entrega: "Entrega", apontamento: "Apontamento", anexo: "Anexo",
};

function Info({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <div className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{children}</div>
    </div>
  );
}

export default function ProjetoPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: opcoes } = useQuery<NrOpcoes>({ queryKey: ["nr-opcoes"], queryFn: nrApi.opcoes });
  const { data: p, isLoading, isError } = useQuery({ queryKey: ["nr-projeto", +id], queryFn: () => nrApi.projeto(+id) });
  const { data: apontamentos = [] } = useQuery({
    queryKey: ["nr-apontamentos", "projeto", +id],
    queryFn: () => nrApi.apontamentos({ projeto_id: +id }),
    enabled: !!p,
  });
  const [editar, setEditar] = useState(false);
  const [vincular, setVincular] = useState(false);
  const [editVinc, setEditVinc] = useState<any>(null);
  const [decisao, setDecisao] = useState<{ v: any; acao: "aprovar" | "encerrar" } | null>(null);
  const [entrega, setEntrega] = useState<any>(null);
  const [novaEntrega, setNovaEntrega] = useState(false);
  const [apontar, setApontar] = useState(false);
  const [editAp, setEditAp] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const [aba, setAba] = useState<"equipe" | "entregas" | "horas" | "historico">("equipe");

  if (isLoading || !opcoes) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (isError || !p) return <p className="py-10 text-center text-sm text-red-600">Projeto não encontrado ou sem permissão de acesso.</p>;

  const eu = opcoes.eu;
  const gerir = p.pode_gerir;
  const encerrado = ["concluido", "cancelado"].includes(p.situacao);
  const souDaEquipe = p.vinculos.some((v: any) => v.professor_id === eu.professor_id && ["aprovada", "encerrada"].includes(v.situacao));
  const totAprov = p.vinculos.filter((v: any) => v.situacao === "aprovada").reduce((s: number, v: any) => s + v.horas_semanais, 0);
  const totProp = p.vinculos.filter((v: any) => v.situacao === "proposta").reduce((s: number, v: any) => s + v.horas_semanais, 0);
  const hValid = apontamentos.filter((a: any) => a.situacao === "aprovado").reduce((s: number, a: any) => s + a.horas, 0);
  const hInf = apontamentos.filter((a: any) => a.situacao !== "rascunho").reduce((s: number, a: any) => s + a.horas, 0);

  async function anexar(files: FileList | null) {
    if (!files?.length) return;
    setEnviando(true);
    try {
      for (const f of Array.from(files)) await nrApi.enviarAnexo(p.id, f);
      toast.success("Arquivo(s) anexado(s)");
      qc.invalidateQueries({ queryKey: ["nr-projeto"] });
    } catch (e) {
      toast.error(erroApi(e, "Erro ao anexar"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/nao-regencia?aba=projetos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Projetos e atividades
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-500">{p.codigo} · {p.categoria || "Sem categoria"}{p.unidade && ` · ${p.unidade}`}</p>
            <h1 className="text-2xl font-bold text-gray-900">{p.nome}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Selo cls={SITUACAO_PROJETO_STYLE[p.situacao]}>{p.situacao_label}</Selo>
              <span className={cn("text-xs", PRIORIDADE_STYLE[p.prioridade])}>Prioridade {p.prioridade_label.toLowerCase()}</span>
              <span className="text-xs text-gray-500">
                {dataBR(p.data_inicio)} – {p.continuo ? `contínua (revisão em ${dataBR(p.data_revisao)})` : dataBR(p.data_fim_prevista)}
                {p.data_conclusao && ` · concluído em ${dataBR(p.data_conclusao)}`}
              </span>
              {(p.prazo_vencido || p.revisao_vencida) && (
                <Selo cls="bg-red-50 text-red-700 border-red-200">{p.prazo_vencido ? "Término previsto vencido" : "Revisão da alocação vencida"}</Selo>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">Responsável: {p.responsavel_nome?.toUpperCase() || "não definido"}</p>
          </div>
          {gerir && <button className="btn-secondary gap-1.5" onClick={() => setEditar(true)}><Pencil className="h-4 w-4" /> Editar</button>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="rounded-md bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Equipe</p><p className="text-lg font-bold">{p.professores}</p></div>
          <div className="rounded-md bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Carga aprovada</p><p className="text-lg font-bold">{horas(totAprov)}/sem</p>{totProp > 0 && <p className="text-[11px] text-amber-700">+{horas(totProp)}/sem propostas</p>}</div>
          <div className="rounded-md bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Horas informadas</p><p className="text-lg font-bold">{horas(hInf)}</p>{p.ch_total_prevista && <p className="text-[11px] text-gray-500">de {horas(p.ch_total_prevista)} previstas no total</p>}</div>
          <div className="rounded-md bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Horas validadas</p><p className="text-lg font-bold text-green-700">{horas(hValid)}</p></div>
          <div className="rounded-md bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Progresso (entregas)</p><div className="mt-1.5"><BarraProgresso valor={p.progresso} /></div></div>
        </div>
        {p.ch_total_prevista && hInf >= p.ch_total_prevista && p.progresso !== 100 && (
          <p className="mt-2 text-xs text-amber-800">As horas previstas foram consumidas, mas o projeto só é concluído pelas entregas aprovadas.</p>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-primary">Descrição, justificativa, objetivos e referências</summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <Info titulo="Descrição">{p.descricao}</Info>
            <Info titulo="Justificativa institucional">{p.justificativa}</Info>
            <Info titulo="Objetivo">{p.objetivo}</Info>
            <Info titulo="Resultados esperados">{p.resultados_esperados}</Info>
            <Info titulo="Entregas previstas">{p.entregas_previstas}</Info>
            <Info titulo="Observações">{p.observacoes}</Info>
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Links e anexos</p>
              {p.links.map((l: any, i: number) => (
                <a key={i} href={l.url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> {l.titulo || l.url}
                </a>
              ))}
              <AnexosLista anexos={p.anexos} podeExcluir={gerir} />
              {gerir && (
                <label className="btn-secondary mt-2 h-8 cursor-pointer gap-1.5 px-3 text-xs">
                  {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Anexar arquivo
                  <input type="file" multiple className="hidden" onChange={(e) => anexar(e.target.files)} />
                </label>
              )}
              {!p.links.length && !p.anexos.length && !gerir && <p className="text-sm text-gray-400">—</p>}
            </div>
          </div>
        </details>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {([["equipe", "Equipe e alocação"], ["entregas", "Entregas"], ["horas", "Horas apontadas"], ["historico", "Histórico"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)}
                  className={cn("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium", aba === k ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-800")}>
            {l}
          </button>
        ))}
      </div>

      {aba === "equipe" && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="mr-auto">
              <h3 className="text-sm font-semibold text-gray-800">Professores vinculados</h3>
              <p className="text-xs text-gray-500">Só vínculos aprovados compõem a carga oficial. Propostas aparecem separadas.</p>
            </div>
            {gerir && !encerrado && (
              <button className="btn-primary h-8 gap-1 px-3 text-xs" onClick={() => setVincular(true)}><Plus className="h-3.5 w-3.5" /> Vincular professores</button>
            )}
          </div>
          <Tabela
            cabecalho={<>
              <th className="px-4 py-2">Professor</th><th className="px-3 py-2">Papel e responsabilidades</th><th className="px-3 py-2">Vigência</th>
              <th className="px-3 py-2 text-right">h/sem</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2" />
            </>}
            vazio={p.vinculos.length === 0 ? <Vazio icone={Users} titulo="Nenhum professor vinculado"
              texto="Use “Vincular professores” para propor a participação de vários professores de uma vez, com a carga de cada um." /> : undefined}
          >
            {p.vinculos.map((v: any) => (
              <tr key={v.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2"><Avatar nome={v.professor_nome} foto={v.professor_foto} /><LinkProfessor id={v.professor_id} nome={v.professor_nome} /></div>
                </td>
                <td className="max-w-sm px-3 py-2 text-gray-700">
                  <p className="font-medium">{v.papel || "—"}</p>
                  {v.responsabilidades && <p className="text-xs text-gray-500">Responsável por: {v.responsabilidades}</p>}
                  {v.contribuicao && <p className="text-xs text-gray-500">{v.contribuicao}</p>}
                  {v.justificativa && <p className="text-xs italic text-gray-400">Justificativa: {v.justificativa}</p>}
                  {v.gestor_nome && <p className="text-[11px] text-gray-400">Aprovação: {v.gestor_nome}</p>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{dataBR(v.data_inicio)} – {v.data_fim ? dataBR(v.data_fim) : "contínuo"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {horas(v.horas_semanais)}
                  {v.periodos.map((pe: any) => (
                    <p key={pe.id} className="text-[11px] text-gray-500">{horas(pe.horas_semanais)} de {dataBR(pe.data_inicio)}{pe.data_fim ? ` a ${dataBR(pe.data_fim)}` : " em diante"}</p>
                  ))}
                </td>
                <td className="px-3 py-2"><Selo cls={SITUACAO_VINCULO_STYLE[v.situacao]}>{v.situacao_label}</Selo></td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <span className="inline-flex items-center gap-3">
                    {v.situacao === "proposta" && (eu.gestao || v.gestor_id === eu.id) && v.professor_id !== eu.professor_id && (
                      <button className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline" onClick={() => setDecisao({ v, acao: "aprovar" })}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                      </button>
                    )}
                    {gerir && ["proposta", "aprovada"].includes(v.situacao) && (
                      <>
                        <button className="text-gray-400 hover:text-primary" title="Editar carga e vigência" onClick={() => setEditVinc(v)}><Pencil className="h-4 w-4" /></button>
                        <button className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600" onClick={() => setDecisao({ v, acao: "encerrar" })}>
                          <XCircle className="h-3.5 w-3.5" /> {v.situacao === "proposta" ? "Cancelar" : "Encerrar"}
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </Tabela>
        </div>
      )}

      {aba === "entregas" && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="mr-auto">
              <h3 className="text-sm font-semibold text-gray-800">Entregas</h3>
              <p className="text-xs text-gray-500">O progresso é calculado pelas entregas aprovadas e seus pesos.</p>
            </div>
            {gerir && <button className="btn-primary h-8 gap-1 px-3 text-xs" onClick={() => setNovaEntrega(true)}><Plus className="h-3.5 w-3.5" /> Nova entrega</button>}
          </div>
          <TabelaEntregas itens={p.entregas} opcoes={opcoes} projeto={p} mostrarProjeto={false} onEditar={setEntrega} />
        </div>
      )}

      {aba === "horas" && (
        <div className="space-y-5">
          {gerir && <ValidacaoHoras projetoId={p.id} />}
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <div className="mr-auto">
                <h3 className="text-sm font-semibold text-gray-800">Apontamentos</h3>
                <p className="text-xs text-gray-500">Informadas = enviadas ou aprovadas; validadas = aprovadas pelo gestor.</p>
              </div>
              {(souDaEquipe || gerir) && <button className="btn-primary h-8 gap-1 px-3 text-xs" onClick={() => setApontar(true)}><Plus className="h-3.5 w-3.5" /> Registrar atividade</button>}
            </div>
            <TabelaApontamentos itens={apontamentos} mostrarProjeto={false}
                                onEditar={(a) => (a.professor_id === eu.professor_id || a.criado_por_id === eu.id) && setEditAp(a)} />
          </div>
        </div>
      )}

      {aba === "historico" && (
        <div className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-gray-800"><History className="h-4 w-4 text-gray-400" /> Histórico</h3>
          {p.historico.length === 0 ? <Vazio icone={History} titulo="Sem registros" /> : (
            <ul className="divide-y">
              {p.historico.map((h: any) => (
                <li key={h.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-gray-900">{ENTIDADE_LABEL[h.entidade] ?? h.entidade} · {ACAO_LABEL[h.acao] ?? h.acao}</span>
                    <span className="text-xs text-gray-500">{h.usuario || "sistema"} · {h.criado_em ? new Date(h.criado_em).toLocaleString("pt-BR") : ""}</span>
                  </div>
                  {h.detalhe && <p className="text-gray-700">{h.detalhe}</p>}
                  {h.justificativa && <p className="text-xs italic text-gray-500">Justificativa: {h.justificativa}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editar && <ProjetoForm projeto={p} opcoes={opcoes} onClose={() => setEditar(false)} />}
      {vincular && <NovosVinculosModal projeto={p} opcoes={opcoes} onClose={() => setVincular(false)} />}
      {editVinc && <EditarVinculoModal vinculo={editVinc} projeto={p} opcoes={opcoes} onClose={() => setEditVinc(null)} />}
      {decisao && <DecisaoVinculoModal vinculo={decisao.v} projeto={p} acao={decisao.acao} onClose={() => setDecisao(null)} />}
      {novaEntrega && <EntregaForm projeto={p} onClose={() => setNovaEntrega(false)} />}
      {entrega && <EntregaForm projeto={p} entrega={entrega} onClose={() => setEntrega(null)} />}
      {apontar && <ApontamentoForm opcoes={opcoes} projetoFixo={p} onClose={() => setApontar(false)} />}
      {editAp && <ApontamentoForm opcoes={opcoes} projetoFixo={p} apontamento={editAp} onClose={() => setEditAp(null)} />}
    </div>
  );
}
