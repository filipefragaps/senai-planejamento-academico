"use client";

import { useState } from "react";
import { AlertTriangle, Eye, EyeOff, Loader2, Lock, Trash2, X } from "lucide-react";

interface Props {
  titulo: string;
  children?: React.ReactNode;
  exigirSenha?: boolean;
  textoBotao?: string;
  carregando?: boolean;
  onConfirmar: (senha: string) => void;
  onCancelar: () => void;
}

/** Confirmação de exclusão; com `exigirSenha`, pede a senha (conferida no servidor). */
export function ModalConfirmacao({
  titulo, children, exigirSenha, textoBotao = "Excluir", carregando, onConfirmar, onCancelar,
}: Props) {
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const pronto = !exigirSenha || senha.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 shrink-0 rounded-lg bg-red-100 p-2"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
          <h3 className="flex-1 text-sm font-semibold text-gray-900">{titulo}</h3>
          <button onClick={onCancelar} className="text-gray-400 hover:text-gray-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 text-sm text-gray-700">{children}</div>

        {exigirSenha && (
          <label className="mt-4 block space-y-1">
            <span className="text-xs text-gray-600">Esta exclusão é irreversível. Digite sua senha para confirmar:</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input type={mostrar ? "text" : "password"} className="input pl-9 pr-9" value={senha} autoFocus
                     onChange={(e) => setSenha(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && pronto && !carregando && onConfirmar(senha)} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      onClick={() => setMostrar((m) => !m)} title={mostrar ? "Ocultar senha" : "Mostrar senha"}>
                {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancelar}>Cancelar</button>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={!pronto || carregando} onClick={() => onConfirmar(senha)}>
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {textoBotao}
          </button>
        </div>
      </div>
    </div>
  );
}
