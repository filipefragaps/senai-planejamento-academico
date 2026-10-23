"use client";

// Gestão de Ponto: mesma tela da versão local v1.5 (v15/home.tsx), com os dados no banco da
// plataforma (v15/plataforma.tsx) em vez do armazenamento do navegador.
import { useEffect, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import "./v15/gp15.css";

export default function GestaoPontoPage() {
  const [Tela, setTela] = useState<ComponentType | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        // O e-mail do RH precisa estar carregado antes de a tela ser importada
        const { initialize } = await import("./v15/plataforma");
        await initialize();
        const tela = await import("./v15/home");
        if (ativo) setTela(() => tela.default);
      } catch (e: any) {
        if (!ativo) return;
        const detalhe = e?.response?.data?.detail;
        setErro(typeof detalhe === "string" ? detalhe : "Não foi possível carregar a Gestão de Ponto.");
      }
    })();
    return () => { ativo = false; };
  }, []);

  return (
    <div className="gp15 gp15-full">
      {Tela ? <Tela /> : (
        <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-slate-500">
          {erro ? <span className="font-semibold text-red-700">{erro}</span> : <><Loader2 className="h-4 w-4 animate-spin" /> Carregando Gestão de Ponto...</>}
        </div>
      )}
    </div>
  );
}
