"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, ClipboardList, Download, FileUp, Loader2, Pencil, Plus, Send, Trash2,
  Undo2, Paperclip, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NrOpcoes, SITUACAO_APONTAMENTO_STYLE, SITUACAO_ENTREGA_STYLE, dataBR, erroApi, horas, isoLocal, lerNumero, mesAtual, nrApi,
} from "@/lib/nao-regencia";
import { Campo, Modal, Selo, Tabela, Vazio } from "./ui";

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  ["nr-apontamentos", "nr-entregas", "nr-dashboard", "nr-projeto", "nr-projetos", "nr-visao", "nr-validar"].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k] }));
}

// ── Apontamento ───────────────────────────────────────────────────────────────

export function ApontamentoForm({ opcoes, apontamento, projetoFixo, onClose }: {
  opcoes: NrOpcoes; apontamento?: any; projetoFixo?: any; onClose: () => void;
}) {
  const qc = useQueryClient();
  const hoje = isoLocal(new Date());
  const [modo, setModo] = useState<"dia" | "semana">(apontamento && apontamento.data_fim !== apontamento.data_inicio ? "semana" : "dia");
  const [f, setF] = useState({
    projeto_id: apontamento?.projeto_id ?? projetoFixo?.id ?? "",
    professor_id: apontamento?.professor_id ?? opcoes.eu.professor_id ?? "",
    data_inicio: apontamento?.data_inicio ?? hoje, data_fim: apontamento?.data_fim ?? hoje,
    horas: apontamento ? String(apontamento.horas).replace(".", ",") : "", descricao: apontamento?.descricao ?? "",
    entrega_id: apontamento?.entrega_id ?? "", evidencia: apontamento?.evidencia ?? "",
  });
  const [avisos, setAvisos] = useState<string[]>([]);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));

  // Projetos em que posso lançar: vínculos aprovados (professor) ou projetos que gerencio
  const { data: vinculos } = useQuery({
    queryKey: ["nr-vinculos", "meus", f.professor_id],
    queryFn: () => nrApi.vinculos({ professor_id: f.professor_id || undefined, ...mesAtual() }),
    enabled: !!f.professor_id && !projetoFixo,
  });
  const projetos = useMemo(() => {
    if (projetoFixo) return [{ id: projetoFixo.id, nome: projetoFixo.nome, codigo: projetoFixo.codigo }];
    const m = new Map<number, any>();
    (vinculos ?? []).filter((v: any) => ["aprovada", "encerrada"].includes(v.situacao)).forEach((v: any) => m.set(v.projeto_id, { id: v.projeto_id, nome: v.projeto_nome, codigo: v.projeto_codigo }));
    return Array.from(m.values());
  }, [vinculos, projetoFixo]);
  const { data: projeto } = useQuery({
    queryKey: ["nr-projeto", f.projeto_id],
    queryFn: () => nrApi.projeto(+f.projeto_id),
    enabled: !!f.projeto_id,
  });
  const equipe = projetoFixo
    ? (projetoFixo.vinculos ?? []).filter((v: any) => ["aprovada", "encerrada"].includes(v.situacao))
    : [];
  const podeEscolherProfessor = !!projetoFixo?.pode_gerir;

  const salvar = useMutation({
    mutationFn: (enviar: boolean) => {
      const dados = {
        projeto_id: f.projeto_id || null, professor_id: f.professor_id || null, data_inicio: f.data_inicio,
        data_fim: modo === "dia" ? f.data_inicio : f.data_fim, horas: lerNumero(f.horas), descricao: f.descricao,
        entrega_id: f.entrega_id || null, evidencia: f.evidencia || null, enviar,
      };
      return apontamento ? nrApi.editarApontamento(apontamento.id, dados) : nrApi.criarApontamento(dados);
    },
    onSuccess: (r, enviar) => {
      invalidar(qc);
      if (r.avisos?.length) {
        setAvisos(r.avisos);
        toast.warning(enviar ? "Horas enviadas, com avisos para o gestor" : "Rascunho salvo, com avisos");
      } else {
        toast.success(enviar ? "Horas enviadas para validação" : "Rascunho salvo");
        onClose();
      }
    },
    onError: (e) => toast.error(erroApi(e)),
  });

  return (
    <Modal titulo={apontamento ? "Editar apontamento" : "Registrar atividade"} subtitulo="Horas informadas só contam como validadas após a aprovação do gestor."
           onClose={onClose}
           rodape={avisos.length ? <button className="btn-primary" onClick={onClose}>Entendi</button> : <>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-secondary gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate(false)}>Salvar rascunho</button>
             <button className="btn-primary gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate(true)}>
               {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar para validação
             </button>
           </>}>
      {avisos.length > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Registro salvo. Atenção:</p>
          <ul className="list-disc space-y-1 pl-5">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {podeEscolherProfessor && !apontamento && (
            <Campo label="Professor" obrigatorio className="md:col-span-2">
              <select className="input" value={f.professor_id} onChange={(e) => set("professor_id", e.target.value ? +e.target.value : "")}>
                <option value="">Selecione…</option>
                {equipe.map((v: any) => <option key={v.id} value={v.professor_id}>{v.professor_nome}</option>)}
              </select>
            </Campo>
          )}
          <Campo label="Projeto ou atividade" obrigatorio className="md:col-span-2">
            <select className="input" value={f.projeto_id} disabled={!!projetoFixo || !!apontamento} onChange={(e) => set("projeto_id", e.target.value ? +e.target.value : "")}>
              <option value="">{projetos.length ? "Selecione…" : "Nenhum vínculo aprovado"}</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
            </select>
          </Campo>
          <div className="md:col-span-2">
            <div className="inline-flex rounded-md border p-0.5 text-xs">
              {(["dia", "semana"] as const).map((m) => (
                <button key={m} onClick={() => setModo(m)}
                        className={cn("rounded px-3 py-1 font-medium", modo === m ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-100")}>
                  {m === "dia" ? "Por dia" : "Lançamento semanal"}
                </button>
              ))}
            </div>
          </div>
          <Campo label={modo === "dia" ? "Data" : "De"} obrigatorio>
            <input type="date" className="input" max={hoje} value={f.data_inicio} onChange={(e) => set("data_inicio", e.target.value)} />
          </Campo>
          {modo === "semana" ? (
            <Campo label="Até" obrigatorio dica="Máximo de 7 dias por lançamento.">
              <input type="date" className="input" max={hoje} value={f.data_fim} onChange={(e) => set("data_fim", e.target.value)} />
            </Campo>
          ) : <div />}
          <Campo label="Horas realizadas" obrigatorio>
            <input className="input" inputMode="decimal" value={f.horas} onChange={(e) => set("horas", e.target.value)} placeholder="Ex.: 2,5" />
          </Campo>
          <Campo label="Entrega relacionada">
            <select className="input" value={f.entrega_id} onChange={(e) => set("entrega_id", e.target.value ? +e.target.value : "")}>
              <option value="">Nenhuma</option>
              {(projeto?.entregas ?? []).map((e: any) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
            </select>
          </Campo>
          <Campo label="Descrição da atividade" obrigatorio className="md:col-span-2">
            <textarea className="input h-auto min-h-[72px] py-2" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </Campo>
          <Campo label="Evidência ou observação" className="md:col-span-2">
            <input className="input" value={f.evidencia} onChange={(e) => set("evidencia", e.target.value)} placeholder="Link, local do arquivo ou observação" />
          </Campo>
        </div>
      )}
    </Modal>
  );
}

export function TabelaApontamentos({ itens, selecionaveis, selecionados, setSelecionados, onEditar, mostrarProjeto = true, mostrarProfessor = true }: {
  itens: any[]; selecionaveis?: boolean; selecionados?: number[]; setSelecionados?: (ids: number[]) => void;
  onEditar?: (a: any) => void; mostrarProjeto?: boolean; mostrarProfessor?: boolean;
}) {
  const qc = useQueryClient();
  const excluir = useMutation({
    mutationFn: (id: number) => nrApi.excluirApontamento(id),
    onSuccess: () => { toast.success("Apontamento excluído"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const enviar = useMutation({
    mutationFn: (id: number) => nrApi.enviarApontamento(id),
    onSuccess: () => { toast.success("Enviado para validação"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const sel = new Set(selecionados ?? []);
  return (
    <Tabela
      cabecalho={<>
        {selecionaveis && (
          <th className="w-8 px-3 py-2">
            <input type="checkbox" checked={itens.length > 0 && itens.every((a) => sel.has(a.id))}
                   onChange={(e) => setSelecionados?.(e.target.checked ? itens.map((a) => a.id) : [])} />
          </th>
        )}
        <th className="px-3 py-2">Data</th>
        {mostrarProfessor && <th className="px-3 py-2">Professor</th>}
        {mostrarProjeto && <th className="px-3 py-2">Projeto</th>}
        <th className="px-3 py-2">Atividade</th>
        <th className="px-3 py-2 text-right">Horas</th>
        <th className="px-3 py-2">Situação</th>
        <th className="px-3 py-2" />
      </>}
      vazio={itens.length === 0 ? <Vazio icone={ClipboardList} titulo="Nenhum apontamento" /> : undefined}
    >
      {itens.map((a) => (
        <tr key={a.id} className="align-top hover:bg-gray-50">
          {selecionaveis && (
            <td className="px-3 py-2">
              <input type="checkbox" checked={sel.has(a.id)}
                     onChange={(e) => setSelecionados?.(e.target.checked ? [...sel, a.id] : Array.from(sel).filter((x) => x !== a.id))} />
            </td>
          )}
          <td className="whitespace-nowrap px-3 py-2">
            {dataBR(a.data_inicio)}{a.data_fim !== a.data_inicio && <span className="text-gray-500"> – {dataBR(a.data_fim)}</span>}
          </td>
          {mostrarProfessor && <td className="px-3 py-2">{a.professor_nome}</td>}
          {mostrarProjeto && (
            <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${a.projeto_id}`}>{a.projeto_codigo} {a.projeto_nome}</Link></td>
          )}
          <td className="max-w-sm px-3 py-2">
            <p className="text-gray-800">{a.descricao}</p>
            {a.evidencia && <p className="text-xs text-gray-500">Evidência: {a.evidencia}</p>}
            {a.parecer && <p className={cn("text-xs", a.situacao === "devolvido" ? "text-amber-800" : "text-gray-500")}>Parecer: {a.parecer}</p>}
          </td>
          <td className="px-3 py-2 text-right tabular-nums">{horas(a.horas)}</td>
          <td className="px-3 py-2">
            <Selo cls={SITUACAO_APONTAMENTO_STYLE[a.situacao]}>{a.situacao_label}</Selo>
            {a.validado_por && <p className="mt-0.5 text-[11px] text-gray-400">por {a.validado_por}</p>}
          </td>
          <td className="whitespace-nowrap px-3 py-2 text-right">
            {onEditar && ["rascunho", "devolvido"].includes(a.situacao) && (
              <span className="inline-flex gap-2">
                <button className="text-gray-400 hover:text-primary" title="Editar" onClick={() => onEditar(a)}><Pencil className="h-4 w-4" /></button>
                <button className="text-gray-400 hover:text-violet-700" title="Enviar para validação" onClick={() => enviar.mutate(a.id)}><Send className="h-4 w-4" /></button>
                <button className="text-gray-400 hover:text-red-600" title="Excluir" onClick={() => confirm("Excluir este apontamento?") && excluir.mutate(a.id)}><Trash2 className="h-4 w-4" /></button>
              </span>
            )}
          </td>
        </tr>
      ))}
    </Tabela>
  );
}

/** Validação em lote: aprovar ou devolver horas enviadas. */
export function ValidacaoHoras({ projetoId }: { projetoId?: number }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["nr-validar", projetoId],
    queryFn: () => nrApi.apontamentos({ para_validar: true, projeto_id: projetoId }),
  });
  const [sel, setSel] = useState<number[]>([]);
  const [devolver, setDevolver] = useState(false);
  const [parecer, setParecer] = useState("");
  const validar = useMutation({
    mutationFn: (aprovar: boolean) => nrApi.validarApontamentos(sel, aprovar, parecer || undefined),
    onSuccess: (_, aprovar) => {
      toast.success(aprovar ? "Horas validadas" : "Horas devolvidas ao professor");
      setSel([]); setParecer(""); setDevolver(false); invalidar(qc);
    },
    onError: (e) => toast.error(erroApi(e)),
  });
  const total = data.filter((a: any) => sel.includes(a.id)).reduce((s: number, a: any) => s + a.horas, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="mr-auto">
          <h3 className="text-sm font-semibold text-gray-800">Horas aguardando validação</h3>
          <p className="text-xs text-gray-500">Suas próprias horas não aparecem aqui: outro gestor autorizado as valida.</p>
        </div>
        {sel.length > 0 && (
          <>
            <span className="text-xs text-gray-600">{sel.length} selecionado(s) · {horas(total)}</span>
            <button className="btn-secondary h-8 gap-1 px-3 text-xs" onClick={() => setDevolver(true)}><Undo2 className="h-3.5 w-3.5" /> Devolver</button>
            <button className="btn-primary h-8 gap-1 px-3 text-xs" disabled={validar.isPending} onClick={() => validar.mutate(true)}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Validar
            </button>
          </>
        )}
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : <TabelaApontamentos itens={data} selecionaveis selecionados={sel} setSelecionados={setSel} mostrarProjeto={!projetoId} />}
      {devolver && (
        <Modal titulo="Devolver horas para ajuste" onClose={() => setDevolver(false)}
               rodape={<>
                 <button className="btn-secondary" onClick={() => setDevolver(false)}>Cancelar</button>
                 <button className="btn-primary" disabled={!parecer.trim() || validar.isPending} onClick={() => validar.mutate(false)}>Devolver</button>
               </>}>
          <Campo label="Motivo da devolução" obrigatorio>
            <textarea className="input h-auto min-h-[80px] py-2" value={parecer} onChange={(e) => setParecer(e.target.value)} />
          </Campo>
        </Modal>
      )}
    </div>
  );
}

// ── Entregas ──────────────────────────────────────────────────────────────────

export function EntregaForm({ projeto, entrega, onClose }: { projeto: any; entrega?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const equipe = (projeto.vinculos ?? []).filter((v: any) => ["proposta", "aprovada"].includes(v.situacao));
  const [f, setF] = useState({
    titulo: entrega?.titulo ?? "", descricao: entrega?.descricao ?? "", prazo: entrega?.prazo ?? "",
    criterio_aceite: entrega?.criterio_aceite ?? "", peso: entrega?.peso != null ? String(entrega.peso).replace(".", ",") : "",
    responsaveis: (entrega?.responsaveis ?? []).map((r: any) => r.id) as number[],
  });
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const dados = { ...f, prazo: f.prazo || null, peso: lerNumero(f.peso) };
      return entrega ? nrApi.editarEntrega(entrega.id, dados) : nrApi.criarEntrega(projeto.id, dados);
    },
    onSuccess: () => { toast.success(entrega ? "Entrega atualizada" : "Entrega cadastrada"); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <Modal titulo={entrega ? "Editar entrega" : "Nova entrega"} subtitulo={`${projeto.codigo} · ${projeto.nome}`} onClose={onClose}
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-primary gap-1.5" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
               {salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
             </button>
           </>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Campo label="Título" obrigatorio className="md:col-span-2">
          <input className="input" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex.: Relatório técnico, protótipo, plano de curso…" />
        </Campo>
        <Campo label="Prazo"><input type="date" className="input" value={f.prazo} onChange={(e) => set("prazo", e.target.value)} /></Campo>
        <Campo label="Peso no progresso" dica="Vazio = 1. O progresso usa as entregas aprovadas.">
          <input className="input" inputMode="decimal" value={f.peso} onChange={(e) => set("peso", e.target.value)} />
        </Campo>
        <Campo label="Descrição" className="md:col-span-2"><textarea className="input h-auto min-h-[60px] py-2" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} /></Campo>
        <Campo label="Critério de aceite" className="md:col-span-2"><textarea className="input h-auto min-h-[60px] py-2" value={f.criterio_aceite} onChange={(e) => set("criterio_aceite", e.target.value)} /></Campo>
        <div className="space-y-1 md:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Responsáveis</span>
          {equipe.length === 0 ? <p className="text-xs text-gray-500">Vincule professores ao projeto para indicar responsáveis.</p> : (
            <div className="flex flex-wrap gap-2">
              {equipe.map((v: any) => (
                <label key={v.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                  f.responsaveis.includes(v.professor_id) ? "border-primary bg-primary/10 text-primary" : "text-gray-600")}>
                  <input type="checkbox" className="hidden" checked={f.responsaveis.includes(v.professor_id)}
                         onChange={(e) => set("responsaveis", e.target.checked ? [...f.responsaveis, v.professor_id] : f.responsaveis.filter((x) => x !== v.professor_id))} />
                  {v.professor_nome}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Enviar entrega para validação, com evidências (texto, links e arquivos). */
export function SubmeterEntregaModal({ entrega, onClose }: { entrega: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [evid, setEvid] = useState(entrega.evidencias ?? "");
  const [links, setLinks] = useState<{ titulo: string; url: string }[]>(entrega.links ?? []);
  const [enviando, setEnviando] = useState(false);
  const submeter = useMutation({
    mutationFn: () => nrApi.submeterEntrega(entrega.id, { evidencias: evid, links: links.filter((l) => l.url.trim()) }),
    onSuccess: () => { toast.success("Entrega enviada para validação"); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });
  async function anexar(files: FileList | null) {
    if (!files?.length) return;
    setEnviando(true);
    try {
      for (const f of Array.from(files)) await nrApi.enviarAnexo(entrega.projeto_id, f, { entrega_id: entrega.id });
      toast.success("Arquivo(s) anexado(s)");
      invalidar(qc);
    } catch (e) {
      toast.error(erroApi(e, "Erro ao anexar"));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal titulo="Enviar entrega para validação" subtitulo={entrega.titulo} onClose={onClose}
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-primary gap-1.5" disabled={submeter.isPending} onClick={() => submeter.mutate()}>
               {submeter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
             </button>
           </>}>
      <div className="space-y-3">
        {entrega.criterio_aceite && (
          <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-600"><b>Critério de aceite:</b> {entrega.criterio_aceite}</p>
        )}
        <Campo label="Descrição das evidências"><textarea className="input h-auto min-h-[80px] py-2" value={evid} onChange={(e) => setEvid(e.target.value)} /></Campo>
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Links</span>
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input className="input w-1/3" placeholder="Título" value={l.titulo} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} />
              <input className="input flex-1" placeholder="https://…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              <button className="text-gray-400 hover:text-red-600" onClick={() => setLinks(links.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setLinks([...links, { titulo: "", url: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Adicionar link
          </button>
        </div>
        <div>
          <label className="btn-secondary h-8 cursor-pointer gap-1.5 px-3 text-xs">
            {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Anexar arquivo (até 5 MB)
            <input type="file" multiple className="hidden" onChange={(e) => anexar(e.target.files)} />
          </label>
          {(entrega.anexos ?? []).length > 0 && <AnexosLista anexos={entrega.anexos} />}
        </div>
      </div>
    </Modal>
  );
}

export function AvaliarEntregaModal({ entrega, onClose }: { entrega: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [parecer, setParecer] = useState("");
  const avaliar = useMutation({
    mutationFn: (aprovar: boolean) => nrApi.avaliarEntrega(entrega.id, aprovar, parecer || undefined),
    onSuccess: (_, aprovar) => { toast.success(aprovar ? "Entrega aprovada" : "Entrega devolvida para ajustes"); invalidar(qc); onClose(); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <Modal titulo="Avaliar entrega" subtitulo={entrega.titulo} onClose={onClose}
           rodape={<>
             <button className="btn-secondary" onClick={onClose}>Cancelar</button>
             <button className="btn-secondary gap-1" disabled={avaliar.isPending || !parecer.trim()} onClick={() => avaliar.mutate(false)}>
               <Undo2 className="h-4 w-4" /> Devolver para ajustes
             </button>
             <button className="btn-primary gap-1" disabled={avaliar.isPending} onClick={() => avaliar.mutate(true)}>
               <CheckCircle2 className="h-4 w-4" /> Aprovar
             </button>
           </>}>
      <div className="space-y-3 text-sm">
        {entrega.criterio_aceite && <p><b>Critério de aceite:</b> {entrega.criterio_aceite}</p>}
        <div className="rounded-md bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Evidências</p>
          <p className="mt-1 whitespace-pre-wrap text-gray-800">{entrega.evidencias || "—"}</p>
          {(entrega.links ?? []).map((l: any, i: number) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> {l.titulo || l.url}
            </a>
          ))}
          {(entrega.anexos ?? []).length > 0 && <AnexosLista anexos={entrega.anexos} />}
        </div>
        <p className="text-xs text-gray-500">A aprovação da entrega não valida automaticamente as horas do projeto: elas são validadas à parte.</p>
        <Campo label="Parecer (obrigatório para devolver)">
          <textarea className="input h-auto min-h-[70px] py-2" value={parecer} onChange={(e) => setParecer(e.target.value)} />
        </Campo>
      </div>
    </Modal>
  );
}

export function AnexosLista({ anexos, podeExcluir }: { anexos: any[]; podeExcluir?: boolean }) {
  const qc = useQueryClient();
  const excluir = useMutation({
    mutationFn: (id: number) => nrApi.excluirAnexo(id),
    onSuccess: () => { toast.success("Anexo excluído"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  return (
    <ul className="mt-2 space-y-1">
      {anexos.map((a) => (
        <li key={a.id} className="flex items-center gap-2 text-xs">
          <Paperclip className="h-3.5 w-3.5 text-gray-400" />
          <button className="text-primary hover:underline" onClick={() => nrApi.baixarAnexo(a.id, a.nome).catch((e) => toast.error(erroApi(e, "Erro ao baixar")))}>
            {a.nome}
          </button>
          <span className="text-gray-400">{(a.tamanho / 1024).toFixed(0)} KB</span>
          <Download className="h-3 w-3 text-gray-300" />
          {podeExcluir && (
            <button className="ml-auto text-gray-400 hover:text-red-600" onClick={() => confirm(`Excluir ${a.nome}?`) && excluir.mutate(a.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function TabelaEntregas({ itens, opcoes, projeto, mostrarProjeto = true, onEditar }: {
  itens: any[]; opcoes: NrOpcoes; projeto?: any; mostrarProjeto?: boolean; onEditar?: (e: any) => void;
}) {
  const qc = useQueryClient();
  const [submeter, setSubmeter] = useState<any>(null);
  const [avaliar, setAvaliar] = useState<any>(null);
  const excluir = useMutation({
    mutationFn: (id: number) => nrApi.excluirEntrega(id),
    onSuccess: () => { toast.success("Entrega excluída"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const andamento = useMutation({
    mutationFn: (id: number) => nrApi.editarEntrega(id, { situacao: "em_andamento" }),
    onSuccess: () => { toast.success("Entrega em andamento"); invalidar(qc); },
    onError: (e) => toast.error(erroApi(e)),
  });
  const eu = opcoes.eu;
  const gestor = (e: any) => eu.gestao || eu.coordena.includes(e.projeto_id);
  const responsavel = (e: any) => e.responsaveis.some((r: any) => r.id === eu.professor_id);
  return (
    <>
      <Tabela
        cabecalho={<>
          <th className="px-3 py-2">Entrega</th>
          {mostrarProjeto && <th className="px-3 py-2">Projeto</th>}
          <th className="px-3 py-2">Responsáveis</th>
          <th className="px-3 py-2">Prazo</th>
          <th className="px-3 py-2 text-right">Peso</th>
          <th className="px-3 py-2">Situação</th>
          <th className="px-3 py-2" />
        </>}
        vazio={itens.length === 0 ? <Vazio icone={ClipboardCheck} titulo="Nenhuma entrega cadastrada"
          texto="Sem entregas, o progresso do projeto fica como “não definido”. Cadastre as entregas que justificam a alocação." /> : undefined}
      >
        {itens.map((e) => (
          <tr key={e.id} className="align-top hover:bg-gray-50">
            <td className="max-w-xs px-3 py-2">
              <p className="font-medium text-gray-900">{e.titulo}</p>
              {e.criterio_aceite && <p className="text-xs text-gray-500">Aceite: {e.criterio_aceite}</p>}
              {e.parecer && <p className={cn("text-xs", e.situacao === "devolvida" ? "text-amber-800" : "text-gray-500")}>Parecer: {e.parecer}</p>}
              {(e.evidencias || e.links?.length || e.anexos?.length) ? (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-primary">Ver evidências</summary>
                  <p className="mt-1 whitespace-pre-wrap text-gray-700">{e.evidencias}</p>
                  {e.links?.map((l: any, i: number) => (
                    <a key={i} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3" /> {l.titulo || l.url}
                    </a>
                  ))}
                  {e.anexos?.length > 0 && <AnexosLista anexos={e.anexos} />}
                </details>
              ) : null}
            </td>
            {mostrarProjeto && (
              <td className="px-3 py-2"><Link className="hover:underline" href={`/nao-regencia/projetos/${e.projeto_id}`}>{e.projeto_codigo} {e.projeto_nome}</Link></td>
            )}
            <td className="px-3 py-2 text-gray-600">{e.responsaveis.map((r: any) => r.nome).join(", ") || "—"}</td>
            <td className={cn("whitespace-nowrap px-3 py-2", e.atrasada && "font-semibold text-red-700")}>
              {dataBR(e.prazo)}{e.atrasada && <p className="flex items-center gap-1 text-[11px]"><AlertTriangle className="h-3 w-3" /> atrasada</p>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{e.peso ?? 1}</td>
            <td className="px-3 py-2">
              <Selo cls={SITUACAO_ENTREGA_STYLE[e.situacao]}>{e.situacao_label}</Selo>
              {e.data_aprovacao && <p className="mt-0.5 text-[11px] text-gray-400">em {dataBR(e.data_aprovacao)}</p>}
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right">
              <span className="inline-flex items-center gap-2">
                {(responsavel(e) || gestor(e)) && e.situacao === "nao_iniciada" && (
                  <button className="text-xs text-gray-600 hover:text-primary hover:underline" onClick={() => andamento.mutate(e.id)}>Iniciar</button>
                )}
                {(responsavel(e) || gestor(e)) && ["nao_iniciada", "em_andamento", "devolvida"].includes(e.situacao) && (
                  <button className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline" onClick={() => setSubmeter(e)}>
                    <Send className="h-3.5 w-3.5" /> Enviar
                  </button>
                )}
                {gestor(e) && e.situacao === "submetida" && (
                  <button className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline" onClick={() => setAvaliar(e)}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Avaliar
                  </button>
                )}
                {gestor(e) && onEditar && e.situacao !== "aprovada" && (
                  <button className="text-gray-400 hover:text-primary" title="Editar" onClick={() => onEditar(e)}><Pencil className="h-4 w-4" /></button>
                )}
                {gestor(e) && e.situacao !== "aprovada" && (
                  <button className="text-gray-400 hover:text-red-600" title="Excluir" onClick={() => confirm("Excluir esta entrega?") && excluir.mutate(e.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </span>
            </td>
          </tr>
        ))}
      </Tabela>
      {submeter && <SubmeterEntregaModal entrega={submeter} onClose={() => setSubmeter(null)} />}
      {avaliar && <AvaliarEntregaModal entrega={avaliar} onClose={() => setAvaliar(null)} />}
    </>
  );
}

/** Aba "Entregas e apontamentos". */
export function EntregasApontamentos({ opcoes }: { opcoes: NrOpcoes }) {
  const eu = opcoes.eu;
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<any>(null);
  const [fEnt, setFEnt] = useState({ situacao: "", atrasadas: false });
  const [fAp, setFAp] = useState({ situacao: "" });
  const gestorAlgum = eu.gestao || eu.coordena.length > 0;

  const { data: meus = [] } = useQuery({
    queryKey: ["nr-apontamentos", "meus", eu.professor_id, fAp.situacao],
    queryFn: () => nrApi.apontamentos({ professor_id: eu.professor_id, situacao: fAp.situacao }),
    enabled: !!eu.professor_id,
  });
  const { data: entregas = [] } = useQuery({
    queryKey: ["nr-entregas", fEnt],
    queryFn: () => nrApi.entregas({ situacao: fEnt.situacao, atrasadas: fEnt.atrasadas || undefined }),
  });

  return (
    <div className="space-y-5">
      {eu.professor_id ? (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <div className="mr-auto">
              <h3 className="text-sm font-semibold text-gray-800">Minhas atividades</h3>
              <p className="text-xs text-gray-500">Registre por dia ou em um lançamento semanal. Rascunhos não contam; enviados aguardam validação.</p>
            </div>
            <select className="input h-8 w-auto py-0 text-xs" value={fAp.situacao} onChange={(e) => setFAp({ situacao: e.target.value })}>
              <option value="">Todas as situações</option>
              {opcoes.situacoes_apontamento.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn-primary h-8 gap-1 px-3 text-xs" onClick={() => setNovo(true)}><Plus className="h-3.5 w-3.5" /> Registrar atividade</button>
          </div>
          <TabelaApontamentos itens={meus} mostrarProfessor={false} onEditar={setEditar} />
        </div>
      ) : !gestorAlgum ? (
        <div className="card"><Vazio icone={ClipboardList} titulo="Seu usuário não está ligado a um professor"
          texto="Para registrar atividades, o e-mail do seu usuário precisa ser o mesmo do cadastro em Professores." /></div>
      ) : null}

      {gestorAlgum && <ValidacaoHoras />}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="mr-auto">
            <h3 className="text-sm font-semibold text-gray-800">Entregas</h3>
            <p className="text-xs text-gray-500">Novas entregas são cadastradas na página de cada projeto.</p>
          </div>
          <select className="input h-8 w-auto py-0 text-xs" value={fEnt.situacao} onChange={(e) => setFEnt({ ...fEnt, situacao: e.target.value })}>
            <option value="">Todas as situações</option>
            {opcoes.situacoes_entrega.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={fEnt.atrasadas} onChange={(e) => setFEnt({ ...fEnt, atrasadas: e.target.checked })} /> Só atrasadas
          </label>
        </div>
        <TabelaEntregas itens={entregas} opcoes={opcoes} />
      </div>

      {novo && <ApontamentoForm opcoes={opcoes} onClose={() => setNovo(false)} />}
      {editar && <ApontamentoForm opcoes={opcoes} apontamento={editar} onClose={() => setEditar(null)} />}
    </div>
  );
}
