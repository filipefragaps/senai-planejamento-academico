"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, ClipboardCheck, FolderKanban, Loader2 } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";
import {
  ALERTA_NIVEL_STYLE, SITUACAO_ENTREGA_STYLE, SITUACAO_VINCULO_STYLE, dataBR, horas, mesAtual, nrApi,
} from "@/lib/nao-regencia";
import { Avatar, Campo, Selo, Tabela, Vazio } from "@/components/nao-regencia/ui";
import { TabelaApontamentos } from "@/components/nao-regencia/entregas-apontamentos";

const STATUS_REG: Record<string, string> = {
  OK: "bg-green-50 text-green-700 border-green-200",
  Alerta: "bg-amber-50 text-amber-800 border-amber-200",
  Critico: "bg-red-50 text-red-700 border-red-200",
  Sobrecarga: "bg-violet-50 text-violet-700 border-violet-200",
};

function Linha({ rotulo, valor, destaque, sub }: { rotulo: string; valor: string; destaque?: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-gray-600">{rotulo}{sub && <span className="block text-[11px] text-gray-400">{sub}</span>}</span>
      <span className={cn("font-semibold tabular-nums text-gray-900", destaque)}>{valor}</span>
    </div>
  );
}

export default function VisaoProfessorPage() {
  const { id } = useParams<{ id: string }>();
  const [per, setPer] = useState(mesAtual());
  const { data, isLoading, isError } = useQuery({
    queryKey: ["nr-visao", +id, per.ini, per.fim],
    queryFn: () => nrApi.visaoProfessor(+id, per.ini, per.fim),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-red-600">Professor não encontrado ou sem permissão de acesso.</p>;

  const { professor: pr, carga: c, regencia: rg } = data;
  const pizza = c ? [
    { nome: "Regência prevista", valor: c.regencia_prevista, cor: "hsl(218 100% 28%)" },
    { nome: "Não regência aprovada", valor: c.nr_prevista, cor: "#0ea5e9" },
    { nome: "Outras alocações", valor: c.outras_alocacoes, cor: "#a78bfa" },
    { nome: "Reserva de planejamento", valor: c.reserva_planejamento, cor: "#fbbf24" },
    { nome: "Saldo", valor: Math.max(0, c.saldo_previsto), cor: "#d1d5db" },
  ].filter((x) => x.valor > 0) : [];

  return (
    <div className="space-y-5">
      <Link href="/nao-regencia" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Não Regência
      </Link>

      <div className="card flex flex-wrap items-center gap-4 p-5">
        <Avatar nome={pr.nome} foto={pr.foto} tamanho="h-20 w-20 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{pr.nome}</h1>
          <p className="text-sm text-gray-500">{pr.tipo} · {pr.horas_semanais}h/semana contratuais{pr.area && ` · ${pr.area}`}</p>
        </div>
        <div className="flex items-end gap-2">
          <Campo label="De"><input type="date" className="input h-8 w-auto py-0 text-xs" value={per.ini} onChange={(e) => setPer({ ...per, ini: e.target.value })} /></Campo>
          <Campo label="Até"><input type="date" className="input h-8 w-auto py-0 text-xs" value={per.fim} onChange={(e) => setPer({ ...per, fim: e.target.value })} /></Campo>
        </div>
      </div>

      {data.alertas.length > 0 && (
        <ul className="space-y-2">
          {data.alertas.map((a: any, i: number) => (
            <li key={i} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", ALERTA_NIVEL_STYLE[a.nivel])}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a.mensagem}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Carga no período</h3>
          {c ? (
            <div className="divide-y">
              <Linha rotulo="Carga contratual" valor={horas(c.carga_contratual)} sub={`${c.dias_uteis} dias de trabalho`} />
              <Linha rotulo="Indisponível (afastamentos)" valor={horas(c.indisponivel)} sub={c.dias_afastado ? `${c.dias_afastado} dia(s)` : undefined} />
              <Linha rotulo="Disponível" valor={horas(c.disponivel)} />
              {c.reserva_planejamento > 0 && <Linha rotulo="Reserva de planejamento" valor={horas(c.reserva_planejamento)} />}
              <Linha rotulo="Regência prevista" valor={horas(c.regencia_prevista)} sub="aulas agendadas + realizadas" />
              <Linha rotulo="Não regência aprovada" valor={horas(c.nr_prevista)} />
              {c.nr_proposta > 0 && <Linha rotulo="Não regência proposta" valor={horas(c.nr_proposta)} destaque="text-amber-700" sub="não entra no saldo" />}
              <Linha rotulo="Outras alocações" valor={horas(c.outras_alocacoes)} />
              <Linha rotulo="Saldo previsto" valor={horas(c.saldo_previsto)} destaque={c.sobrecarga ? "text-red-700" : "text-green-700"}
                     sub={c.sobrecarga ? "sobrecarga prevista" : undefined} />
            </div>
          ) : <p className="text-sm text-gray-500">Sem dados no período.</p>}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Distribuição prevista</h3>
          {pizza.length === 0 ? <Vazio icone={CalendarClock} titulo="Sem carga distribuída" /> : (
            <div className="h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pizza} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={80}>
                    {pizza.map((x) => <Cell key={x.nome} fill={x.cor} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => horas(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">Regência (indicador existente) e execução</h3>
          <div className="divide-y">
            <div className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-gray-600">Regência no período</span>
              <span className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{rg.percentual_regencia.toLocaleString("pt-BR")}%</span>
                <Selo cls={STATUS_REG[rg.status]}>{rg.status === "Critico" ? "Crítico" : rg.status}</Selo>
              </span>
            </div>
            <Linha rotulo="Meta de regência" valor={`${rg.meta_regencia}%`} />
            <Linha rotulo="Horas de aula (agendadas + realizadas)" valor={horas(rg.horas_ministradas)} />
            {c && <Linha rotulo="Aulas realizadas" valor={horas(c.regencia_realizada)} />}
            {c && <Linha rotulo="Não regência informada" valor={horas(c.nr_informada)} />}
            {c && <Linha rotulo="Não regência validada" valor={horas(c.nr_validada)} destaque="text-green-700" />}
            {c && c.nr_pendente > 0 && <Linha rotulo="Aguardando validação" valor={horas(c.nr_pendente)} destaque="text-violet-700" />}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">As horas de projeto não alteram o percentual de regência.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-gray-800"><FolderKanban className="h-4 w-4 text-gray-400" /> Projetos ativos</h3>
          <Tabela cabecalho={<><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Papel</th><th className="px-3 py-2 text-right">h/sem</th><th className="px-3 py-2 text-right">No período</th><th className="px-3 py-2">Situação</th></>}
                  vazio={data.vinculos_ativos.length === 0 ? <Vazio icone={FolderKanban} titulo="Sem projetos ativos" /> : undefined}>
            {data.vinculos_ativos.map((v: any) => (
              <tr key={v.id}>
                <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${v.projeto_id}`}>{v.projeto_codigo} {v.projeto_nome}</Link></td>
                <td className="px-3 py-2 text-gray-600">{v.papel || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{horas(v.horas_semanais)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{horas(v.previsto_periodo)}</td>
                <td className="px-3 py-2"><Selo cls={SITUACAO_VINCULO_STYLE[v.situacao]}>{v.situacao_label}</Selo></td>
              </tr>
            ))}
          </Tabela>
        </div>

        <div className="card overflow-hidden">
          <h3 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-gray-800"><ClipboardCheck className="h-4 w-4 text-gray-400" /> Entregas</h3>
          {data.entregas_atrasadas.length === 0 && data.proximas_entregas.length === 0 ? (
            <Vazio icone={CheckCircle2} titulo="Nenhuma entrega pendente" />
          ) : (
            <ul className="divide-y">
              {[...data.entregas_atrasadas, ...data.proximas_entregas].map((e: any) => (
                <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{e.titulo}</p>
                    <Link className="text-xs text-gray-500 hover:underline" href={`/nao-regencia/projetos/${e.projeto_id}`}>{e.projeto_codigo} {e.projeto_nome}</Link>
                  </div>
                  <div className="text-right">
                    <p className={cn("text-xs", e.atrasada ? "font-semibold text-red-700" : "text-gray-600")}>{e.atrasada ? "Atrasada · " : ""}{dataBR(e.prazo)}</p>
                    <Selo cls={SITUACAO_ENTREGA_STYLE[e.situacao]}>{e.situacao_label}</Selo>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Atividades apontadas no período</h3>
        <TabelaApontamentos itens={data.apontamentos} mostrarProfessor={false} />
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Histórico de participação em projetos</h3>
        <Tabela cabecalho={<><th className="px-3 py-2">Projeto</th><th className="px-3 py-2">Papel</th><th className="px-3 py-2">Vigência</th><th className="px-3 py-2 text-right">h/sem</th><th className="px-3 py-2">Situação</th></>}
                vazio={data.historico_participacao.length === 0 ? <Vazio icone={FolderKanban} titulo="Sem participações registradas" /> : undefined}>
          {data.historico_participacao.map((v: any) => (
            <tr key={v.id}>
              <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${v.projeto_id}`}>{v.projeto_codigo} {v.projeto_nome}</Link></td>
              <td className="px-3 py-2 text-gray-600">{v.papel || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">{dataBR(v.data_inicio)} – {v.data_fim ? dataBR(v.data_fim) : "contínuo"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{horas(v.horas_semanais)}</td>
              <td className="px-3 py-2"><Selo cls={SITUACAO_VINCULO_STYLE[v.situacao]}>{v.situacao_label}</Selo></td>
            </tr>
          ))}
        </Tabela>
      </div>
    </div>
  );
}
