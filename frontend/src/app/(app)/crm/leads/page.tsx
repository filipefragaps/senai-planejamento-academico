"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search, Plus, Upload, Download, MessageCircle, ChevronLeft, ChevronRight, Loader2, UserPlus, Shuffle, X, List, SquareKanban,
} from "lucide-react";
import { crmApi, downloadBlob, CrmFiltros } from "@/lib/api";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { LeadDrawer } from "@/components/crm/lead-drawer";
import { OfertaPicker } from "@/components/crm/oferta-picker";
import { KanbanLeads } from "@/components/crm/kanban";
import {
  ALERTA_INFO, STATUS_STYLE, TEMPERATURA_STYLE, CrmOpcoes, data, dataHora, formatarTelefone, linkWhatsApp,
} from "@/lib/crm";

const PAGE_SIZE = 50;
const EM_ABERTO = "novo,tentativa_contato,em_atendimento,aguardando_retorno,aguardando_decisao";

type Filtros = {
  busca: string; campanha_id: string; status: string; temperatura: string; vendedor_id: string;
  data_inicio: string; data_fim: string; alerta: string; ordem: string;
};

const FILTROS_VAZIOS: Filtros = {
  busca: "", campanha_id: "", status: "", temperatura: "", vendedor_id: "",
  data_inicio: "", data_fim: "", alerta: "", ordem: "recentes",
};

function paraApi(f: Filtros, busca: string): CrmFiltros {
  return {
    ...(busca && { busca }),
    ...(f.campanha_id && { campanha_id: +f.campanha_id }),
    ...(f.status && { status: f.status }),
    ...(f.temperatura && { temperatura: f.temperatura }),
    ...(f.vendedor_id !== "" && { vendedor_id: +f.vendedor_id }),
    ...(f.data_inicio && { data_inicio: f.data_inicio }),
    ...(f.data_fim && { data_fim: f.data_fim }),
    ...(f.alerta && { alerta: f.alerta }),
  };
}

// ── Modal: novo lead manual ──────────────────────────────────────────────────

