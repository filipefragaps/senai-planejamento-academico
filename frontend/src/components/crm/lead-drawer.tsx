"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X, Phone, Mail, MessageCircle, Lock, Save, Loader2, Megaphone, Clock, StickyNote, Trash2,
} from "lucide-react";
import { crmApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ALERTA_INFO, CAMPO_LABEL, STATUS_STYLE, TEMPERATURA_STYLE, CrmOpcoes,
  data, dataHora, formatarTelefone, hojeISO, linkWhatsApp,
} from "@/lib/crm";
import { OfertaPicker } from "./oferta-picker";

interface Props {
  leadId: number;
  opcoes: CrmOpcoes;
  isAdmin: boolean;
  onClose: () => void;
}

type Form = {
  temperatura: string | null;
  status: string;
  ultimo_contato: string;
  proximo_retorno: string;
  motivo_perda: string;
  motivo_perda_comentario: string;
  data_matricula: string;
  vencimento_primeira_parcela: string;
  parcela_paga_em: string;
  oferta_id: number | null;
  observacoes: string;
  vendedor_id: number | null;
};

function formDoLead(l: any): Form {
  return {
    temperatura: l.temperatura,
    status: l.status,
    ultimo_contato: l.ultimo_contato ?? "",
    proximo_retorno: l.proximo_retorno ?? "",
    motivo_perda: l.motivo_perda ?? "",
    motivo_perda_comentario: l.motivo_perda_comentario ?? "",
    data_matricula: l.data_matricula ?? "",
    vencimento_primeira_parcela: l.vencimento_primeira_parcela ?? "",
    parcela_paga_em: l.parcela_paga_em ?? "",
    oferta_id: l.oferta_id,
    observacoes: l.observacoes ?? "",
    vendedor_id: l.vendedor_id,
  };
}

