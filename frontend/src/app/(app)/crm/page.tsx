"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Inbox, UserX, GraduationCap, Percent, Timer, CalendarClock, ArrowRight, Loader2,
} from "lucide-react";
import { crmApi, CrmFiltros } from "@/lib/api";
import { useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { OfertaPicker } from "@/components/crm/oferta-picker";
import { CrmOpcoes, TEMPERATURA_STYLE } from "@/lib/crm";

const PRIMARIA = "hsl(218 100% 28%)";

function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PERIODOS = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "mes", label: "Este mês" },
  { key: "90", label: "90 dias" },
  { key: "tudo", label: "Tudo" },
  { key: "custom", label: "Personalizado" },
];

function intervalo(p: string): { ini: string; fim: string } {
  const hoje = new Date();
  if (p === "tudo" || p === "custom") return { ini: "", fim: "" };
  if (p === "mes") return { ini: isoLocal(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: isoLocal(hoje) };
  const ini = new Date(hoje);
  ini.setDate(ini.getDate() - (+p - 1));
  return { ini: isoLocal(ini), fim: isoLocal(hoje) };
}

function Tile({ icon: Icon, label, valor, detalhe, href, destaque }: {
  icon: React.ElementType; label: string; valor: React.ReactNode; detalhe?: React.ReactNode; href?: string; destaque?: "alerta" | "sucesso";
}) {
  const corpo = (
    <div className={cn("card h-full p-4 transition-colors", href && "hover:border-primary/40")}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon className={cn("h-4 w-4", destaque === "alerta" ? "text-red-500" : destaque === "sucesso" ? "text-green-600" : "text-gray-400")} />
        {label}
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-gray-500">{detalhe}</p>}
    </div>
  );
  return href ? <Link href={href}>{corpo}</Link> : corpo;
}

function TabelaGrupo({ titulo, linhas, vazio }: { titulo: string; linhas: any[]; vazio: string }) {
  return (
    <div className="card overflow-hidden">
      <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">{titulo}</h3>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">{vazio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2">Nome</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Em aberto</th>
                <th className="px-3 py-2 text-right">Perdidos*</th>
                <th className="px-3 py-2 text-right">Matrículas</th>
                <th className="px-4 py-2 text-right">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="max-w-[280px] truncate px-4 py-2 text-gray-800" title={l.nome}>{l.nome}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{l.em_aberto}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{l.perdidos}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{l.matriculados}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 sm:block">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(l.taxa_conversao, 100)}%`, background: PRIMARIA }} />
                      </div>
                      <span className="w-12 tabular-nums font-medium">{l.taxa_conversao.toLocaleString("pt-BR")}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-gray-400">* Perdidos inclui "Sem retorno após tentativas".</p>
        </div>
      )}
    </div>
  );
}

function DiaTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-gray-800">{p.rotulo}</p>
      <p className="text-gray-600">{p.total} lead(s) recebido(s)</p>
      <p className="text-gray-600">{p.matriculados} matriculado(s)</p>
    </div>
  );
}

