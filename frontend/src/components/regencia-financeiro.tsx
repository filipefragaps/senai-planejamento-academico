"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Calculator, Coins, Download, Info, Loader2, Target, TrendingDown, TrendingUp, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const CHAVE_VALOR = "regencia-valor-hora";
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const reais = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const hrs = (v?: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h`);
const pct = (v?: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const rotuloMes = (m: string) => `${MES[+m.slice(5) - 1]}/${m.slice(2, 4)}`;

function lerValor(t: string) {
  const s = t.trim();
  if (!s) return NaN;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
}

function Card({ icon: Icon, titulo, valor, detalhe, tom }: {
  icon: React.ElementType; titulo: string; valor: React.ReactNode; detalhe?: React.ReactNode; tom?: "verde" | "ambar" | "vermelho";
}) {
  const cor = tom === "verde" ? "text-green-700" : tom === "ambar" ? "text-amber-700" : tom === "vermelho" ? "text-red-700" : "text-gray-900";
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><Icon className="h-3.5 w-3.5" /> {titulo}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", cor)}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-[11px] text-gray-500">{detalhe}</p>}
    </div>
  );
}

/** Simulação: e se a regência da equipe fosse X%? Usa as horas realizadas e a capacidade de cada mês. */
function Simulador({ meses, mes, valorHora }: { meses: any[]; mes: string; valorHora: number }) {
  const [alvoTxt, setAlvoTxt] = useState("80");
  const alvo = Math.min(100, Math.max(0, Number(alvoTxt.replace(",", ".")) || 0));
  const m = meses.find((x) => x.mes === mes) ?? meses[meses.length - 1];
  if (!m) return null;
  const sim = (x: any) => {
    // Regência por professor; a média simples (como no gráfico) é levada ao alvo.
    // Acima da média atual: sobe primeiro quem está mais abaixo (piso comum). Abaixo: reduz todos na proporção.
    const profs: [number, number, number][] = x.sim ?? [];
    const taxas = profs.map(([h, cap]) => h / cap);
    const n = taxas.length || 1;
    const mediaAtual = taxas.reduce((a, t) => a + t, 0) / n;
    const objetivo = alvo / 100;
    let novas: number[];
    if (objetivo >= mediaAtual) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        const meio = (lo + hi) / 2;
        const med = taxas.reduce((a, t) => a + Math.max(t, meio), 0) / n;
        if (med < objetivo) lo = meio; else hi = meio;
      }
      novas = taxas.map((t) => Math.max(t, hi));
    } else {
      const f = mediaAtual > 0 ? objetivo / mediaAtual : 0;
      novas = taxas.map((t) => t * f);
    }
    const horasAlvo = profs.reduce((a, [, cap], i) => a + novas[i] * cap, 0);
    const extra = horasAlvo - x.horas_sala;
    const restante = profs.reduce((a, [, cap, meta], i) => a + Math.max(0, meta * cap - novas[i] * cap), 0);
    return {
      horasAlvo, extra, reais: extra * valorHora,
      vsAnteriorH: x.ganho_horas == null ? null : x.ganho_horas + extra,
      vsAnteriorR: x.ganho_reais == null ? null : x.ganho_reais + extra * valorHora,
      oportunidadeRestante: restante,
    };
  };
  const s0 = sim(m);
  const totalExtra = meses.reduce((acc, x) => acc + sim(x).reais, 0);
  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Calculator className="h-4 w-4 text-indigo-600" /> Simular regência</h3>
          <p className="text-xs text-gray-500">E se a regência da equipe (média, como no gráfico) fosse outra? Sobe primeiro quem está mais abaixo; capacidade e valor da hora do mês.</p>
        </div>
        <div className="flex items-center gap-1">
          {[70, 75, 80, 85, 90].map((v) => (
            <button key={v} onClick={() => setAlvoTxt(String(v))}
                    className={cn("rounded border px-2 py-1 text-xs", alvo === v ? "border-indigo-600 bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50")}>
              {v}%
            </button>
          ))}
        </div>
        <label className="space-y-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Regência simulada</span>
          <div className="relative">
            <input className="w-24 rounded border py-1.5 pl-2 pr-7 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-300"
                   inputMode="decimal" value={alvoTxt} onChange={(e) => setAlvoTxt(e.target.value)} />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
          </div>
        </label>
      </div>
      <input type="range" min={0} max={100} step={1} value={alvo} onChange={(e) => setAlvoTxt(e.target.value)} className="mb-4 w-full accent-indigo-600" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card icon={Calculator} titulo={`Em ${rotuloMes(m.mes)}, a ${pct(alvo)}`} valor={hrs(s0.horasAlvo)}
              detalhe={`em sala, contra ${hrs(m.horas_sala)} realizadas (${pct(m.regencia_pct)})`} />
        <Card icon={Coins} titulo="Diferença sobre o realizado" valor={reais(s0.reais)}
              detalhe={`${s0.extra >= 0 ? "+" : ""}${hrs(s0.extra)} no mês`} tom={s0.reais > 0 ? "verde" : s0.reais < 0 ? "vermelho" : undefined} />
        <Card icon={TrendingUp} titulo={`Impacto sobre ${m.mes_anterior ? rotuloMes(m.mes_anterior) : "o mês anterior"}`}
              valor={reais(s0.vsAnteriorR)}
              detalhe={s0.vsAnteriorH == null ? "sem dados do mês anterior" : `se tivesse saído de ${pct(m.regencia_anterior_pct)} para ${pct(alvo)}`}
              tom={(s0.vsAnteriorR ?? 0) > 0 ? "verde" : (s0.vsAnteriorR ?? 0) < 0 ? "vermelho" : undefined} />
        <Card icon={Target} titulo="Oportunidade que restaria" valor={reais(s0.oportunidadeRestante * valorHora)}
              detalhe={`${hrs(s0.oportunidadeRestante)} até a meta de cada professor`} tom="ambar" />
      </div>

      {meses.length > 1 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th className="py-1 pr-2">Mês</th>
                <th className="px-2 py-1 text-right">Regência realizada</th>
                <th className="px-2 py-1 text-right">Horas realizadas</th>
                <th className="px-2 py-1 text-right">Horas a {pct(alvo)}</th>
                <th className="py-1 pl-2 text-right">Diferença (R$)</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((x) => {
                const v = sim(x);
                return (
                  <tr key={x.mes} className="border-t">
                    <td className="py-1.5 pr-2">{rotuloMes(x.mes)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct(x.regencia_pct)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{hrs(x.horas_sala)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{hrs(v.horasAlvo)}</td>
                    <td className={cn("py-1.5 pl-2 text-right font-medium tabular-nums", v.reais > 0 ? "text-green-700" : v.reais < 0 ? "text-red-700" : "")}>{reais(v.reais)}</td>
                  </tr>
                );
              })}
              <tr className="border-t font-semibold">
                <td className="py-1.5 pr-2" colSpan={4}>Total do período a {pct(alvo)}</td>
                <td className={cn("py-1.5 pl-2 text-right tabular-nums", totalExtra > 0 ? "text-green-700" : totalExtra < 0 ? "text-red-700" : "")}>{reais(totalExtra)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        Regência da equipe = média simples dos percentuais dos professores do quadro (a mesma do gráfico geral). Para chegar ao percentual
        simulado, os professores mais abaixo sobem primeiro até um piso comum; quem já está acima não muda. Os valores em reais seguem as horas de cada um.
      </p>
    </div>
  );
}

/** Calculadora do impacto financeiro da regência (professores do quadro), no período e filtros do gráfico geral. */
export function RegenciaFinanceiroModal({ dataInicio, dataFim, area, modalidade, onClose }: {
  dataInicio: string; dataFim: string; area?: string; modalidade?: string; onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [valorHora, setValorHora] = useState<number | null>(null);
  const [fonte, setFonte] = useState("auto");
  const [mes, setMes] = useState("");

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_VALOR);
      if (salvo) { setTexto(salvo.replace(".", ",")); setValorHora(Number(salvo)); }
    } catch { /* sem armazenamento local */ }
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  function aplicarValor() {
    const v = lerValor(texto);
    if (Number.isNaN(v) || v < 0) return;
    setValorHora(v);
    try { localStorage.setItem(CHAVE_VALOR, String(v)); } catch { /* ignora */ }
  }

  const { data, isFetching, isError } = useQuery({
    queryKey: ["regencia-financeiro", dataInicio, dataFim, valorHora, fonte, mes, area, modalidade],
    queryFn: () => api.get("/regencia-financeiro", {
      params: {
        data_inicio: dataInicio, data_fim: dataFim, valor_hora: valorHora, fonte,
        mes: mes || undefined, area: area || undefined, modalidade: modalidade || undefined,
      },
    }).then((r) => r.data),
    enabled: valorHora != null,
  });
  const r = data?.resumo;

  function exportar() {
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const cab = [
      ["Impacto financeiro da regência — professores do quadro"],
      [`Período: ${dataInicio.split("-").reverse().join("/")} a ${dataFim.split("-").reverse().join("/")}`],
      [`Valor médio da hora: ${reais(data.valor_hora)} · Fonte: ${data.fonte === "real" ? "Regência Real (diário ÷ ponto)" : "Aulas realizadas ÷ carga contratada"} · Cada mês comparado com o mês anterior`],
      [`Filtros: ${[area && `área ${area}`, modalidade && `modalidade ${modalidade}`].filter(Boolean).join("; ") || "nenhum"}`],
      [],
    ];
    const meses = XLSX.utils.aoa_to_sheet([...cab,
      ["Mês", "Professores", "Horas em sala", "Capacidade (h)", "Regência mês anterior %", "Regência %", "Ganho vs mês anterior (h)", "Ganho vs mês anterior (R$)", "Horas até a meta", "Oportunidade (R$)"],
      ...data.meses.map((m: any) => [rotuloMes(m.mes), m.n_professores, m.horas_sala, m.capacidade, m.regencia_anterior_pct ?? "", m.regencia_pct,
        m.ganho_horas ?? "", m.ganho_reais ?? "", m.faltante_horas, m.oportunidade_reais]),
    ]);
    const profs = XLSX.utils.aoa_to_sheet([...cab,
      [`Mês analisado: ${data.mes ? rotuloMes(data.mes) : "—"}`],
      ["Professor", "Tipo", "Área", "Regência mês anterior %", "Regência no mês %", "Meta %", "Ganho (h)", "Ganho (R$)", "Horas até a meta", "Oportunidade (R$)"],
      ...data.professores.map((p: any) => [p.nome, p.tipo, p.area ?? "", p.regencia_anterior ?? "", p.regencia, p.meta,
        p.ganho_horas ?? "", p.ganho_reais ?? "", p.faltante_horas, p.oportunidade_reais]),
    ]);
    XLSX.utils.book_append_sheet(wb, meses, "Por mês");
    XLSX.utils.book_append_sheet(wb, profs, "Por professor");
    XLSX.writeFile(wb, `impacto_financeiro_regencia_${dataInicio}_${dataFim}.xlsx`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="relative my-6 w-full max-w-6xl rounded-lg bg-gray-50 shadow-xl">
        <div className="flex items-start gap-3 border-b bg-white px-5 py-4 rounded-t-lg">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">Impacto financeiro da regência</h2>
            <p className="text-sm text-gray-500">
              Professores do quadro · período e filtros do gráfico geral
              {area && <> · área <b>{area}</b></>}{modalidade && <> · {modalidade}</>}
            </p>
          </div>
          {data && (
            <button onClick={exportar} className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Valor médio da hora</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                <input className="w-36 rounded border py-1.5 pl-8 pr-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300"
                       inputMode="decimal" placeholder="Ex.: 85,00" value={texto} autoFocus={valorHora == null}
                       onChange={(e) => setTexto(e.target.value)} onBlur={aplicarValor}
                       onKeyDown={(e) => e.key === "Enter" && aplicarValor()} />
              </div>
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fonte da regência</span>
              <select className="rounded border px-2 py-1.5 text-sm" value={fonte} onChange={(e) => setFonte(e.target.value)}>
                <option value="auto">Automática (como o gráfico)</option>
                <option value="real">Real (diário ÷ ponto)</option>
                <option value="planejada">Aulas realizadas ÷ carga contratada</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mês analisado (× mês anterior)</span>
              <select className="rounded border px-2 py-1.5 text-sm" value={mes || data?.mes || ""} onChange={(e) => setMes(e.target.value)}>
                {(data?.meses_disponiveis ?? []).map((m: string) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
            </label>
            {isFetching && <Loader2 className="mb-2 h-4 w-4 animate-spin text-gray-400" />}
            <p className="ml-auto max-w-xs text-[11px] text-gray-500">
              O valor fica salvo neste navegador. Depois, dá para evoluir para o valor real de cada professor.
            </p>
          </div>

          {valorHora == null ? (
            <div className="rounded-lg border border-dashed bg-white p-10 text-center text-sm text-gray-500">
              <Coins className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              Informe o valor médio da hora do professor do quadro e pressione Enter para calcular.
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-red-600">Não foi possível calcular o impacto financeiro.</p>
          ) : !data ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : data.meses.length === 0 ? (
            <p className="rounded-lg border bg-white py-8 text-center text-sm text-gray-500">Sem dados de regência no período para os professores do quadro.</p>
          ) : (
            <>
              {r.mes_anterior ? (
                <div className={cn("rounded-lg border p-4 text-sm",
                  (r.ganho_reais ?? 0) >= 0 ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900")}>
                  Em <b>{rotuloMes(r.mes)}</b>, a regência da equipe foi de <b>{pct(r.regencia_anterior)}</b> para <b>{pct(r.regencia)}</b> em relação
                  a {rotuloMes(r.mes_anterior)} ({(r.variacao_pp ?? 0) >= 0 ? "+" : ""}{(r.variacao_pp ?? 0).toLocaleString("pt-BR")} p.p.).
                  {(r.ganho_reais ?? 0) >= 0
                    ? <> Essa melhoria gerou <b>{reais(r.ganho_reais)}</b> ({hrs(r.ganho_horas)} a mais em sala).</>
                    : <> A queda representou <b>{reais(Math.abs(r.ganho_reais))}</b> ({hrs(Math.abs(r.ganho_horas))} a menos em sala).</>}
                  {" "}Ainda há <b>{reais(r.oportunidade_reais)}</b> de oportunidade ({hrs(r.oportunidade_horas)} até a meta).
                </div>
              ) : (
                <p className="rounded-lg border bg-white p-3 text-xs text-gray-500">Sem dados do mês anterior a {rotuloMes(r.mes)} para comparar.</p>
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card icon={(r.variacao_pp ?? 0) >= 0 ? TrendingUp : TrendingDown} titulo={`Regência em ${rotuloMes(r.mes)}`}
                      valor={pct(r.regencia)}
                      detalhe={r.variacao_pp == null ? undefined : `${r.variacao_pp >= 0 ? "+" : ""}${r.variacao_pp.toLocaleString("pt-BR")} p.p. sobre ${rotuloMes(r.mes_anterior)} (${pct(r.regencia_anterior)})`}
                      tom={(r.variacao_pp ?? 0) > 0 ? "verde" : (r.variacao_pp ?? 0) < 0 ? "vermelho" : undefined} />
                <Card icon={Coins} titulo="Impacto da melhoria no mês" valor={reais(r.ganho_reais)}
                      detalhe={r.ganho_horas == null ? undefined : `${hrs(r.ganho_horas)} em relação ao ritmo do mês anterior`}
                      tom={(r.ganho_reais ?? 0) > 0 ? "verde" : (r.ganho_reais ?? 0) < 0 ? "vermelho" : undefined} />
                <Card icon={Target} titulo="Oportunidade ainda disponível" valor={reais(r.oportunidade_reais)}
                      detalhe={`${hrs(r.oportunidade_horas)} pagas que ainda podem ir para a sala até a meta`} tom="ambar" />
                <Card icon={Coins} titulo="Impacto somado no período" valor={reais(r.ganho_periodo_reais)}
                      detalhe={`soma das melhorias mês a mês (${hrs(r.ganho_periodo_horas)})`}
                      tom={r.ganho_periodo_reais > 0 ? "verde" : r.ganho_periodo_reais < 0 ? "vermelho" : undefined} />
              </div>

              <Simulador meses={data.meses} mes={data.mes} valorHora={data.valor_hora} />

              <div className="rounded-lg border bg-white p-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Evolução mensal</h3>
                <p className="mb-3 text-xs text-gray-500">Barras em reais (impacto de cada mês sobre o anterior e oportunidade até a meta) e linha da regência da equipe.</p>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.meses.map((m: any) => ({ ...m, rotulo: rotuloMes(m.mes) }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="r" tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${(v / 1000).toLocaleString("pt-BR")}k`} width={70} />
                      <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                      <Tooltip formatter={(v: any, n: any) => (n === "Regência" ? pct(v) : reais(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="r" dataKey="ganho_reais" name="Impacto vs mês anterior" fill="#16a34a" />
                      <Bar yAxisId="r" dataKey="oportunidade_reais" name="Oportunidade até a meta" fill="#f59e0b" />
                      <Line yAxisId="p" type="monotone" dataKey="regencia_pct" name="Regência" stroke="hsl(218 100% 28%)" strokeWidth={2} dot />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border bg-white">
                <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Por professor — {rotuloMes(data.mes)} × {r.mes_anterior ? rotuloMes(r.mes_anterior) : "mês anterior"}</h3>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-2">Professor</th>
                        <th className="px-3 py-2 text-right">Mês anterior</th>
                        <th className="px-3 py-2 text-right">No mês</th>
                        <th className="px-3 py-2 text-right">Meta</th>
                        <th className="px-3 py-2 text-right">Ganho</th>
                        <th className="px-3 py-2 text-right">Horas até a meta</th>
                        <th className="px-4 py-2 text-right">Oportunidade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.professores.map((p: any) => (
                        <tr key={p.professor_id} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <p className="font-medium text-gray-900">{p.nome}</p>
                            <p className="text-[11px] text-gray-500">{p.tipo}{p.area && ` · ${p.area}`}</p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{pct(p.regencia_anterior)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pct(p.regencia)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{p.meta}%</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", p.ganho_reais > 0 ? "text-green-700" : p.ganho_reais < 0 ? "text-red-700" : "text-gray-500")}>
                            {p.ganho_reais == null ? <span className="text-[11px] text-gray-400">sem mês anterior</span> : <>{reais(p.ganho_reais)}<p className="text-[11px]">{hrs(p.ganho_horas)}</p></>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{hrs(p.faltante_horas)}</td>
                          <td className="px-4 py-2 text-right font-medium tabular-nums text-amber-700">{reais(p.oportunidade_reais)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p><b>Como é calculado.</b> Fonte: {data.fonte === "real" ? "Regência Real — horas do diário ÷ horas do ponto" : "aulas com status Realizada ÷ carga contratada × semanas úteis"}. Só a produção efetiva conta (aulas agendadas ficam de fora) e só professores do quadro (mensalistas e horistas); horas acima da carga do mês não contam. A regência mostrada é a média simples dos professores, a mesma do gráfico geral; os reais seguem as horas de cada professor.</p>
                  <p><b>Impacto da melhoria</b> = horas em sala no mês − (regência do professor no mês anterior × capacidade do mês), × valor da hora. Compara pela taxa, então meses com mais ou menos dias úteis não distorcem. Fica negativo se a regência cair.</p>
                  <p><b>Oportunidade</b> = horas que faltam para a meta (70% mensalista, 100% horista) × valor da hora: capacidade já paga que ainda pode ir para a sala. Não é custo a cortar — o salário do mensalista é fixo.</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
