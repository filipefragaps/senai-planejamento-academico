"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Número com DDD, só dígitos e sem o 55 ('5562999990001' → '62999990001'). */
function numeroParaCopiar(tel: string) {
  return tel.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegador sem permissão de área de transferência: cópia pelo método antigo
    const campo = document.createElement("textarea");
    campo.value = texto;
    campo.style.position = "fixed";
    campo.style.opacity = "0";
    document.body.appendChild(campo);
    campo.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(campo);
    return ok;
  }
}

/** Botão de copiar o telefone do lead (não abre o lead ao clicar). */
export function CopiarTelefone({ telefone, className, tamanho = "h-3.5 w-3.5" }: {
  telefone?: string | null; className?: string; tamanho?: string;
}) {
  const [copiado, setCopiado] = useState(false);
  if (!telefone) return null;
  const numero = numeroParaCopiar(telefone);
  return (
    <button
      type="button"
      title={`Copiar telefone (${numero})`}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copiar(numero)) {
          setCopiado(true);
          toast.success(`Telefone ${numero} copiado`);
          setTimeout(() => setCopiado(false), 1500);
        } else {
          toast.error("Não foi possível copiar o telefone");
        }
      }}
      className={cn("text-gray-400 hover:text-primary", copiado && "text-green-600 hover:text-green-600", className)}
    >
      {copiado ? <Check className={tamanho} /> : <Copy className={tamanho} />}
    </button>
  );
}
