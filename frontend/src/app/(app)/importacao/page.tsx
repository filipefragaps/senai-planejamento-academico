"use client";

import { useState, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { importacaoApi, adminApi } from "@/lib/api";
import { LimparBdButton } from "@/components/limpar-bd-button";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2,
  Info, Download, Trash2, RefreshCw,
} from "lucide-react";
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

interface ResultadoSeduc {
  sucesso: boolean;
  mensagem: string;
  criadas: number;
  atualizadas: number;
  erros: string[];
}

export default function ImportacaoPage() {
  // ── Dados Mestres ─────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── SEDUC ─────────────────────────────────────────────────────────────────
  const [seducDragging, setSeducDragging] = useState(false);
  const [seducLoading, setSeducLoading] = useState(false);
  const [seducNomeArquivo, setSeducNomeArquivo] = useState("");
  const [seducResultado, setSeducResultado] = useState<ResultadoSeduc | null>(null);
  const [seducErro, setSeducErro] = useState<string | null>(null);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const seducInputRef = useRef<HTMLInputElement>(null);

  // ── handlers dados mestres ────────────────────────────────────────────────
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
        toast.warning("Arquivo processado, mas nenhum registro foi importado. Verifique os nomes das abas e colunas.");
      }
    } catch (err: any) {
      const raw = err?.response?.data?.detail;
      const detalhe =
        typeof raw === "string" ? raw
        : Array.isArray(raw) ? raw.map((e: any) => e.msg || JSON.stringify(e)).join("; ")
        : err?.message || "Erro desconhecido ao processar o arquivo.";
      setErro(detalhe);
      toast.error(`Erro na importação: ${detalhe}`);
    } finally {
      setLoading(false);
    }
  }

  // ── handlers SEDUC ────────────────────────────────────────────────────────
  async function processSeducFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error("O arquivo deve ser .xlsx ou .xls");
      return;
    }
    setSeducLoading(true);
    setSeducResultado(null);
    setSeducErro(null);
    setSeducNomeArquivo(file.name);
    try {
      const res: ResultadoSeduc = await importacaoApi.importarSeduc(file);
      setSeducResultado(res);
      toast.success(res.mensagem || "Importação SEDUC concluída!");
    } catch (err: any) {
      const raw = err?.response?.data?.detail;
      const detalhe =
        typeof raw === "string" ? raw
        : err?.message || "Erro desconhecido ao processar a planilha SEDUC.";
      setSeducErro(detalhe);
      toast.error(`Erro SEDUC: ${detalhe}`);
    } finally {
      setSeducLoading(false);
    }
  }

  async function handleRollbackSeduc() {
    if (!rollbackConfirm) {
      setRollbackConfirm(true);
      return;
    }
    setRollbackLoading(true);
    setRollbackConfirm(false);
    try {
      const res = await importacaoApi.reverterSeduc();
      setSeducResultado(null);
      toast.success(res.mensagem || `${res.deletadas} aulas SEDUC removidas.`);
    } catch {
      toast.error("Erro ao desfazer importação SEDUC.");
    } finally {
      setRollbackLoading(false);
    }
  }

  return (
    <div className="space-y-8">
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

      {/* ── Dados Mestres ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload */}
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) processFile(f);
            }}
            onClick={() => !loading && inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center transition-colors",
              loading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
              dragging ? "border-primary bg-blue-50" : "border-gray-200 hover:border-primary hover:bg-gray-50"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processFile(f);
                e.target.value = "";
              }}
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
                <p className="text-gray-700 font-semibold text-lg">Arraste sua planilha aqui</p>
                <p className="text-gray-400 text-sm mt-1">ou clique para selecionar</p>
                <p className="text-xs text-gray-300 mt-3">.xlsx ou .xls • máximo 50MB</p>
              </>
            )}
          </div>

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
                    <span className={cn("font-bold", (valor || 0) > 0 ? "text-green-800" : "text-gray-400")}>
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

              {(resultado.importados?.cursos === 0 && resultado.importados?.professores === 0) && (
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
                <p className="text-xs text-gray-500 font-mono">{colunas.join(" | ")}</p>
                {nota && <p className="text-xs text-gray-400 mt-1 italic">{nota}</p>}
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

      {/* ── Cronograma SEDUC ──────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="rounded-lg bg-orange-100 p-2">
            <FileSpreadsheet className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">Importar Cronograma SEDUC</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Cursos integrados com o Ensino Médio — planilha com colunas separadas{" "}
              <strong>HORA_INICIO</strong> e <strong>HORA_TERMINO</strong>. Todas as aulas importadas
              ficam marcadas e podem ser removidas em bloco se algo der errado.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Drop zone SEDUC */}
          <div className="space-y-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setSeducDragging(true); }}
              onDragLeave={() => setSeducDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setSeducDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) processSeducFile(f);
              }}
              onClick={() => !seducLoading && seducInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center transition-colors",
                seducLoading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                seducDragging
                  ? "border-orange-400 bg-orange-50"
                  : "border-orange-200 hover:border-orange-400 hover:bg-orange-50"
              )}
            >
              <input
                ref={seducInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) processSeducFile(f);
                  e.target.value = "";
                }}
              />
              {seducLoading ? (
                <div className="text-gray-500">
                  <Loader2 className="animate-spin h-10 w-10 text-orange-500 mx-auto mb-2" />
                  <p className="font-medium text-gray-700 text-sm">Processando SEDUC...</p>
                  <p className="text-xs text-gray-400 mt-1">{seducNomeArquivo}</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-orange-300 mx-auto mb-2" />
                  <p className="text-gray-700 font-semibold">Arraste a planilha SEDUC</p>
                  <p className="text-gray-400 text-xs mt-1">ou clique para selecionar • .xlsx ou .xls</p>
                </>
              )}
            </div>

            {seducErro && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-red-700 text-xs">{seducErro}</p>
                </div>
              </div>
            )}

            {seducResultado && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <p className="font-semibold text-green-800 text-sm">Importação SEDUC concluída</p>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between border-b border-green-100 pb-1">
                    <span className="text-green-700">Aulas criadas</span>
                    <span className="font-bold text-green-800">{seducResultado.criadas}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-green-700">Aulas atualizadas</span>
                    <span className="font-bold text-green-800">{seducResultado.atualizadas}</span>
                  </div>
                </div>
                {seducResultado.erros?.length > 0 && (
                  <div className="mt-2 p-2 bg-yellow-50 rounded border border-yellow-200">
                    <p className="text-xs font-semibold text-yellow-800 mb-1">Avisos:</p>
                    {seducResultado.erros.map((e, i) => (
                      <p key={i} className="text-xs text-yellow-700">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Rollback */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {rollbackConfirm ? (
                <>
                  <span className="text-xs text-red-600 font-medium flex-1 min-w-0">
                    Confirmar? Remove TODAS as aulas SEDUC importadas.
                  </span>
                  <button
                    onClick={handleRollbackSeduc}
                    disabled={rollbackLoading}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 disabled:opacity-50"
                  >
                    {rollbackLoading
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Trash2 className="h-3 w-3" />}
                    Confirmar exclusão
                  </button>
                  <button
                    onClick={() => setRollbackConfirm(false)}
                    className="text-xs text-gray-500 underline"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  onClick={handleRollbackSeduc}
                  disabled={rollbackLoading}
                  className="text-xs text-red-600 underline hover:no-underline flex items-center gap-1.5"
                >
                  <RefreshCw className="h-3 w-3" />
                  Desfazer importação SEDUC (rollback)
                </button>
              )}
            </div>
          </div>

          {/* Info colunas SEDUC */}
          <div className="space-y-3">
            <div className="border rounded-lg p-3 border-orange-100 bg-orange-50">
              <p className="text-xs font-bold text-orange-700 mb-2">Colunas esperadas na planilha SEDUC</p>
              <p className="text-xs text-gray-600 font-mono leading-relaxed">
                Data | Evento | Turno | <strong>HORA_INICIO</strong> | <strong>HORA_TERMINO</strong> |
                Curso | Unidade Curricular | Aula | Subturma | Professor | Ambiente | Carga Horária |
                Etapa | Modalidade | Área
              </p>
            </div>

            <div className="border rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-700 mb-2">Como funciona o rollback</p>
              <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
                <li>Importe a planilha normalmente usando a área acima.</li>
                <li>As aulas são inseridas no cronograma com uma marcação interna.</li>
                <li>Se algo der errado, clique em <em>Desfazer importação SEDUC</em>.</li>
                <li>Todas as aulas marcadas são removidas em bloco — o restante do cronograma não é afetado.</li>
              </ol>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  Se uma aula com mesmo evento + data + horário já existir, ela é <strong>atualizada</strong>{" "}
                  (não duplicada), e também recebe a marcação SEDUC para facilitar o rollback.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ── Manutenção de dados ───────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-lg bg-gray-100 p-2">
            <FileSpreadsheet className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-800">Manutenção de Dados</h2>
            <p className="text-xs text-gray-400">Rotinas de normalização e consistência</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <NormalizarButton />
        </div>
      </div>
    </div>
  );
}

function NormalizarButton() {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<any>(null);

  async function normalizar() {
    setLoading(true);
    try {
      const res = await adminApi.normalizarMaiusculas();
      setResultado(res);
      toast.success(
        `Normalizado: ${res.ucs_atualizadas} UCs, ${res.aulas_atualizadas} aulas, ${res.eventos_atualizados} eventos`
      );
    } catch {
      toast.error("Erro ao normalizar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 flex-1 min-w-64">
      <p className="text-sm font-medium text-gray-700 mb-1">Normalizar UCs e Disciplinas para Maiúsculas</p>
      <p className="text-xs text-gray-400 mb-3">
        Converte nomes de UCs, disciplinas de aulas e eventos para letras maiúsculas em todo o banco.
      </p>
      {resultado && (
        <p className="text-xs text-green-700 bg-green-50 rounded p-2 mb-3">
          ✓ {resultado.ucs_atualizadas} UCs · {resultado.aulas_atualizadas} aulas · {resultado.eventos_atualizados} eventos atualizados
        </p>
      )}
      <button
        onClick={normalizar}
        disabled={loading}
        className="btn-secondary text-sm flex items-center gap-2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
        {loading ? "Normalizando..." : "Executar normalização"}
      </button>
    </div>
  );
}
