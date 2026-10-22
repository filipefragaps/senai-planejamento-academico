"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Megaphone, Users, Plus, FileSpreadsheet } from "lucide-react";
import { crmApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { OfertaPicker } from "@/components/crm/oferta-picker";
import { IntegracaoMeta } from "@/components/crm/meta-integracao";
import { CrmOpcoes } from "@/lib/crm";
import { useCurrentUser } from "@/lib/use-current-user";

function Secao({ icon: Icon, titulo, descricao, children }: {
  icon: React.ElementType; titulo: string; descricao?: string; children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2"><Icon className="h-5 w-5 text-primary" /></div>
        <div>
          <h2 className="font-semibold text-gray-800">{titulo}</h2>
          {descricao && <p className="text-xs text-gray-500">{descricao}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function CrmConfigPage() {
  const me = useCurrentUser();
  if (me === undefined) return null;
  if (me?.perfil !== "admin") {
    return <p className="py-10 text-center text-sm text-gray-500">Somente o administrador acessa as configurações do CRM.</p>;
  }
  return <CrmConfig />;
}

function CrmConfig() {
  const qc = useQueryClient();
  const { data: opcoes } = useQuery<CrmOpcoes>({ queryKey: ["crm-opcoes"], queryFn: crmApi.opcoes });
  const { data: config } = useQuery({ queryKey: ["crm-config"], queryFn: crmApi.config });
  const { data: campanhas = [] } = useQuery({ queryKey: ["crm-campanhas"], queryFn: crmApi.campanhas });

  const [horas, setHoras] = useState("");
  const [diasParcela, setDiasParcela] = useState("");
  const [novaCampanha, setNovaCampanha] = useState("");
  useEffect(() => {
    if (config) { setHoras(String(config.horas_alerta_novo)); setDiasParcela(String(config.dias_alerta_parcela)); }
  }, [config]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["crm-campanhas"] });
    qc.invalidateQueries({ queryKey: ["crm-leads"] });
    qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
  };

  const salvarHoras = useMutation({
    mutationFn: () => crmApi.salvarConfig({
      horas_alerta_novo: Number(horas.replace(",", ".")), dias_alerta_parcela: Number(diasParcela),
    }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["crm-config"] });
      qc.invalidateQueries({ queryKey: ["crm-opcoes"] });
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao salvar"),
  });

  const criarCampanha = useMutation({
    mutationFn: () => crmApi.criarCampanha({ nome: novaCampanha.trim() }),
    onSuccess: () => { setNovaCampanha(""); toast.success("Campanha cadastrada"); invalidar(); },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao cadastrar campanha"),
  });

  const atualizarCampanha = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => crmApi.atualizarCampanha(id, data),
    onSuccess: (r) => {
      toast.success(r.leads_atualizados ? `Campanha salva · curso aplicado a ${r.leads_atualizados} lead(s)` : "Campanha salva");
      invalidar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Erro ao salvar campanha"),
  });

  function definirOferta(c: any, id: number | null) {
    const semCurso = c.total_leads > 0 && id
      ? confirm(`Aplicar este curso também aos leads já recebidos desta campanha que estão sem curso?`)
      : false;
    atualizarCampanha.mutate({ id: c.id, data: { oferta_id: id, aplicar_oferta_leads: semCurso } });
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Configurações do CRM" description="Campanhas, distribuição de leads e alertas" />

      <IntegracaoMeta />

      <Secao icon={Megaphone} titulo="Campanhas"
             descricao="As campanhas são criadas automaticamente na importação. Vincule cada uma ao curso anunciado e, se quiser, a um vendedor fixo.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-3">Campanha</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Matrículas</th>
                <th className="px-3 py-2 min-w-[260px]">Curso (oferta)</th>
                <th className="px-3 py-2 min-w-[180px]">Vendedor padrão</th>
                <th className="px-3 py-2 text-center">Ativa</th>
              </tr>
            </thead>
            <tbody>
              {(campanhas as any[]).length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-gray-400">Nenhuma campanha ainda.</td></tr>
              )}
              {(campanhas as any[]).map((c) => (
                <tr key={c.id} className="border-b last:border-0 align-middle">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-gray-800">{c.nome}</p>
                    {c.meta_campaign_id && <p className="font-mono text-[11px] text-gray-400">ID Meta {c.meta_campaign_id}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.total_leads}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.matriculados}</td>
                  <td className="px-3 py-2">
                    <OfertaPicker value={c.oferta_id} label={c.oferta_label} onChange={(id) => definirOferta(c, id)} />
                  </td>
                  <td className="px-3 py-2">
                    <select className="input" value={c.vendedor_padrao_id ?? ""}
                            onChange={(e) => atualizarCampanha.mutate({ id: c.id, data: { vendedor_padrao_id: e.target.value ? +e.target.value : null } })}>
                      <option value="">Rodízio automático</option>
                      {opcoes?.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" className="h-4 w-4 rounded" checked={c.ativa}
                           onChange={(e) => atualizarCampanha.mutate({ id: c.id, data: { ativa: e.target.checked } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex max-w-md gap-2">
          <input className="input" placeholder="Nome exato da campanha na Meta" value={novaCampanha} onChange={(e) => setNovaCampanha(e.target.value)} />
          <button className="btn-secondary gap-1.5 whitespace-nowrap" disabled={!novaCampanha.trim() || criarCampanha.isPending} onClick={() => criarCampanha.mutate()}>
            <Plus className="h-4 w-4" /> Adicionar
          </button>
        </div>
      </Secao>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Secao icon={Users} titulo="Vendedores e distribuição">
          <p className="text-sm text-gray-600">
            Cada lead novo vai para o <strong>vendedor padrão da campanha</strong>. Se a campanha não tiver um, entra no
            <strong> rodízio</strong> entre os vendedores ativos, um de cada vez.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {opcoes?.vendedores.length ? opcoes.vendedores.map((v) => (
              <li key={v.id} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />{v.nome}</li>
            )) : <li className="text-amber-700">Nenhum vendedor ativo: os leads ficarão “Sem vendedor”.</li>}
          </ul>
          <p className="mt-3 text-xs text-gray-500">
            Para incluir um vendedor, cadastre o usuário com o perfil <strong>Vendedor</strong> em{" "}
            <Link href="/usuarios" className="text-primary hover:underline">Usuários</Link>.
          </p>
        </Secao>

        <Secao icon={Bell} titulo="Alertas" descricao="Prazos usados nos destaques da lista, do quadro e do painel.">
          <div className="space-y-3 text-sm text-gray-600">
            <label className="flex flex-wrap items-center gap-2">
              <span className="w-56">Lead em “Novo lead” há mais de</span>
              <input type="number" min={0.5} step={0.5} className="input w-24" value={horas} onChange={(e) => setHoras(e.target.value)} />
              <span>horas</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <span className="w-56">1ª parcela vencendo nos próximos</span>
              <input type="number" min={0} max={60} step={1} className="input w-24" value={diasParcela} onChange={(e) => setDiasParcela(e.target.value)} />
              <span>dias</span>
            </label>
            <button className="btn-primary"
                    disabled={!horas || diasParcela === "" || salvarHoras.isPending
                      || (Number(horas) === config?.horas_alerta_novo && Number(diasParcela) === config?.dias_alerta_parcela)}
                    onClick={() => salvarHoras.mutate()}>Salvar</button>
          </div>
        </Secao>

        <Secao icon={FileSpreadsheet} titulo="Importação por CSV" descricao="Alternativa manual à integração automática.">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
            <li>No Meta Business Suite, abra <strong>Todas as ferramentas → Central de leads</strong> (ou a página do formulário).</li>
            <li>Selecione o período e clique em <strong>Baixar → CSV</strong>.</li>
            <li>Em <Link href="/crm/leads" className="text-primary hover:underline">Leads</Link>, clique em <strong>Importar CSV</strong>.</li>
          </ol>
          <p className="mt-2 text-xs text-gray-500">Pode reimportar o mesmo arquivo: leads que já existem são ignorados.</p>
        </Secao>

      </div>
    </div>
  );
}
