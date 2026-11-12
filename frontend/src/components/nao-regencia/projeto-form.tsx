"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { NrOpcoes, PERFIS_RESPONSAVEL, erroApi, lerNumero, nrApi } from "@/lib/nao-regencia";
import { Campo, Modal } from "./ui";

type Form = {
  nome: string; categoria_id: number | ""; descricao: string; justificativa: string; objetivo: string;
  resultados_esperados: string; unidade: string; responsavel_id: number | ""; data_inicio: string;
  data_fim_prevista: string; data_conclusao: string; continuo: boolean; data_revisao: string; situacao: string;
  prioridade: string; ch_total_prevista: string; entregas_previstas: string; links: { titulo: string; url: string }[];
  observacoes: string;
};

function inicial(p?: any): Form {
  return {
    nome: p?.nome ?? "", categoria_id: p?.categoria_id ?? "", descricao: p?.descricao ?? "",
    justificativa: p?.justificativa ?? "", objetivo: p?.objetivo ?? "", resultados_esperados: p?.resultados_esperados ?? "",
    unidade: p?.unidade ?? "", responsavel_id: p?.responsavel_id ?? "", data_inicio: p?.data_inicio ?? "",
    data_fim_prevista: p?.data_fim_prevista ?? "", data_conclusao: p?.data_conclusao ?? "", continuo: !!p?.continuo,
    data_revisao: p?.data_revisao ?? "", situacao: p?.situacao ?? "planejado", prioridade: p?.prioridade ?? "media",
    ch_total_prevista: p?.ch_total_prevista != null ? String(p.ch_total_prevista).replace(".", ",") : "",
    entregas_previstas: p?.entregas_previstas ?? "", links: p?.links ?? [], observacoes: p?.observacoes ?? "",
  };
}

