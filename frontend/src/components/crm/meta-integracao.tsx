"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plug, CheckCircle2, XCircle, AlertTriangle, Copy, RefreshCw, Loader2, Link2, Webhook,
} from "lucide-react";
import { crmApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dataHora } from "@/lib/crm";

const VARIAVEIS: { nome: string; descricao: string }[] = [
  { nome: "META_ACCESS_TOKEN", descricao: "Token do usuário do sistema" },
  { nome: "META_PAGE_ID", descricao: "ID da página do Facebook" },
  { nome: "META_APP_SECRET", descricao: "Chave secreta do app (valida o webhook)" },
  { nome: "META_VERIFY_TOKEN", descricao: "Senha combinada no cadastro do webhook" },
];

const TIPO_ID: Record<string, string> = {
  page: "Página do Facebook",
  user: "perfil de pessoa / usuário (não é uma Página)",
  application: "app da Meta (não é uma Página)",
  business: "portfólio empresarial (não é uma Página)",
  adaccount: "conta de anúncios (não é uma Página)",
  instagramuser: "conta do Instagram (não é uma Página)",
  shadowiguser: "conta do Instagram (não é uma Página)",
};

function erroDe(e: any) {
  return e?.response?.data?.detail || "Falha ao falar com a Meta";
}

