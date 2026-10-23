"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Trash2, X } from "lucide-react";
import { crmApi } from "@/lib/api";

/** Zona de perigo: apaga todos os leads (e, opcionalmente, as campanhas) após senha + "EXCLUIR". */
export function LimparCrm() {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [incluirCampanhas, setIncluirCampanhas] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);

  function fechar() {
    setAberto(false);
    setConfirmacao("");
    setSenha("");
    setMostrar(false);
  }

  const limpar = useMutation({
    mutationFn: () => crmApi.limpar({ senha, confirmacao, incluir_campanhas: incluirCampanhas }),
    onSuccess: (r) => {
      toast.success(`CRM limpo: ${r.leads} lead(s)` + (r.campanhas ? ` e ${r.campanhas} campanha(s)` : "") + " excluído(s)");
      ["crm-leads", "crm-dashboard", "crm-campanhas", "crm-lead"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      fechar();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || "Não foi possível limpar o CRM"),
  });

  const pronto = confirmacao.trim().toUpperCase() === "EXCLUIR" && senha.length > 0;

  return (
    <section className="card border-red-200 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-lg bg-red-50 p-2"><Trash2 className="h-5 w-5 text-red-600" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-gray-800">Excluir dados do CRM</h2>
          <p className="text-xs text-gray-500">
            Apaga <strong>todos os leads</strong>, com histórico e anotações. Não afeta o restante do sistema
            (cursos, eventos, cronograma) nem as configurações e a integração com a Meta.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-4 w-4 rounded" checked={incluirCampanhas} onChange={(e) => setIncluirCampanhas(e.target.checked)} />
            Excluir também as campanhas (vínculos com cursos e vendedores padrão)
          </label>
        </div>
        <button className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                onClick={() => setAberto(true)}>
          <Trash2 className="h-4 w-4" /> Excluir dados do CRM
        </button>
      </div>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={fechar}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-lg bg-red-100 p-2"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">Excluir todos os leads{incluirCampanhas && " e campanhas"}?</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Esta ação é <strong>irreversível</strong>. Recomendo exportar o Excel dos leads antes.
                  {" "}Se a integração com a Meta estiver ativa, leads novos continuam chegando normalmente.
                </p>
              </div>
              <button onClick={fechar} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
            </div>

            <label className="mb-3 block space-y-1">
              <span className="text-xs text-gray-600">Digite <strong>EXCLUIR</strong> para confirmar:</span>
              <input className="input" value={confirmacao} autoFocus onChange={(e) => setConfirmacao(e.target.value)} placeholder="EXCLUIR" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-600">Sua senha:</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input type={mostrar ? "text" : "password"} className="input pl-9 pr-9" value={senha}
                       onChange={(e) => setSenha(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && pronto && limpar.mutate()} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" onClick={() => setMostrar((m) => !m)}
                        title={mostrar ? "Ocultar senha" : "Mostrar senha"}>
                  {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={fechar}>Cancelar</button>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      disabled={!pronto || limpar.isPending} onClick={() => limpar.mutate()}>
                {limpar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
