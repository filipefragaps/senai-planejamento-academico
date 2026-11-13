"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, FolderKanban, Hourglass, Loader2, Scale, ShieldAlert,
  Users, ClipboardCheck, ClipboardList, BellRing, Inbox, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALERTA_NIVEL_STYLE, NrFiltros, NrOpcoes, SITUACAO_APONTAMENTO_STYLE, SITUACAO_ENTREGA_STYLE,
  SITUACAO_PROJETO_STYLE, SITUACAO_VINCULO_STYLE, dataBR, horas, nrApi,
} from "@/lib/nao-regencia";
import { Avatar, LinkProfessor, Modal, Selo, Tabela, Tile, Vazio } from "./ui";

const COR = {
  regencia: "hsl(218 100% 28%)",
  nr: "#0ea5e9",
  outras: "#a78bfa",
  saldo: "#d1d5db",
  previstas: "#94a3b8",
  informadas: "#f59e0b",
  validadas: "#16a34a",
};

type Detalhe = { titulo: string; tipo: "vinculos" | "apontamentos" | "entregas" | "professores" | "projetos"; itens: any[] };

const CHAVE_EXCLUIDOS = "nr-excluidos";

/** Professores que não entram no gráfico, na tabela gerencial e nos cartões de saldo — lembrados neste navegador. */
function useExcluidos() {
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAVE_EXCLUIDOS);
      if (raw) setExcluidos(new Set(JSON.parse(raw) as number[]));
    } catch { /* sem armazenamento local */ }
  }, []);
  function alternar(id: number) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(CHAVE_EXCLUIDOS, JSON.stringify(Array.from(next))); } catch { /* ignora */ }
      return next;
    });
  }
  return { excluidos, alternar };
}

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function Dashboard({ filtros, opcoes, setFiltros }: { filtros: NrFiltros; opcoes?: NrOpcoes; setFiltros: (f: NrFiltros) => void }) {
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["nr-dashboard", filtros],
    queryFn: () => nrApi.dashboard(filtros),
  });
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const { excluidos, alternar } = useExcluidos();
  const [verOcultos, setVerOcultos] = useState(false);
  const linhas = useMemo(() => (data?.professores ?? []).filter((l: any) => !excluidos.has(l.professor_id)), [data, excluidos]);
  const ocultos = useMemo(() => (data?.professores ?? []).filter((l: any) => excluidos.has(l.professor_id)), [data, excluidos]);

  const graficoProf = useMemo(() => linhas
    .filter((l: any) => l.quadro && (l.nr_prevista > 0 || l.regencia_prevista > 0 || l.outras_alocacoes > 0))
    .sort((a: any, b: any) => b.nr_prevista - a.nr_prevista)
    .map((l: any) => ({
      id: l.professor_id, nome: l.nome.split(" ").slice(0, 2).join(" "),
      Regência: l.regencia_prevista, "Não regência": l.nr_prevista, Outras: l.outras_alocacoes,
      Saldo: Math.max(0, l.saldo_previsto),
    })), [linhas]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-red-600">Não foi possível carregar o dashboard.</p>;

  // Saldo e sobrecarga sem os professores ocultados
  const ind = {
    ...data.indicadores,
    saldo_disponivel: linhas.reduce((s: number, l: any) => s + Math.max(0, l.saldo_previsto), 0),
    professores_sobrecarga: linhas.filter((l: any) => l.sobrecarga).length,
  };
  const ini = data.periodo.inicio, fim = data.periodo.fim;
  const entregasPeriodo = data.entregas.filter((e: any) => e.prazo && e.prazo >= ini && e.prazo <= fim);
  const oficiais = data.vinculos.filter((v: any) => ["aprovada", "encerrada"].includes(v.situacao) && (v.previsto_periodo ?? 0) > 0);

  const abrir = (titulo: string, tipo: Detalhe["tipo"], itens: any[]) => setDetalhe({ titulo, tipo, itens });

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Período de {dataBR(ini)} a {dataBR(fim)} · {data.periodo.dias_uteis} dias de trabalho no calendário · valores em hora-relógio.
        Clique em um indicador para ver os registros que o compõem.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Tile icon={Users} label="Professores vinculados" valor={ind.professores_vinculados} detalhe="com alocação aprovada no período"
              onClick={() => abrir("Alocações aprovadas no período", "vinculos", oficiais)} />
        <Tile icon={FolderKanban} label="Projetos em andamento" valor={ind.projetos_andamento}
              onClick={() => abrir("Projetos em andamento", "projetos", data.projetos.filter((p: any) => p.situacao === "em_andamento"))} />
        <Tile icon={CalendarClock} label="Horas previstas" valor={horas(ind.horas_previstas)}
              detalhe={ind.horas_propostas ? `+ ${horas(ind.horas_propostas)} em propostas` : "vínculos aprovados"}
              onClick={() => abrir("Horas previstas (vínculos aprovados)", "vinculos", oficiais)} />
        <Tile icon={ClipboardList} label="Horas informadas" valor={horas(ind.horas_informadas)} detalhe="enviadas ou aprovadas"
              onClick={() => abrir("Horas informadas", "apontamentos", data.apontamentos.filter((a: any) => a.situacao !== "rascunho"))} />
        <Tile icon={CheckCircle2} label="Horas validadas" valor={horas(ind.horas_validadas)} tom="sucesso"
              onClick={() => abrir("Horas validadas", "apontamentos", data.apontamentos.filter((a: any) => a.situacao === "aprovado"))} />
        <Tile icon={Hourglass} label="Pendentes de validação" valor={horas(ind.horas_pendentes)} tom={ind.horas_pendentes ? "atencao" : undefined}
              onClick={() => abrir("Horas aguardando validação", "apontamentos", data.apontamentos.filter((a: any) => a.situacao === "enviado"))} />
        <Tile icon={Scale} label="Saldo disponível" valor={horas(ind.saldo_disponivel)} detalhe="soma dos saldos positivos"
              onClick={() => abrir("Saldo previsto por professor", "professores", linhas.filter((l: any) => l.saldo_previsto > 0))} />
        <Tile icon={ShieldAlert} label="Sobrecarga prevista" valor={ind.professores_sobrecarga} tom={ind.professores_sobrecarga ? "alerta" : undefined}
              detalhe="professores com saldo negativo"
              onClick={() => abrir("Professores com sobrecarga prevista", "professores", linhas.filter((l: any) => l.sobrecarga))} />
        <Tile icon={ClipboardCheck} label="Entregas no período" valor={ind.entregas_periodo}
              onClick={() => abrir("Entregas com prazo no período", "entregas", entregasPeriodo)} />
        <Tile icon={CheckCircle2} label="Entregas aprovadas" valor={ind.entregas_aprovadas} tom="sucesso" detalhe="com prazo no período"
              onClick={() => abrir("Entregas aprovadas (prazo no período)", "entregas", entregasPeriodo.filter((e: any) => e.situacao === "aprovada"))} />
        <Tile icon={AlertTriangle} label="Entregas em atraso" valor={ind.entregas_atrasadas} tom={ind.entregas_atrasadas ? "alerta" : undefined}
              onClick={() => abrir("Entregas em atraso", "entregas", data.entregas.filter((e: any) => e.atrasada))} />
        <Tile icon={BellRing} label="Alertas" valor={data.alertas.length} tom={data.alertas.length ? "atencao" : undefined}
              onClick={() => document.getElementById("nr-alertas")?.scrollIntoView({ behavior: "smooth" })} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Distribuição da carga prevista por professor</h3>
          <p className="mb-3 text-xs text-gray-500">Professores do quadro: regência prevista, não regência aprovada, outras alocações e saldo. Clique na barra para abrir a visão do professor.</p>
          {graficoProf.length === 0 ? (
            <Vazio icone={Inbox} titulo="Nenhuma carga registrada no período" texto="Cadastre projetos e aprove alocações para ver a distribuição." />
          ) : (
            <div style={{ height: Math.max(220, graficoProf.length * 28 + 60) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={graficoProf} layout="vertical" margin={{ left: 10, right: 10 }}
                          onClick={(e: any) => e?.activePayload?.[0] && router.push(`/nao-regencia/professor/${e.activePayload[0].payload.id}`)}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="nome" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => horas(v)} cursor={{ fill: "#f3f4f6" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Regência" stackId="a" fill={COR.regencia} className="cursor-pointer" />
                  <Bar dataKey="Não regência" stackId="a" fill={COR.nr} className="cursor-pointer" />
                  <Bar dataKey="Outras" stackId="a" fill={COR.outras} className="cursor-pointer" />
                  <Bar dataKey="Saldo" stackId="a" fill={COR.saldo} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Previstas × informadas × validadas por projeto</h3>
          <p className="mb-3 text-xs text-gray-500">Horas no período. Clique para abrir o projeto.</p>
          {data.por_projeto.length === 0 ? (
            <Vazio icone={FolderKanban} titulo="Nenhum projeto nos filtros" texto="Cadastre um projeto na aba Projetos e atividades." />
          ) : (
            <div style={{ height: Math.max(220, data.por_projeto.length * 34 + 60) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.por_projeto.map((p: any) => ({ ...p, rotulo: p.nome.length > 22 ? p.nome.slice(0, 21) + "…" : p.nome }))}
                          layout="vertical" margin={{ left: 10, right: 10 }}
                          onClick={(e: any) => e?.activePayload?.[0] && router.push(`/nao-regencia/projetos/${e.activePayload[0].payload.projeto_id}`)}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="rotulo" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => horas(v)} cursor={{ fill: "#f3f4f6" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="previstas" name="Previstas" fill={COR.previstas} className="cursor-pointer" />
                  <Bar dataKey="informadas" name="Informadas" fill={COR.informadas} className="cursor-pointer" />
                  <Bar dataKey="validadas" name="Validadas" fill={COR.validadas} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Horas por categoria</h3>
          <p className="mb-3 text-xs text-gray-500">Clique para filtrar o painel pela categoria.</p>
          {data.por_categoria.length === 0 ? (
            <Vazio icone={Inbox} titulo="Sem horas por categoria no período" />
          ) : (
            <div style={{ height: Math.max(200, data.por_categoria.length * 34 + 60) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.por_categoria} layout="vertical" margin={{ left: 10, right: 10 }}
                          onClick={(e: any) => {
                            const nome = e?.activePayload?.[0]?.payload?.categoria;
                            const cat = opcoes?.categorias.find((c) => c.nome === nome);
                            if (cat) setFiltros({ ...filtros, categoria_id: cat.id });
                          }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
                  <YAxis type="category" dataKey="categoria" width={170} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => horas(v)} cursor={{ fill: "#f3f4f6" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="previstas" name="Previstas" fill={COR.previstas} className="cursor-pointer" />
                  <Bar dataKey="validadas" name="Validadas" fill={COR.validadas} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-800">Evolução das horas informadas e validadas</h3>
          <p className="mb-3 text-xs text-gray-500">Por mês, com lançamentos semanais rateados pelos dias.</p>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.evolucao.map((m: any) => ({ ...m, rotulo: `${MES[+m.mes.slice(5) - 1]}/${m.mes.slice(2, 4)}` }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="h" />
                <Tooltip formatter={(v: any) => horas(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="informadas" name="Informadas" stroke={COR.informadas} strokeWidth={2} dot />
                <Line type="monotone" dataKey="validadas" name="Validadas" stroke={COR.validadas} strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div id="nr-alertas" className="card overflow-hidden xl:col-span-2">
          <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Alertas gerenciais</h3>
          {data.alertas.length === 0 ? (
            <Vazio icone={CheckCircle2} titulo="Nenhum alerta no período" texto="Os limites dos alertas podem ser ajustados em Configurações." />
          ) : (
            <ul className="max-h-[360px] space-y-2 overflow-y-auto p-3">
              {data.alertas.map((a: any, i: number) => (
                <li key={i} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", ALERTA_NIVEL_STYLE[a.nivel])}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="flex-1">{a.mensagem}</span>
                  {a.projeto_id ? (
                    <Link href={`/nao-regencia/projetos/${a.projeto_id}`} className="shrink-0 text-xs font-medium underline">Ver projeto</Link>
                  ) : a.professor_id ? (
                    <Link href={`/nao-regencia/professor/${a.professor_id}`} className="shrink-0 text-xs font-medium underline">Ver professor</Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card overflow-hidden">
          <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Prazos vencidos e entregas atrasadas</h3>
          {data.projetos_atrasados.length === 0 ? (
            <Vazio icone={Clock} titulo="Nenhum projeto com atraso" />
          ) : (
            <ul className="max-h-[360px] divide-y overflow-y-auto">
              {data.projetos_atrasados.map((p: any) => (
                <li key={p.projeto_id} className="px-4 py-2.5 text-sm">
                  <Link href={`/nao-regencia/projetos/${p.projeto_id}`} className="font-medium text-gray-900 hover:text-primary hover:underline">
                    {p.codigo} · {p.nome}
                  </Link>
                  <p className="text-xs text-red-700">
                    {p.prazo_vencido && `Término previsto vencido em ${dataBR(p.data_fim_prevista)}`}
                    {p.prazo_vencido && p.entregas_atrasadas > 0 && " · "}
                    {p.entregas_atrasadas > 0 && `${p.entregas_atrasadas} entrega(s) atrasada(s)`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold text-gray-800">Tabela gerencial</h3>
            {ocultos.length > 0 && (
              <button onClick={() => setVerOcultos((v) => !v)}
                      className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100">
                <EyeOff className="h-3 w-3" /> {ocultos.length} oculto(s) · {verOcultos ? "esconder" : "ver"}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Carga disponível = contratual − afastamentos. Saldo previsto = disponível − reserva de planejamento − regência prevista − não regência prevista − outras alocações.
            Regência realizada e não regência validada mostram a execução, sem descontar do saldo planejado.
            Use o olho para ocultar um professor do gráfico, da tabela e dos cartões de saldo (fica lembrado neste navegador).
          </p>
        </div>
        <TabelaGerencial linhas={verOcultos ? [...linhas, ...ocultos] : linhas} excluidos={excluidos} onAlternar={alternar} />
      </div>

      {detalhe && <DetalheModal detalhe={detalhe} onClose={() => setDetalhe(null)} />}
    </div>
  );
}

export function TabelaGerencial({ linhas, excluidos, onAlternar }: {
  linhas: any[]; excluidos?: Set<number>; onAlternar?: (id: number) => void;
}) {
  return (
    <Tabela
      cabecalho={<>
        <th className="px-4 py-2">Professor</th>
        <th className="px-3 py-2 text-right">Carga disponível</th>
        <th className="px-3 py-2 text-right">Regência prevista</th>
        <th className="px-3 py-2 text-right">Regência realizada</th>
        <th className="px-3 py-2 text-right">Não regência prevista</th>
        <th className="px-3 py-2 text-right">Não regência validada</th>
        <th className="px-3 py-2 text-right">Outras alocações</th>
        <th className="px-3 py-2 text-right">Saldo previsto</th>
        <th className="px-4 py-2 text-right">Entregas atrasadas</th>
      </>}
      vazio={linhas.length === 0 ? <Vazio icone={Users} titulo="Nenhum professor nos filtros" /> : undefined}
    >
      {linhas.map((l) => (
        <tr key={l.professor_id} className={cn("hover:bg-gray-50", excluidos?.has(l.professor_id) && "opacity-50")}>
          <td className="px-4 py-2">
            <div className="flex items-center gap-2">
              {onAlternar && (
                <button onClick={() => onAlternar(l.professor_id)} className="shrink-0 text-gray-300 hover:text-gray-600"
                        title={excluidos?.has(l.professor_id) ? "Voltar a considerar este professor" : "Não considerar este professor"}>
                  {excluidos?.has(l.professor_id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              )}
              <Avatar nome={l.nome} foto={l.foto} />
              <div className="min-w-0">
                <LinkProfessor id={l.professor_id} nome={l.nome} />
                <p className="text-[11px] text-gray-500">
                  {l.tipo} · {l.horas_semanais_contrato}h/sem · regência {l.regencia_pct.toLocaleString("pt-BR")}%
                  {l.dias_afastado > 0 && ` · ${l.dias_afastado} dia(s) afastado`}
                </p>
              </div>
            </div>
          </td>
          <td className="px-3 py-2 text-right tabular-nums">
            {horas(l.disponivel)}
            {l.reserva_planejamento > 0 && <p className="text-[11px] text-gray-400">reserva {horas(l.reserva_planejamento)}</p>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">{horas(l.regencia_prevista)}</td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{horas(l.regencia_realizada)}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {horas(l.nr_prevista)}
            {l.nr_proposta > 0 && <p className="text-[11px] text-amber-700">+{horas(l.nr_proposta)} proposta</p>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
            {horas(l.nr_validada)}
            {l.nr_pendente > 0 && <p className="text-[11px] text-violet-700">{horas(l.nr_pendente)} a validar</p>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">{horas(l.outras_alocacoes)}</td>
          <td className={cn("px-3 py-2 text-right font-semibold tabular-nums", l.sobrecarga ? "text-red-700" : "text-gray-900")}>
            {horas(l.saldo_previsto)}
            {l.sobrecarga && <p className="text-[11px] font-medium">sobrecarga</p>}
          </td>
          <td className={cn("px-4 py-2 text-right tabular-nums", l.entregas_atrasadas > 0 && "font-semibold text-red-700")}>
            {l.entregas_atrasadas}
          </td>
        </tr>
      ))}
    </Tabela>
  );
}

function DetalheModal({ detalhe, onClose }: { detalhe: Detalhe; onClose: () => void }) {
  const { tipo, itens } = detalhe;
  return (
    <Modal titulo={detalhe.titulo} subtitulo={`${itens.length} registro(s)`} onClose={onClose} largura="max-w-4xl">
      {itens.length === 0 ? (
        <Vazio icone={Inbox} titulo="Nenhum registro" />
      ) : tipo === "vinculos" ? (
        <Tabela cabecalho={<><th className="px-3 py-2">Professor</th><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">h/sem</th><th className="px-3 py-2 text-right">No período</th></>}>
          {itens.map((v) => (
            <tr key={v.id}>
              <td className="px-3 py-2"><LinkProfessor id={v.professor_id} nome={v.professor_nome} /></td>
              <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${v.projeto_id}`}>{v.projeto_codigo} {v.projeto_nome}</Link></td>
              <td className="px-3 py-2"><Selo cls={SITUACAO_VINCULO_STYLE[v.situacao]}>{v.situacao_label}</Selo></td>
              <td className="px-3 py-2 text-right tabular-nums">{horas(v.horas_semanais)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{horas(v.previsto_periodo)}</td>
            </tr>
          ))}
        </Tabela>
      ) : tipo === "apontamentos" ? (
        <Tabela cabecalho={<><th className="px-3 py-2">Data</th><th className="px-3 py-2">Professor</th><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Atividade</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Horas</th></>}>
          {itens.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap px-3 py-2">{dataBR(a.data_inicio)}{a.data_fim !== a.data_inicio && ` – ${dataBR(a.data_fim)}`}</td>
              <td className="px-3 py-2">{a.professor_nome}</td>
              <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${a.projeto_id}`}>{a.projeto_nome}</Link></td>
              <td className="max-w-xs px-3 py-2 text-gray-600">{a.descricao}</td>
              <td className="px-3 py-2"><Selo cls={SITUACAO_APONTAMENTO_STYLE[a.situacao]}>{a.situacao_label}</Selo></td>
              <td className="px-3 py-2 text-right tabular-nums">
                {horas(a.horas_periodo ?? a.horas)}
                {a.horas_periodo != null && a.horas_periodo !== a.horas && <p className="text-[11px] text-gray-400">de {horas(a.horas)}</p>}
              </td>
            </tr>
          ))}
        </Tabela>
      ) : tipo === "entregas" ? (
        <Tabela cabecalho={<><th className="px-3 py-2">Entrega</th><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Responsáveis</th><th className="px-3 py-2">Prazo</th><th className="px-3 py-2">Situação</th></>}>
          {itens.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2 font-medium">{e.titulo}</td>
              <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${e.projeto_id}`}>{e.projeto_nome}</Link></td>
              <td className="px-3 py-2 text-gray-600">{e.responsaveis.map((r: any) => r.nome).join(", ") || "—"}</td>
              <td className={cn("whitespace-nowrap px-3 py-2", e.atrasada && "font-semibold text-red-700")}>{dataBR(e.prazo)}</td>
              <td className="px-3 py-2"><Selo cls={SITUACAO_ENTREGA_STYLE[e.situacao]}>{e.situacao_label}</Selo></td>
            </tr>
          ))}
        </Tabela>
      ) : tipo === "projetos" ? (
        <Tabela cabecalho={<><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Categoria</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Professores</th></>}>
          {itens.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2"><Link className="font-medium hover:underline" href={`/nao-regencia/projetos/${p.id}`}>{p.codigo} {p.nome}</Link></td>
              <td className="px-3 py-2 text-gray-600">{p.categoria || "—"}</td>
              <td className="px-3 py-2"><Selo cls={SITUACAO_PROJETO_STYLE[p.situacao]}>{p.situacao_label}</Selo></td>
              <td className="px-3 py-2 text-right">{p.professores}</td>
            </tr>
          ))}
        </Tabela>
      ) : (
        <TabelaGerencial linhas={itens} />
      )}
    </Modal>
  );
}
