"use client";

import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Loader2, Lock, MessageCircle, X } from "lucide-react";
import { crmApi, CrmFiltros } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ALERTA_INFO, CrmOpcoes, STATUS_STYLE, TEMPERATURA_STYLE, data, formatarTelefone, hojeISO, linkWhatsApp,
} from "@/lib/crm";

const LOTE = 30;
const MAX_POR_COLUNA = 200;

// Cor da faixa no topo de cada coluna
const FAIXA: Record<string, string> = {
  novo: "bg-blue-500",
  tentativa_contato: "bg-indigo-500",
  em_atendimento: "bg-violet-500",
  aguardando_retorno: "bg-amber-500",
  aguardando_decisao: "bg-orange-500",
  matriculado: "bg-green-600",
  perdido: "bg-gray-400",
  sem_retorno: "bg-gray-300",
};

type Movimento = { lead: any; para: string };
type Pendente = { lead: any; para: string; dados: Record<string, string> };

interface Props {
  filtros: CrmFiltros;          // filtros da tela, sem o de status
  opcoes: CrmOpcoes;
  isAdmin: boolean;
  onAbrirLead: (id: number) => void;
}

export function KanbanLeads({ filtros, opcoes, isAdmin, onAbrirLead }: Props) {
  const qc = useQueryClient();
  const [limites, setLimites] = useState<Record<string, number>>({});
  const [movendo, setMovendo] = useState<Record<number, Movimento>>({});
  const [arrastando, setArrastando] = useState<any | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);

  const colunas = opcoes.status;
  const consultas = useQueries({
    queries: colunas.map((s) => {
      const limite = limites[s.value] ?? LOTE;
      return {
        queryKey: ["crm-leads", "kanban", s.value, filtros, limite],
        queryFn: () => crmApi.leads({
          ...filtros, status: s.value, page_size: limite,
          ordem: s.value.startsWith("aguardando") ? "retorno" : "recentes",
        }),
        placeholderData: (prev: any) => prev,
        refetchInterval: 60_000,
      };
    }),
  });

  // Itens por coluna já com os movimentos otimistas aplicados
  const porColuna = useMemo(() => {
    const out: Record<string, { itens: any[]; total: number; carregando: boolean }> = {};
    colunas.forEach((s, i) => {
      const q = consultas[i];
      const saindo = (q.data?.items ?? []).filter((l: any) => !movendo[l.id] || movendo[l.id].para === s.value);
      const entrando = Object.values(movendo)
        .filter((m) => m.para === s.value && !saindo.some((l: any) => l.id === m.lead.id))
        .map((m) => ({ ...m.lead, status: s.value }));
      const delta = entrando.length - ((q.data?.items ?? []).length - saindo.length);
      out[s.value] = { itens: [...entrando, ...saindo], total: (q.data?.total ?? 0) + delta, carregando: q.isLoading };
    });
    return out;
  }, [consultas, colunas, movendo]);

  function podeMover(lead: any) {
    return isAdmin || !lead.finalizado;
  }

  async function salvar(lead: any, para: string, extra: Record<string, string | null> = {}) {
    setMovendo((m) => ({ ...m, [lead.id]: { lead, para } }));
    try {
      await crmApi.atualizar(lead.id, { status: para, ...extra });
      const destino = opcoes.status.find((s) => s.value === para)?.label;
      toast.success(`${lead.nome} → ${destino}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["crm-leads"] }),
        qc.invalidateQueries({ queryKey: ["crm-dashboard"] }),
        qc.invalidateQueries({ queryKey: ["crm-lead", lead.id] }),
      ]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Não foi possível mover o lead");
    } finally {
      setMovendo((m) => { const n = { ...m }; delete n[lead.id]; return n; });
    }
  }

  /** Abre o formulário quando o status de destino exige informação; senão salva direto. */
  function mover(lead: any, para: string) {
    if (lead.status === para) return;
    if (!podeMover(lead)) {
      toast.error("Lead finalizado: somente o administrador pode alterar.");
      return;
    }
    if (para === "perdido") {
      return setPendente({ lead, para, dados: { motivo_perda: lead.motivo_perda ?? "", motivo_perda_comentario: lead.motivo_perda_comentario ?? "" } });
    }
    if (para === "matriculado") {
      return setPendente({ lead, para, dados: {
        data_matricula: lead.data_matricula ?? hojeISO(),
        vencimento_primeira_parcela: lead.vencimento_primeira_parcela ?? "",
      } });
    }
    if (para === "aguardando_retorno") {
      return setPendente({ lead, para, dados: { proximo_retorno: lead.proximo_retorno ?? "" } });
    }
    salvar(lead, para);
  }

  function confirmarPendente() {
    if (!pendente) return;
    const d = pendente.dados;
    if (pendente.para === "perdido") {
      if (!d.motivo_perda) return toast.error("Informe o motivo da perda");
      if (d.motivo_perda === "outro" && !d.motivo_perda_comentario?.trim()) return toast.error("Descreva o motivo no comentário");
    }
    if (pendente.para === "matriculado" && !d.data_matricula) return toast.error("Informe a data da matrícula");
    if (pendente.para === "matriculado" && !d.vencimento_primeira_parcela) return toast.error("Informe o vencimento da 1ª parcela");
    if (pendente.para === "aguardando_retorno" && !d.proximo_retorno) return toast.error("Informe a data do próximo retorno");
    const extra = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === "" ? null : v]));
    const { lead, para } = pendente;
    setPendente(null);
    salvar(lead, para, extra);
  }

  return (
    <>
      <div className="-mx-6 overflow-x-auto px-6 pb-2">
        <div className="flex gap-3" style={{ minHeight: "calc(100vh - 330px)" }}>
          {colunas.map((s) => {
            const col = porColuna[s.value];
            const limite = limites[s.value] ?? LOTE;
            const destinoValido = arrastando && arrastando.status !== s.value;
            return (
              <section
                key={s.value}
                onDragOver={(e) => { if (destinoValido) { e.preventDefault(); setSobre(s.value); } }}
                onDragLeave={() => setSobre((v) => (v === s.value ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  setSobre(null);
                  if (arrastando) mover(arrastando, s.value);
                  setArrastando(null);
                }}
                className={cn(
                  "flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border bg-gray-100/70 transition-colors",
                  sobre === s.value && "border-primary bg-blue-50 ring-2 ring-primary/30",
                )}
              >
                <div className={cn("h-1", FAIXA[s.value])} />
                <header className="flex items-center gap-2 px-3 py-2">
                  <h3 className="flex-1 truncate text-sm font-semibold text-gray-800" title={s.label}>{s.label}</h3>
                  {s.final && <span className="text-[10px] uppercase tracking-wide text-gray-400">final</span>}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-700 shadow-sm">{col?.total ?? 0}</span>
                </header>

                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: "calc(100vh - 330px)" }}>
                  {col?.carregando && <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-gray-400" />}
                  {!col?.carregando && col?.itens.length === 0 && (
                    <p className="mt-6 px-2 text-center text-xs text-gray-400">
                      {arrastando ? "Solte aqui" : "Nenhum lead"}
                    </p>
                  )}
                  {col?.itens.map((l) => (
                    <CardLead
                      key={l.id}
                      lead={l}
                      opcoes={opcoes}
                      isAdmin={isAdmin}
                      salvando={!!movendo[l.id]}
                      arrastavel={podeMover(l)}
                      onAbrir={() => onAbrirLead(l.id)}
                      onDragStart={() => setArrastando(l)}
                      onDragEnd={() => { setArrastando(null); setSobre(null); }}
                      onMover={(para) => mover(l, para)}
                    />
                  ))}
                  {col && col.total > col.itens.length && (
                    limite < MAX_POR_COLUNA ? (
                      <button
                        className="w-full rounded-md py-1.5 text-xs font-medium text-primary hover:bg-white"
                        onClick={() => setLimites((m) => ({ ...m, [s.value]: Math.min(limite + LOTE, MAX_POR_COLUNA) }))}
                      >
                        Carregar mais ({col.total - col.itens.length})
                      </button>
                    ) : (
                      <p className="px-2 py-1.5 text-center text-[11px] text-gray-400">
                        Mostrando {col.itens.length} de {col.total}. Use os filtros ou a lista para ver os demais.
                      </p>
                    )
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {pendente && (
        <ModalDestino pendente={pendente} opcoes={opcoes} onChange={setPendente}
                      onCancelar={() => setPendente(null)} onConfirmar={confirmarPendente} />
      )}
    </>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

function CardLead({ lead, opcoes, isAdmin, salvando, arrastavel, onAbrir, onDragStart, onDragEnd, onMover }: {
  lead: any; opcoes: CrmOpcoes; isAdmin: boolean; salvando: boolean; arrastavel: boolean;
  onAbrir: () => void; onDragStart: () => void; onDragEnd: () => void; onMover: (para: string) => void;
}) {
  const temp = lead.temperatura ? TEMPERATURA_STYLE[lead.temperatura] : null;
  const wa = linkWhatsApp(lead.telefone);
  const urgente = ["novo_sem_atendimento", "retorno_atrasado", "parcela_vencida"].some((a) => lead.alertas.includes(a));
  const hoje = lead.alertas.includes("retorno_hoje") || lead.alertas.includes("parcela_a_vencer");
  const iniciais = lead.nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase();

  return (
    <article
      draggable={arrastavel && !salvando}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(lead.id)); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onAbrir}
      className={cn(
        "group cursor-pointer rounded-md border border-l-4 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md",
        urgente ? "border-l-red-500" : hoje ? "border-l-amber-400" : "border-l-transparent",
        arrastavel && "active:cursor-grabbing",
        salvando && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
          {iniciais}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900" title={lead.nome}>{lead.nome}</p>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500">
            <span className="truncate">{formatarTelefone(lead.telefone)}</span>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                 className="text-green-600 hover:text-green-700" title="Abrir no WhatsApp">
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
        {salvando ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : !arrastavel && <Lock className="h-3.5 w-3.5 text-gray-300" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {temp && (
          <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold", temp.cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", temp.dot)} />{temp.label}
          </span>
        )}
        {lead.alertas.filter((a: string) => a !== "sem_vendedor" || isAdmin).map((a: string) => (
          <span key={a} className={cn("rounded px-1.5 py-px text-[10px] font-semibold", ALERTA_INFO[a]?.cls)}>{ALERTA_INFO[a]?.label}</span>
        ))}
      </div>

      {(lead.oferta_label || lead.campanha_nome) && (
        <p className="mt-1.5 truncate text-[11px] text-gray-500" title={lead.oferta_label ?? lead.campanha_nome}>
          {lead.oferta_label ?? lead.campanha_nome}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
        {lead.proximo_retorno && !lead.finalizado ? (
          <span className={cn("inline-flex items-center gap-1",
            lead.alertas.includes("retorno_atrasado") ? "font-semibold text-red-600" : hoje ? "font-semibold text-amber-700" : "")}>
            <CalendarClock className="h-3 w-3" /> {data(lead.proximo_retorno)}
          </span>
        ) : (
          <span>{new Date(lead.recebido_em).toLocaleDateString("pt-BR")}</span>
        )}
        {lead.status === "matriculado" && (lead.parcela_paga_em ? (
          <span className="font-semibold text-green-700" title={`1ª parcela paga em ${data(lead.parcela_paga_em)}`}>✓ Paga</span>
        ) : lead.vencimento_primeira_parcela ? (
          <span className={cn(lead.alertas.includes("parcela_vencida") ? "font-semibold text-red-600"
            : lead.alertas.includes("parcela_a_vencer") ? "font-semibold text-amber-700" : "")}>
            1ª parc. {data(lead.vencimento_primeira_parcela)}
          </span>
        ) : null)}
        {isAdmin && lead.vendedor_nome && <span className="ml-auto truncate">{lead.vendedor_nome.split(" ")[0]}</span>}
      </div>

      {/* Alternativa ao arrastar (celular / teclado) */}
      {arrastavel && (
        <select
          aria-label={`Mover ${lead.nome} para outra etapa`}
          className="mt-2 w-full rounded border border-gray-200 bg-gray-50 px-1.5 py-1 text-[11px] text-gray-600 md:hidden"
          value=""
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { if (e.target.value) onMover(e.target.value); }}
        >
          <option value="">Mover para…</option>
          {opcoes.status.filter((s) => s.value !== lead.status).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      )}
    </article>
  );
}

// ── Formulário do status de destino ─────────────────────────────────────────

function ModalDestino({ pendente, opcoes, onChange, onCancelar, onConfirmar }: {
  pendente: Pendente; opcoes: CrmOpcoes; onChange: (p: Pendente) => void; onCancelar: () => void; onConfirmar: () => void;
}) {
  const set = (k: string, v: string) => onChange({ ...pendente, dados: { ...pendente.dados, [k]: v } });
  const d = pendente.dados;
  const titulo = { perdido: "Marcar como perdido", matriculado: "Confirmar matrícula", aguardando_retorno: "Agendar retorno" }[pendente.para];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancelar}>
      <div className="w-full max-w-sm rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold text-gray-800">{titulo}</h3>
            <p className="text-xs text-gray-500">{pendente.lead.nome}</p>
          </div>
          <button onClick={onCancelar} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm">
          {pendente.para === "perdido" && (
            <>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Motivo da perda *</span>
                <select className="input" autoFocus value={d.motivo_perda} onChange={(e) => set("motivo_perda", e.target.value)}>
                  <option value="">Selecione...</option>
                  {opcoes.motivos_perda.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Comentário{d.motivo_perda === "outro" && " *"}
                </span>
                <textarea className="input h-auto min-h-[60px] py-2" value={d.motivo_perda_comentario}
                          onChange={(e) => set("motivo_perda_comentario", e.target.value)} />
              </label>
            </>
          )}
          {pendente.para === "matriculado" && (
            <>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data da matrícula *</span>
                <input type="date" className="input" max={hojeISO()} value={d.data_matricula} onChange={(e) => set("data_matricula", e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Vencimento da 1ª parcela *</span>
                <input type="date" className="input" autoFocus value={d.vencimento_primeira_parcela}
                       onChange={(e) => set("vencimento_primeira_parcela", e.target.value)} />
              </label>
              <p className="text-xs text-gray-500">A matrícula só é efetivada após o pagamento. Registre o pagamento na ficha do lead.</p>
            </>
          )}
          {pendente.para === "aguardando_retorno" && (
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Data do próximo retorno *</span>
              <input type="date" className="input" autoFocus min={hojeISO()} value={d.proximo_retorno} onChange={(e) => set("proximo_retorno", e.target.value)} />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button className="btn-primary" onClick={onConfirmar}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}
