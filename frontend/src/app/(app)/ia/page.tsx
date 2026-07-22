"use client";

import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { iaApi } from "@/lib/api";
import { toast } from "sonner";
import {
  Brain, Send, Loader2, FileText, Copy, Check,
  AlertTriangle, CheckCircle, RefreshCw, ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Mensagem {
  pergunta: string;
  resposta: string;
  ts: string;
}

// ── Componente de markdown ─────────────────────────────────────────────────────

function MarkdownOutput({ texto, className }: { texto: string; className?: string }) {
  const [copiado, setCopiado] = useState(false);

  function copiar() {
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className={cn("relative group", className)}>
      <button
        onClick={copiar}
        title="Copiar texto"
        className="absolute top-2 right-2 p-1.5 rounded bg-white/80 hover:bg-white border text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {copiado ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <div className="prose prose-sm max-w-none text-gray-800
        prose-headings:text-gray-900 prose-headings:font-semibold
        prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
        prose-strong:text-gray-900 prose-code:text-indigo-700
        prose-ul:my-1 prose-li:my-0.5 prose-p:my-1.5
        prose-table:w-full prose-table:text-xs
        prose-th:bg-gray-100 prose-th:px-2 prose-th:py-1 prose-th:text-left prose-th:font-semibold prose-th:border prose-th:border-gray-200
        prose-td:px-2 prose-td:py-1 prose-td:border prose-td:border-gray-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{texto}</ReactMarkdown>
      </div>
    </div>
  );
}

// ── Página ────────────────────────────────────────────────────────────────────

export default function IAPage() {
  const [pergunta, setPergunta] = useState("");
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [loadingAnalise, setLoadingAnalise] = useState(false);

  const [relatorio, setRelatorio] = useState("");
  const [loadingRelatorio, setLoadingRelatorio] = useState(false);
  const [tipoRelatorio, setTipoRelatorio] = useState("mensal");

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Verifica se a chave está configurada
  const { data: statusIA } = useQuery({
    queryKey: ["ia-status"],
    queryFn: () => iaApi.status(),
    retry: false,
  });

  const chaveConfigurada = statusIA?.configurada === true;

  async function handleAnalise(e: React.FormEvent) {
    e.preventDefault();
    if (!pergunta.trim()) return;
    if (!chaveConfigurada) {
      toast.error("Configure a ANTHROPIC_API_KEY no .env do backend para usar a IA");
      return;
    }

    const q = pergunta.trim();
    setPergunta("");
    setLoadingAnalise(true);

    try {
      const res = await iaApi.analisar(q);
      const nova: Mensagem = {
        pergunta: q,
        resposta: res.analise,
        ts: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      };
      setHistorico((prev) => [...prev, nova]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao consultar a IA");
    } finally {
      setLoadingAnalise(false);
    }
  }

  async function handleRelatorio() {
    if (!chaveConfigurada) {
      toast.error("Configure a ANTHROPIC_API_KEY no .env do backend para usar a IA");
      return;
    }
    setLoadingRelatorio(true);
    setRelatorio("");
    try {
      const res = await iaApi.relatorio(tipoRelatorio);
      setRelatorio(res.relatorio);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Erro ao gerar relatório");
    } finally {
      setLoadingRelatorio(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Análise com Inteligência Artificial"
        description="Claude analisa os dados reais do sistema e responde perguntas sobre cronograma, regência e professores"
      />

      {/* Banner de status da chave */}
      {statusIA !== undefined && (
        <div className={cn(
          "flex items-start gap-3 rounded-lg p-4 border text-sm",
          chaveConfigurada
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}>
          {chaveConfigurada
            ? <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
            : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />}
          <div>
            {chaveConfigurada ? (
              <span>IA configurada e pronta para uso.</span>
            ) : (
              <>
                <strong>IA não configurada.</strong> Adicione sua chave Anthropic no arquivo{" "}
                <code className="bg-amber-100 px-1 rounded text-xs">backend/.env</code>:{" "}
                <code className="bg-amber-100 px-1 rounded text-xs">ANTHROPIC_API_KEY=sk-ant-…</code>
                {" "}e reinicie o backend.
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── Chat de análise ──────────────────────────────────────────────── */}
        <div className="card flex flex-col" style={{ minHeight: 520 }}>
          <div className="flex items-center gap-2 px-6 pt-6 pb-4 border-b shrink-0">
            <Brain className="h-5 w-5 text-indigo-600" />
            <h3 className="font-semibold text-gray-800">Análise do Cronograma</h3>
            {historico.length > 0 && (
              <button
                onClick={() => setHistorico([])}
                className="ml-auto text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" /> Limpar
              </button>
            )}
          </div>

          {/* Área de mensagens */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            {historico.length === 0 && !loadingAnalise && (
              <div className="text-center py-12 text-gray-300">
                <Brain className="h-12 w-12 mx-auto mb-3" />
                <p className="text-sm font-medium">Faça uma pergunta para iniciar</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {[
                    "Quais professores estão com baixa regência?",
                    "Há aulas sem professor nos próximos dias?",
                    "Qual turma tem mais aulas sem professor?",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setPergunta(s)}
                      disabled={!chaveConfigurada}
                      className="text-xs border rounded-full px-3 py-1 text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {historico.map((m, i) => (
              <div key={i} className="space-y-2">
                {/* Pergunta */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
                    <p>{m.pergunta}</p>
                    <p className="text-indigo-300 text-[10px] mt-1 text-right">{m.ts}</p>
                  </div>
                </div>
                {/* Resposta */}
                <div className="flex justify-start">
                  <div className="max-w-[92%] bg-gray-50 border rounded-2xl rounded-tl-sm px-4 py-3">
                    <MarkdownOutput texto={m.resposta} />
                  </div>
                </div>
              </div>
            ))}

            {loadingAnalise && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisando dados do sistema...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleAnalise} className="px-6 pb-6 pt-3 border-t shrink-0">
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                placeholder={chaveConfigurada ? "Ex: Quais professores precisam de mais aulas?" : "Configure a ANTHROPIC_API_KEY para usar"}
                disabled={!chaveConfigurada || loadingAnalise}
              />
              <button
                type="submit"
                disabled={!chaveConfigurada || loadingAnalise || !pergunta.trim()}
                className="btn-primary flex items-center gap-2 shrink-0 disabled:opacity-50"
              >
                {loadingAnalise ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </form>
        </div>

        {/* ── Relatório Executivo ───────────────────────────────────────────── */}
        <div className="card flex flex-col" style={{ minHeight: 520 }}>
          <div className="flex items-center gap-2 px-6 pt-6 pb-4 border-b shrink-0">
            <FileText className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold text-gray-800">Relatório Executivo com IA</h3>
          </div>

          <div className="px-6 py-4 border-b shrink-0">
            <p className="text-xs text-gray-400 mb-3">
              Gera um relatório narrativo completo com análise de regência, turmas, alertas e recomendações —
              baseado exclusivamente nos dados atuais do sistema.
            </p>
            <div className="flex gap-2">
              <select
                className="input flex-1 text-sm"
                value={tipoRelatorio}
                onChange={(e) => setTipoRelatorio(e.target.value)}
                disabled={!chaveConfigurada}
              >
                <option value="mensal">Período Mensal</option>
                <option value="semanal">Período Semanal</option>
                <option value="semestral">Período Semestral</option>
              </select>
              <button
                onClick={handleRelatorio}
                disabled={!chaveConfigurada || loadingRelatorio}
                className="btn-primary flex items-center gap-2 shrink-0 disabled:opacity-50"
              >
                {loadingRelatorio
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <FileText className="h-4 w-4" />}
                Gerar
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {loadingRelatorio && (
              <div className="text-center py-16 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin mx-auto mb-3" />
                <p className="text-sm">Gerando relatório executivo...</p>
                <p className="text-xs text-gray-300 mt-1">Pode levar entre 20 e 60 segundos</p>
              </div>
            )}
            {relatorio && !loadingRelatorio && (
              <MarkdownOutput texto={relatorio} />
            )}
            {!relatorio && !loadingRelatorio && (
              <div className="text-center py-16 text-gray-300">
                <FileText className="h-12 w-12 mx-auto mb-3" />
                <p className="text-sm">Clique em Gerar para criar o relatório</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Info card */}
      <div className="card p-5 bg-slate-50 border-slate-100">
        <details>
          <summary className="font-semibold text-slate-700 text-sm cursor-pointer flex items-center gap-2">
            <ChevronDown className="h-4 w-4" />
            Sobre o funcionamento da IA
          </summary>
          <ul className="text-sm text-slate-600 space-y-1 list-disc list-inside mt-3">
            <li>Usa <strong>Claude Opus 4.8</strong> (Anthropic) com raciocínio adaptativo</li>
            <li>O contexto enviado inclui professores, regências, eventos e aulas dos últimos 30 + próximos 60 dias</li>
            <li>Todas as análises são baseadas <strong>exclusivamente</strong> nos dados reais do banco</li>
            <li>A IA nunca inventa professores, turmas ou horários que não existam</li>
            <li>Configure <code className="bg-slate-100 px-1 rounded">ANTHROPIC_API_KEY</code> no arquivo <code className="bg-slate-100 px-1 rounded">backend/.env</code></li>
          </ul>
        </details>
      </div>
    </div>
  );
}
