"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Coins, Download, Info, Loader2, Target, TrendingDown, TrendingUp, X } from "lucide-react";
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

/** Calculadora do impacto financeiro da regência (professores do quadro), no período e filtros do gráfico geral. */
export function RegenciaFinanceiroModal({ dataInicio, dataFim, area, modalidade, onClose }: {
  dataInicio: string; dataFim: string; area?: string; modalidade?: string; onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [valorHora, setValorHora] = useState<number | null>(null);
  const [fonte, setFonte] = useState("auto");
  const [mesBase, setMesBase] = useState("");

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
    queryKey: ["regencia-financeiro", dataInicio, dataFim, valorHora, fonte, mesBase, area, modalidade],
    queryFn: () => api.get("/regencia-financeiro", {
      params: {
        data_inicio: dataInicio, data_fim: dataFim, valor_hora: valorHora, fonte,
        mes_base: mesBase || undefined, area: area || undefined, modalidade: modalidade || undefined,
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
      [`Valor médio da hora: ${reais(data.valor_hora)} · Fonte: ${data.fonte === "real" ? "Regência Real (diário ÷ ponto)" : "Regência planejada (aulas ÷ carga contratada)"} · Mês-base: ${data.mes_base ? rotuloMes(data.mes_base) : "—"}`],
      [`Filtros: ${[area && `área ${area}`, modalidade && `modalidade ${modalidade}`].filter(Boolean).join("; ") || "nenhum"}`],
      [],
    ];
    const meses = XLSX.utils.aoa_to_sheet([...cab,
      ["Mês", "Professores", "Horas em sala", "Capacidade (h)", "Regência %", "Horas até a meta", "Oportunidade (R$)", "Ganho vs mês-base (h)", "Ganho vs mês-base (R$)"],
      ...data.meses.map((m: any) => [rotuloMes(m.mes) + (m.base ? " (base)" : ""), m.n_professores, m.horas_sala, m.capacidade, m.regencia_pct,
        m.faltante_horas, m.oportunidade_reais, m.ganho_horas ?? "", m.ganho_reais ?? ""]),
    ]);
    const profs = XLSX.utils.aoa_to_sheet([...cab,
      ["Professor", "Tipo", "Área", "Regência mês-base %", "Regência último mês %", "Meta %", "Ganho (h)", "Ganho (R$)", "Horas até a meta", "Oportunidade (R$)"],
      ...data.professores.map((p: any) => [p.nome, p.tipo, p.area ?? "", p.regencia_base ?? "", p.regencia_ultimo ?? "", p.meta,
        p.ganho_horas, p.ganho_reais, p.faltante_horas, p.oportunidade_reais]),
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
                <option value="planejada">Planejada (aulas ÷ carga contratada)</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mês-base da comparação</span>
              <select className="rounded border px-2 py-1.5 text-sm" value={mesBase || data?.mes_base || ""} onChange={(e) => setMesBase(e.target.value)}>
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
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Card icon={r.variacao_pp >= 0 ? TrendingUp : TrendingDown} titulo="Regência da equipe"
                      valor={<>{pct(r.regencia_base)} → {pct(r.regencia_ultimo)}</>}
                      detalhe={r.variacao_pp == null ? undefined : `${r.variacao_pp >= 0 ? "+" : ""}${r.variacao_pp.toLocaleString("pt-BR")} p.p. desde ${rotuloMes(data.mes_base)}`}
                      tom={r.variacao_pp > 0 ? "verde" : r.variacao_pp < 0 ? "vermelho" : undefined} />
                <Card icon={Coins} titulo="Ganho com a melhoria" valor={reais(r.ganho_reais)}
                      detalhe={`${hrs(r.ganho_horas)} a mais em sala que no ritmo de ${rotuloMes(data.mes_base)}`}
                      tom={r.ganho_reais > 0 ? "verde" : r.ganho_reais < 0 ? "vermelho" : undefined} />
                <Card icon={Target} titulo="Oportunidade no último mês" valor={reais(r.oportunidade_ultimo_reais)}
                      detalhe={`${hrs(r.oportunidade_ultimo_horas)} pagas que ainda podem ir para a sala até a meta`} tom="ambar" />
                <Card icon={Target} titulo="Oportunidade no período" valor={reais(r.oportunidade_periodo_reais)}
                      detalhe={`média de ${reais(r.oportunidade_media_reais)} por mês`} tom="ambar" />
                <Card icon={TrendingDown} titulo="Redução da oportunidade" valor={reais(r.reducao_oportunidade_reais)}
                      detalhe={`do mês-base para ${rotuloMes(data.meses[data.meses.length - 1].mes)}`}
                      tom={r.reducao_oportunidade_reais > 0 ? "verde" : r.reducao_oportunidade_reais < 0 ? "vermelho" : undefined} />
              </div>

              <div className="rounded-lg border bg-white p-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-800">Evolução mensal</h3>
                <p className="mb-3 text-xs text-gray-500">Barras em reais (ganho em relação ao mês-base e oportunidade até a meta) e linha da regência da equipe.</p>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.meses.map((m: any) => ({ ...m, rotulo: rotuloMes(m.mes) + (m.base ? " (base)" : "") }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="r" tick={{ fontSize: 11 }} tickFormatter={(v) => `R$ ${(v / 1000).toLocaleString("pt-BR")}k`} width={70} />
                      <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                      <Tooltip formatter={(v: any, n: any) => (n === "Regência" ? pct(v) : reais(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="r" dataKey="ganho_reais" name="Ganho vs mês-base" fill="#16a34a" />
                      <Bar yAxisId="r" dataKey="oportunidade_reais" name="Oportunidade até a meta" fill="#f59e0b" />
                      <Line yAxisId="p" type="monotone" dataKey="regencia_pct" name="Regência" stroke="hsl(218 100% 28%)" strokeWidth={2} dot />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border bg-white">
                <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Por professor</h3>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-2">Professor</th>
                        <th className="px-3 py-2 text-right">Regência base</th>
                        <th className="px-3 py-2 text-right">Último mês</th>
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
                          <td className="px-3 py-2 text-right tabular-nums">{pct(p.regencia_base)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{pct(p.regencia_ultimo)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-500">{p.meta}%</td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", p.ganho_reais > 0 ? "text-green-700" : p.ganho_reais < 0 ? "text-red-700" : "text-gray-500")}>
                            {p.regencia_base == null ? <span className="text-[11px] text-gray-400">sem mês-base</span> : <>{reais(p.ganho_reais)}<p className="text-[11px]">{hrs(p.ganho_horas)}</p></>}
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
                  <p><b>Como é calculado.</b> Fonte: {data.fonte === "real" ? "Regência Real — horas do diário ÷ horas do ponto" : "Regência planejada — horas de aula ÷ carga contratada × semanas úteis"}. Só professores do quadro (mensalistas e horistas); horas acima da carga do mês não contam.</p>
                  <p><b>Ganho com a melhoria</b> = horas em sala − (regência do professor no mês-base × capacidade do mês), × valor da hora. Compara pela taxa, então meses com mais ou menos dias úteis não distorcem. Pode ficar negativo se a regência cair.</p>
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