function Campo({ label, children, obrigatorio }: { label: string; children: React.ReactNode; obrigatorio?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}{obrigatorio && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}

export function LeadDrawer({ leadId, opcoes, isAdmin, onClose }: Props) {
  const qc = useQueryClient();
  const { data: lead, isLoading } = useQuery({
    queryKey: ["crm-lead", leadId],
    queryFn: () => crmApi.lead(leadId),
  });

  const [form, setForm] = useState<Form | null>(null);
  const [ofertaLabel, setOfertaLabel] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (lead) {
      setForm(formDoLead(lead));
      setOfertaLabel(lead.oferta_label);
    }
  }, [lead]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const bloqueado = !!lead?.finalizado && !isAdmin;
  // Num lead Matriculado o vendedor ainda controla a 1ª parcela
  const parcelaEditavel = !bloqueado || lead?.status === "matriculado";

  const alteracoes = useMemo(() => {
    if (!lead || !form) return {};
    const original = formDoLead(lead);
    const diff: Record<string, any> = {};
    (Object.keys(form) as (keyof Form)[]).forEach((k) => {
      if (k === "vendedor_id" && !isAdmin) return;
      if (form[k] !== original[k]) diff[k] = form[k] === "" ? null : form[k];
    });
    return diff;
  }, [lead, form, isAdmin]);
  const temAlteracoes = Object.keys(alteracoes).length > 0;

  function aplicarResultado(atualizado: any) {
    qc.setQueryData(["crm-lead", leadId], atualizado);
    qc.invalidateQueries({ queryKey: ["crm-leads"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  }

  const salvar = useMutation({
    mutationFn: (payload: any) => crmApi.atualizar(leadId, payload),
    onSuccess: (atualizado, payload) => {
      aplicarResultado(atualizado);
      if (payload.nota) setNota("");
      toast.success(payload.nota && Object.keys(payload).length === 1 ? "Anotação registrada" : "Lead atualizado");
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao salvar"),
  });

  const excluir = useMutation({
    mutationFn: () => crmApi.excluir(leadId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
      toast.success("Lead excluído");
      onClose();
    },
    onError: () => toast.error("Erro ao excluir lead"),
  });

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function salvarAlteracoes() {
    if (!form) return;
    // Validações espelhando o backend, para feedback imediato
    if (form.status === "perdido" && !form.motivo_perda) return toast.error("Informe o motivo da perda");
    if (form.status === "perdido" && form.motivo_perda === "outro" && !form.motivo_perda_comentario.trim())
      return toast.error("Descreva o motivo no comentário");
    if (form.status === "matriculado" && !form.data_matricula) return toast.error("Informe a data da matrícula");
    if (form.status === "matriculado" && !form.vencimento_primeira_parcela) return toast.error("Informe o vencimento da 1ª parcela");
    if (form.status === "aguardando_retorno" && !form.proximo_retorno) return toast.error("Informe a data do próximo retorno");
    salvar.mutate(alteracoes);
  }

  const wa = linkWhatsApp(lead?.telefone);
  const extras = Object.entries(lead?.dados_extras ?? {});

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        {/* Cabeçalho */}
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{lead?.nome ?? "Carregando..."}</h2>
            {lead && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className={cn("badge border", STATUS_STYLE[lead.status])}>{lead.status_label}</span>
                {lead.alertas.map((a: string) => (
                  <span key={a} className={cn("badge", ALERTA_INFO[a]?.cls)}>{ALERTA_INFO[a]?.label ?? a}</span>
                ))}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading || !lead || !form ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
            {/* Contato */}
            <section className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                )}
                {lead.telefone && (
                  <a href={`tel:+${lead.telefone}`} className="btn-secondary gap-1.5">
                    <Phone className="h-4 w-4" /> {formatarTelefone(lead.telefone)}
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="btn-secondary gap-1.5 max-w-full">
                    <Mail className="h-4 w-4 shrink-0" /> <span className="truncate">{lead.email}</span>
                  </a>
                )}
              </div>
            </section>

            {/* Origem */}
            <section className="rounded-lg border bg-gray-50 p-3 text-sm">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <Megaphone className="h-3.5 w-3.5" /> Origem
              </p>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <dt className="text-gray-500">Recebido em</dt><dd>{dataHora(lead.recebido_em)}</dd>
                <dt className="text-gray-500">Campanha</dt><dd>{lead.campanha_nome ?? "—"}</dd>
                {lead.conjunto_anuncio && <><dt className="text-gray-500">Conjunto</dt><dd>{lead.conjunto_anuncio}</dd></>}
                {lead.anuncio && <><dt className="text-gray-500">Anúncio</dt><dd>{lead.anuncio}</dd></>}
                {lead.formulario && <><dt className="text-gray-500">Formulário</dt><dd>{lead.formulario}</dd></>}
                {lead.plataforma && <><dt className="text-gray-500">Plataforma</dt><dd>{lead.plataforma === "ig" ? "Instagram" : lead.plataforma === "fb" ? "Facebook" : lead.plataforma}</dd></>}
                <dt className="text-gray-500">Entrada</dt><dd className="capitalize">{lead.origem === "csv" ? "Importação CSV" : lead.origem}</dd>
                {extras.map(([k, v]) => (
                  <Fragment key={k}><dt className="text-gray-500 break-words">{k.replace(/_/g, " ")}</dt><dd>{String(v)}</dd></Fragment>
                ))}
              </dl>
            </section>

            {bloqueado && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                Lead finalizado. Somente o administrador pode corrigir os dados; você ainda pode registrar anotações{lead.status === "matriculado" ? " e o pagamento da 1ª parcela" : ""}.
              </div>
            )}

            {/* Acompanhamento */}
            <section className="space-y-4">
              <Campo label="Temperatura">
                <div className="flex gap-2">
                  {opcoes.temperaturas.map((t) => {
                    const st = TEMPERATURA_STYLE[t.value];
                    const ativo = form.temperatura === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        disabled={bloqueado}
                        onClick={() => set("temperatura", ativo ? null : t.value)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
                          ativo ? st.cls + " ring-2 ring-offset-1 ring-current" : "bg-white text-gray-600 hover:bg-gray-50",
                        )}
                      >
                        <span className={cn("h-2 w-2 rounded-full", st.dot)} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </Campo>

              <Campo label="Status do atendimento">
                <select className="input" value={form.status} disabled={bloqueado} onChange={(e) => set("status", e.target.value)}>
                  <optgroup label="Em andamento">
                    {opcoes.status.filter((s) => !s.final).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </optgroup>
                  <optgroup label="Resultado final">
                    {opcoes.status.filter((s) => s.final).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </optgroup>
                </select>
              </Campo>

              {form.status === "perdido" && (
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <Campo label="Motivo da perda" obrigatorio>
                    <select className="input" value={form.motivo_perda} disabled={bloqueado} onChange={(e) => set("motivo_perda", e.target.value)}>
                      <option value="">Selecione...</option>
                      {opcoes.motivos_perda.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Comentário" obrigatorio={form.motivo_perda === "outro"}>
                    <textarea className="input h-auto min-h-[60px] py-2" value={form.motivo_perda_comentario} disabled={bloqueado}
                              onChange={(e) => set("motivo_perda_comentario", e.target.value)} placeholder="Detalhe o motivo (opcional, obrigatório para 'Outro')" />
                  </Campo>
                </div>
              )}

              {form.status === "matriculado" && (
                <div className={cn("space-y-3 rounded-lg border p-3",
                  lead.alertas.includes("parcela_vencida") ? "border-red-300 bg-red-50/50"
                    : lead.alertas.includes("parcela_a_vencer") ? "border-amber-300 bg-amber-50/50"
                    : form.parcela_paga_em ? "border-green-300 bg-green-50/50" : "border-gray-200")}>
                  <Campo label="Data da matrícula" obrigatorio>
                    <input type="date" className="input" value={form.data_matricula} disabled={bloqueado} max={hojeISO()}
                           onChange={(e) => set("data_matricula", e.target.value)} />
                  </Campo>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    1ª parcela <span className="font-normal normal-case text-gray-400">— a matrícula só é efetivada após o pagamento</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Campo label="Vencimento" obrigatorio>
                      <input type="date" className="input bg-white" value={form.vencimento_primeira_parcela} disabled={!parcelaEditavel}
                             onChange={(e) => set("vencimento_primeira_parcela", e.target.value)} />
                    </Campo>
                    <Campo label="Paga em">
                      <input type="date" className="input bg-white" value={form.parcela_paga_em} disabled={!parcelaEditavel} max={hojeISO()}
                             onChange={(e) => set("parcela_paga_em", e.target.value)} />
                    </Campo>
                  </div>
                  {form.parcela_paga_em ? (
                    <p className="text-xs font-medium text-green-700">✓ Matrícula efetivada (1ª parcela paga)</p>
                  ) : (
                    parcelaEditavel && (
                      <button type="button" className="text-xs font-medium text-primary hover:underline"
                              onClick={() => set("parcela_paga_em", hojeISO())}>
                        Marcar como paga hoje
                      </button>
                    )
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Último contato">
                  <input type="date" className="input" value={form.ultimo_contato} disabled={bloqueado} max={hojeISO()}
                         onChange={(e) => set("ultimo_contato", e.target.value)} />
                </Campo>
                <Campo label="Próximo retorno" obrigatorio={form.status === "aguardando_retorno"}>
                  <input type="date" className="input" value={form.proximo_retorno} disabled={bloqueado}
                         onChange={(e) => set("proximo_retorno", e.target.value)} />
                </Campo>
              </div>

              <Campo label="Curso de interesse">
                <OfertaPicker
                  value={form.oferta_id}
                  label={ofertaLabel}
                  disabled={bloqueado}
                  onChange={(id, lbl) => { set("oferta_id", id); setOfertaLabel(lbl); }}
                />
              </Campo>

              {isAdmin && (
                <Campo label="Vendedor responsável">
                  <select className="input" value={form.vendedor_id ?? ""} onChange={(e) => set("vendedor_id", e.target.value ? +e.target.value : null)}>
                    <option value="">Sem vendedor</option>
                    {opcoes.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                    {lead.vendedor_id && !opcoes.vendedores.some((v) => v.id === lead.vendedor_id) && (
                      <option value={lead.vendedor_id}>{lead.vendedor_nome} (inativo)</option>
                    )}
                  </select>
                </Campo>
              )}

              <Campo label="Observações">
                <textarea className="input h-auto min-h-[80px] py-2" value={form.observacoes} disabled={bloqueado}
                          onChange={(e) => set("observacoes", e.target.value)} placeholder="Informações gerais sobre o lead" />
              </Campo>
            </section>

            {/* Anotação rápida */}
            <section className="space-y-2">
              <Campo label="Registrar contato / anotação">
                <textarea className="input h-auto min-h-[60px] py-2" value={nota} onChange={(e) => setNota(e.target.value)}
                          placeholder="Ex.: Liguei, pediu para retornar na sexta à tarde." />
              </Campo>
              <button
                className="btn-secondary gap-1.5"
                disabled={!nota.trim() || salvar.isPending}
                onClick={() => salvar.mutate({ nota })}
              >
                <StickyNote className="h-4 w-4" /> Registrar anotação
              </button>
            </section>

            {/* Histórico */}
            <section>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <Clock className="h-3.5 w-3.5" /> Histórico
              </p>
              <ol className="relative space-y-3 border-l border-gray-200 pl-4">
                {lead.historico.map((h: any) => (
                  <li key={h.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-gray-300" />
                    <p className="text-xs text-gray-400">{dataHora(h.criado_em)} · {h.usuario_nome ?? "Sistema"}</p>
                    {h.campo === "nota" ? (
                      <p className="mt-0.5 whitespace-pre-wrap rounded bg-yellow-50 px-2 py-1 text-gray-800">{h.valor_novo}</p>
                    ) : h.campo === "criacao" || h.campo === "observacoes" ? (
                      <p className="text-gray-700">{h.valor_novo}</p>
                    ) : (
                      <p className="text-gray-700">
                        <span className="font-medium">{CAMPO_LABEL[h.campo] ?? h.campo}:</span>{" "}
                        {h.valor_anterior && <span className="text-gray-400 line-through mr-1">{h.valor_anterior}</span>}
                        {h.valor_novo ?? <span className="text-gray-400">(vazio)</span>}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}

        {/* Rodapé */}
        {lead && form && (
          <div className="flex items-center gap-2 border-t px-5 py-3">
            {isAdmin && (
              <button
                className="mr-auto inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                onClick={() => { if (confirm(`Excluir definitivamente o lead ${lead.nome}? Esta ação não pode ser desfeita.`)) excluir.mutate(); }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Excluir lead
              </button>
            )}
            <button className="btn-secondary ml-auto" onClick={onClose}>Fechar</button>
            <button className="btn-primary gap-1.5" disabled={!temAlteracoes || (bloqueado && !Object.keys(alteracoes).every((k) => k === "vencimento_primeira_parcela" || k === "parcela_paga_em")) || salvar.isPending} onClick={salvarAlteracoes}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar alterações
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