export function IntegracaoMeta() {
  const qc = useQueryClient();
  const [teste, setTeste] = useState<any | null>(null);
  const [diagnostico, setDiagnostico] = useState<any | null>(null);

  const { data: st, isLoading } = useQuery({
    queryKey: ["crm-meta-status"],
    queryFn: crmApi.metaStatus,
    refetchInterval: 60_000,
  });

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["crm-meta-status"] });
    qc.invalidateQueries({ queryKey: ["crm-leads"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    qc.invalidateQueries({ queryKey: ["crm-campanhas"] });
  };

  const testar = useMutation({
    mutationFn: crmApi.metaTestar,
    onSuccess: (r) => { setTeste(r); setDiagnostico(null); toast.success(`Conectado à página ${r.pagina?.nome ?? ""}`); },
    onError: (e: any) => {
      setTeste(null);
      setDiagnostico(e?.response?.data?.diagnostico ?? null);
      toast.error(erroDe(e));
      qc.invalidateQueries({ queryKey: ["crm-meta-status"] });
    },
  });
  const assinar = useMutation({
    mutationFn: crmApi.metaAssinar,
    onSuccess: () => { toast.success("Página assinada: os leads novos serão enviados ao CRM"); testar.mutate(); },
    onError: (e) => toast.error(erroDe(e)),
  });
  const cadastrarWebhook = useMutation({
    mutationFn: crmApi.metaWebhookApp,
    onSuccess: (r) => {
      toast.success(`Webhook cadastrado no app ${r.app?.nome ?? ""}`);
      testar.mutate();
    },
    onError: (e) => { toast.error(erroDe(e)); qc.invalidateQueries({ queryKey: ["crm-meta-status"] }); },
  });

  const sincronizar = useMutation({
    mutationFn: (dias?: number) => crmApi.metaSincronizar(dias),
    onSuccess: (r) => {
      toast.success(`Sincronizado: ${r.inseridos} novo(s), ${r.duplicados} já existiam (${r.formularios} formulário(s))`);
      atualizar();
    },
    onError: (e) => { toast.error(erroDe(e)); atualizar(); },
  });

  if (isLoading || !st) {
    return <section className="card flex items-center gap-2 p-5 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando integração...</section>;
  }

  const erroRecente = st.ultimo_erro && (!st.ultima_sincronizacao || st.ultimo_erro.em > st.ultima_sincronizacao);
  const situacao = !st.configurado
    ? { label: "Não configurada", cls: "bg-gray-100 text-gray-600", Icon: XCircle }
    : erroRecente
      ? { label: "Com erro", cls: "bg-red-50 text-red-700", Icon: AlertTriangle }
      : { label: st.ultima_sincronizacao ? "Ativa" : "Configurada", cls: "bg-green-50 text-green-700", Icon: CheckCircle2 };
  const res = st.ultimo_resultado;

  function copiar(texto: string) {
    navigator.clipboard.writeText(texto).then(() => toast.success("Copiado"), () => toast.error("Não foi possível copiar"));
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2"><Plug className="h-5 w-5 text-primary" /></div>
        <div className="flex-1">
          <h2 className="font-semibold text-gray-800">Integração com a Meta (Lead Ads)</h2>
          <p className="text-xs text-gray-500">
            Leads dos formulários do Facebook e Instagram entram sozinhos. Sincronização de segurança a cada {st.sincronizacao_minutos} min.
          </p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", situacao.cls)}>
          <situacao.Icon className="h-3.5 w-3.5" /> {situacao.label}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Variáveis e webhook */}
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Variáveis no servidor (Railway)</p>
            <ul className="space-y-1 text-sm">
              {VARIAVEIS.map((v) => {
                const ok = st.variaveis?.[v.nome];
                return (
                  <li key={v.nome} className="flex items-center gap-2">
                    {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="h-4 w-4 shrink-0 text-gray-300" />}
                    <code className="rounded bg-gray-100 px-1 text-xs">{v.nome}</code>
                    <span className="truncate text-xs text-gray-500">{v.descricao}</span>
                  </li>
                );
              })}
            </ul>
            {!st.configurado && (
              <p className="mt-2 text-xs text-gray-500">
                Cadastre os valores em <strong>Railway → backend → Variables</strong> e faça um novo deploy. Os valores nunca aparecem nesta tela.
              </p>
            )}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              <Webhook className="h-3.5 w-3.5" /> Endereço do webhook (cadastrar no app da Meta)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded border bg-gray-50 px-2 py-1.5 text-xs" title={st.webhook_url}>{st.webhook_url}</code>
              <button className="btn-secondary h-8 px-2" title="Copiar" onClick={() => copiar(st.webhook_url)}><Copy className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Campo a assinar: <code className="rounded bg-gray-100 px-1">leadgen</code> · Token de verificação: o valor de <code className="rounded bg-gray-100 px-1">META_VERIFY_TOKEN</code>.
            </p>
            <button className="btn-secondary mt-2 gap-1.5 text-xs"
                    disabled={!st.configurado || !st.variaveis?.META_APP_SECRET || !st.variaveis?.META_VERIFY_TOKEN || cadastrarWebhook.isPending}
                    onClick={() => cadastrarWebhook.mutate()}
                    title="Cadastra este endereço no app da Meta (objeto Página, campo leadgen), sem usar o painel da Meta">
              {cadastrarWebhook.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Webhook className="h-3.5 w-3.5" />}
              Cadastrar webhook automaticamente
            </button>
          </div>
        </div>

        {/* Situação e ações */}
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">Última sincronização</dt>
            <dd>{st.ultima_sincronizacao ? dataHora(st.ultima_sincronizacao) : "—"}</dd>
            {res && (
              <>
                <dt className="text-gray-500">Resultado</dt>
                <dd>{res.inseridos} novo(s) · {res.duplicados} já existiam · {res.formularios} formulário(s)</dd>
              </>
            )}
            <dt className="text-gray-500">Último aviso (webhook)</dt>
            <dd>{st.ultimo_webhook ? dataHora(st.ultimo_webhook) : "—"}</dd>
          </dl>

          {erroRecente && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              <p className="font-semibold">{dataHora(st.ultimo_erro.em)}</p>
              <p className="break-words">{st.ultimo_erro.mensagem}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary gap-1.5" disabled={!st.configurado || testar.isPending} onClick={() => testar.mutate()}>
              {testar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Testar conexão
            </button>
            <button className="btn-primary gap-1.5" disabled={!st.configurado || sincronizar.isPending} onClick={() => sincronizar.mutate(undefined)}>
              {sincronizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar agora
            </button>
            {st.configurado && (
              <button className="text-xs text-primary hover:underline disabled:opacity-50" disabled={sincronizar.isPending}
                      onClick={() => { if (confirm("Buscar todos os leads dos últimos 90 dias? Os que já existem não serão duplicados.")) sincronizar.mutate(90); }}>
                Buscar últimos 90 dias
              </button>
            )}
          </div>

          {diagnostico && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-gray-700">
              <p className="mb-1 font-semibold text-amber-900">Diagnóstico</p>
              {diagnostico.id_informado && (
                <p>
                  <span className="text-gray-500">ID em META_PAGE_ID:</span>{" "}
                  <code className="rounded bg-white px-1 text-xs">{diagnostico.id_informado.id}</code>
                  {diagnostico.id_informado.nome && <> — {diagnostico.id_informado.nome}</>}
                  {diagnostico.id_informado.tipo && (
                    <span className={cn("ml-1 font-medium", diagnostico.id_informado.tipo === "page" ? "text-green-700" : "text-red-700")}>
                      ({TIPO_ID[diagnostico.id_informado.tipo] ?? diagnostico.id_informado.tipo})
                    </span>
                  )}
                </p>
              )}
              {diagnostico.dono_do_token && (
                <p className="mt-1">
                  <span className="text-gray-500">O token pertence a:</span> {diagnostico.dono_do_token.nome}
                  {diagnostico.dono_do_token.tipo && <> ({TIPO_ID[diagnostico.dono_do_token.tipo] ?? diagnostico.dono_do_token.tipo})</>}
                  {" "}<code className="rounded bg-white px-1 text-xs">{diagnostico.dono_do_token.id}</code>
                </p>
              )}
              {diagnostico.dono_do_token?.tipo === "page" && diagnostico.dono_do_token.id !== diagnostico.id_informado?.id && (
                <p className="mt-1 text-xs font-medium text-amber-900">
                  O token é da página “{diagnostico.dono_do_token.nome}”: use o ID dela em META_PAGE_ID.
                </p>
              )}
              {Array.isArray(diagnostico.paginas) && (
                <>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Páginas que este token acessa ({diagnostico.paginas.length})
                  </p>
                  {diagnostico.paginas.length === 0 ? (
                    <p className="text-xs text-red-700">
                      Nenhuma. Atribua a página ao usuário do sistema em Configurações do negócio → Usuários do sistema → Atribuir ativos.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {diagnostico.paginas.map((p: any) => (
                        <li key={p.id} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate">{p.nome}</span>
                          <code className="rounded bg-white px-1">{p.id}</code>
                          <button className="text-primary hover:underline" onClick={() => copiar(p.id)}>Copiar ID</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Cole o ID da página certa em <strong>Railway → backend → Variables → META_PAGE_ID</strong> e aguarde o deploy.
              </p>
            </div>
          )}

          {teste && (
            <div className="rounded-md border bg-gray-50 p-3 text-sm">
              <p><span className="text-gray-500">Página:</span> <strong>{teste.pagina?.nome}</strong> <span className="text-xs text-gray-400">({teste.pagina?.id})</span></p>
              <p className="text-xs text-gray-500">
                Token em uso: {teste.pagina?.token_usado === "página" ? "token da página (obtido automaticamente)" : "o token informado em META_ACCESS_TOKEN"}
              </p>
              <p className="mt-1 flex items-center gap-1.5">
                {teste.webhook_assinado ? (
                  <><CheckCircle2 className="h-4 w-4 text-green-600" /> Página enviando avisos de lead ao app</>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Página ainda não envia avisos de lead
                    <button className="ml-2 text-xs font-medium text-primary hover:underline" disabled={assinar.isPending} onClick={() => assinar.mutate()}>
                      {assinar.isPending ? "Assinando..." : "Assinar agora"}
                    </button>
                  </>
                )}
              </p>
              {teste.webhook_app && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5">
                  {teste.webhook_app.erro ? (
                    <><AlertTriangle className="h-4 w-4 text-amber-600" /> Não foi possível ler o webhook do app: <span className="text-xs">{teste.webhook_app.erro}</span></>
                  ) : teste.webhook_app.leadgen && teste.webhook_app.url_correta ? (
                    <><CheckCircle2 className="h-4 w-4 text-green-600" /> Webhook cadastrado no app {teste.webhook_app.app?.nome}</>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      {teste.webhook_app.leadgen ? "Webhook do app aponta para outro endereço" : "Webhook ainda não cadastrado no app"}
                      <button className="ml-2 text-xs font-medium text-primary hover:underline" disabled={cadastrarWebhook.isPending}
                              onClick={() => cadastrarWebhook.mutate()}>
                        {cadastrarWebhook.isPending ? "Cadastrando..." : "Cadastrar agora"}
                      </button>
                    </>
                  )}
                </p>
              )}
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Formulários ({teste.formularios.length})</p>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-gray-700">
                {teste.formularios.map((f: any) => (
                  <li key={f.id} className="flex gap-2">
                    <span className="flex-1 truncate">{f.nome}</span>
                    <span className={cn("shrink-0", f.status === "ACTIVE" ? "text-green-700" : "text-gray-400")}>{f.status === "ACTIVE" ? "ativo" : (f.status ?? "").toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