function NovoLeadModal({ opcoes, campanhas, isAdmin, onClose, onCreated }: {
  opcoes: CrmOpcoes; campanhas: any[]; isAdmin: boolean; onClose: () => void; onCreated: (id: number) => void;
}) {
  const [f, setF] = useState({ nome: "", telefone: "", email: "", campanha: "", temperatura: "", observacoes: "", vendedor_id: "" });
  const [oferta, setOferta] = useState<{ id: number | null; label: string | null }>({ id: null, label: null });
  const criar = useMutation({
    mutationFn: () => crmApi.criar({
      nome: f.nome.trim(), telefone: f.telefone || null, email: f.email || null, campanha: f.campanha || null,
      temperatura: f.temperatura || null, observacoes: f.observacoes || null, oferta_id: oferta.id,
      ...(isAdmin && f.vendedor_id && { vendedor_id: +f.vendedor_id }),
    }),
    onSuccess: (lead) => { toast.success("Lead cadastrado"); onCreated(lead.id); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao cadastrar lead"),
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="font-semibold text-gray-800">Novo lead</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-xs text-gray-500">Use para contatos que chegaram fora dos formulários da Meta (ligação, indicação, WhatsApp).</p>
          <input className="input" placeholder="Nome completo *" value={f.nome} onChange={set("nome")} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Telefone" value={f.telefone} onChange={set("telefone")} />
            <input className="input" placeholder="E-mail" type="email" value={f.email} onChange={set("email")} />
          </div>
          <input className="input" list="crm-campanhas" placeholder="Campanha / origem" value={f.campanha} onChange={set("campanha")} />
          <datalist id="crm-campanhas">{campanhas.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
          <OfertaPicker value={oferta.id} label={oferta.label} onChange={(id, label) => setOferta({ id, label })} placeholder="Curso de interesse (opcional)" />
          <div className="grid grid-cols-2 gap-3">
            <select className="input" value={f.temperatura} onChange={set("temperatura")}>
              <option value="">Temperatura...</option>
              {opcoes.temperaturas.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {isAdmin && (
              <select className="input" value={f.vendedor_id} onChange={set("vendedor_id")}>
                <option value="">Distribuir automaticamente</option>
                {opcoes.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            )}
          </div>
          <textarea className="input h-auto min-h-[60px] py-2" placeholder="Observações" value={f.observacoes} onChange={set("observacoes")} />
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!f.nome.trim() || criar.isPending} onClick={() => criar.mutate()}>
            {criar.isPending ? "Salvando..." : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

function LeadsPageInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const me = useCurrentUser();
  const isAdmin = me?.perfil === "admin";

  const [filtros, setFiltros] = useState<Filtros>(() => ({
    ...FILTROS_VAZIOS,
    status: params.get("status") ?? "",
    alerta: params.get("alerta") ?? "",
    temperatura: params.get("temperatura") ?? "",
    campanha_id: params.get("campanha_id") ?? "",
  }));
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [busca, setBusca] = useState("");
  const [page, setPage] = useState(1);
  const [leadAberto, setLeadAberto] = useState<number | null>(params.get("lead") ? +params.get("lead")! : null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [vendedorLote, setVendedorLote] = useState("");
  const [exportando, setExportando] = useState(false);
  const [visao, setVisao] = useState<"lista" | "quadro">("quadro");
  const inputCsv = useRef<HTMLInputElement>(null);

  // Visualização preferida fica salva no navegador
  useEffect(() => {
    try {
      const v = localStorage.getItem("crm_leads_visao");
      if (v === "lista" || v === "quadro") setVisao(v);
    } catch {}
  }, []);
  function trocarVisao(v: "lista" | "quadro") {
    setVisao(v);
    try { localStorage.setItem("crm_leads_visao", v); } catch {}
  }

  useEffect(() => {
    const t = setTimeout(() => setBusca(buscaDigitada.trim()), 350);
    return () => clearTimeout(t);
  }, [buscaDigitada]);
  useEffect(() => { setPage(1); setSelecionados(new Set()); }, [filtros, busca]);

  const { data: opcoes } = useQuery<CrmOpcoes>({ queryKey: ["crm-opcoes"], queryFn: crmApi.opcoes, staleTime: 300_000 });
  const { data: campanhas = [] } = useQuery({ queryKey: ["crm-campanhas"], queryFn: crmApi.campanhas, staleTime: 60_000 });

  const apiFiltros = useMemo(() => paraApi(filtros, busca), [filtros, busca]);
  const { data: lista, isLoading, isFetching } = useQuery({
    queryKey: ["crm-leads", apiFiltros, filtros.ordem, page],
    queryFn: () => crmApi.leads({ ...apiFiltros, ordem: filtros.ordem, page, page_size: PAGE_SIZE }),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    enabled: visao === "lista",
  });
  const { status: _s, ...filtrosQuadro } = apiFiltros;

  // Contadores dos atalhos de alerta (mesmos filtros, sem o filtro de alerta)
  const { alerta: _a, ...semAlerta } = apiFiltros;
  const { data: resumo } = useQuery({
    queryKey: ["crm-dashboard", "contadores", semAlerta],
    queryFn: () => crmApi.dashboard(semAlerta),
    refetchInterval: 60_000,
  });

  const atribuir = useMutation({
    mutationFn: () => crmApi.atribuir([...selecionados], vendedorLote === "0" ? null : +vendedorLote),
    onSuccess: (r) => {
      toast.success(`${r.atribuidos} lead(s) atribuído(s)`);
      setSelecionados(new Set());
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao atribuir"),
  });

  const distribuir = useMutation({
    mutationFn: crmApi.distribuir,
    onSuccess: (r) => {
      toast.success(`${r.distribuidos} lead(s) distribuído(s) entre os vendedores`);
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao distribuir"),
  });

  const importar = useMutation({
    mutationFn: (f: File) => crmApi.importarCsv(f),
    onSuccess: (r) => {
      toast.success(`${r.inseridos} lead(s) importado(s)` + (r.duplicados ? ` · ${r.duplicados} já existiam` : ""));
      if (r.total_erros) toast.warning(`${r.total_erros} linha(s) ignorada(s): ${r.erros.slice(0, 3).join("; ")}`);
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
      qc.invalidateQueries({ queryKey: ["crm-campanhas"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao importar CSV"),
  });

  async function exportar() {
    setExportando(true);
    try {
      const res = await crmApi.exportar(apiFiltros);
      downloadBlob(res.data, "leads.xlsx");
    } catch {
      toast.error("Erro ao exportar");
    } finally {
      setExportando(false);
    }
  }

  const set = (k: keyof Filtros) => (e: any) => setFiltros((f) => ({ ...f, [k]: e.target.value }));
  const itens: any[] = lista?.items ?? [];
  const total = lista?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtrosAtivos = JSON.stringify({ ...filtros, ordem: "" }) !== JSON.stringify({ ...FILTROS_VAZIOS, ordem: "" }) || !!buscaDigitada;

  const atalhos = [
    { key: "", label: "Todos", n: resumo?.total },
    { key: "novo_sem_atendimento", label: "Novos sem atendimento", n: resumo?.novos_sem_atendimento },
    { key: "retorno_atrasado", label: "Retorno atrasado", n: resumo?.retornos_atrasados },
    { key: "retorno_hoje", label: "Retorno hoje", n: resumo?.retornos_hoje },
    { key: "parcela_a_vencer", label: "1ª parcela a vencer", n: resumo?.parcelas_a_vencer },
    { key: "parcela_vencida", label: "1ª parcela vencida", n: resumo?.parcelas_vencidas },
    ...(isAdmin ? [{ key: "sem_vendedor", label: "Sem vendedor", n: resumo?.sem_vendedor }] : []),
  ];

  function toggle(id: number) {
    setSelecionados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div>
      <PageHeader title="Leads" description={isAdmin ? "Todos os contatos recebidos das campanhas" : "Seus contatos para atendimento"}>
        <div className="inline-flex rounded-md border bg-white p-0.5" role="group" aria-label="Visualização">
          {([["quadro", "Quadro", SquareKanban], ["lista", "Lista", List]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => trocarVisao(v)} aria-pressed={visao === v}
                    className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium",
                      visao === v ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-50")}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <>
            <input ref={inputCsv} type="file" accept=".csv,text/csv" className="hidden"
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) importar.mutate(f); e.target.value = ""; }} />
            <button className="btn-secondary gap-1.5" disabled={importar.isPending} onClick={() => inputCsv.current?.click()}
                    title="CSV exportado da Central de Leads ou do Gerenciador de Anúncios da Meta">
              {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar CSV
            </button>
          </>
        )}
        <button className="btn-secondary gap-1.5" disabled={exportando} onClick={exportar}>
          <Download className="h-4 w-4" /> {exportando ? "Exportando..." : "Excel"}
        </button>
        <button className="btn-primary gap-1.5" onClick={() => setNovoAberto(true)}>
          <Plus className="h-4 w-4" /> Novo lead
        </button>
      </PageHeader>

      {/* Atalhos de alerta */}
      <div className="mb-3 flex flex-wrap gap-2">
        {atalhos.map((a) => (
          <button
            key={a.key || "todos"}
            onClick={() => setFiltros((f) => ({ ...f, alerta: a.key }))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtros.alerta === a.key ? "border-primary bg-primary text-white" : "bg-white text-gray-600 hover:bg-gray-50",
            )}
          >
            {a.label}
            {a.n != null && (
              <span className={cn("rounded-full px-1.5 tabular-nums",
                filtros.alerta === a.key ? "bg-white/20" : a.key && a.n > 0 ? ALERTA_INFO[a.key]?.cls : "bg-gray-100")}>
                {a.n}
              </span>
            )}
          </button>
        ))}
        {isAdmin && (resumo?.sem_vendedor ?? 0) > 0 && (opcoes?.vendedores.length ?? 0) > 0 && (
          <button className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  disabled={distribuir.isPending} onClick={() => distribuir.mutate()}>
            <Shuffle className="h-3.5 w-3.5" /> Distribuir {resumo.sem_vendedor} sem vendedor
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="card mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 lg:grid-cols-8">
        <div className="relative col-span-2">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <input className="input pl-8" placeholder="Nome, telefone ou e-mail" value={buscaDigitada} onChange={(e) => setBuscaDigitada(e.target.value)} />
        </div>
        <select className="input" value={filtros.campanha_id} onChange={set("campanha_id")}>
          <option value="">Todas as campanhas</option>
          {(campanhas as any[]).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <select className="input disabled:opacity-50" value={visao === "quadro" ? "" : filtros.status} onChange={set("status")}
                disabled={visao === "quadro"} title={visao === "quadro" ? "No quadro, cada coluna é um status" : undefined}>
          <option value="">Todos os status</option>
          <option value={EM_ABERTO}>Em aberto (não finalizados)</option>
          {opcoes?.status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select className="input" value={filtros.temperatura} onChange={set("temperatura")}>
          <option value="">Temperatura</option>
          {opcoes?.temperaturas.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          <option value="sem">Sem classificação</option>
        </select>
        {isAdmin ? (
          <select className="input" value={filtros.vendedor_id} onChange={set("vendedor_id")}>
            <option value="">Todos os vendedores</option>
            <option value="0">Sem vendedor</option>
            {opcoes?.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
        ) : (
          <select className="input" value={filtros.ordem} onChange={set("ordem")}>
            <option value="recentes">Mais recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="retorno">Próximo retorno</option>
          </select>
        )}
        <input type="date" className="input" title="Recebido a partir de" value={filtros.data_inicio} onChange={set("data_inicio")} />
        <input type="date" className="input" title="Recebido até" value={filtros.data_fim} onChange={set("data_fim")} />
      </div>

      <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
        {visao === "lista" && <span>{total} lead(s){isFetching && !isLoading && " · atualizando..."}</span>}
        {visao === "quadro" && <span className="hidden md:inline">Arraste os cards entre as colunas para atualizar o status.</span>}
        {isAdmin && visao === "lista" && (
          <select className="input h-7 w-auto py-0 text-xs" value={filtros.ordem} onChange={set("ordem")}>
            <option value="recentes">Mais recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="retorno">Próximo retorno</option>
          </select>
        )}
        {filtrosAtivos && (
          <button className="text-primary hover:underline" onClick={() => { setFiltros(FILTROS_VAZIOS); setBuscaDigitada(""); }}>
            Limpar filtros
          </button>
        )}
      </div>

      {visao === "quadro" && opcoes && (
        <KanbanLeads filtros={filtrosQuadro} opcoes={opcoes} isAdmin={isAdmin} onAbrirLead={setLeadAberto} />
      )}

      {visao === "lista" && <>
      {/* Atribuição em lote */}
      {isAdmin && selecionados.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-sm">
          <UserPlus className="h-4 w-4 text-blue-700" />
          <span className="text-blue-800">{selecionados.size} selecionado(s) — atribuir a</span>
          <select className="input h-8 w-auto py-0" value={vendedorLote} onChange={(e) => setVendedorLote(e.target.value)}>
            <option value="">Selecione...</option>
            <option value="0">Sem vendedor</option>
            {opcoes?.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
          </select>
          <button className="btn-primary h-8 py-0" disabled={!vendedorLote || atribuir.isPending} onClick={() => atribuir.mutate()}>Atribuir</button>
          <button className="text-xs text-gray-500 hover:underline" onClick={() => setSelecionados(new Set())}>Cancelar</button>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              {isAdmin && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" className="rounded"
                         checked={itens.length > 0 && itens.every((l) => selecionados.has(l.id))}
                         onChange={(e) => setSelecionados(e.target.checked ? new Set(itens.map((l) => l.id)) : new Set())} />
                </th>
              )}
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Telefone</th>
              <th className="hidden px-3 py-2 lg:table-cell">Campanha</th>
              <th className="hidden px-3 py-2 md:table-cell">Entrada</th>
              <th className="px-3 py-2">Temperatura</th>
              <th className="px-3 py-2">Status</th>
              <th className="hidden px-3 py-2 md:table-cell">Últ. contato</th>
              <th className="px-3 py-2">Próx. retorno</th>
              {isAdmin && <th className="hidden px-3 py-2 xl:table-cell">Vendedor</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            )}
            {!isLoading && itens.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">
                {filtrosAtivos ? "Nenhum lead para os filtros selecionados." : isAdmin ? "Nenhum lead ainda. Importe um CSV da Meta ou cadastre manualmente." : "Nenhum lead atribuído a você no momento."}
              </td></tr>
            )}
            {itens.map((l) => {
              const urgente = ["novo_sem_atendimento", "retorno_atrasado", "parcela_vencida"].some((a) => l.alertas.includes(a));
              const hoje = l.alertas.includes("retorno_hoje") || l.alertas.includes("parcela_a_vencer");
              const temp = l.temperatura ? TEMPERATURA_STYLE[l.temperatura] : null;
              const wa = linkWhatsApp(l.telefone);
              return (
                <tr
                  key={l.id}
                  onClick={() => setLeadAberto(l.id)}
                  className={cn(
                    "cursor-pointer border-b last:border-0 hover:bg-gray-50",
                    urgente && "bg-red-50/60 hover:bg-red-50",
                    !urgente && hoje && "bg-amber-50/60 hover:bg-amber-50",
                    l.finalizado && "text-gray-500",
                  )}
                >
                  {isAdmin && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="rounded" checked={selecionados.has(l.id)} onChange={() => toggle(l.id)} />
                    </td>
                  )}
                  <td className={cn("px-3 py-2 border-l-4", urgente ? "border-l-red-500" : hoje ? "border-l-amber-400" : "border-l-transparent")}>
                    <p className="font-medium text-gray-900">{l.nome}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {l.alertas.map((a: string) => (
                        <span key={a} className={cn("rounded px-1.5 py-px text-[10px] font-semibold", ALERTA_INFO[a]?.cls)}>{ALERTA_INFO[a]?.label}</span>
                      ))}
                      {l.oferta_label && <span className="truncate text-[11px] text-gray-400 max-w-[220px]" title={l.oferta_label}>{l.oferta_label}</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      {formatarTelefone(l.telefone)}
                      {wa && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                           className="text-green-600 hover:text-green-700" title="Abrir no WhatsApp">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="hidden max-w-[200px] truncate px-3 py-2 text-gray-600 lg:table-cell" title={l.campanha_nome ?? ""}>{l.campanha_nome ?? "—"}</td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-gray-600 md:table-cell">{dataHora(l.recebido_em)}</td>
                  <td className="px-3 py-2">
                    {temp ? (
                      <span className={cn("badge border gap-1", temp.cls)}><span className={cn("h-1.5 w-1.5 rounded-full", temp.dot)} />{temp.label}</span>
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2"><span className={cn("badge border whitespace-nowrap", STATUS_STYLE[l.status])}>{l.status_label}</span></td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-gray-600 md:table-cell">{data(l.ultimo_contato)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2",
                    l.alertas.includes("retorno_atrasado") ? "font-semibold text-red-600" : hoje ? "font-semibold text-amber-700" : "text-gray-600")}>
                    {data(l.proximo_retorno)}
                  </td>
                  {isAdmin && <td className="hidden px-3 py-2 text-gray-600 xl:table-cell">{l.vendedor_nome ?? <span className="text-gray-400">—</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <button className="btn-secondary h-8 px-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <span className="text-gray-600">Página {page} de {paginas}</span>
          <button className="btn-secondary h-8 px-2" disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
      </>}

      {leadAberto && opcoes && (
        <LeadDrawer leadId={leadAberto} opcoes={opcoes} isAdmin={isAdmin} onClose={() => setLeadAberto(null)} />
      )}
      {novoAberto && opcoes && (
        <NovoLeadModal
          opcoes={opcoes} campanhas={campanhas as any[]} isAdmin={isAdmin}
          onClose={() => setNovoAberto(false)}
          onCreated={(id) => {
            setNovoAberto(false);
            qc.invalidateQueries({ queryKey: ["crm-leads"] });
            qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
            qc.invalidateQueries({ queryKey: ["crm-campanhas"] });
            setLeadAberto(id);
          }}
        />
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={null}>
      <LeadsPageInner />
    </Suspense>
  );
}
