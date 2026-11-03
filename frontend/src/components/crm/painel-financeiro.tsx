"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Coins, Loader2, RefreshCw, Target, TrendingUp, UserPlus, Percent } from "lucide-react";
import { crmApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const roas = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`);
const roi = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function Indicador({ icon: Icon, sigla, nome, valor, detalhe, tom }: {
  icon: React.ElementType; sigla: string; nome: string; valor: string; detalhe: string; tom?: "bom" | "ruim";
}) {
  return (
    <div className="card h-full p-4" title={nome}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
        <Icon className="h-4 w-4 text-gray-400" />
        <span className="font-semibold text-gray-700">{sigla}</span>
        <span className="truncate">{nome}</span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums",
        tom === "bom" ? "text-green-700" : tom === "ruim" ? "text-red-600" : "text-gray-900")}>{valor}</p>
      <p className="mt-1 text-xs text-gray-500">{detalhe}</p>
    </div>
  );
}

/** Investimento × retorno das campanhas (somente administrador). */
export function PainelFinanceiro({ f }: { f: any }) {
  const qc = useQueryClient();
  const sincronizar = useMutation({
    mutationFn: crmApi.metaSincronizarGastos,
    onSuccess: (r: any) => {
      toast.success(`Investimento atualizado: ${r.campanhas} campanha(s), ${brl(r.valor_lido)} lidos da Meta.`);
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Não foi possível ler o investimento na Meta."),
  });
  const tomRetorno = (v: number | null, limite: number) => (v == null ? undefined : v >= limite ? "bom" : "ruim");
  const atualizado = f.gastos_ultima_sincronizacao
    ? new Date(f.gastos_ultima_sincronizacao).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Investimento e retorno</h2>
          <p className="text-xs text-gray-500">
            Receita = matrículas com 1ª parcela paga × valor do curso.
            {atualizado ? ` Investimento da Meta lido em ${atualizado}.` : " Investimento da Meta ainda não lido."}
          </p>
        </div>
        <button onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending} className="btn-secondary gap-1.5 text-sm">
          {sincronizar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar investimento
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Indicador icon={Banknote} sigla="" nome="Investimento" valor={brl(f.investimento)} detalhe="gasto com anúncios no período" />
        <Indicador icon={Coins} sigla="" nome="Receita" valor={brl(f.receita)} detalhe={`${f.matriculas_pagas} matrícula(s) paga(s)`} />
        <Indicador icon={UserPlus} sigla="CPL" nome="Custo por lead" valor={brl(f.cpl)} detalhe={`investimento ÷ ${f.leads} lead(s)`} />
        <Indicador icon={Target} sigla="CPA" nome="Custo por aquisição" valor={brl(f.cpa)} detalhe="investimento ÷ matrículas pagas" />
        <Indicador icon={TrendingUp} sigla="ROAS" nome="Retorno sobre anúncios" valor={roas(f.roas)}
                   detalhe="receita ÷ investimento" tom={tomRetorno(f.roas, 1)} />
        <Indicador icon={Percent} sigla="ROI" nome="Retorno sobre investimento" valor={roi(f.roi)}
                   detalhe="(receita − investimento) ÷ investimento" tom={tomRetorno(f.roi, 0)} />
      </div>

      {f.matriculas_pagas_sem_valor > 0 && (
        <p className="text-xs text-amber-700">
          {f.matriculas_pagas_sem_valor} matrícula(s) paga(s) sem valor do curso: vincule um curso com valor individual ao lead ou à campanha.
        </p>
      )}

      <div className="card overflow-hidden">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-800">Retorno por campanha</h3>
        {f.por_campanha.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Sem dados no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2">Campanha</th>
                  <th className="px-3 py-2 text-right">Investimento</th>
                  <th className="px-3 py-2 text-right">Leads</th>
                  <th className="px-3 py-2 text-right">CPL</th>
                  <th className="px-3 py-2 text-right">Pagas</th>
                  <th className="px-3 py-2 text-right">CPA</th>
                  <th className="px-3 py-2 text-right">Receita</th>
                  <th className="px-3 py-2 text-right">ROAS</th>
                  <th className="px-4 py-2 text-right">ROI</th>
                </tr>
              </thead>
              <tbody>
                {f.por_campanha.map((c: any) => (
                  <tr key={c.campanha_id} className="border-t">
                    <td className="max-w-[260px] px-4 py-2">
                      <p className="truncate text-gray-800" title={c.nome}>{c.nome}</p>
                      <p className="text-[11px] text-gray-400">
                        {c.fonte_investimento === "meta" ? "Investimento da Meta" : c.fonte_investimento === "manual"
                          ? "Investimento manual (total)" : (
                            <Link href="/crm/config" className="text-primary hover:underline">Sem investimento — informar</Link>
                          )}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.investimento)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.leads}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.cpl)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.matriculas_pagas}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.cpa)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{brl(c.receita)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums font-medium",
                      c.roas == null ? "text-gray-400" : c.roas >= 1 ? "text-green-700" : "text-red-600")}>{roas(c.roas)}</td>
                    <td className={cn("whitespace-nowrap px-4 py-2 text-right tabular-nums font-medium",
                      c.roi == null ? "text-gray-400" : c.roi >= 0 ? "text-green-700" : "text-red-600")}>{roi(c.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[11px] text-gray-400">
              O investimento da Meta segue o período filtrado; o manual é o total da campanha. Os demais filtros (vendedor, status...) não dividem o investimento.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