/** Cadastro rápido (campos essenciais) com a opção de detalhar tudo na mesma tela. */
export function ProjetoForm({ projeto, opcoes, onClose, onSalvo }: {
  projeto?: any; opcoes: NrOpcoes; onClose: () => void; onSalvo?: (p: any) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => inicial(projeto));
  const [completo, setCompleto] = useState(!!projeto);
  const [justificativa, setJustificativa] = useState("");
  const [encerrar, setEncerrar] = useState(true);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const mudaSituacao = projeto && projeto.situacao !== f.situacao;
  const encerrando = ["concluido", "cancelado"].includes(f.situacao) && projeto?.situacao !== f.situacao;
  const pedeJustificativa = mudaSituacao && ["suspenso", "concluido", "cancelado"].includes(f.situacao);

  const salvar = useMutation({
    mutationFn: () => {
      const ch = lerNumero(f.ch_total_prevista);
      const dados: any = {
        ...f,
        categoria_id: f.categoria_id || null, responsavel_id: f.responsavel_id || null,
        data_inicio: f.data_inicio || null, data_fim_prevista: f.continuo ? null : f.data_fim_prevista || null,
        data_conclusao: f.data_conclusao || null, data_revisao: f.data_revisao || null,
        ch_total_prevista: ch, links: f.links.filter((l) => l.url.trim()),
      };
      if (projeto) {
        dados.justificativa_alteracao = justificativa || null;
        dados.encerrar_vinculos = encerrando && encerrar;
        return nrApi.editarProjeto(projeto.id, dados);
      }
      return nrApi.criarProjeto(dados);
    },
    onSuccess: (p) => {
      toast.success(projeto ? "Projeto atualizado" : `Projeto ${p.codigo} cadastrado`);
      qc.invalidateQueries({ queryKey: ["nr-projetos"] });
      qc.invalidateQueries({ queryKey: ["nr-projeto"] });
      qc.invalidateQueries({ queryKey: ["nr-dashboard"] });
      qc.invalidateQueries({ queryKey: ["nr-opcoes"] });
      onSalvo?.(p);
      onClose();
    },
    onError: (e) => toast.error(erroApi(e)),
  });

  const ta = "input h-auto min-h-[64px] py-2";
  return (
    <Modal
      titulo={projeto ? `Editar ${projeto.codigo}` : "Novo projeto ou atividade"}
      subtitulo={projeto ? projeto.nome : "Preencha o essencial agora; os demais campos podem ser completados depois."}
      onClose={onClose}
      largura="max-w-3xl"
      rodape={<>
        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn-primary gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
          {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
        </button>
      </>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Campo label="Nome" obrigatorio className="md:col-span-2">
          <input className="input" value={f.nome} onChange={(e) => set("nome", e.target.value.toUpperCase())} autoFocus placeholder="EX.: ESTRUTURAÇÃO DO LABORATÓRIO DE IOT" />
        </Campo>
        <Campo label="Categoria">
          <select className="input" value={f.categoria_id} onChange={(e) => set("categoria_id", e.target.value ? +e.target.value : "")}>
            <option value="">Selecione…</option>
            {opcoes.categorias.filter((c) => c.ativa || c.id === f.categoria_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
        <Campo label="Responsável pelo projeto" dica="Acompanha a equipe, valida horas e aprova entregas.">
          <select className="input" value={f.responsavel_id} disabled={!!projeto && !opcoes.eu.gestao}
                  onChange={(e) => set("responsavel_id", e.target.value ? +e.target.value : "")}>
            <option value="">Selecione…</option>
            {opcoes.usuarios.filter((u) => PERFIS_RESPONSAVEL.includes(u.perfil) || u.id === f.responsavel_id).map((u) => (
              <option key={u.id} value={u.id}>{u.nome.toUpperCase()}</option>
            ))}
          </select>
        </Campo>
        <Campo label="Situação">
          <select className="input" value={f.situacao} onChange={(e) => set("situacao", e.target.value)}>
            {opcoes.situacoes_projeto.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Campo>
        <Campo label="Prioridade">
          <select className="input" value={f.prioridade} onChange={(e) => set("prioridade", e.target.value)}>
            {opcoes.prioridades.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Campo>
        <div className="md:col-span-2">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.continuo} onChange={(e) => set("continuo", e.target.checked)} />
            Atividade contínua (sem prazo final — exige data de revisão da alocação)
          </label>
        </div>
        <Campo label="Início" obrigatorio={f.situacao !== "rascunho"}>
          <input type="date" className="input" value={f.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} />
        </Campo>
        {f.continuo ? (
          <Campo label="Revisão da alocação" obrigatorio={f.situacao !== "rascunho"}>
            <input type="date" className="input" value={f.data_revisao} onChange={(e) => set("data_revisao", e.target.value)} />
          </Campo>
        ) : (
          <Campo label="Término previsto" obrigatorio={f.situacao !== "rascunho"}>
            <input type="date" className="input" value={f.data_fim_prevista} onChange={(e) => set("data_fim_prevista", e.target.value)} />
          </Campo>
        )}
        {(projeto || ["concluido", "cancelado"].includes(f.situacao)) && (
          <Campo label="Conclusão efetiva" dica="Preenchida ao concluir ou cancelar; as horas param de contar a partir dela.">
            <input type="date" className="input" value={f.data_conclusao} onChange={(e) => set("data_conclusao", e.target.value)} />
          </Campo>
        )}
        <Campo label="Unidade ou setor responsável">
          <input className="input" list="nr-unidades" value={f.unidade} onChange={(e) => set("unidade", e.target.value)} />
          <datalist id="nr-unidades">{opcoes.unidades.map((u) => <option key={u} value={u} />)}</datalist>
        </Campo>

        {pedeJustificativa && (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 md:col-span-2">
            <Campo label="Justificativa da mudança de situação" obrigatorio>
              <textarea className={ta} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            </Campo>
            {encerrando && (
              <label className="inline-flex items-center gap-2 text-sm text-amber-900">
                <input type="checkbox" checked={encerrar} onChange={(e) => setEncerrar(e.target.checked)} />
                Encerrar as alocações dos professores na data de conclusão (propostas são canceladas)
              </label>
            )}
          </div>
        )}
        {projeto && !pedeJustificativa && (
          <Campo label="Justificativa da alteração (opcional)" className="md:col-span-2">
            <input className="input" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
          </Campo>
        )}
      </div>

      {!completo ? (
        <button className="mt-4 text-sm font-medium text-primary hover:underline" onClick={() => setCompleto(true)}>
          + Detalhar descrição, justificativa, objetivos, entregas previstas e links
        </button>
      ) : (
        <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-2">
          <Campo label="Descrição" className="md:col-span-2"><textarea className={ta} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} /></Campo>
          <Campo label="Justificativa institucional" className="md:col-span-2"><textarea className={ta} value={f.justificativa} onChange={(e) => set("justificativa", e.target.value)} /></Campo>
          <Campo label="Objetivo"><textarea className={ta} value={f.objetivo} onChange={(e) => set("objetivo", e.target.value)} /></Campo>
          <Campo label="Resultados esperados"><textarea className={ta} value={f.resultados_esperados} onChange={(e) => set("resultados_esperados", e.target.value)} /></Campo>
          <Campo label="Carga horária total prevista (h)" dica="Quando aplicável.">
            <input className="input" inputMode="decimal" value={f.ch_total_prevista} onChange={(e) => set("ch_total_prevista", e.target.value)} />
          </Campo>
          <Campo label="Entregas previstas (resumo)" dica="As entregas com prazo e validação são cadastradas no projeto.">
            <textarea className={ta} value={f.entregas_previstas} onChange={(e) => set("entregas_previstas", e.target.value)} />
          </Campo>
          <div className="space-y-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Links de referência</span>
            {f.links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className="input w-1/3" placeholder="Título" value={l.titulo}
                       onChange={(e) => set("links", f.links.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} />
                <input className="input flex-1" placeholder="https://…" value={l.url}
                       onChange={(e) => set("links", f.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button className="text-gray-400 hover:text-red-600" onClick={() => set("links", f.links.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    onClick={() => set("links", [...f.links, { titulo: "", url: "" }])}>
              <Plus className="h-3.5 w-3.5" /> Adicionar link
            </button>
            <p className="text-[11px] text-gray-400">Arquivos podem ser anexados na página do projeto depois de salvar.</p>
          </div>
          <Campo label="Observações" className="md:col-span-2"><textarea className={ta} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Campo>
        </div>
      )}
    </Modal>
  );
}
