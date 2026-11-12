"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FolderKanban, Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NrFiltros, NrOpcoes, PRIORIDADE_STYLE, SITUACAO_PROJETO_STYLE, dataBR, horas, nrApi } from "@/lib/nao-regencia";
import { BarraProgresso, Selo, Tabela, Vazio } from "./ui";
import { ProjetoForm } from "./projeto-form";

/** Aba "Projetos e atividades". */
export function ProjetosLista({ filtros, opcoes }: { filtros: NrFiltros; opcoes: NrOpcoes }) {
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const params = {
    busca, categoria_id: filtros.categoria_id, situacao: filtros.situacao, unidade: filtros.unidade,
    responsavel_id: filtros.responsavel_id, professor_id: filtros.professor_id,
  };
  const { data = [], isLoading } = useQuery({ queryKey: ["nr-projetos", params], queryFn: () => nrApi.projetos(params) });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="relative mr-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8" placeholder="Buscar por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {opcoes.eu.gestao && (
          <button className="btn-primary gap-1.5" onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo projeto ou atividade</button>
        )}
      </div>
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : (
        <Tabela
          cabecalho={<>
            <th className="px-4 py-2">Projeto</th>
            <th className="px-3 py-2">Categoria</th>
            <th className="px-3 py-2">Responsável</th>
            <th className="px-3 py-2">Período</th>
            <th className="px-3 py-2 text-right">Equipe</th>
            <th className="px-3 py-2 text-right">h/sem aprovadas</th>
            <th className="px-3 py-2">Entregas</th>
            <th className="px-3 py-2">Progresso</th>
            <th className="px-4 py-2">Situação</th>
          </>}
          vazio={data.length === 0 ? (
            <Vazio icone={FolderKanban} titulo="Nenhum projeto ou atividade encontrado"
                   texto={opcoes.eu.gestao ? "Cadastre o primeiro projeto: nome, período e responsável já bastam para começar." : "Você ainda não participa de projetos de não regência."}>
              {opcoes.eu.gestao && <button className="btn-primary gap-1.5" onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Cadastrar projeto</button>}
            </Vazio>
          ) : undefined}
        >
          {data.map((p: any) => (
            <tr key={p.id} className="hover:bg-gray-50">
              <td className="px-4 py-2">
                <Link href={`/nao-regencia/projetos/${p.id}`} className="font-medium text-gray-900 hover:text-primary hover:underline">{p.nome}</Link>
                <p className="text-[11px] text-gray-500">
                  {p.codigo} · <span className={PRIORIDADE_STYLE[p.prioridade]}>prioridade {p.prioridade_label.toLowerCase()}</span>
                  {p.unidade && ` · ${p.unidade}`}
                </p>
              </td>
              <td className="px-3 py-2 text-gray-600">{p.categoria || "—"}</td>
              <td className="px-3 py-2 text-gray-600">{p.responsavel_nome || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                {dataBR(p.data_inicio)} – {p.continuo ? "contínua" : dataBR(p.data_fim_prevista)}
                {(p.prazo_vencido || p.revisao_vencida) && (
                  <p className="flex items-center gap-1 text-[11px] font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" /> {p.prazo_vencido ? "término previsto vencido" : "revisão vencida"}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{p.professores}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {horas(p.horas_semanais_aprovadas)}
                {p.horas_semanais_propostas > 0 && <p className="text-[11px] text-amber-700">+{horas(p.horas_semanais_propostas)} propostas</p>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                {p.entregas_aprovadas}/{p.entregas} aprovadas
                {p.entregas_atrasadas > 0 && <p className="text-[11px] font-medium text-red-700">{p.entregas_atrasadas} atrasada(s)</p>}
              </td>
              <td className="px-3 py-2"><BarraProgresso valor={p.progresso} /></td>
              <td className="px-4 py-2"><Selo cls={cn(SITUACAO_PROJETO_STYLE[p.situacao])}>{p.situacao_label}</Selo></td>
            </tr>
          ))}
        </Tabela>
      )}
      {novo && <ProjetoForm opcoes={opcoes} onClose={() => setNovo(false)}
                            onSalvo={(p) => { window.location.href = `/nao-regencia/projetos/${p.id}`; }} />}
    </div>
  );
}
