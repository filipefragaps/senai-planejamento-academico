"use client";

import { useState, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { importacaoApi } from "@/lib/api";
import { LimparBdButton } from "@/components/limpar-bd-button";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Info, Download } from "lucide-react";
import { downloadModeloDadosMestres } from "@/lib/templates";
import { cn } from "@/lib/utils";

interface ResultadoImportacao {
  sucesso: boolean;
  mensagem: string;
  importados: {
    cursos: number;
    professores: number;
    atuacoes: number;
    disponibilidades: number;
    calendario: number;
    erros?: string[];
  };
}

export default function ImportacaoPage() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error("O arquivo deve ser .xlsx ou .xls");
      return;
    }

    setLoading(true);
    setResultado(null);
    setErro(null);
    setNomeArquivo(file.name);

    try {
      const res: ResultadoImportacao = await importacaoApi.importarExcel(file);
      setResultado(res);
      const total =
        (res.importados?.cursos || 0) +
        (res.importados?.professores || 0) +
        (res.importados?.atuacoes || 0) +
        (res.importados?.disponibilidades || 0) +
        (res.importados?.calendario || 0);
      if (total > 0) {
        toast.success(`Importado com sucesso! ${total} registros processados.`);
      } else {
        toast.warning(
          "Arquivo processado, mas nenhum registro foi importado. Verifique os nomes das abas e colunas."
        );
      }
    } catch (err: any) {
      const raw = err?.response?.data?.detail;
      const detalhe =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
          ? raw.map((e: any) => e.msg || JSON.stringify(e)).join("; ")
          : err?.message || "Erro desconhecido ao processar o arquivo.";
      setErro(detalhe);
      toast.error(`Erro na importação: ${detalhe}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Limpa o input para permitir reimportar o mesmo arquivo
    e.target.value = "";
  }

  return (
    <div>
      <PageHeader
        title="Importar Dados"
        description="Importe sua planilha Excel com os dados do banco preliminar"
      >
        <LimparBdButton
          tipo="importacao"
          label="Limpar Dados Importados"
          onLimpou={() => setResultado(null)}
        />
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Área de upload */}
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !loading && inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center transition-colors",
              loading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              dragging
                ? "border-primary bg-blue-50"
                : "border-gray-200 hover:border-primary hover:bg-gray-50"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileInput}
            />

            {loading ? (
              <div className="text-gray-500">
                <Loader2 className="animate-spin h-12 w-12 text-primary mx-auto mb-3" />
                <p className="font-medium text-gray-700">Processando arquivo...</p>
                <p className="text-sm text-gray-400 mt-1">{nomeArquivo}</p>
                <p className="text-xs text-gray-300 mt-2">
                  Isso pode levar alguns segundos dependendo do tamanho da planilha.
                </p>
              </div>
            ) : (
              <>
                <Upload className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-700 font-semibold text-lg">
                  Arraste sua planilha aqui
                </p>
                <p className="text-gray-400 text-sm mt-1">ou clique para selecionar</p>
                <p className="text-xs text-gray-300 mt-3">.xlsx ou .xls • máximo 50MB</p>
              </>
            )}
          </div>

          {/* Erro */}
          {erro && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-800 text-sm">Erro ao importar</p>
                  <p className="text-red-600 text-sm mt-1">{erro}</p>
                </div>
              </div>
            </div>
          )}

          {/* Resultado da importação */}
          {resultado && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <p className="font-semibold text-green-800">Importação concluída</p>
              </div>
              <div className="space-y-2">
                {[
                  { label: "Cursos", valor: resultado.importados?.cursos },
                  { label: "Professores", valor: resultado.importados?.professores },
                  { label: "Atuações / Habilitações", valor: resultado.importados?.atuacoes },
                  { label: "Disponibilidades", valor: resultado.importados?.disponibilidades },
                  { label: "Calendário Acadêmico", valor: resultado.importados?.calendario },
                ].map(({ label, valor }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between text-sm py-1 border-b border-green-100 last:border-0"
                  >
                    <span className="text-green-700">{label}</span>
                    <span
                      className={cn(
                        "font-bold",
                        (valor || 0) > 0 ? "text-green-800" : "text-gray-400"
                      )}
                    >
                      {valor ?? 0} registros
                    </span>
                  </div>
                ))}
              </div>

              {resultado.importados?.erros && resultado.importados.erros.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-50 rounded border border-yellow-200">
                  <p className="text-xs font-semibold text-yellow-800 mb-1">Avisos:</p>
                  {resultado.importados.erros.map((e, i) => (
                    <p key={i} className="text-xs text-yellow-700">{e}</p>
                  ))}
                </div>
              )}

              {/* Zero registros? — dica de diagnóstico */}
              {(resultado.importados?.cursos === 0 &&
                resultado.importados?.professores === 0) && (
                <div className="mt-3 p-3 bg-amber-50 rounded border border-amber-200">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-700 space-y-1">
                      <p className="font-semibold">Nenhum registro importado. Verifique:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li>Os nomes das abas estão exatos? (ver coluna direita)</li>
                        <li>A primeira linha de cada aba contém os cabeçalhos?</li>
                        <li>Os dados começam na segunda linha?</li>
                        <li>O arquivo não está protegido com senha?</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => inputRef.current?.click()}
                className="mt-4 w-full text-sm text-primary underline hover:no-underline"
              >
                Importar outro arquivo
              </button>
            </div>
          )}
        </div>

        {/* Guia de estrutura */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-green-600" />
              <h3 className="font-semibold text-gray-800">Estrutura esperada da planilha</h3>
            </div>
            <button
              onClick={downloadModeloDadosMestres}
              className="btn-secondary flex items-center gap-1.5 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar Modelo
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            A planilha pode ter <strong>qualquer nome de arquivo</strong>, mas as{" "}
            <strong>abas devem ter exatamente esses nomes</strong> (insensível a maiúsculas).
            As abas são opcionais — importe apenas as que tiver.
          </p>

          <div className="space-y-3">
            {[
              {
                aba: "PROFESSORES",
                colunas: ["PROFESSOR", "ÁREA", "TIPO", "CH"],
                nota: "TIPO = Mensalista ou Horista · CH = carga horária semanal",
              },
              {
                aba: "ATUAÇÃO",
                colunas: ["PROFESSOR", "CURSO", "PASTA", "UNIDADE CURRICULAR", "AT"],
                nota: "PASTA = código do curso · AT = SIM autoriza o professor na UC",
              },
              {
                aba: "DISPONIBILIDADE DETALHADA",
                colunas: ["PROFESSOR", "DIA_SEMANA", "HORA_INICIO", "HORA_FIM", "DISPONIVEL"],
                nota: "DIA_SEMANA = SEG, TER, QUA, QUI, SEX · DISPONIVEL = SIM ou NÃO",
              },
              {
                aba: "CALENDÁRIO ACADÊMICO",
                colunas: ["DATA", "TIPO", "LETIVO", "TURNO", "DESCRIÇÃO"],
                nota: "Registre os dias sem aula: feriados, recessos, férias dos alunos",
              },
              {
                aba: "CURSOS",
                colunas: ["(qualquer estrutura)"],
                nota: "Cursos são extraídos automaticamente da aba ATUAÇÃO via PASTA + CURSO",
              },
            ].map(({ aba, colunas, nota }) => (
              <div key={aba} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-primary">{aba}</span>
                </div>

                <p className="text-xs text-gray-500 font-mono">
                  {colunas.join(" | ")}
                </p>
                {nota && (
                  <p className="text-xs text-gray-400 mt-1 italic">{nota}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700 space-y-1">
                <p>
                  A importação é <strong>incremental</strong>: registros existentes são
                  atualizados pelo código/nome, novos são criados. Nenhum dado é deletado.
                </p>
                <p>
                  Se os nomes das colunas na sua planilha forem diferentes, você pode
                  renomeá-las ou avisar para ajustar o sistema.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
