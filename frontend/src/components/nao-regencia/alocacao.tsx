"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarOff, CheckCircle2, Loader2, Plus, Trash2, Users, Briefcase, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NrFiltros, NrOpcoes, SITUACAO_VINCULO_STYLE, dataBR, erroApi, horas, lerNumero, nrApi } from "@/lib/nao-regencia";
import { Avatar, Campo, LinkProfessor, Modal, Selo, Tabela, Vazio } from "./ui";
import { DecisaoVinculoModal } from "./vinculos";

/** Aba "Alocação de professores": participações, aprovações, afastamentos e outras alocações. */
export function Alocacao({ filtros, opcoes }: { filtros: NrFiltros; opcoes: NrOpcoes }) {
  const [situacao, setSituacao] = useState("");
  const [decisao, setDecisao] = useState<{ v: any; acao: "aprovar" | "encerrar" } | null>(null);
  const { data = [], isLoading } = useQuery({
    queryKey: ["nr-vinculos", filtros.ini, filtros.fim, filtros.professor_id, situacao],
    queryFn: () => nrApi.vinculos({ ini: filtros.ini, fim: filtros.fim, professor_id: filtros.professor_id, situacao }),
  });
  const eu = opcoes.eu;
  const podeAprovar = (v: any) => (eu.gestao || v.gestor_id === eu.id) && v.professor_id !== eu.professor_id;
  const podeGerir = (v: any) => eu.gestao || eu.coordena.includes(v.projeto_id);

  const porProfessor = useMemo(() => {
    const m = new Map<number, { id: number; nome: string; foto?: string; itens: any[] }>();
    data.forEach((v: any) => {
      if (!m.has(v.professor_id)) m.set(v.professor_id, { id: v.professor_id, nome: v.professor_nome, foto: v.professor_foto, itens: [] });
      m.get(v.professor_id)!.itens.push(v);
    });
    return Array.from(m.values()).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [data]);
  const propostas = data.filter((v: any) => v.situacao === "proposta");

  return (
    <div className="space-y-5">
      {propostas.length > 0 && eu.gestao && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {propostas.length} alocação(ões) proposta(s) aguardando aprovação. Propostas não compõem a carga oficial até serem aprovadas.
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="mr-auto">
            <h3 className="text-sm font-semibold text-gray-800">Distribuição da carga por professor</h3>
            <p className="text-xs text-gray-500">Horas no período = carga semanal vigente × dias de trabalho, fora de afastamentos. Os vínculos são criados na página do projeto.</p>
          </div>
          <select className="input h-8 w-auto py-0 text-xs" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            <option value="">Todas as situações</option>
            {opcoes.situacoes_vinculo.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          : porProfessor.length === 0 ? (
            <Vazio icone={Users} titulo="Nenhuma alocação encontrada" texto="Abra um projeto na aba Projetos e atividades e use “Vincular professores”." />
          ) : (
            <div className="divide-y">
              {porProfessor.map((g) => {
                const aprov = g.itens.filter((v) => v.situacao === "aprovada").reduce((s, v) => s + v.horas_semanais, 0);
                const prop = g.itens.filter((v) => v.situacao === "proposta").reduce((s, v) => s + v.horas_semanais, 0);
                const noPeriodo = g.itens.filter((v) => ["aprovada", "encerrada"].includes(v.situacao)).reduce((s, v) => s + (v.previsto_periodo ?? 0), 0);
                return (
                  <div key={g.id} className="px-4 py-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Avatar nome={g.nome} foto={g.foto} />
                      <LinkProfessor id={g.id} nome={g.nome} />
                      <span className="text-xs text-gray-500">
                        {horas(aprov)}/sem aprovadas{prop > 0 && <span className="text-amber-700"> · {horas(prop)}/sem propostas</span>} · {horas(noPeriodo)} no período
                      </span>
                    </div>
                    <Tabela cabecalho={<>
                      <th className="px-3 py-1.5">Projeto</th><th className="px-3 py-1.5">Papel</th><th className="px-3 py-1.5">Vigência</th>
                      <th className="px-3 py-1.5 text-right">h/sem</th><th className="px-3 py-1.5 text-right">No período</th>
                      <th className="px-3 py-1.5">Situação</th><th className="px-3 py-1.5" />
                    </>}>
                      {g.itens.map((v) => (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5"><Link className="hover:underline" href={`/nao-regencia/projetos/${v.projeto_id}`}>{v.projeto_codigo} {v.projeto_nome}</Link></td>
                          <td className="px-3 py-1.5 text-gray-600">{v.papel || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{dataBR(v.data_inicio)} – {v.data_fim ? dataBR(v.data_fim) : "contínuo"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {horas(v.horas_semanais)}
                            {v.periodos?.length > 0 && <p className="text-[10px] text-gray-400">{v.periodos.length} faixa(s) de carga</p>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{horas(v.previsto_periodo)}</td>
                          <td className="px-3 py-1.5"><Selo cls={SITUACAO_VINCULO_STYLE[v.situacao]}>{v.situacao_label}</Selo></td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">
                            {v.situacao === "proposta" && podeAprovar(v) && (
                              <button className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline" onClick={() => setDecisao({ v, acao: "aprovar" })}>
                                <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                              </button>
                            )}
                            {["proposta", "aprovada"].includes(v.situacao) && podeGerir(v) && (
                              <button className="ml-3 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600" onClick={() => setDecisao({ v, acao: "encerrar" })}>
                                <XCircle className="h-3.5 w-3.5" /> {v.situacao === "proposta" ? "Cancelar" : "Encerrar"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Tabela>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Afastamentos opcoes={opcoes} />
        <OutrasAlocacoes opcoes={opcoes} />
      </div>

      {decisao && <DecisaoVinculoModal vinculo={decisao.v} acao={decisao.acao} onClose={() => setDecisao(null)} />}
    </div>
  );
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  ["nr-afastamentos", "nr-outras", "nr-dashboard", "nr-vinculos", "nr-visao", "nr-disp"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

function Afastamentos({ opcoes }: { opcoes: NrOpcoes }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ professor_id: "" as number | "", tipo: opcoes.tipos_afastamento[0], data_inicio: "", data_fim: "", observacao: "" });
  const { data = [] } = useQuery({ queryKey: ["nr-afastamentos"], queryFn: () => nrApi.afastamentos() });
  const criar = useMutation({
    mutationFn: () => nrApi.criarAfastamento(f),
    onSuccess: () => { toast.success("Afastamento registrado"); invalidar(qc); setNovo(false); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const excluir = useMutation({
    mutationFn: (id: number) => nrApi.excluirAfastamento(id),
    onSuccess: () => { toast.success("Afastamento excluído"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold text-gray-800">Afastamentos e indisponibilidades</h3>
          <p className="text-xs text-gray-500">Reduzem a carga disponível e suspendem as horas previstas nos dias afastados.</p>
        </div>
        {opcoes.eu.gestao && <button className="btn-secondary h-8 gap-1 px-3 text-xs" onClick={() => setNovo(true)}><Plus className="h-3.5 w-3.5" /> Registrar</button>}
      </div>
      <Tabela cabecalho={<><th className="px-3 py-2">Professor</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Período</th><th className="px-3 py-2" /></>}
              vazio={data.length === 0 ? <Vazio icone={CalendarOff} titulo="Nenhum afastamento registrado" /> : undefined}>
        {data.map((a: any) => (
          <tr key={a.id}>
            <td className="px-3 py-2">{a.professor_nome}</td>
            <td className="px-3 py-2">{a.tipo}{a.observacao && <p className="text-xs text-gray-500">{a.observacao}</p>}</td>
            <td className="whitespace-nowrap px-3 py-2">{dataBR(a.data_inicio)} – {dataBR(a.data_fim)}</td>
            <td className="px-3 py-2 text-right">
              {opcoes.eu.gestao && <button className="text-gray-400 hover:text-red-600" onClick={() => confirm("Excluir este afastamento?") && excluir.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>}
            </td>
          </tr>
        ))}
      </Tabela>
      {novo && (
        <Modal titulo="Registrar afastamento" onClose={() => setNovo(false)}
               rodape={<><button className="btn-secondary" onClick={() => setNovo(false)}>Cancelar</button>
                 <button className="btn-primary" disabled={criar.isPending || !f.professor_id || !f.data_inicio || !f.data_fim} onClick={() => criar.mutate()}>Salvar</button></>}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Professor" obrigatorio className="md:col-span-2">
              <select className="input" value={f.professor_id} onChange={(e) => setF({ ...f, professor_id: e.target.value ? +e.target.value : "" })}>
                <option value="">Selecione…</option>
                {opcoes.professores.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Tipo" obrigatorio>
              <select className="input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                {opcoes.tipos_afastamento.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Campo>
            <div />
            <Campo label="De" obrigatorio><input type="date" className="input" value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} /></Campo>
            <Campo label="Até" obrigatorio><input type="date" className="input" value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} /></Campo>
            <Campo label="Observação" className="md:col-span-2"><input className="input" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></Campo>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OutrasAlocacoes({ opcoes }: { opcoes: NrOpcoes }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ professor_id: "" as number | "", descricao: "", data_inicio: "", data_fim: "", horas: "" });
  const { data = [] } = useQuery({ queryKey: ["nr-outras"], queryFn: () => nrApi.outrasAlocacoes() });
  const criar = useMutation({
    mutationFn: () => nrApi.criarOutraAlocacao({ professor_id: f.professor_id, descricao: f.descricao, data_inicio: f.data_inicio,
      data_fim: f.data_fim || null, horas_semanais: lerNumero(f.horas) }),
    onSuccess: () => { toast.success("Alocação registrada"); invalidar(qc); setNovo(false); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const excluir = useMutation({
    mutationFn: (id: number) => nrApi.excluirOutraAlocacao(id),
    onSuccess: () => { toast.success("Alocação excluída"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold text-gray-800">Outras alocações institucionais</h3>
          <p className="text-xs text-gray-500">Compromissos fixos fora de projetos (ex.: comissão permanente). Entram no saldo previsto.</p>
        </div>
        {opcoes.eu.gestao && <button className="btn-secondary h-8 gap-1 px-3 text-xs" onClick={() => setNovo(true)}><Plus className="h-3.5 w-3.5" /> Registrar</button>}
      </div>
      <Tabela cabecalho={<><th className="px-3 py-2">Professor</th><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Vigência</th><th className="px-3 py-2 text-right">h/sem</th><th className="px-3 py-2" /></>}
              vazio={data.length === 0 ? <Vazio icone={Briefcase} titulo="Nenhuma outra alocação registrada" /> : undefined}>
        {data.map((o: any) => (
          <tr key={o.id}>
            <td className="px-3 py-2">{o.professor_nome}</td>
            <td className="px-3 py-2">{o.descricao}</td>
            <td className="whitespace-nowrap px-3 py-2">{dataBR(o.data_inicio)} – {o.data_fim ? dataBR(o.data_fim) : "contínuo"}</td>
            <td className="px-3 py-2 text-right tabular-nums">{horas(o.horas_semanais)}</td>
            <td className="px-3 py-2 text-right">
              {opcoes.eu.gestao && <button className="text-gray-400 hover:text-red-600" onClick={() => confirm("Excluir esta alocação?") && excluir.mutate(o.id)}><Trash2 className="h-4 w-4" /></button>}
            </td>
          </tr>
        ))}
      </Tabela>
      {novo && (
        <Modal titulo="Registrar outra alocação" onClose={() => setNovo(false)}
               rodape={<><button className="btn-secondary" onClick={() => setNovo(false)}>Cancelar</button>
                 <button className={cn("btn-primary")} disabled={criar.isPending || !f.professor_id || !f.descricao || !f.data_inicio || !f.horas} onClick={() => criar.mutate()}>Salvar</button></>}>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo label="Professor" obrigatorio className="md:col-span-2">
              <select className="input" value={f.professor_id} onChange={(e) => setF({ ...f, professor_id: e.target.value ? +e.target.value : "" })}>
                <option value="">Selecione…</option>
                {opcoes.professores.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
            <Campo label="Descrição" obrigatorio className="md:col-span-2"><input className="input" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Campo>
            <Campo label="De" obrigatorio><input type="date" className="input" value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} /></Campo>
            <Campo label="Até (vazio = contínuo)"><input type="date" className="input" value={f.data_fim} onChange={(e) => setF({ ...f, data_fim: e.target.value })} /></Campo>
            <Campo label="h/semana" obrigatorio><input className="input" inputMode="decimal" value={f.horas} onChange={(e) => setF({ ...f, horas: e.target.value })} /></Campo>
          </div>
        </Modal>
      )}
    </div>
  );
}