export default function CrmPainelPage() {
  const me = useCurrentUser();
  const isAdmin = me?.perfil === "admin";

  const [periodo, setPeriodo] = useState("30");
  const [custom, setCustom] = useState({ ini: "", fim: "" });
  const [campanhaId, setCampanhaId] = useState("");
  const [temperatura, setTemperatura] = useState("");
  const [status, setStatus] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [oferta, setOferta] = useState<{ id: number | null; label: string | null }>({ id: null, label: null });

  const { ini, fim } = periodo === "custom" ? custom : intervalo(periodo);
  const filtros: CrmFiltros = useMemo(() => ({
    ...(ini && { data_inicio: ini }),
    ...(fim && { data_fim: fim }),
    ...(campanhaId && { campanha_id: +campanhaId }),
    ...(temperatura && { temperatura }),
    ...(status && { status }),
    ...(vendedorId !== "" && { vendedor_id: +vendedorId }),
    ...(oferta.id && { oferta_id: oferta.id }),
  }), [ini, fim, campanhaId, temperatura, status, vendedorId, oferta.id]);

  const { data: opcoes } = useQuery<CrmOpcoes>({ queryKey: ["crm-opcoes"], queryFn: crmApi.opcoes, staleTime: 300_000 });
  const { data: campanhas = [] } = useQuery({ queryKey: ["crm-campanhas"], queryFn: crmApi.campanhas, staleTime: 60_000 });
  const { data: d, isLoading } = useQuery({
    queryKey: ["crm-dashboard", "painel", filtros],
    queryFn: () => crmApi.dashboard(filtros),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  // Série diária completa (dias sem leads aparecem com zero)
  const serieDiaria = useMemo(() => {
    if (!d?.por_dia?.length) return [];
    const mapa = new Map<string, any>(d.por_dia.map((x: any) => [x.data, x]));
    const inicio = new Date((ini || d.por_dia[0].data) + "T00:00:00");
    const final = new Date((fim || d.por_dia[d.por_dia.length - 1].data) + "T00:00:00");
    const out: any[] = [];
    for (let dt = new Date(inicio); dt <= final && out.length < 400; dt.setDate(dt.getDate() + 1)) {
      const k = isoLocal(dt);
      const v = mapa.get(k) ?? { total: 0, matriculados: 0 };
      out.push({ data: k, rotulo: dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }),
                 eixo: `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`, ...v });
    }
    return out;
  }, [d, ini, fim]);

  const maxStatus = Math.max(1, ...(d?.por_status ?? []).map((s: any) => s.total));
  const maxMotivo = Math.max(1, ...(d?.motivos_perda ?? []).map((m: any) => m.total));
  const horas = opcoes?.horas_alerta_novo ?? 2;

  return (
    <div>
      <PageHeader title="Painel CRM" description={isAdmin ? "Acompanhamento dos leads das campanhas Meta" : "Seus resultados no período"}>
        <Link href="/crm/leads" className="btn-secondary gap-1.5">Ver leads <ArrowRight className="h-4 w-4" /></Link>
      </PageHeader>

      {/* Filtros */}
      <div className="card mb-5 space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODOS.map((p) => (
            <button key={p.key} onClick={() => setPeriodo(p.key)}
                    className={cn("rounded-full border px-3 py-1 text-xs font-medium",
                      periodo === p.key ? "border-primary bg-primary text-white" : "bg-white text-gray-600 hover:bg-gray-50")}>
              {p.label}
            </button>
          ))}
          {periodo === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" className="input h-8 w-auto" value={custom.ini} onChange={(e) => setCustom({ ...custom, ini: e.target.value })} />
              <span className="text-xs text-gray-400">até</span>
              <input type="date" className="input h-8 w-auto" value={custom.fim} onChange={(e) => setCustom({ ...custom, fim: e.target.value })} />
            </div>
          )}
          {isLoading && <Loader2 className="ml-2 h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <select className="input" value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}>
            <option value="">Todas as campanhas</option>
            {(campanhas as any[]).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <OfertaPicker value={oferta.id} label={oferta.label} onChange={(id, label) => setOferta({ id, label })} placeholder="Filtrar por curso..." />
          <select className="input" value={temperatura} onChange={(e) => setTemperatura(e.target.value)}>
            <option value="">Todas as temperaturas</option>
            {opcoes?.temperaturas.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            <option value="sem">Sem classificação</option>
          </select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            {opcoes?.status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {isAdmin && (
            <select className="input" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              <option value="">Todos os vendedores</option>
              <option value="0">Sem vendedor</option>
              {opcoes?.vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
            </select>
          )}
        </div>
      </div>

      {d && (
        <div className="space-y-5">
          {/* Indicadores principais */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile icon={Inbox} label="Leads recebidos" valor={d.total} href="/crm/leads" />
            <Tile icon={UserX} label="Novos não atendidos" valor={d.novos} destaque={d.novos_sem_atendimento ? "alerta" : undefined}
                  detalhe={d.novos_sem_atendimento ? <span className="font-medium text-red-600">{d.novos_sem_atendimento} há mais de {horas}h</span> : "Nenhum atrasado"}
                  href="/crm/leads?status=novo" />
            <Tile icon={CalendarClock} label="Retornos atrasados" valor={d.retornos_atrasados} destaque={d.retornos_atrasados ? "alerta" : undefined}
                  detalhe={`${d.retornos_hoje} para hoje`} href="/crm/leads?alerta=retorno_atrasado" />
            <Tile icon={GraduationCap} label="Matriculados" valor={d.matriculados} destaque="sucesso" href="/crm/leads?status=matriculado" />
            <Tile icon={Percent} label="Taxa de conversão" valor={`${d.taxa_conversao.toLocaleString("pt-BR")}%`} detalhe="matrículas ÷ leads recebidos" />
            <Tile icon={Timer} label="1º atendimento (média)" valor={d.tempo_medio_primeiro_atendimento_h == null ? "—" : `${d.tempo_medio_primeiro_atendimento_h.toLocaleString("pt-BR")}h`}
                  detalhe="do recebimento ao 1º contato" />
          </div>

          {/* Temperatura */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.por_temperatura.map((t: any) => {
              const st = TEMPERATURA_STYLE[t.temperatura];
              return (
                <Link key={t.temperatura} href={`/crm/leads?temperatura=${t.temperatura}`}
                      className="card flex items-center justify-between p-3 hover:border-primary/40">
                  <span className="flex items-center gap-2 text-sm text-gray-700">
                    <span className={cn("h-2.5 w-2.5 rounded-full", st?.dot ?? "bg-gray-300")} />
                    {t.label}
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-gray-900">{t.total}</span>
                </Link>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            {/* Funil por status */}
            <div className="card p-4 lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold text-gray-800">Leads por status</h3>
              <div className="space-y-2">
                {d.por_status.map((s: any) => (
                  <Link key={s.status} href={`/crm/leads?status=${s.status}`} className="group block">
                    <div className="mb-0.5 flex justify-between text-xs">
                      <span className={cn("text-gray-600 group-hover:text-primary", s.final && "font-medium")}>{s.label}</span>
                      <span className="tabular-nums font-medium text-gray-800">{s.total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full" style={{ width: `${(s.total / maxStatus) * 100}%`, background: PRIMARIA, opacity: s.final ? 1 : 0.55 }} />
                    </div>
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400">Barras mais escuras: resultados finais.</p>
            </div>

            {/* Leads por dia */}
            <div className="card p-4 lg:col-span-3">
              <h3 className="mb-3 text-sm font-semibold text-gray-800">Leads recebidos por dia</h3>
              {serieDiaria.length === 0 ? (
                <p className="py-16 text-center text-sm text-gray-400">Sem leads no período.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serieDiaria} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#eef0f3" />
                      <XAxis dataKey="eixo" tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }}
                             interval="preserveStartEnd" minTickGap={16} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                      <Tooltip content={<DiaTooltip />} cursor={{ fill: "rgba(0,59,142,0.06)" }} />
                      <Bar dataKey="total" fill={PRIMARIA} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <TabelaGrupo titulo="Conversão por campanha" linhas={d.por_campanha} vazio="Sem dados no período." />
          <TabelaGrupo titulo="Conversão por curso" linhas={d.por_curso} vazio="Sem dados no período." />

          <div className={cn("grid grid-cols-1 gap-5", isAdmin && "lg:grid-cols-2")}>
            {isAdmin && <TabelaGrupo titulo="Desempenho por vendedor" linhas={d.por_vendedor} vazio="Sem dados no período." />}
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-800">Motivos de perda</h3>
              {d.motivos_perda.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">Nenhum lead perdido no período.</p>
              ) : (
                <div className="space-y-2">
                  {d.motivos_perda.map((m: any) => (
                    <div key={m.motivo}>
                      <div className="mb-0.5 flex justify-between text-xs">
                        <span className="text-gray-600">{m.label}</span>
                        <span className="tabular-nums font-medium text-gray-800">{m.total}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full" style={{ width: `${(m.total / maxMotivo) * 100}%`, background: PRIMARIA }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
