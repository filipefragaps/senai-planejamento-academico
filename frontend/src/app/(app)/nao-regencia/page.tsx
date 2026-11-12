"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { NrFiltros, NrOpcoes, mesAtual, nrApi } from "@/lib/nao-regencia";
import { BarraFiltros } from "@/components/nao-regencia/ui";
import { Dashboard } from "@/components/nao-regencia/dashboard";
import { ProjetosLista } from "@/components/nao-regencia/projetos-lista";
import { Alocacao } from "@/components/nao-regencia/alocacao";
import { EntregasApontamentos } from "@/components/nao-regencia/entregas-apontamentos";
import { ConfigModal, Relatorios } from "@/components/nao-regencia/relatorios-config";

const ABAS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "projetos", label: "Projetos e atividades" },
  { key: "alocacao", label: "Alocação de professores" },
  { key: "entregas", label: "Entregas e apontamentos" },
  { key: "relatorios", label: "Relatórios" },
];

const CHAVE_FILTROS = "nr-filtros";

export default function NaoRegenciaPage() {
  const [aba, setAba] = useState("dashboard");
  const [filtros, setFiltrosState] = useState<NrFiltros>(() => mesAtual());
  const [config, setConfig] = useState(false);
  const { data: opcoes, isLoading } = useQuery<NrOpcoes>({ queryKey: ["nr-opcoes"], queryFn: nrApi.opcoes });
  const { data: projetos = [] } = useQuery({ queryKey: ["nr-projetos", "filtro"], queryFn: () => nrApi.projetos() });

  // Aba pela URL (?aba=) e filtros lembrados neste navegador
  useEffect(() => {
    const a = new URLSearchParams(window.location.search).get("aba");
    if (a && ABAS.some((x) => x.key === a)) setAba(a);
    try {
      const salvo = localStorage.getItem(CHAVE_FILTROS);
      if (salvo) setFiltrosState({ ...mesAtual(), ...JSON.parse(salvo) });
    } catch { /* sem armazenamento local */ }
  }, []);

  function setFiltros(f: NrFiltros) {
    setFiltrosState(f);
    try { localStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch { /* ignora */ }
  }

  function trocarAba(a: string) {
    setAba(a);
    const url = new URL(window.location.href);
    url.searchParams.set("aba", a);
    window.history.replaceState(null, "", url.toString());
  }

  if (isLoading || !opcoes) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  const camposFiltro = aba === "alocacao" ? ["periodo", "professor"]
    : aba === "projetos" ? ["professor", "unidade", "categoria", "responsavel", "situacao"]
    : aba === "entregas" ? [] : undefined;

  return (
    <div>
      <PageHeader title="Não Regência"
                  description="Atividades docentes fora da sala de aula: projetos, alocação de carga, entregas e horas validadas. O indicador de regência não é alterado.">
        {(opcoes.eu.gestao) && (
          <button className="btn-secondary gap-1.5" onClick={() => setConfig(true)}><Settings2 className="h-4 w-4" /> Configurações</button>
        )}
      </PageHeader>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {ABAS.map((a) => (
          <button key={a.key} onClick={() => trocarAba(a.key)}
                  className={cn("whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                    aba === a.key ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-800")}>
            {a.label}
          </button>
        ))}
      </div>

      {(camposFiltro === undefined || camposFiltro.length > 0) && (
        <BarraFiltros filtros={filtros} setFiltros={setFiltros} opcoes={opcoes} campos={camposFiltro} projetos={projetos} />
      )}

      {aba === "dashboard" && <Dashboard filtros={filtros} opcoes={opcoes} setFiltros={setFiltros} />}
      {aba === "projetos" && <ProjetosLista filtros={filtros} opcoes={opcoes} />}
      {aba === "alocacao" && <Alocacao filtros={filtros} opcoes={opcoes} />}
      {aba === "entregas" && <EntregasApontamentos opcoes={opcoes} />}
      {aba === "relatorios" && <Relatorios filtros={filtros} />}

      {config && <ConfigModal opcoes={opcoes} onClose={() => setConfig(false)} />}
    </div>
  );
}
