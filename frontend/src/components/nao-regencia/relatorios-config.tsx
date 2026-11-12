"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, FileText, Loader2, Plus } from "lucide-react";
import { NrFiltros, NrOpcoes, dataBR, erroApi, nrApi } from "@/lib/nao-regencia";
import { Campo, Modal } from "./ui";

const RELATORIOS = [
  { tipo: "consolidado", titulo: "Consolidado da atuação docente", texto: "Regência, não regência, outras alocações e entregas, por professor, projeto e categoria." },
  { tipo: "professor", titulo: "Por professor", texto: "Carga disponível, regência prevista e realizada, não regência prevista/proposta/informada/validada e saldo." },
  { tipo: "projeto", titulo: "Por projeto", texto: "Horas previstas, informadas e validadas por projeto, progresso e entregas do período." },
  { tipo: "categoria", titulo: "Por categoria", texto: "Distribuição das horas previstas, informadas e validadas por categoria." },
];

/** Aba "Relatórios": exporta com os mesmos filtros do dashboard. */
export function Relatorios({ filtros }: { filtros: NrFiltros }) {
  const [baixando, setBaixando] = useState<string | null>(null);
  async function exportar(formato: "xlsx" | "pdf", tipo: string) {
    setBaixando(`${tipo}-${formato}`);
    try {
      await nrApi.exportar(formato, tipo, filtros);
    } catch (e) {
      toast.error(erroApi(e, "Erro ao gerar o relatório"));
    } finally {
      setBaixando(null);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Os relatórios usam o período ({dataBR(filtros.ini)} a {dataBR(filtros.fim)}) e os filtros selecionados acima, e trazem esses dados no cabeçalho,
        separando horas previstas, propostas, informadas e validadas.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {RELATORIOS.map((r) => (
          <div key={r.tipo} className="card flex flex-col p-4">
            <h3 className="text-sm font-semibold text-gray-900">{r.titulo}</h3>
            <p className="mt-1 flex-1 text-xs text-gray-500">{r.texto}</p>
            <div className="mt-3 flex gap-2">
              {(["xlsx", "pdf"] as const).map((fmt) => (
                <button key={fmt} className="btn-secondary h-8 gap-1.5 px-3 text-xs" disabled={!!baixando} onClick={() => exportar(fmt, r.tipo)}>
                  {baixando === `${r.tipo}-${fmt}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : fmt === "xlsx" ? <FileSpreadsheet className="h-3.5 w-3.5 text-green-700" /> : <FileText className="h-3.5 w-3.5 text-red-700" />}
                  {fmt === "xlsx" ? "Excel" : "PDF"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ROTULO: Record<string, string> = {
  limite_regencia_pct: "Regência mínima para alerta (%)",
  saldo_minimo_alerta_h: "Saldo sem alocação para alerta (h no período)",
  tolerancia_sobrecarga_h: "Tolerância de sobrecarga (h)",
  tolerancia_apontamento_pct: "Tolerância de apontamento acima do previsto (%)",
  dias_sem_movimentacao: "Dias sem movimentação do projeto",
  dias_validacao_pendente: "Dias com horas aguardando validação",
  reserva_planejamento_pct: "Reserva de planejamento (% da carga disponível)",
  dias_semana_trabalho: "Dias da semana com jornada (0 = segunda … 6 = domingo)",
  tipos_calendario_nao_util: "Tipos do calendário que reduzem a carga",
};

/** Parâmetros (admin) e categorias. Decisões institucionais pendentes ficam destacadas. */
export function ConfigModal({ opcoes, onClose }: { opcoes: NrOpcoes; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["nr-config"], queryFn: nrApi.config });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [novaCat, setNovaCat] = useState("");
  useEffect(() => { if (data) setValores(Object.fromEntries(data.map((c: any) => [c.chave, c.valor ?? ""]))); }, [data]);
  const salvar = useMutation({
    mutationFn: () => nrApi.salvarConfig(valores),
    onSuccess: () => { toast.success("Parâmetros salvos"); qc.invalidateQueries({ queryKey: ["nr-config"] }); qc.invalidateQueries({ queryKey: ["nr-dashboard"] }); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const criarCat = useMutation({
    mutationFn: () => nrApi.criarCategoria(novaCat),
    onSuccess: () => { toast.success("Categoria criada"); setNovaCat(""); qc.invalidateQueries({ queryKey: ["nr-opcoes"] }); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const alternarCat = useMutation({
    mutationFn: (c: any) => nrApi.editarCategoria(c.id, { ativa: !c.ativa }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nr-opcoes"] }),
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <Modal titulo="Configurações da Não Regência" subtitulo="Limites dos alertas e regras de cálculo da carga." onClose={onClose} largura="max-w-3xl"
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-primary gap-1.5" disabled={salvar.isPending || !opcoes.eu.admin} onClick={() => salvar.mutate()}>
               {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar parâmetros
             </button>
           </>}>
      {!opcoes.eu.admin && <p className="mb-3 text-xs text-gray-500">Somente o administrador altera os parâmetros.</p>}
      <div className="space-y-3">
        {(data ?? []).map((c: any) => (
          <div key={c.chave} className={c.decisao_pendente ? "rounded-md border border-amber-200 bg-amber-50 p-3" : ""}>
            <Campo label={ROTULO[c.chave] ?? c.chave} dica={`${c.descricao} Padrão: ${c.padrao}.`}>
              <input className="input bg-white" disabled={!opcoes.eu.admin} value={valores[c.chave] ?? ""}
                     onChange={(e) => setValores({ ...valores, [c.chave]: e.target.value })} />
            </Campo>
            {c.decisao_pendente && (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                <AlertTriangle className="h-3 w-3" /> Decisão institucional pendente: confirme o valor.
              </p>
            )}
          </div>
        ))}
        <p className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
          Unidade: hora-relógio em todo o módulo (a regência do sistema já é calculada pela duração real das aulas). A carga contratual semanal do
          cadastro do professor é dividida pelos dias de trabalho e aplicada dia a dia no período, sem supor 4 ou 5 semanas por mês.
          Gestão = perfis administrador, coordenador e analista (o sistema não tem escopo por unidade; todos veem todos os projetos).
          O professor é reconhecido pelo e-mail igual ao do cadastro de professores.
        </p>
      </div>
      <div className="mt-5 border-t pt-4">
        <p className="mb-2 text-sm font-semibold text-gray-800">Categorias</p>
        <div className="flex flex-wrap gap-2">
          {opcoes.categorias.map((c) => (
            <button key={c.id} disabled={!opcoes.eu.admin} onClick={() => alternarCat.mutate(c)}
                    className={c.ativa ? "badge border border-primary/30 bg-primary/5 text-primary" : "badge border border-gray-300 bg-gray-100 text-gray-400 line-through"}
                    title={c.ativa ? "Clique para desativar" : "Clique para reativar"}>
              {c.nome}
            </button>
          ))}
        </div>
        {opcoes.eu.admin && (
          <div className="mt-3 flex gap-2">
            <input className="input max-w-xs" placeholder="Nova categoria" value={novaCat} onChange={(e) => setNovaCat(e.target.value)} />
            <button className="btn-secondary gap-1" disabled={!novaCat.trim() || criarCat.isPending} onClick={() => criarCat.mutate()}><Plus className="h-4 w-4" /> Adicionar</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
